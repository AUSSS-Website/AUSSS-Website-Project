-- The exchange officers share one members list.
--
-- SCOPE and SCORE are two committees (two public pages, two sets of officers) that run exchange
-- as one team: the assistants and members work for both, and the membership sheet files them
-- under "Exchange". The Roster page already offers the two as one choice, SCOPE/SCORE, and
-- files the shared members under SCOPE. Until now that left SCORE's officer without them: the
-- Members tab, the position picker, the notes and the task assignee list all asked "is this
-- person in MY committee?".
--
-- This migration gives a committee an optional roster group (committees.roster_group) and
-- makes exactly these things group-wide:
--
--   * who sees and manages the members list   rpc/committee_roster, rpc/assign_roster_member,
--                                             rpc/committee_positions, member_notes
--   * who hands out positions below officer   app.can_manage_position (so invites and
--                                             rpc/remove_position follow)
--   * who can be given a task                 app.is_assignable, rpc/task_assignable_people
--
-- Everything else stays per committee, on purpose: each committee's public page, its open
-- calls and applications, its updates, and who may create or manage its tasks still belong to
-- that committee's own officers (app.is_officer_of is untouched). An officer of one exchange
-- committee does not become an officer of the other; they share the people.

-- ---------------------------------------------------------------------------------------------
-- The group
-- ---------------------------------------------------------------------------------------------

alter table public.committees
  add column if not exists roster_group text null
    check (roster_group is null or roster_group ~ '^[a-z][a-z0-9-]{1,30}$');

update public.committees set roster_group = 'exchange' where slug in ('scope', 'score');

-- The committees that share a roster with this one, itself included ('{}' for null or an
-- unknown id).
create or replace function app.roster_group_ids(p_committee uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c2.id), '{}'::uuid[])
  from public.committees c1
  join public.committees c2
    on c2.id = c1.id
    or (c1.roster_group is not null and c2.roster_group = c1.roster_group)
  where c1.id = p_committee
$$;

-- An officer of the committee or of one that shares its roster; the Executive Board always.
create or replace function app.is_roster_officer_of(p_committee uuid)
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
      and p.committee_id = any (app.roster_group_ids(p_committee))
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Positions below officer are handed out by the officers who share the roster
-- ---------------------------------------------------------------------------------------------

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
      and app.is_roster_officer_of(p.committee_id)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Officer notes: read and written by the officers who share the roster
-- ---------------------------------------------------------------------------------------------

drop policy if exists member_notes_select on public.member_notes;
create policy member_notes_select on public.member_notes
  for select to authenticated
  using ((select app.is_roster_officer_of(committee_id)) and not (select app.is_own_roster_entry(roster_entry_id)));

drop policy if exists member_notes_insert on public.member_notes;
create policy member_notes_insert on public.member_notes
  for insert to authenticated
  with check ((select app.is_roster_officer_of(committee_id)) and not (select app.is_own_roster_entry(roster_entry_id)));

drop policy if exists member_notes_update on public.member_notes;
create policy member_notes_update on public.member_notes
  for update to authenticated
  using (author_id = (select auth.uid()) and (select app.is_roster_officer_of(committee_id)))
  with check (author_id = (select auth.uid()) and (select app.is_roster_officer_of(committee_id)));

drop policy if exists member_notes_delete on public.member_notes;
create policy member_notes_delete on public.member_notes
  for delete to authenticated
  using (
    (author_id = (select auth.uid()) and (select app.is_roster_officer_of(committee_id)))
    or (select app.is_eb())
  );

-- ---------------------------------------------------------------------------------------------
-- rpc/committee_roster: the members of the committee and of the ones it shares a roster with
-- ---------------------------------------------------------------------------------------------

-- As 20260921100001, with `committee_id` (the committee the row is filed under, which is what
-- a note about the member is filed under too) and every "this committee" widened to the group.
create or replace function public.committee_roster(committee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid[] := app.roster_group_ids(committee);
begin
  if committee is null or not app.is_roster_officer_of(committee) then
    raise exception 'only that committee''s officers and the executive board can see its roster'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id, 'full_name', r.full_name, 'email', r.email, 'status', r.status,
        'joined_year', r.joined_year, 'years_spent', r.years_spent, 'lgas', r.lgas, 'ngas', r.ngas,
        'current_position', r.current_position, 'is_contact_person', r.is_contact_person,
        'profile_id', r.profile_id, 'committee_id', r.committee_id,
        'position', (
          select jsonb_build_object('id', p.id, 'title', p.title, 'level', p.level)
          from public.positions p where p.id = r.position_id
        ),
        'positions', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'level', p.level) order by p.sort)
          from public.assignments a
          join public.positions p on p.id = a.position_id
          where a.profile_id = r.profile_id
            and a.status = 'active'
            and a.term_id = app.current_term_id()
            and p.committee_id = any (v_group)
        ), '[]'::jsonb),
        'invited', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.sort)
          from public.invites i
          join public.positions p on p.id = i.position_id
          where i.email_normalized = r.email_normalized
            and i.accepted_at is null
            and i.term_id = app.current_term_id()
            and p.committee_id = any (v_group)
        ), '[]'::jsonb),
        'notes', case when r.profile_id is not distinct from auth.uid() then 0 else (
          select count(*) from public.member_notes n
          where n.roster_entry_id = r.id and n.committee_id = any (v_group)
        ) end
      )
      order by r.full_name, r.id
    )
    from public.roster_entries r
    where r.committee_id = any (v_group)
      and not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%')
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/assign_roster_member: any position below officer of the group
-- ---------------------------------------------------------------------------------------------

