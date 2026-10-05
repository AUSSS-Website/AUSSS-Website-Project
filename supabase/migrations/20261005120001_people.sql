-- Phase 5b, step 4: people, one source of truth.
--
-- Until now the public pages took officer names and photos from src/data/society.js, and the
-- committee page from an override the officer typed in. The profile of whoever holds the
-- position this term was not their source, so changing a name or a photo in the portal changed
-- nothing a visitor sees. This migration makes the profile the source and keeps the file as the
-- fallback for a position nobody has claimed:
--
--   bucket `avatars`        the photo a person chooses on their profile, '<profile id>/<id>.jpg'
--   profiles.photo_path     that object; profiles.avatar_url is what every byline shows (the
--                           chosen photo's public address, else the sign-in account's picture)
--   rpc/people_public()     anon: who holds each officer and board position this term, name and
--                           chosen photo only
--   rpc/directory()         members: the people who opted in, with their positions
--   the rebuild trigger     a change to anything the pre-rendered pages show asks for a rebuild;
--                           a scheduled job calls the hosting deploy hook once things settle,
--                           and once every night
--
-- With the board drawn from this term's assignments, changing the board is handing out a
-- position (rpc/invite_to_position, the migration before this one), and nothing else.

-- ---------------------------------------------------------------------------------------------
-- The photo a person chooses
-- ---------------------------------------------------------------------------------------------

-- Public bucket: an officer's photo is shown on the public pages. 1 MB; the portal sends a
-- 512 px JPEG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A person writes, lists and removes inside their own folder only. Nobody lists anybody
-- else's: the public address of a photo works without a policy, and that is the only way in.
drop policy if exists avatars_read_own on storage.objects;
create policy avatars_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- photo_path can only ever name an object in the person's own folder.
alter table public.profiles drop constraint if exists profiles_photo_path_own;
alter table public.profiles add constraint profiles_photo_path_own
  check (photo_path is null or (length(photo_path) <= 120 and photo_path like id::text || '/%'));

-- ---------------------------------------------------------------------------------------------
-- rpc/people_public: who holds the public-facing positions this term
-- ---------------------------------------------------------------------------------------------

