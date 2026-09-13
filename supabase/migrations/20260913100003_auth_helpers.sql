-- Auth helpers used by RLS policies. All are stable, security definer, owned by postgres and run
-- with an empty search_path, so they read assignments/positions/terms directly (bypassing RLS)
-- and policies never recurse into each other. Each is granted only to the roles that evaluate
-- policies (authenticated; anon additionally for current_term_id) and revoked from PUBLIC.

-- The single term flagged is_current (null before reference data is loaded).
create or replace function app.current_term_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.terms t where t.is_current limit 1
$$;

-- Levels of the caller's active assignments in the current term.
create or replace function app.my_levels()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.level
  from public.assignments a
  join public.positions p on p.id = a.position_id
  where a.profile_id = (select auth.uid())
    and a.status = 'active'
    and a.term_id = app.current_term_id()
$$;

create or replace function app.is_webmaster()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.my_levels() as l(lvl) where l.lvl = 'webmaster')
$$;

-- "EB" for authorisation purposes means webmaster OR executive board.
create or replace function app.is_eb()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.my_levels() as l(lvl) where l.lvl in ('webmaster', 'eb'))
$$;

-- Committees where the caller holds ANY active assignment this term (society-wide rows excluded).
create or replace function app.my_committee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.committee_id
  from public.assignments a
  join public.positions p on p.id = a.position_id
  where a.profile_id = (select auth.uid())
    and a.status = 'active'
    and a.term_id = app.current_term_id()
    and p.committee_id is not null
$$;

-- EB, or an active officer-level assignment in that committee this term. Null committee -> EB only.
create or replace function app.is_officer_of(p_committee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() or exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.profile_id = (select auth.uid())
      and a.status = 'active'
      and a.term_id = app.current_term_id()
      and p.level = 'officer'
      and p.committee_id = p_committee
  )
$$;

create or replace function app.position_committee(p_position uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.committee_id from public.positions p where p.id = p_position
$$;

create or replace function app.position_level(p_position uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.level from public.positions p where p.id = p_position
$$;

-- Self, EB, or the caller is an officer of a committee where p_profile is active this term.
create or replace function app.can_view_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_profile = (select auth.uid()), false)
    or app.is_eb()
    or exists (
      select 1
      from public.assignments a
      join public.positions p on p.id = a.position_id
      join public.assignments mine on mine.profile_id = (select auth.uid())
      join public.positions mp on mp.id = mine.position_id
      where a.profile_id = p_profile
        and a.status = 'active'
        and a.term_id = app.current_term_id()
        and mine.status = 'active'
        and mine.term_id = a.term_id
        and mp.level = 'officer'
        and mp.committee_id is not null
        and mp.committee_id = p.committee_id
    )
$$;

-- EB may manage any position; a committee officer may manage positions below officer level in
-- their own committee (assistants, members). Society-wide positions are EB only.
create or replace function app.can_manage_position(p_position uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() or exists (
    select 1
    from public.positions p
    where p.id = p_position
      and p.committee_id is not null
      and app.level_rank(p.level) < app.level_rank('officer')
      and app.is_officer_of(p.committee_id)
  )
$$;

-- Ownership + grants. Default privileges in schema app already drop PUBLIC execute; the explicit
-- revokes make that hold for create-or-replace of pre-existing functions too.
alter function app.current_term_id() owner to postgres;
alter function app.my_levels() owner to postgres;
alter function app.is_webmaster() owner to postgres;
alter function app.is_eb() owner to postgres;
alter function app.my_committee_ids() owner to postgres;
alter function app.is_officer_of(uuid) owner to postgres;
alter function app.position_committee(uuid) owner to postgres;
alter function app.position_level(uuid) owner to postgres;
alter function app.can_view_profile(uuid) owner to postgres;
alter function app.can_manage_position(uuid) owner to postgres;

revoke execute on function app.current_term_id() from public;
revoke execute on function app.my_levels() from public;
revoke execute on function app.is_webmaster() from public;
revoke execute on function app.is_eb() from public;
revoke execute on function app.my_committee_ids() from public;
revoke execute on function app.is_officer_of(uuid) from public;
revoke execute on function app.position_committee(uuid) from public;
revoke execute on function app.position_level(uuid) from public;
revoke execute on function app.can_view_profile(uuid) from public;
revoke execute on function app.can_manage_position(uuid) from public;

grant execute on function app.current_term_id() to anon, authenticated;
grant execute on function app.my_levels() to authenticated;
grant execute on function app.is_webmaster() to authenticated;
grant execute on function app.is_eb() to authenticated;
grant execute on function app.my_committee_ids() to authenticated;
grant execute on function app.is_officer_of(uuid) to authenticated;
grant execute on function app.position_committee(uuid) to authenticated;
grant execute on function app.position_level(uuid) to authenticated;
grant execute on function app.can_view_profile(uuid) to authenticated;
grant execute on function app.can_manage_position(uuid) to authenticated;
