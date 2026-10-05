-- Phase 6, step 1: the editor foundation. Pieces of the public site that are plain content
-- (the FAQ first; the incomings page, events and home sections after it) move out of
-- src/data into one table, each as a jsonb document with a working copy and a published copy.
--
-- One row per block. The row is created by a migration, never from the portal: a block only
-- means something when the site has a field schema for it (src/portal/content/schemas) and a
-- page that reads it, so "add an editable thing" stays one migration, one schema file and one
-- line in the page.
--
--   published  what every visitor sees; null until someone publishes, and the site then shows
--              the copy that ships in the code
--   draft      the working copy; null when there is nothing unpublished
--   editors    committee slugs whose officers may edit and publish the block, besides the EB
--
-- What a document holds is decided by its field schema in the portal, which also validates it
-- before saving. The database does not know the schemas: it holds a document to being a jsonb
-- object under 200 kB, and the site renders every value as text (the markdown fields through a
-- renderer that builds React elements and never HTML), so a document that skipped the portal
-- cannot inject markup.
--
-- Visitors never read the table. They get the published documents from rpc/content_public(),
-- so a draft is never exposed. Writes go through three functions, each of which checks
-- app.can_edit_content: save_content_draft, publish_content, discard_content_draft.

create table if not exists public.content_blocks (
  key text primary key,
  editors text[] not null default '{}',
  draft jsonb null,
  published jsonb null,
  draft_saved_at timestamptz null,
  draft_saved_by uuid null references public.profiles (id) on delete set null,
  published_at timestamptz null,
  published_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "<page>.<part>", lower case: join.faq, exchange.incomings
  constraint content_blocks_key_check check (key ~ '^[a-z][a-z0-9-]{0,39}(\.[a-z][a-z0-9-]{0,39}){1,2}$'),
  constraint content_blocks_draft_check
    check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 200000)),
  constraint content_blocks_published_check
    check (published is null or (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 200000))
);

create index if not exists content_blocks_draft_saved_by_idx on public.content_blocks (draft_saved_by);
create index if not exists content_blocks_published_by_idx on public.content_blocks (published_by);

drop trigger if exists set_updated_at on public.content_blocks;
create trigger set_updated_at before update on public.content_blocks
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.content_blocks;
create trigger audit after insert or update or delete on public.content_blocks
  for each row execute function app.audit();

-- The public pages are rebuilt when what visitors see changes, not on every draft.
drop trigger if exists touch_site on public.content_blocks;
create trigger touch_site after update on public.content_blocks
  for each row when (old.published is distinct from new.published)
  execute function app.touch_site_row();

-- ---------------------------------------------------------------------------------------------
-- The audit log names the row it is about. Two tables are keyed by `key` and not `id`
-- (site_settings, and content_blocks from today), and their entries had an empty row_id.
-- ---------------------------------------------------------------------------------------------

create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
  end if;

  insert into public.audit_log (actor, table_name, row_id, action, before, after)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key'),
    tg_op,
    v_before,
    v_after
  );
  return null;
end
$$;

update public.audit_log
set row_id = coalesce(after ->> 'key', before ->> 'key')
where row_id is null and table_name = 'site_settings';

-- ---------------------------------------------------------------------------------------------
-- Who may edit a block
-- ---------------------------------------------------------------------------------------------

