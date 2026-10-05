-- Phase 5b, step 2: file attachments on tasks.
--
-- An officer attaches files when creating a task; anyone who can see the task (its managers,
-- its creator, its assignees) attaches them to an update. The files sit in the private
-- Storage bucket `task-files` under '<task id>/<random id>.<ext>'; the name the person gave the
-- file is kept in public.task_files, never in the storage key.
--
-- The order of a write is: the browser uploads the objects (the storage policy lets in only
-- people who can see that task), then calls rpc/attach_task_files, which checks every path,
-- writes ONE timeline row for the batch (a comment when there is text, a 'files' row when there
-- is none) and links the files to it. A timeline row is therefore the unit: a comment and its
-- files arrive, are shown and are notified together.
--
-- Who may read a file = who may see the task. Who may delete one = whoever attached it, or a
-- manager of the task. Deleting a task cascades to the rows here; the browser removes the
-- objects first, while the policy can still tell who manages the task.

-- ---------------------------------------------------------------------------------------------
-- The timeline learns one more kind
-- ---------------------------------------------------------------------------------------------

alter table public.task_updates drop constraint if exists task_updates_kind_check;
alter table public.task_updates add constraint task_updates_kind_check
  check (kind in ('comment', 'created', 'status', 'edited', 'assigned', 'unassigned', 'files'));

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------

create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- the timeline row the file arrived with
  update_id uuid not null references public.task_updates (id) on delete cascade,
  -- bucket-relative: '<task id>/<random id>.<ext>'
  path text not null unique check (path <> '' and length(path) <= 200),
  name text not null check (name <> '' and length(name) <= 200),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  mime text not null default '' check (length(mime) <= 120),
  uploaded_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists task_files_task_id_idx on public.task_files (task_id);
create index if not exists task_files_update_id_idx on public.task_files (update_id);
create index if not exists task_files_uploaded_by_idx on public.task_files (uploaded_by);

alter table public.task_files enable row level security;

-- rows are written by rpc/attach_task_files only
grant select, delete on public.task_files to authenticated;
grant all on public.task_files to service_role;

drop policy if exists task_files_select on public.task_files;
create policy task_files_select on public.task_files
  for select to authenticated
  using ((select app.can_see_task(task_id)));
drop policy if exists task_files_delete on public.task_files;
create policy task_files_delete on public.task_files
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select app.can_manage_task(task_id)));

drop trigger if exists audit on public.task_files;
create trigger audit after insert or update or delete on public.task_files
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Storage: private bucket `task-files`
-- ---------------------------------------------------------------------------------------------

-- 10 MB a file. Documents, sheets, slides, PDFs, images, plain text and zip archives; nothing a
-- browser would run (no HTML, no SVG). Downloads go through signed URLs with a download name.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-files', 'task-files', false, 10485760,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The task a storage key belongs to: its first folder, when that is a uuid; null otherwise
-- (a null never passes a policy).
create or replace function app.task_file_task(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
    then left(p_name, 36)::uuid
  end
$$;

drop policy if exists task_files_read on storage.objects;
create policy task_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files' and (select app.can_see_task(app.task_file_task(name))));
drop policy if exists task_files_insert on storage.objects;
create policy task_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-files' and (select app.can_see_task(app.task_file_task(name))));
drop policy if exists task_files_delete on storage.objects;
create policy task_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (
      owner_id = (select auth.uid())::text
      or (select app.can_manage_task(app.task_file_task(name)))
    )
  );

-- ---------------------------------------------------------------------------------------------
-- RPC: link uploaded objects to a task, as one timeline row
-- ---------------------------------------------------------------------------------------------

-- p_files: [{ "path": "<task id>/<id>.<ext>", "name": "Budget.xlsx" }, ...], 1 to 5 a call,
-- 20 a task. Every path must be an object already in the bucket, under this task's folder,
-- not linked before. Size and type are read from Storage, not taken from the caller.
create or replace function public.attach_task_files(p_task uuid, p_files jsonb, p_body text default '')
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := left(btrim(coalesce(p_body, '')), 4000);
  v_count int;
  v_update uuid;
  v_first text;
begin
  if v_uid is null or not app.can_see_task(p_task) then
    raise exception 'That task is not shared with you.' using errcode = '42501';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'Choose at least one file.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_files);
  if v_count < 1 then
    raise exception 'Choose at least one file.' using errcode = '22023';
  end if;
  if v_count > 5 then
    raise exception 'Attach up to 5 files at a time.' using errcode = '22023';
  end if;
  if (select count(*) from public.task_files f where f.task_id = p_task) + v_count > 20 then
    raise exception 'A task holds up to 20 files. Remove one first.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_files) e
    where app.task_file_task(e ->> 'path') is distinct from p_task
       or btrim(coalesce(e ->> 'name', '')) = ''
       or not exists (
         select 1 from storage.objects s
         where s.bucket_id = 'task-files' and s.name = e ->> 'path'
       )
       or exists (select 1 from public.task_files f where f.path = e ->> 'path')
  ) or (select count(distinct e ->> 'path') from jsonb_array_elements(p_files) e) <> v_count then
    raise exception 'One of the files did not upload. Try again.' using errcode = '22023';
  end if;

  insert into public.task_updates (task_id, author_id, kind, body, meta)
  values (p_task, v_uid, case when v_body = '' then 'files' else 'comment' end, v_body,
          jsonb_build_object('files', v_count))
  returning id into v_update;

  insert into public.task_files (task_id, update_id, path, name, size_bytes, mime, uploaded_by)
  select p_task, v_update, e ->> 'path', left(btrim(e ->> 'name'), 200),
         coalesce(nullif(s.metadata ->> 'size', '')::bigint, 0),
         left(coalesce(s.metadata ->> 'mimetype', ''), 120),
         v_uid
  from jsonb_array_elements(p_files) with ordinality as t (e, n)
  join storage.objects s on s.bucket_id = 'task-files' and s.name = e ->> 'path'
  order by n;

  -- a comment notifies through its own trigger; files on their own need this
  if v_body = '' then
    select left(btrim(p_files -> 0 ->> 'name'), 140) into v_first;
    perform app.notify_task(p_task, v_uid, 'task_files',
                            jsonb_build_object('count', v_count, 'name', v_first));
  end if;

  return v_update;
end
$$;

alter function app.task_file_task(text) owner to postgres;
alter function public.attach_task_files(uuid, jsonb, text) owner to postgres;

revoke execute on function app.task_file_task(text) from public;
grant execute on function app.task_file_task(text) to authenticated;

revoke execute on function public.attach_task_files(uuid, jsonb, text) from public, anon;
grant execute on function public.attach_task_files(uuid, jsonb, text) to authenticated;
