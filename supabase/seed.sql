-- Dev/CI only. `supabase db reset` runs this after the migrations; it is never pushed to the
-- hosted project. Provides pgTAP and a small `tests` schema the pgTAP files use to create users,
-- impersonate them and seed fixtures while bypassing RLS.

create extension if not exists pgtap with schema extensions;
-- tests.roster hashes source_key with extensions.digest(); pgcrypto ships preinstalled on Supabase
-- images but the dependency is spelled out so a slimmer CI image cannot break the seed.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists tests;

-- Both API roles get to call these: a test that is currently impersonating `authenticated`
-- must still be able to switch user or clear auth.
grant usage on schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------------------------

-- Insert a realistic auth.users + auth.identities pair so the real app.handle_new_user trigger
-- fires (and GoTrue could still read the row: token columns are '' not NULL).
create or replace function tests.create_user(email text, full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    create_user.email, '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('full_name', create_user.full_name, 'email_verified', true)),
    now(), now(),
    '', '', '', '',
    '', '', '', '',
    false, false
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', create_user.email, 'email_verified', true),
    now(), now(), now()
  );

  return v_id;
end
$$;

-- Lookup that works even while the caller is impersonating `authenticated` (no auth.users grant).
create or replace function tests.user_id(email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where u.email = user_id.email order by u.created_at limit 1
$$;

-- Impersonate a user for the rest of the transaction. Deliberately has NO `set search_path`
-- clause: a function with a SET clause runs in its own GUC nesting level and every set_config(...,
-- true) made inside it would be undone on return.
create or replace function tests.authenticate_as(email text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := tests.user_id(authenticate_as.email);
  if v_id is null then
    raise exception 'tests.authenticate_as: no auth user with email %', authenticate_as.email;
  end if;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_id, 'role', 'authenticated', 'email', authenticate_as.email)::text,
    true
  );
  perform pg_catalog.set_config('role', 'authenticated', true);
end
$$;

create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('role', 'anon')::text, true);
  perform pg_catalog.set_config('role', 'anon', true);
end
$$;

-- Back to the superuser-ish session role. '' (not null) for the claims: auth.uid() treats '' as
-- unset and a reset placeholder GUC also reads back as ''.
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (security definer: bypass RLS regardless of who is impersonated)
-- ---------------------------------------------------------------------------------------------

-- Active assignment for <email> in <position_key> for the current term. Re-activates if it exists.
create or replace function tests.assign(email text, position_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_position uuid;
  v_term uuid := app.current_term_id();
  v_id uuid;
begin
  select p.id into v_profile from public.profiles p
  where p.email_normalized = app.norm_email(assign.email) order by p.created_at limit 1;
  if v_profile is null then
    raise exception 'tests.assign: no profile with email %', assign.email;
  end if;

  select p.id into v_position from public.positions p where p.key = assign.position_key;
  if v_position is null then
    raise exception 'tests.assign: no position with key %', assign.position_key;
  end if;
  if v_term is null then
    raise exception 'tests.assign: no current term (load reference data first)';
  end if;

  insert into public.assignments (profile_id, position_id, term_id)
  values (v_profile, v_position, v_term)
  on conflict (profile_id, position_id, term_id)
    do update set status = 'active', ended_on = null
  returning id into v_id;
  return v_id;
end
$$;

-- Roster row keyed like the importer (sha256 of normalised name|email).
create or replace function tests.roster(full_name text, email text, status text, joined_year int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := app.normalize_text(roster.full_name);
  v_key text := encode(extensions.digest(v_name || '|' || coalesce(app.norm_email(roster.email), ''), 'sha256'), 'hex');
  v_id uuid;
begin
  insert into public.roster_entries (source_key, full_name, name_normalized, email, status, joined_year, import_batch)
  values (v_key, roster.full_name, v_name, roster.email, roster.status, roster.joined_year, 'tests')
  on conflict (source_key)
    do update set status = excluded.status, joined_year = excluded.joined_year
  returning id into v_id;
  return v_id;
end
$$;

-- Standing invite for <email> to <position_key> in the current term (fires app.handle_new_invite).
create or replace function tests.invite(email text, position_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position uuid;
  v_term uuid := app.current_term_id();
  v_id uuid;
begin
  select p.id into v_position from public.positions p where p.key = invite.position_key;
  if v_position is null then
    raise exception 'tests.invite: no position with key %', invite.position_key;
  end if;
  if v_term is null then
    raise exception 'tests.invite: no current term (load reference data first)';
  end if;

  insert into public.invites (email, position_id, term_id)
  values (invite.email, v_position, v_term)
  on conflict (email_normalized, position_id, term_id)
    do update set email = excluded.email
  returning id into v_id;
  return v_id;
end
$$;

alter function tests.create_user(text, text) owner to postgres;
alter function tests.user_id(text) owner to postgres;
alter function tests.authenticate_as(text) owner to postgres;
alter function tests.authenticate_as_anon() owner to postgres;
alter function tests.clear_auth() owner to postgres;
alter function tests.assign(text, text) owner to postgres;
alter function tests.roster(text, text, text, int) owner to postgres;
alter function tests.invite(text, text) owner to postgres;

grant execute on all functions in schema tests to anon, authenticated, service_role;
