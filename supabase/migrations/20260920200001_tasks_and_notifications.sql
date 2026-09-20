-- Phase 3 (portal core), part 1: tasks and the notifications feed.
--
-- tasks: work an officer hands out, scoped to a committee (null committee = society-wide, EB
-- only) and a term. Visibility follows decision 5 of the plan: the assignees, the creator and
-- the committee's officers (EB included). One status per task; any assignee may move it, only a
-- manager (committee officer, or the creator while they may still assign there) edits the rest.
-- That split lives in app.guard_task(), which pins every other column for a non-manager, so the
-- client uses a plain update either way.
--
-- task_updates: the task's timeline. Clients insert comments only (column-level insert grant);
-- 'created', 'status', 'edited', 'assigned' and 'unassigned' rows are written by triggers.
--
-- notifications: the in-app feed and, later, the email digest queue (emailed_at). Rows are
-- written only by security-definer triggers; a person reads their own and may set read_at.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Somebody the society knows: verified by roster/EB, or holding a position this term.
create or replace function app.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.membership_status <> 'unverified'
  ) or exists (select 1 from app.my_levels())
$$;

-- Officers of the committee (EB everywhere), plus anyone whose position there carries the
-- can_assign_tasks flag. Null committee (society-wide) -> EB only.
create or replace function app.can_assign_tasks_in(p_committee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_officer_of(p_committee) or exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.profile_id = (select auth.uid())
      and a.status = 'active'
      and a.term_id = app.current_term_id()
      and p.can_assign_tasks
      and p.committee_id = p_committee
  )
$$;

