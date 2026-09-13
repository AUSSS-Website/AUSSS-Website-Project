-- Identity: link auth users to roster rows and standing invites ("claiming"), keep profiles in
-- sync with auth.users, and the public RPCs the portal calls. Claiming functions live in `app`
-- and are NOT executable by anon/authenticated; they run only from triggers and the RPCs below,
-- which check auth.uid()/app.is_eb() themselves.

-- ---------------------------------------------------------------------------------------------
-- app.claim_for_profile: the one place linking logic lives
-- ---------------------------------------------------------------------------------------------

-- (1) Link the best unlinked roster row with the same normalised email: prefer rows whose status
--     is not archived/suspended, then Full > Associate > Candidate > other, then latest joined
--     year (the roster has duplicate emails). Only an 'unverified' profile is upgraded, so an EB
--     decision is never overwritten by a later re-claim.
-- (2) Turn every un-accepted invite for that email into an assignment.
-- Idempotent: safe to call on every sign-in, email change and importer run.
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
                when v_norm_status like '%candidate%' then 'candidate'
                else membership_status
              end,
              membership_tier = coalesce(v_roster.status, membership_tier),
              joined_year = coalesce(v_roster.joined_year, joined_year)
        where id = p_profile;
      end if;
    end if;
  end if;

  -- (2) standing invites -> assignments
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