-- Officers and the Executive Board are named on the public site already; this is the same
-- list, read from the accounts. Name and chosen photo only: never an email, never the sign-in
-- account's picture (nobody chose that for the site), never anyone below officer.
-- { people: [{ key, name, photo }] }, longest-serving holder first when a position has two.
create or replace function public.people_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('people', coalesce((
    select jsonb_agg(
      jsonb_build_object('key', p.key, 'name', btrim(pr.full_name), 'photo', pr.photo_path)
      order by p.key, a.created_at, a.id
    )
    from public.assignments a
    join public.positions p on p.id = a.position_id
    join public.profiles pr on pr.id = a.profile_id
    where a.status = 'active'
      and a.term_id = app.current_term_id()
      and p.level in ('officer', 'eb')
      and btrim(coalesce(pr.full_name, '')) <> ''
  ), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/directory: the members who opted in
-- ---------------------------------------------------------------------------------------------

-- For members (verified, or holding a position). Name, photo and this term's positions; the
-- opt-in is the switch on the profile page and is off by default.
create or replace function public.directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_member() then
    raise exception 'Members only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(entry order by entry ->> 'full_name', entry ->> 'id')
    from (
      select jsonb_build_object(
        'id', pr.id,
        'full_name', btrim(pr.full_name),
        'avatar_url', pr.avatar_url,
        'positions', coalesce((
          select jsonb_agg(
            jsonb_build_object('title', p.title, 'level', p.level, 'committee', c.abbr)
            order by app.level_rank(p.level) desc, p.sort
          )
          from public.assignments a
          join public.positions p on p.id = a.position_id
          left join public.committees c on c.id = p.committee_id
          where a.profile_id = pr.id and a.status = 'active' and a.term_id = app.current_term_id()
        ), '[]'::jsonb)
      ) as entry
      from public.profiles pr
      where pr.directory_opt_in
        and btrim(coalesce(pr.full_name, '')) <> ''
      limit 2000
    ) entries
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Rebuild on publish
-- ---------------------------------------------------------------------------------------------

-- The public pages are pre-rendered at build time with the gallery, the magazine shelf, the
-- published stories and (from now on) the people baked in. A visitor's browser refreshes all of
-- that live, so nothing is ever wrong for long; the rebuild is for what does not run
-- JavaScript: search engines and link previews.
--
-- Single row: when a rebuild was last asked for, and when one was last fired.
create table if not exists app.site_rebuild (
  id boolean primary key default true check (id),
  requested_at timestamptz,
  reason text,
  fired_at timestamptz,
  fired_reason text
);
insert into app.site_rebuild (id) values (true) on conflict (id) do nothing;
alter table app.site_rebuild enable row level security;
revoke all on app.site_rebuild from public, anon, authenticated;

create or replace function app.request_site_rebuild(p_reason text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update app.site_rebuild set requested_at = now(), reason = left(p_reason, 80) where id
$$;

-- Statement trigger for tables where any write shows on the site.
create or replace function app.touch_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.request_site_rebuild(tg_table_name);
  return null;
end
$$;

-- Row trigger for tables where only some rows show: the WHEN clause on each trigger decides.
create or replace function app.touch_site_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.request_site_rebuild(tg_table_name);
  return null;
end
$$;

-- An assignment matters when its position is one the public pages name.
create or replace function app.touch_site_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position uuid;
begin
  if tg_op = 'DELETE' then
    v_position := old.position_id;
  else
    v_position := new.position_id;
  end if;
  if exists (
    select 1 from public.positions p
    where p.id = v_position and p.level in ('officer', 'eb')
  ) then
    perform app.request_site_rebuild('assignments');
  end if;
  return null;
end
$$;

-- A profile matters when its name or chosen photo changed and it holds such a position.
create or replace function app.touch_site_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.profile_id = new.id and a.status = 'active'
      and a.term_id = app.current_term_id() and p.level in ('officer', 'eb')
  ) then
    perform app.request_site_rebuild('profiles');
  end if;
  return null;
end
$$;

drop trigger if exists touch_site on public.albums;
create trigger touch_site after insert or update or delete on public.albums
  for each statement execute function app.touch_site();
drop trigger if exists touch_site on public.gallery_photos;
create trigger touch_site after insert or update or delete on public.gallery_photos
  for each statement execute function app.touch_site();
drop trigger if exists touch_site on public.magazine_issues;
create trigger touch_site after insert or update or delete on public.magazine_issues
  for each statement execute function app.touch_site();

drop trigger if exists touch_site_update on public.stories;
create trigger touch_site_update after update on public.stories
  for each row when (new.status = 'published' or old.status = 'published')
  execute function app.touch_site_row();
drop trigger if exists touch_site_delete on public.stories;
create trigger touch_site_delete after delete on public.stories
  for each row when (old.status = 'published')
  execute function app.touch_site_row();

drop trigger if exists touch_site on public.committees;
create trigger touch_site after update on public.committees
  for each row when (new.page is distinct from old.page)
  execute function app.touch_site_row();

drop trigger if exists touch_site on public.assignments;
create trigger touch_site after insert or update or delete on public.assignments
  for each row execute function app.touch_site_assignment();

drop trigger if exists touch_site on public.profiles;
create trigger touch_site after update on public.profiles
  for each row
  when (new.full_name is distinct from old.full_name or new.photo_path is distinct from old.photo_path)
  execute function app.touch_site_profile();

-- Calls the hosting provider's deploy hook. The hook's address is a secret (anyone holding it
-- can start a deploy), so it lives in Vault under the name `site_deploy_hook` and is put there
-- by hand (docs/RUNBOOK.md); until it exists this function does nothing and says so.
--
-- Unforced, it fires only when something asked since the last rebuild, the last change is at
-- least three minutes old (an officer uploading forty photos gets one rebuild, at the end) and
-- the last rebuild is at least twenty minutes old (the hosting plan caps deploys per day).
create or replace function app.fire_site_rebuild(p_force boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hook text;
  v_state app.site_rebuild%rowtype;
begin
  select d.decrypted_secret into v_hook
  from vault.decrypted_secrets d where d.name = 'site_deploy_hook';
  if coalesce(v_hook, '') !~ '^https://' then
    return 'no hook';
  end if;

  select s.* into v_state from app.site_rebuild s where s.id for update;
  if not p_force then
    if v_state.requested_at is null
      or (v_state.fired_at is not null and v_state.fired_at >= v_state.requested_at)
    then
      return 'nothing to do';
    end if;
    if v_state.requested_at > now() - interval '3 minutes' then
      return 'settling';
    end if;
    if v_state.fired_at is not null and v_state.fired_at > now() - interval '20 minutes' then
      return 'cooling down';
    end if;
  end if;

  perform net.http_post(url := v_hook, body := '{}'::jsonb, timeout_milliseconds := 10000);
  update app.site_rebuild
     set fired_at = now(),
         fired_reason = case when p_force then 'nightly' else coalesce(v_state.reason, '') end
   where id;
  return 'fired';
end
$$;

-- What the Site settings page shows the Executive Board about the rebuilds.
create or replace function public.site_rebuild_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can see this.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'requested_at', s.requested_at, 'reason', s.reason,
      'fired_at', s.fired_at, 'fired_reason', s.fired_reason,
      'hook', exists (select 1 from vault.secrets v where v.name = 'site_deploy_hook')
    )
    from app.site_rebuild s where s.id
  );
end
$$;

select cron.unschedule(jobid) from cron.job where jobname in ('site-rebuild', 'site-rebuild-nightly', 'cron-history-trim');
-- every five minutes: is a rebuild wanted and due?
select cron.schedule('site-rebuild', '*/5 * * * *', $cron$ select app.fire_site_rebuild() $cron$);
-- every night at 02:30 UTC regardless, so dated content can never be more than a day stale
select cron.schedule('site-rebuild-nightly', '30 2 * * *', $cron$ select app.fire_site_rebuild(true) $cron$);
-- a five-minute job writes 288 history rows a day; a week of them is plenty
select cron.schedule(
  'cron-history-trim', '50 2 * * *',
  $cron$ delete from cron.job_run_details where end_time < now() - interval '7 days' $cron$
);

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function public.people_public() owner to postgres;
alter function public.directory() owner to postgres;
alter function public.site_rebuild_status() owner to postgres;
alter function app.request_site_rebuild(text) owner to postgres;
alter function app.touch_site() owner to postgres;
alter function app.touch_site_row() owner to postgres;
alter function app.touch_site_assignment() owner to postgres;
alter function app.touch_site_profile() owner to postgres;
alter function app.fire_site_rebuild(boolean) owner to postgres;

revoke execute on function app.request_site_rebuild(text) from public;
revoke execute on function app.touch_site() from public;
revoke execute on function app.touch_site_row() from public;
revoke execute on function app.touch_site_assignment() from public;
revoke execute on function app.touch_site_profile() from public;
revoke execute on function app.fire_site_rebuild(boolean) from public;

revoke execute on function public.people_public() from public;
grant execute on function public.people_public() to anon, authenticated;
revoke execute on function public.directory() from public, anon;
grant execute on function public.directory() to authenticated;
revoke execute on function public.site_rebuild_status() from public, anon;
grant execute on function public.site_rebuild_status() to authenticated;
