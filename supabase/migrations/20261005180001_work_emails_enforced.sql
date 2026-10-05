-- The work emails, enforced.
--
-- 20261005170001 closed one route: a position on a roster row no longer gives an officer's or
-- the board's access. It left the rule itself to whoever types an address into an invite. This
-- migration makes the database hold it:
--
--   every position of level officer, eb or webmaster has ONE work email
--   (public.position_work_emails), and that position can only ever be held by the account of
--   that address.
--
-- Three doors lead to holding a position, and each now checks:
--   * offering it        rpc/invite_to_position, and a direct insert or update of an invite
--   * accepting it       app.handle_new_invite (the account already exists) and
--                        app.claim_for_profile (first sign-in): an offer of such a position to
--                        any other address is never turned into an assignment, however it got
--                        into the table
--   * being given it     a direct insert or update of an assignment
--
-- A position below officer is not affected: members and assistants hold theirs on whatever
-- email the roster or an invite names.
--
-- The work emails are the role inboxes the society already uses (src/data/society.js lists
-- them as each role's `email`). They are seeded below from the invites that reference data
-- made for them, and edited by the Executive Board in the portal; only the webmaster changes
-- the webmaster's. Changing one does not move anybody's access: the account that holds the
-- position keeps it until it is removed, and the new address is then invited.

-- ---------------------------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------------------------

-- Its own table, not a column on positions: positions is readable by visitors, and which
-- address controls which role is the Executive Board's to see.
create table if not exists public.position_work_emails (
  position_id uuid primary key references public.positions (id) on delete cascade,
  email text not null check (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized text generated always as (app.norm_email(email)) stored,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles (id) on delete set null
);

create index if not exists position_work_emails_updated_by_idx on public.position_work_emails (updated_by);

-- before insert/update: tidy the address, stamp who, and keep the table to the positions it
-- is for.
create or replace function app.guard_position_work_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(btrim(coalesce(new.email, '')));
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' then
    new.position_id := old.position_id;
  end if;
  if not app.position_is_privileged(new.position_id) then
    raise exception 'Only an officer''s, a board member''s or the webmaster''s position has a work email.'
      using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists guard_position_work_email on public.position_work_emails;
create trigger guard_position_work_email before insert or update on public.position_work_emails
  for each row execute function app.guard_position_work_email();
drop trigger if exists audit on public.position_work_emails;
create trigger audit after insert or update or delete on public.position_work_emails
  for each row execute function app.audit();

alter table public.position_work_emails enable row level security;
revoke all on public.position_work_emails from anon, authenticated;
grant select, delete on public.position_work_emails to authenticated;
grant insert (position_id, email) on public.position_work_emails to authenticated;
grant update (email) on public.position_work_emails to authenticated;
grant all on public.position_work_emails to service_role;

-- The Executive Board, and for the webmaster's own position the webmaster alone: otherwise a
-- board member could point that position at an address of their own.
create or replace function app.can_set_work_email(p_position uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() and (
    app.is_webmaster()
    or not exists (select 1 from public.positions p where p.id = p_position and p.level = 'webmaster')
  )
$$;

drop policy if exists position_work_emails_select on public.position_work_emails;
create policy position_work_emails_select on public.position_work_emails
  for select to authenticated
  using ((select app.is_eb()));
drop policy if exists position_work_emails_insert on public.position_work_emails;
create policy position_work_emails_insert on public.position_work_emails
  for insert to authenticated
  with check ((select app.can_set_work_email(position_id)));
drop policy if exists position_work_emails_update on public.position_work_emails;
create policy position_work_emails_update on public.position_work_emails
  for update to authenticated
  using ((select app.can_set_work_email(position_id)))
  with check ((select app.can_set_work_email(position_id)));
drop policy if exists position_work_emails_delete on public.position_work_emails;
create policy position_work_emails_delete on public.position_work_emails
  for delete to authenticated
  using ((select app.can_set_work_email(position_id)));

-- ---------------------------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------------------------

-- May this address hold this position? Always for a position below officer; for the others
-- only when it is the position's work email (so never, while none is set).
create or replace function app.work_email_ok(p_position uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.position_is_privileged(p_position) or exists (
    select 1 from public.position_work_emails w
    where w.position_id = p_position and w.email_normalized = app.norm_email(p_email)
  )
$$;

-- The same question about an account.
create or replace function app.work_account_ok(p_position uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.work_email_ok(p_position, (select pr.email from public.profiles pr where pr.id = p_profile))
$$;

-- ---------------------------------------------------------------------------------------------
-- Seed: the addresses reference data already invited, one per position
-- ---------------------------------------------------------------------------------------------

insert into public.position_work_emails (position_id, email)
select p.id, min(i.email_normalized)
from public.positions p
join public.invites i on i.position_id = p.id and i.term_id = app.current_term_id()
where p.level in ('officer', 'eb', 'webmaster')
group by p.id
having count(distinct i.email_normalized) = 1
on conflict (position_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Door 1: offering
-- ---------------------------------------------------------------------------------------------

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check ((select app.can_manage_position(position_id)) and (select app.work_email_ok(position_id, email)));
drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites
  for update to authenticated
  using ((select app.can_manage_position(position_id)))
  with check ((select app.can_manage_position(position_id)) and (select app.work_email_ok(position_id, email)));

-- As 20261005103632, refusing any address but the work email for a privileged position.
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
  v_work text;
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
  if not app.work_email_ok("position", v_email) then
    select w.email into v_work from public.position_work_emails w where w.position_id = "position";
    if v_work is null then
      raise exception 'This position has no work email yet. Set it first; the position can only be given to that address.'
        using errcode = '22023';
    end if;
    raise exception 'This position can only be given to its work email, %.', v_work
      using errcode = '22023';
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
-- Door 2: accepting
-- ---------------------------------------------------------------------------------------------

-- As 20260913100004, leaving an offer of a privileged position to any other address alone.
create or replace function app.handle_new_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if new.accepted_at is not null or new.email_normalized is null then
    return new;
  end if;
  if not app.work_email_ok(new.position_id, new.email) then
    return new;
  end if;

  select p.id
    into v_profile
  from public.profiles p
  where p.email_normalized = new.email_normalized
  order by p.created_at
  limit 1;

  if v_profile is null then
    return new;
  end if;

  insert into public.assignments (profile_id, position_id, term_id)
  values (v_profile, new.position_id, new.term_id)
  on conflict (profile_id, position_id, term_id) do nothing;

  update public.invites
    set accepted_at = now(),
        accepted_profile_id = v_profile
  where id = new.id;

  return new;
end
$$;

-- As 20260920090003; step (2) skips the same offers, which simply stay unaccepted.
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

  -- (2) standing invites -> assignments (app.verify_position_holder then verifies the holder).
  -- An officer's, the board's or the webmaster's position only for its work email.
  insert into public.assignments (profile_id, position_id, term_id)
  select p_profile, i.position_id, i.term_id
  from public.invites i
  where i.email_normalized = v_email
    and i.accepted_at is null
    and app.work_email_ok(i.position_id, i.email)
  on conflict (profile_id, position_id, term_id) do nothing;

  update public.invites i
    set accepted_at = now(),
        accepted_profile_id = p_profile
  where i.email_normalized = v_email
    and i.accepted_at is null
    and app.work_email_ok(i.position_id, i.email);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Door 3: being given it directly
-- ---------------------------------------------------------------------------------------------

drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    (select app.can_manage_position(position_id))
    and (status <> 'active' or (select app.work_account_ok(position_id, profile_id)))
  );
drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update to authenticated
  using ((select app.can_manage_position(position_id)))
  with check (
    (select app.can_manage_position(position_id))
    and (status <> 'active' or (select app.work_account_ok(position_id, profile_id)))
  );

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.guard_position_work_email() owner to postgres;
alter function app.can_set_work_email(uuid) owner to postgres;
alter function app.work_email_ok(uuid, text) owner to postgres;
alter function app.work_account_ok(uuid, uuid) owner to postgres;

revoke execute on function app.guard_position_work_email() from public;
revoke execute on function app.can_set_work_email(uuid) from public;
revoke execute on function app.work_email_ok(uuid, text) from public;
revoke execute on function app.work_account_ok(uuid, uuid) from public;
-- these three run inside row-level security policies, as the caller
grant execute on function app.can_set_work_email(uuid) to authenticated;
grant execute on function app.work_email_ok(uuid, text) to authenticated;
grant execute on function app.work_account_ok(uuid, uuid) to authenticated;