-- Who a task may be handed to: people active in that committee this term; for a society-wide
-- task, anyone holding any position this term.
create or replace function app.is_assignable(p_committee uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.profile_id = p_profile
      and a.status = 'active'
      and a.term_id = app.current_term_id()
      and (p_committee is null or p.committee_id = p_committee)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid null references public.committees (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete restrict,
  title text not null check (title <> '' and length(title) <= 200),
  body text not null default '' check (length(body) <= 8000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'blocked', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- a Cairo calendar day, like calls.deadline; the day itself still counts as on time
  due_on date null,
  completed_at timestamptz null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_committee_id_status_idx on public.tasks (committee_id, status);
create index if not exists tasks_term_id_idx on public.tasks (term_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_open_due_on_idx on public.tasks (due_on) where status <> 'done';

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index if not exists task_assignees_profile_id_idx on public.task_assignees (profile_id);
create index if not exists task_assignees_assigned_by_idx on public.task_assignees (assigned_by);

create table if not exists public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid null references public.profiles (id) on delete set null,
  kind text not null default 'comment'
    check (kind in ('comment', 'created', 'status', 'edited', 'assigned', 'unassigned')),
  body text not null default '' check (length(body) <= 4000),
  -- status: { from, to }; assigned/unassigned: { profile_id }; edited: { fields: [] }
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_updates_task_id_created_at_idx
  on public.task_updates (task_id, created_at);
create index if not exists task_updates_author_id_idx on public.task_updates (author_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- task_assigned | task_status | task_comment (more kinds arrive with later phases)
  kind text not null check (kind <> '' and length(kind) <= 40),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  emailed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_id_created_at_idx
  on public.notifications (profile_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (profile_id) where read_at is null;
create index if not exists notifications_digest_idx
  on public.notifications (created_at) where read_at is null and emailed_at is null;

-- The daily digest is opt-out, per person (plan section 8).
alter table public.profiles add column if not exists email_digest boolean not null default true;
grant update (email_digest) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Visibility helpers that read the new tables (security definer, so policies never recurse)
-- ---------------------------------------------------------------------------------------------

create or replace function app.is_task_assignee(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_assignees ta
    where ta.task_id = p_task and ta.profile_id = (select auth.uid())
  )
$$;

-- Committee officer / EB, or the creator for as long as they may still assign in that committee.
create or replace function app.can_manage_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        app.is_officer_of(t.committee_id)
        or (t.created_by = (select auth.uid()) and app.can_assign_tasks_in(t.committee_id))
      )
  )
$$;

create or replace function app.can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (t.created_by = (select auth.uid()) or app.is_officer_of(t.committee_id))
  ) or app.is_task_assignee(p_task)
$$;

-- One notification per person involved in the task (creator + assignees), minus the actor.
create or replace function app.notify_task(p_task uuid, p_actor uuid, p_kind text, p_extra jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notifications (profile_id, kind, payload)
  select who.profile_id, p_kind,
         jsonb_build_object('task_id', t.id, 'title', t.title, 'committee_id', t.committee_id,
                            'actor_id', p_actor) || coalesce(p_extra, '{}'::jsonb)
  from public.tasks t
  cross join lateral (
    select t.created_by as profile_id
    union
    select ta.profile_id from public.task_assignees ta where ta.task_id = t.id
  ) who
  where t.id = p_task
    and who.profile_id is not null
    and who.profile_id is distinct from p_actor
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers: tasks
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.title := left(btrim(coalesce(new.title, '')), 200);
  new.body := left(btrim(coalesce(new.body, '')), 8000);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
    new.term_id := coalesce(new.term_id, app.current_term_id());
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- a task is never re-homed or re-attributed
  new.committee_id := old.committee_id;
  new.term_id := old.term_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- an assignee moves the status and nothing else (no session = service role / scripts)
  if v_uid is not null and not app.can_manage_task(old.id) then
    new.title := old.title;
    new.body := old.body;
    new.priority := old.priority;
    new.due_on := old.due_on;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end
$$;

create or replace function app.log_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.task_updates (task_id, author_id, kind)
    values (new.id, coalesce(v_uid, new.created_by), 'created');
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (new.id, v_uid, 'status', jsonb_build_object('from', old.status, 'to', new.status));
    perform app.notify_task(new.id, v_uid, 'task_status',
                            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.title is distinct from old.title then v_fields := v_fields || 'title'; end if;
  if new.body is distinct from old.body then v_fields := v_fields || 'body'; end if;
  if new.priority is distinct from old.priority then v_fields := v_fields || 'priority'; end if;
  if new.due_on is distinct from old.due_on then v_fields := v_fields || 'due_on'; end if;
  if cardinality(v_fields) > 0 then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (new.id, v_uid, 'edited', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return null;
end
$$;

drop trigger if exists guard_task on public.tasks;
create trigger guard_task before insert or update on public.tasks
  for each row execute function app.guard_task();
drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at before update on public.tasks
  for each row execute function app.set_updated_at();
drop trigger if exists log_task on public.tasks;
create trigger log_task after insert or update on public.tasks
  for each row execute function app.log_task();
drop trigger if exists audit on public.tasks;
create trigger audit after insert or update or delete on public.tasks
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Triggers: task_assignees
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_committee uuid;
begin
  select t.committee_id into v_committee from public.tasks t where t.id = new.task_id;
  if not found then
    raise exception 'That task no longer exists.' using errcode = '22023';
  end if;
  if not app.is_assignable(v_committee, new.profile_id) then
    raise exception 'That person does not hold a position there this term.' using errcode = '22023';
  end if;
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  new.created_at := now();
  return new;
end
$$;

create or replace function app.log_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text;
  v_committee uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (new.task_id, v_uid, 'assigned', jsonb_build_object('profile_id', new.profile_id));
    if new.profile_id is distinct from v_uid then
      select t.title, t.committee_id into v_title, v_committee
      from public.tasks t where t.id = new.task_id;
      insert into public.notifications (profile_id, kind, payload)
      values (new.profile_id, 'task_assigned',
              jsonb_build_object('task_id', new.task_id, 'title', v_title,
                                 'committee_id', v_committee, 'actor_id', v_uid));
    end if;
    return null;
  end if;

  -- when the task itself is being deleted the cascade lands here after the parent row is gone
  if exists (select 1 from public.tasks t where t.id = old.task_id) then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (old.task_id, v_uid, 'unassigned', jsonb_build_object('profile_id', old.profile_id));
  end if;
  return null;
end
$$;

drop trigger if exists guard_task_assignee on public.task_assignees;
create trigger guard_task_assignee before insert on public.task_assignees
  for each row execute function app.guard_task_assignee();
drop trigger if exists log_task_assignee on public.task_assignees;
create trigger log_task_assignee after insert or delete on public.task_assignees
  for each row execute function app.log_task_assignee();
drop trigger if exists audit on public.task_assignees;
create trigger audit after insert or update or delete on public.task_assignees
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Triggers: task_updates
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_task_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.body := left(btrim(coalesce(new.body, '')), 4000);
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  if new.kind = 'comment' and new.body = '' then
    raise exception 'Write something first.' using errcode = '22023';
  end if;
  return new;
end
$$;

create or replace function app.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify_task(new.task_id, new.author_id, 'task_comment',
                          jsonb_build_object('excerpt', left(new.body, 140)));
  return null;
end
$$;

drop trigger if exists guard_task_update on public.task_updates;
create trigger guard_task_update before insert on public.task_updates
  for each row execute function app.guard_task_update();
drop trigger if exists notify_task_comment on public.task_updates;
create trigger notify_task_comment after insert on public.task_updates
  for each row when (new.kind = 'comment') execute function app.notify_task_comment();

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- The assignee picker: names and positions only, for people who may assign in that committee.
-- Officers could read most of this through assignments + profiles, assistants with the
-- can_assign_tasks flag could not, so it is one definer function for both.
create or replace function public.task_assignable_people(committee uuid default null)
returns table (id uuid, full_name text, avatar_url text, position_title text, level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_assign_tasks_in(committee) then
    raise exception 'You cannot assign tasks there.' using errcode = '42501';
  end if;
  return query
    select distinct on (pr.id)
      pr.id, pr.full_name, pr.avatar_url, coalesce(p.short_title, p.title), p.level
    from public.assignments a
    join public.positions p on p.id = a.position_id
    join public.profiles pr on pr.id = a.profile_id
    where a.status = 'active'
      and a.term_id = app.current_term_id()
      and (committee is null or p.committee_id = committee)
    order by pr.id, app.level_rank(p.level) desc, p.sort;
end
$$;

-- Names for ids the caller already holds (task creators, assignees, comment authors, post
-- authors): profiles RLS hides fellow members from each other, and a timeline of blank names is
-- useless. Name and avatar only, members only, and only for ids they already know.
create or replace function public.profile_names(ids uuid[])
returns table (id uuid, full_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_member() then
    raise exception 'Members only.' using errcode = '42501';
  end if;
  return query
    select pr.id, pr.full_name, pr.avatar_url
    from public.profiles pr
    where pr.id = any ((coalesce(ids, '{}'::uuid[]))[1:200]);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------------------------

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_updates enable row level security;
alter table public.notifications enable row level security;

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, delete on public.task_assignees to authenticated;
grant select on public.task_updates to authenticated;
-- comments only: kind keeps its default and author_id is stamped by the trigger
grant insert (task_id, body) on public.task_updates to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.tasks, public.task_assignees, public.task_updates, public.notifications
  to service_role;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select app.is_officer_of(committee_id))
    or (select app.is_task_assignee(id))
  );
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((select app.can_assign_tasks_in(committee_id)));
-- assignees pass too; app.guard_task() limits them to the status column
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using ((select app.can_manage_task(id)) or (select app.is_task_assignee(id)))
  with check ((select app.can_manage_task(id)) or (select app.is_task_assignee(id)));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using ((select app.can_manage_task(id)));

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using ((select app.can_see_task(task_id)));
drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert on public.task_assignees
  for insert to authenticated
  with check ((select app.can_manage_task(task_id)));
drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete on public.task_assignees
  for delete to authenticated
  using ((select app.can_manage_task(task_id)));

drop policy if exists task_updates_select on public.task_updates;
create policy task_updates_select on public.task_updates
  for select to authenticated
  using ((select app.can_see_task(task_id)));
drop policy if exists task_updates_insert on public.task_updates;
create policy task_updates_insert on public.task_updates
  for insert to authenticated
  with check (
    kind = 'comment'
    and author_id = (select auth.uid())
    and (select app.can_see_task(task_id))
  );

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (profile_id = (select auth.uid()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.is_member() owner to postgres;
alter function app.can_assign_tasks_in(uuid) owner to postgres;
alter function app.is_assignable(uuid, uuid) owner to postgres;
alter function app.is_task_assignee(uuid) owner to postgres;
alter function app.can_manage_task(uuid) owner to postgres;
alter function app.can_see_task(uuid) owner to postgres;
alter function app.notify_task(uuid, uuid, text, jsonb) owner to postgres;
alter function app.guard_task() owner to postgres;
alter function app.log_task() owner to postgres;
alter function app.guard_task_assignee() owner to postgres;
alter function app.log_task_assignee() owner to postgres;
alter function app.guard_task_update() owner to postgres;
alter function app.notify_task_comment() owner to postgres;
alter function public.task_assignable_people(uuid) owner to postgres;
alter function public.profile_names(uuid[]) owner to postgres;

revoke execute on function app.is_member() from public;
revoke execute on function app.can_assign_tasks_in(uuid) from public;
revoke execute on function app.is_assignable(uuid, uuid) from public;
revoke execute on function app.is_task_assignee(uuid) from public;
revoke execute on function app.can_manage_task(uuid) from public;
revoke execute on function app.can_see_task(uuid) from public;
revoke execute on function app.notify_task(uuid, uuid, text, jsonb) from public;
revoke execute on function app.guard_task() from public;
revoke execute on function app.log_task() from public;
revoke execute on function app.guard_task_assignee() from public;
revoke execute on function app.log_task_assignee() from public;
revoke execute on function app.guard_task_update() from public;
revoke execute on function app.notify_task_comment() from public;
-- policy and guard helpers run as the caller; notify_task / is_assignable only inside definers
grant execute on function app.is_member() to authenticated;
grant execute on function app.can_assign_tasks_in(uuid) to authenticated;
grant execute on function app.is_task_assignee(uuid) to authenticated;
grant execute on function app.can_manage_task(uuid) to authenticated;
grant execute on function app.can_see_task(uuid) to authenticated;
-- app.guard_task() resolves the term for scripts that insert with the secret key too
grant execute on function app.current_term_id() to service_role;

revoke execute on function public.task_assignable_people(uuid) from public, anon;
revoke execute on function public.profile_names(uuid[]) from public, anon;
grant execute on function public.task_assignable_people(uuid) to authenticated;
grant execute on function public.profile_names(uuid[]) to authenticated;