-- The EB, or an officer of one of the committees the block names.
create or replace function app.is_content_editor(p_editors text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() or exists (
    select 1
    from unnest(coalesce(p_editors, '{}'::text[])) as e (slug)
    where app.is_officer_of(app.committee_id_by_slug(e.slug))
  )
$$;

-- The same question by key; false for a block that does not exist.
create or replace function app.can_edit_content(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select app.is_content_editor(b.editors) from public.content_blocks b where b.key = p_key),
    false
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS: editors read their blocks; nobody writes the table directly
-- ---------------------------------------------------------------------------------------------

alter table public.content_blocks enable row level security;

revoke all on public.content_blocks from public, anon, authenticated;
grant select on public.content_blocks to authenticated;
grant all on public.content_blocks to service_role;

drop policy if exists content_blocks_select on public.content_blocks;
create policy content_blocks_select on public.content_blocks
  for select to authenticated
  using ((select app.is_eb()) or app.is_content_editor(editors));

-- ---------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------

-- Shared checks. Returns the locked row. `p_base` is the updated_at the editor loaded; when
-- the row has moved on since, someone else saved in between and this save would undo theirs.
create or replace function app.content_block_for_write(p_key text, p_doc jsonb, p_base timestamptz)
returns public.content_blocks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.content_blocks;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select b.* into v_row from public.content_blocks b where b.key = p_key for update;
  if not found or not app.is_content_editor(v_row.editors) then
    raise exception 'You cannot edit that part of the site.' using errcode = '42501';
  end if;
  if p_doc is not null then
    if jsonb_typeof(p_doc) is distinct from 'object' then
      raise exception 'That is not a document the site can read.' using errcode = '22023';
    end if;
    if octet_length(p_doc::text) > 200000 then
      raise exception 'That is too long to save. Shorten the text and try again.' using errcode = '22023';
    end if;
  end if;
  if p_base is not null and date_trunc('milliseconds', v_row.updated_at) > p_base then
    raise exception 'Someone else saved this while you were editing. Reload to see their version before saving yours.'
      using errcode = '40001';
  end if;
  return v_row;
end
$$;

-- Keeps the working copy without changing what visitors see. A working copy equal to the
-- published one is no draft at all.
create or replace function public.save_content_draft(p_key text, p_doc jsonb, p_base timestamptz default null)
returns public.content_blocks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.content_blocks;
begin
  if p_doc is null then
    raise exception 'That is not a document the site can read.' using errcode = '22023';
  end if;
  v_row := app.content_block_for_write(p_key, p_doc, p_base);
  update public.content_blocks b
  set draft = case when p_doc = b.published then null else p_doc end,
      draft_saved_at = case when p_doc = b.published then null else now() end,
      draft_saved_by = case when p_doc = b.published then null else (select auth.uid()) end
  where b.key = p_key
  returning b.* into v_row;
  return v_row;
end
$$;

-- Makes a document the published one, and clears the working copy.
create or replace function public.publish_content(p_key text, p_doc jsonb, p_base timestamptz default null)
returns public.content_blocks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.content_blocks;
begin
  if p_doc is null then
    raise exception 'That is not a document the site can read.' using errcode = '22023';
  end if;
  v_row := app.content_block_for_write(p_key, p_doc, p_base);
  update public.content_blocks b
  set published = p_doc,
      published_at = now(),
      published_by = (select auth.uid()),
      draft = null,
      draft_saved_at = null,
      draft_saved_by = null
  where b.key = p_key
  returning b.* into v_row;
  return v_row;
end
$$;

-- Throws the working copy away; the published document is untouched.
create or replace function public.discard_content_draft(p_key text)
returns public.content_blocks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.content_blocks;
begin
  v_row := app.content_block_for_write(p_key, null, null);
  update public.content_blocks b
  set draft = null, draft_saved_at = null, draft_saved_by = null
  where b.key = p_key
  returning b.* into v_row;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The public read: every published document in one answer, { "blocks": { "<key>": {…} } }
-- ---------------------------------------------------------------------------------------------

create or replace function public.content_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'blocks',
    coalesce(
      (select jsonb_object_agg(b.key, b.published) from public.content_blocks b where b.published is not null),
      '{}'::jsonb
    )
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `content-media`, written by a block's editors under <block key>/…
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-media', 'content-media', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves its files by address without a policy; the select policy is for the
-- editors, who need to list and replace what they uploaded.
drop policy if exists content_media_read on storage.objects;
create policy content_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'content-media' and (select app.can_edit_content((storage.foldername(name))[1])));
drop policy if exists content_media_insert on storage.objects;
create policy content_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'content-media' and (select app.can_edit_content((storage.foldername(name))[1])));
drop policy if exists content_media_delete on storage.objects;
create policy content_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'content-media' and (select app.can_edit_content((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.audit() owner to postgres;
alter function app.is_content_editor(text[]) owner to postgres;
alter function app.can_edit_content(text) owner to postgres;
alter function app.content_block_for_write(text, jsonb, timestamptz) owner to postgres;
alter function public.save_content_draft(text, jsonb, timestamptz) owner to postgres;
alter function public.publish_content(text, jsonb, timestamptz) owner to postgres;
alter function public.discard_content_draft(text) owner to postgres;
alter function public.content_public() owner to postgres;

revoke execute on function app.audit() from public;
revoke execute on function app.is_content_editor(text[]) from public;
revoke execute on function app.can_edit_content(text) from public;
revoke execute on function app.content_block_for_write(text, jsonb, timestamptz) from public;
grant execute on function app.is_content_editor(text[]) to authenticated;
grant execute on function app.can_edit_content(text) to authenticated;

revoke execute on function public.save_content_draft(text, jsonb, timestamptz) from public, anon;
revoke execute on function public.publish_content(text, jsonb, timestamptz) from public, anon;
revoke execute on function public.discard_content_draft(text) from public, anon;
grant execute on function public.save_content_draft(text, jsonb, timestamptz) to authenticated;
grant execute on function public.publish_content(text, jsonb, timestamptz) to authenticated;
grant execute on function public.discard_content_draft(text) to authenticated;

revoke execute on function public.content_public() from public;
grant execute on function public.content_public() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The first block: the questions on /join. No published copy yet, so the page keeps showing
-- src/data/faq.js until the EB publishes from the portal.
-- ---------------------------------------------------------------------------------------------

insert into public.content_blocks (key, editors)
values ('join.faq', '{}')
on conflict (key) do nothing;