-- As 20260921100001. The member may be filed under any committee of the group the position
-- belongs to, and is refiled under the position's own committee (a roster row's position is
-- always one of its committee's).
create or replace function public.assign_roster_member(entry uuid, "position" uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.roster_entries%rowtype;
  v_committee uuid;
  v_term uuid := app.current_term_id();
begin
  select p.committee_id into v_committee from public.positions p where p.id = "position" and p.active;
  if v_committee is null or not app.can_manage_position("position") then
    raise exception 'You cannot hand out that position.' using errcode = '42501';
  end if;
  select r.* into v_row from public.roster_entries r where r.id = entry for update;
  if not found or v_row.committee_id is null
    or not (v_row.committee_id = any (app.roster_group_ids(v_committee)))
  then
    raise exception 'That member is not on this committee''s roster.' using errcode = '22023';
  end if;
  -- an officer moves members between the positions below their own, never out of a senior one
  if v_row.position_id is not null and not app.can_manage_position(v_row.position_id) then
    raise exception 'Only the Executive Board can change that member''s position.' using errcode = '42501';
  end if;

  update public.roster_entries set position_id = "position", committee_id = v_committee where id = entry;

  return case
    when v_row.email_normalized is null then 'noted'
    when exists (
      select 1 from public.assignments a
      join public.profiles pr on pr.id = a.profile_id
      where pr.email_normalized = v_row.email_normalized
        and a.position_id = "position" and a.term_id = v_term and a.status = 'active'
    ) then 'assigned'
    else 'invited' end;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/committee_positions: holders and waiting invites across the group
-- ---------------------------------------------------------------------------------------------

create or replace function public.committee_positions(committee uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term uuid := app.current_term_id();
  v_group uuid[] := app.roster_group_ids(committee);
begin
  if committee is null then
    if not app.is_eb() then
      raise exception 'Only the Executive Board can see the society-level positions.'
        using errcode = '42501';
    end if;
  elsif not app.is_roster_officer_of(committee) then
    raise exception 'Only that committee''s officers and the Executive Board can see its positions.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'holders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assignment_id', a.id,
          'profile_id', pr.id,
          'full_name', pr.full_name,
          'email', pr.email,
          'avatar_url', pr.avatar_url,
          'since', a.created_at,
          'position', jsonb_build_object('id', p.id, 'key', p.key, 'title', p.title, 'level', p.level),
          'from_roster', app.position_from_roster(p.id, pr.email_normalized, pr.id),
          'can_remove', app.can_manage_position(p.id) and pr.id is distinct from auth.uid()
        )
        order by app.level_rank(p.level) desc, p.sort, pr.full_name, a.id
      )
      from public.assignments a
      join public.positions p on p.id = a.position_id
      join public.profiles pr on pr.id = a.profile_id
      where a.status = 'active'
        and a.term_id = v_term
        and ((committee_positions.committee is null and p.committee_id is null)
             or p.committee_id = any (v_group))
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'email', i.email,
          'created_at', i.created_at,
          'invited_by', (select b.full_name from public.profiles b where b.id = i.invited_by),
          'position', jsonb_build_object('id', p.id, 'key', p.key, 'title', p.title, 'level', p.level),
          'from_roster', app.position_from_roster(p.id, i.email_normalized, null),
          'can_withdraw', app.can_manage_position(p.id)
        )
        order by i.created_at desc, i.id
      )
      from public.invites i
      join public.positions p on p.id = i.position_id
      where i.accepted_at is null
        and i.term_id = v_term
        and ((committee_positions.committee is null and p.committee_id is null)
             or p.committee_id = any (v_group))
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Tasks: a committee's task can be given to anyone on the roster it shares
-- ---------------------------------------------------------------------------------------------

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
      and (p_committee is null or p.committee_id = any (app.roster_group_ids(p_committee)))
  )
$$;

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
      and (committee is null or p.committee_id = any (app.roster_group_ids(committee)))
    order by pr.id, app.level_rank(p.level) desc, p.sort;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.roster_group_ids(uuid) owner to postgres;
alter function app.is_roster_officer_of(uuid) owner to postgres;

revoke execute on function app.roster_group_ids(uuid) from public;
revoke execute on function app.is_roster_officer_of(uuid) from public;
-- both run inside the member_notes policies, as the caller
grant execute on function app.roster_group_ids(uuid) to authenticated;
grant execute on function app.is_roster_officer_of(uuid) to authenticated;
