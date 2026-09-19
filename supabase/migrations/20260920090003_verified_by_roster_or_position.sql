-- Who counts as verified the moment they sign in. Two gaps in app.claim_for_profile:
--
--   1. A roster row whose status was blank or unusual linked the profile but left it
--      'unverified', so a person the Secretary General lists had to ask for verification anyway.
--      Being on the roster IS the verification: such a profile now becomes at least 'candidate'.
--      Archived and suspended rows still change nothing.
--   2. Holding a position said nothing about membership. Every Team of Officials and Executive
--      Board email has a standing invite, but an officer who signs in with an address that is not
--      on the roster (a personal one, a role mailbox) stayed 'unverified' while holding the
--      position. An active assignment now verifies its holder, whatever route created it (invite
--      at sign-up, invite for an existing profile, or the EB assigning by hand), through one
--      trigger on public.assignments.
--
-- Both only ever lift an 'unverified' profile, so an EB decision is never overwritten.

create or replace function app.claim_for_profile(p_profile uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_membership text;
  v_roster public.roster_entries%rowtype;
  v_norm_status text;
begin
  select p.email_normalized, p.membership_status
    into v_email, v_membership
  from public.profiles p
  where p.id = p_profile;

  if v_email is null then
    return;
  end if;

  -- (1) roster link
  if not exists (select 1 from public.roster_entries r where r.profile_id = p_profile) then
    select r.*
      into v_roster
    from public.roster_entries r
    where r.email_normalized = v_email
      and r.profile_id is null
    order by
      (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%') asc,
      case
        when r.status ilike '%full%' then 3
        when r.status ilike '%associate%' then 2
        when r.status ilike '%candidate%' then 1
        else 0
      end desc,
      r.joined_year desc nulls last,
      r.imported_at desc
    limit 1;

    if found then
      update public.roster_entries
        set profile_id = p_profile
      where id = v_roster.id;

      if v_membership = 'unverified' then
        v_norm_status := app.normalize_text(v_roster.status);
        update public.profiles
          set membership_status = case
                when v_norm_status like '%archiv%' or v_norm_status like '%suspend%' then membership_status
                when v_norm_status like '%full%' or v_norm_status like '%associate%' then 'active'
                when v_norm_status like '%alumni%' or v_norm_status like '%honor%' then 'alumni'
                -- candidate, blank or anything else: on the roster means a member
                else 'candidate'
              end,
              membership_tier = coalesce(v_roster.status, membership_tier),
              joined_year = coalesce(v_roster.joined_year, joined_year)
        where id = p_profile;
      end if;
    end if;
  end if;

  -- (2) standing invites -> assignments (app.verify_position_holder then verifies the holder)
  insert into public.assignments (profile_id, position_id, term_id)
  select p_profile, i.position_id, i.term_id
  from public.invites i
  where i.email_normalized = v_email
    and i.accepted_at is null
  on conflict (profile_id, position_id, term_id) do nothing;

  update public.invites
    set accepted_at = now(),
        accepted_profile_id = p_profile
  where email_normalized = v_email
    and accepted_at is null;
end
$$;

-- after insert/update on assignments: an active assignment verifies an unverified holder.
-- Security definer because officers may add assignments but nobody may write membership_status.
create or replace function app.verify_position_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    update public.profiles p
      set membership_status = 'active'
    where p.id = new.profile_id
      and p.membership_status = 'unverified';
  end if;
  return null;
end
$$;

drop trigger if exists verify_position_holder on public.assignments;
create trigger verify_position_holder
  after insert or update of status on public.assignments
  for each row execute function app.verify_position_holder();

alter function app.claim_for_profile(uuid) owner to postgres;
alter function app.verify_position_holder() owner to postgres;
revoke execute on function app.claim_for_profile(uuid) from public, anon, authenticated, service_role;
revoke execute on function app.verify_position_holder() from public;

-- Catch up everyone who signed in under the old rules: position holders first, then anyone a
-- re-claim can now link or lift.
update public.profiles p
  set membership_status = 'active'
where p.membership_status = 'unverified'
  and exists (
    select 1 from public.assignments a where a.profile_id = p.id and a.status = 'active'
  );

update public.profiles p
  set membership_status = case
        when app.normalize_text(r.status) like '%full%' or app.normalize_text(r.status) like '%associate%' then 'active'
        when app.normalize_text(r.status) like '%alumni%' or app.normalize_text(r.status) like '%honor%' then 'alumni'
        else 'candidate'
      end,
      membership_tier = coalesce(r.status, p.membership_tier),
      joined_year = coalesce(r.joined_year, p.joined_year)
from public.roster_entries r
where r.profile_id = p.id
  and p.membership_status = 'unverified'
  and not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%');

select app.claim_unlinked();