-- For the importer: re-run claiming for every profile that still lacks a roster link or has a
-- pending invite. Returns how many profiles were processed.
create or replace function app.claim_unlinked()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_row record;
begin
  for v_row in
    select p.id
    from public.profiles p
    where p.email_normalized is not null
      and (
        not exists (select 1 from public.roster_entries r where r.profile_id = p.id)
        or exists (
          select 1 from public.invites i
          where i.email_normalized = p.email_normalized and i.accepted_at is null
        )
      )
  loop
    perform app.claim_for_profile(v_row.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- auth.users -> profiles
-- ---------------------------------------------------------------------------------------------

-- after insert on auth.users. The profile insert must never fail sign-up, and neither may a
-- claiming bug, hence the swallowed exception (surfaced as a warning in the Postgres logs).
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  begin
    perform app.claim_for_profile(new.id);
  exception when others then
    raise warning 'app.handle_new_user: claim failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end
$$;

-- create or replace (PG14+) rather than drop+create: dropping a trigger needs ownership of
-- auth.users (supabase_auth_admin), while creating/replacing only needs the TRIGGER privilege
-- that postgres holds.
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- after update of email on auth.users: mirror the address and re-run claiming, since a changed
-- email may now match a roster row or invite.
create or replace function app.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set email = new.email
  where id = new.id
    and email is distinct from new.email;

  begin
    perform app.claim_for_profile(new.id);
  exception when others then
    raise warning 'app.sync_user_email: claim failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end
$$;

create or replace trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function app.sync_user_email();

-- ---------------------------------------------------------------------------------------------
-- invites -> assignments when the profile already exists
-- ---------------------------------------------------------------------------------------------

-- after insert on public.invites. Security definer so an officer inviting into their committee
-- (already checked by the invites insert policy) can create the assignment and read the profile.
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

drop trigger if exists on_invite_created on public.invites;
create trigger on_invite_created
  after insert on public.invites
  for each row execute function app.handle_new_invite();

-- ---------------------------------------------------------------------------------------------
-- Public RPCs (exposed through PostgREST as rpc/<name>)
-- ---------------------------------------------------------------------------------------------

-- Re-run claiming for the signed-in user (e.g. "Refresh my membership" in the portal).
create or replace function public.claim_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform app.claim_for_profile(auth.uid());
end
$$;

-- EB approves/declines a verification request; approval also sets the member's status.
create or replace function public.decide_verification(
  request_id uuid,
  decision text,
  new_status text default 'active'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_status text;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can decide verification requests' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'declined') then
    raise exception 'decision must be approved or declined' using errcode = '22023';
  end if;
  if new_status is null or new_status not in ('unverified', 'candidate', 'active', 'alumni') then
    raise exception 'invalid membership status %', new_status using errcode = '22023';
  end if;

  select vr.profile_id, vr.status
    into v_profile, v_status
  from public.verification_requests vr
  where vr.id = decide_verification.request_id
  for update;

  if v_profile is null then
    raise exception 'verification request % not found', request_id using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'verification request % is already %', request_id, v_status using errcode = '22023';
  end if;

  update public.verification_requests
    set status = decide_verification.decision,
        decided_by = auth.uid(),
        decided_at = now()
  where id = decide_verification.request_id;

  if decision = 'approved' then
    update public.profiles
      set membership_status = decide_verification.new_status
    where id = v_profile;
  end if;
end
$$;

-- EB sets a member's status directly (members cannot: profiles has a column-level update grant).
-- A null tier leaves membership_tier unchanged.
create or replace function public.set_membership_status(
  profile_id uuid,
  status text,
  tier text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can change membership status' using errcode = '42501';
  end if;
  if status is null or status not in ('unverified', 'candidate', 'active', 'alumni') then
    raise exception 'invalid membership status %', status using errcode = '22023';
  end if;

  update public.profiles p
    set membership_status = set_membership_status.status,
        membership_tier = coalesce(set_membership_status.tier, p.membership_tier)
  where p.id = set_membership_status.profile_id;

  if not found then
    raise exception 'profile % not found', profile_id using errcode = 'P0002';
  end if;
end
$$;

-- EB flips the current term. Two statements because the partial unique index terms_one_current
-- is not deferrable.
create or replace function public.set_current_term(term_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can change the current term' using errcode = '42501';
  end if;
  if not exists (select 1 from public.terms t where t.id = set_current_term.term_id) then
    raise exception 'term % not found', term_id using errcode = 'P0002';
  end if;

  update public.terms t set is_current = false where t.is_current and t.id <> set_current_term.term_id;
  update public.terms t set is_current = true where t.id = set_current_term.term_id and not t.is_current;
end
$$;

-- Importer entry point (secret key only): claim for everyone still unlinked.
create or replace function public.admin_claim_unlinked()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  select app.claim_unlinked()
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.claim_for_profile(uuid) owner to postgres;
alter function app.claim_unlinked() owner to postgres;
alter function app.handle_new_user() owner to postgres;
alter function app.sync_user_email() owner to postgres;
alter function app.handle_new_invite() owner to postgres;
alter function public.claim_my_account() owner to postgres;
alter function public.decide_verification(uuid, text, text) owner to postgres;
alter function public.set_membership_status(uuid, text, text) owner to postgres;
alter function public.set_current_term(uuid) owner to postgres;
alter function public.admin_claim_unlinked() owner to postgres;

-- app.* claiming and trigger functions: nobody but the owner may call them directly.
revoke execute on function app.claim_for_profile(uuid) from public, anon, authenticated, service_role;
revoke execute on function app.claim_unlinked() from public, anon, authenticated, service_role;
revoke execute on function app.handle_new_user() from public;
revoke execute on function app.sync_user_email() from public;
revoke execute on function app.handle_new_invite() from public;

-- Supabase's default privileges in `public` grant EXECUTE to anon/authenticated/service_role on
-- creation, so revoke explicitly and re-grant the intended audience.
revoke execute on function public.claim_my_account() from public, anon;
grant execute on function public.claim_my_account() to authenticated;

revoke execute on function public.decide_verification(uuid, text, text) from public, anon;
grant execute on function public.decide_verification(uuid, text, text) to authenticated;

revoke execute on function public.set_membership_status(uuid, text, text) from public, anon;
grant execute on function public.set_membership_status(uuid, text, text) to authenticated;

revoke execute on function public.set_current_term(uuid) from public, anon;
grant execute on function public.set_current_term(uuid) to authenticated;

revoke execute on function public.admin_claim_unlinked() from public, anon, authenticated;
grant execute on function public.admin_claim_unlinked() to service_role;
