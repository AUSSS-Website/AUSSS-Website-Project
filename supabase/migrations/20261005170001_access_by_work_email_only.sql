-- Access belongs to the work emails. A position on the roster does not give it.
--
-- The roster lists people under their personal emails, and since 20260921100001 a roster
-- row's position reached that email's account by itself. For a member or an assistant that is
-- right: it is what lets them receive tasks. For an officer, a board member or the webmaster it
-- is wrong: those positions open the committee editors, the gallery and magazine editors, the
-- submissions and the board's pages, and the society runs them from the positions' own work
-- accounts (the role inboxes), handed over each term. A personal email is a normal member.
--
-- So, from here:
--
--   * a roster row may still SAY that somebody is the LORE or the President (a record of who
--     holds what), but for a position of level officer, eb or webmaster the roster creates no
--     invite and no assignment, and removes none either;
--   * positions below officer keep working as before;
--   * access to an officer's or the board's pages is given in one way only: an invite to the
--     position's work email (the Invites tab, or Executive Board on the Roster page, both
--     limited to the Executive Board for these positions).
--
-- The clean-up at the end removes the offers the old behaviour left waiting.

-- ---------------------------------------------------------------------------------------------
-- Which positions open editors and admin pages
-- ---------------------------------------------------------------------------------------------

create or replace function app.position_is_privileged(p_position uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.positions p
    where p.id = p_position and p.level in ('officer', 'eb', 'webmaster')
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- The roster reaches accounts for positions below officer only
-- ---------------------------------------------------------------------------------------------

-- As 20260921100001, skipping privileged positions on both sides: none is offered, and an
-- old one is not "ended" either, because the roster never gave it.
create or replace function app.sync_roster_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term uuid := app.current_term_id();
begin
  if v_term is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
    and new.position_id is not distinct from old.position_id
    and new.email_normalized is not distinct from old.email_normalized
    and new.profile_id is not distinct from old.profile_id
  then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.position_id is not null
    and not app.position_is_privileged(old.position_id)
    and (old.position_id is distinct from new.position_id
         or old.email_normalized is distinct from new.email_normalized)
  then
    delete from public.invites i
    where i.position_id = old.position_id and i.term_id = v_term
      and i.email_normalized = old.email_normalized and i.accepted_at is null;
    update public.assignments a
       set status = 'ended', ended_on = current_date
     where a.position_id = old.position_id and a.term_id = v_term and a.status = 'active'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = old.profile_id or p.email_normalized = old.email_normalized);
  end if;

  if new.position_id is not null and new.email_normalized is not null
    and not app.position_is_privileged(new.position_id)
  then
    insert into public.invites (email, position_id, term_id, invited_by)
    values (new.email, new.position_id, v_term, auth.uid())
    on conflict (email_normalized, position_id, term_id) do nothing;
    update public.assignments a
       set status = 'active', ended_on = null
     where a.position_id = new.position_id and a.term_id = v_term and a.status = 'ended'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = new.profile_id or p.email_normalized = new.email_normalized);
  end if;
  return null;
end
$$;

-- The roster "owns" an invite or an assignment only for the positions it gives. A privileged
-- one is never the roster's, so it can always be withdrawn or removed from the invites screen.
create or replace function app.position_from_roster(p_position uuid, p_email_normalized text, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.position_is_privileged(p_position) and exists (
    select 1 from public.roster_entries r
    where r.position_id = p_position
      and (
        (p_email_normalized is not null and r.email_normalized = p_email_normalized)
        or (p_profile is not null and r.profile_id = p_profile)
      )
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/assign_roster_member says so
-- ---------------------------------------------------------------------------------------------

-- As 20261005112802, with a fourth answer: 'recorded' for a privileged position (the roster
-- now says who holds it; the account of that email is not touched).
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
    when app.position_is_privileged("position") then 'recorded'
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
-- Clean-up: what the roster had already offered or given
-- ---------------------------------------------------------------------------------------------

-- Offers nobody accepted yet: a privileged position waiting for the roster email's first
-- sign-in. The invites made for the work emails are not on the roster and stay.
delete from public.invites i
where i.accepted_at is null
  and app.position_is_privileged(i.position_id)
  and exists (
    select 1 from public.roster_entries r
    where r.position_id = i.position_id and r.email_normalized = i.email_normalized
  );

-- Nothing had been accepted: on 2026-10-05 no account held a privileged position because of
-- its roster row (the two that hold one, the LORE's and the webmaster's, are work accounts
-- invited by address), so there is no assignment to end here.

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.position_is_privileged(uuid) owner to postgres;
revoke execute on function app.position_is_privileged(uuid) from public;
