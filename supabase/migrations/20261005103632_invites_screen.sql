-- Phase 5b, step 3: the invites screen.
--
-- The pieces existed already: public.invites (a standing offer of a position, keyed by email,
-- that becomes an assignment at the person's first sign-in) and the roster, which keeps one
-- position per member and writes that invite itself. What was missing is a way to use them
-- from the portal for someone who is NOT on the committee's roster, to see what is still
-- waiting, to take an offer back, and to take a position away. Three functions do that:
--
--   rpc/committee_positions(committee)  who holds a position there this term and which
--                                       invites are still waiting; null = the society-level
--                                       positions (the Executive Board, the webmaster)
--   rpc/invite_to_position(email, pos)  offer a position to an address
--   rpc/remove_position(assignment)     end a position somebody holds
--
-- plus a wider delete policy on invites so "withdraw" is a plain delete.
--
-- One rule runs through all of it: a position that comes from the membership roster
-- (roster_entries.position_id) is changed on the roster, not here. Withdrawing or removing it
-- here would leave the roster saying one thing and the account another, so both are refused
-- with a message that says where to go.
--
-- The Executive Board is the same mechanism with committee = null. That is what makes the
-- board editable without an editor of its own: changing it is offering a position.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- True when the roster gives that address that position (so the roster owns it).
create or replace function app.position_from_roster(p_position uuid, p_email_normalized text, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roster_entries r
    where r.position_id = p_position
      and (
        (p_email_normalized is not null and r.email_normalized = p_email_normalized)
        or (p_profile is not null and r.profile_id = p_profile)
      )
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Withdrawing: an invite nobody has accepted may be deleted by whoever could have made it
-- ---------------------------------------------------------------------------------------------

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites
  for delete to authenticated
  using (
    (select app.is_eb())
    or (accepted_at is null and (select app.can_manage_position(position_id)))
  );

-- The roster's own invites are not withdrawn by hand (see the header).
create or replace function app.guard_invite_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- no session = the roster trigger, the importer or a script; they know what they are doing
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.accepted_at is null
    and old.term_id = app.current_term_id()
    and app.position_from_roster(old.position_id, old.email_normalized, null)
  then
    raise exception 'This position comes from the membership roster. Change it on the Members tab.'
      using errcode = '22023';
  end if;
  return old;
end
$$;

drop trigger if exists guard_invite_delete on public.invites;
create trigger guard_invite_delete before delete on public.invites
  for each row execute function app.guard_invite_delete();

-- ---------------------------------------------------------------------------------------------
-- rpc/committee_positions
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
begin
  if committee is null then
    if not app.is_eb() then
      raise exception 'Only the Executive Board can see the society-level positions.'
        using errcode = '42501';
    end if;
  elsif not app.is_officer_of(committee) then
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
        and p.committee_id is not distinct from committee_positions.committee
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
        and p.committee_id is not distinct from committee_positions.committee
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/invite_to_position
-- ---------------------------------------------------------------------------------------------

-- 'assigned' (an account with that address exists: the position is on it now) or 'invited'
-- (it waits for their first sign-in). Offering it twice is harmless. No email is sent: the
-- person is told by whoever invited them.
create or replace function public.invite_to_position(email text, "position" uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(email, '')));
  v_norm text;
  v_term uuid := app.current_term_id();
  v_profile uuid;
begin
  if not exists (select 1 from public.positions p where p.id = "position" and p.active)
    or not app.can_manage_position("position")
  then
    raise exception 'You cannot hand out that position.' using errcode = '42501';
  end if;
  if v_term is null then
    raise exception 'There is no current term.' using errcode = '22023';
  end if;
  if length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;
  v_norm := app.norm_email(v_email);

  -- the insert trigger turns it into an assignment when the account already exists
  insert into public.invites (email, position_id, term_id, invited_by)
  values (v_email, "position", v_term, auth.uid())
  on conflict (email_normalized, position_id, term_id) do nothing;

  select p.id into v_profile from public.profiles p
  where p.email_normalized = v_norm order by p.created_at limit 1;
  if v_profile is null then
    return 'invited';
  end if;

  -- held before and removed since: it comes back
  insert into public.assignments (profile_id, position_id, term_id)
  values (v_profile, "position", v_term)
  on conflict (profile_id, position_id, term_id)
    do update set status = 'active', ended_on = null;
  update public.invites i
     set accepted_at = coalesce(i.accepted_at, now()), accepted_profile_id = v_profile
   where i.email_normalized = v_norm and i.position_id = "position" and i.term_id = v_term;
  return 'assigned';
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/remove_position
-- ---------------------------------------------------------------------------------------------

-- Ends one active assignment of this term. Not your own (an officer or board member who
-- removed themselves could lock everyone out of that position), and not one the roster owns.
create or replace function public.remove_position(assignment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.assignments%rowtype;
  v_norm text;
begin
  select a.* into v_row from public.assignments a where a.id = assignment for update;
  if not found or not app.can_manage_position(v_row.position_id) then
    raise exception 'You cannot remove that position.' using errcode = '42501';
  end if;
  if v_row.profile_id = auth.uid() then
    raise exception 'You cannot remove your own position. Ask another member of the Executive Board.'
      using errcode = '22023';
  end if;
  select p.email_normalized into v_norm from public.profiles p where p.id = v_row.profile_id;
  if app.position_from_roster(v_row.position_id, v_norm, v_row.profile_id) then
    raise exception 'This position comes from the membership roster. Change it on the Members tab.'
      using errcode = '22023';
  end if;

  update public.assignments
     set status = 'ended', ended_on = current_date
   where id = v_row.id and status = 'active';
  -- the offer goes too, so offering it again later starts clean
  delete from public.invites i
   where i.position_id = v_row.position_id and i.term_id = v_row.term_id
     and (i.accepted_profile_id = v_row.profile_id or i.email_normalized = v_norm);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.position_from_roster(uuid, text, uuid) owner to postgres;
alter function app.guard_invite_delete() owner to postgres;
alter function public.committee_positions(uuid) owner to postgres;
alter function public.invite_to_position(text, uuid) owner to postgres;
alter function public.remove_position(uuid) owner to postgres;

revoke execute on function app.position_from_roster(uuid, text, uuid) from public;
revoke execute on function app.guard_invite_delete() from public;

revoke execute on function public.committee_positions(uuid) from public, anon;
revoke execute on function public.invite_to_position(text, uuid) from public, anon;
revoke execute on function public.remove_position(uuid) from public, anon;
grant execute on function public.committee_positions(uuid) to authenticated;
grant execute on function public.invite_to_position(text, uuid) to authenticated;
grant execute on function public.remove_position(uuid) to authenticated;
