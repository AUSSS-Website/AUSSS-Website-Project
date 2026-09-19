-- Hosted Supabase projects ship default privileges that grant anon, authenticated and
-- service_role ALL on every table and sequence postgres creates in `public` (pg_default_acl).
-- `auto_expose_new_tables = false` in config.toml only affects the local stack, so the explicit
-- grants in migrations 5, 7 and 9 were unions with "everything" in production: RLS still held
-- (every table has policies), but the column-level restriction on calls.notify_email did not.
--
-- This migration makes the grant set the single source of truth: drop the default privileges
-- for future objects, revoke everything the API roles hold on today's tables and sequences, and
-- re-issue exactly the grants the earlier migrations intended. Function grants were already
-- explicit (each RPC revokes from public and re-grants) and are left alone.

-- ---------------------------------------------------------------------------------------------
-- No implicit privileges on anything created from now on
-- ---------------------------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reset the API roles on every existing table/sequence
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Re-grant (verbatim from migrations 5, 7 and 9)
-- ---------------------------------------------------------------------------------------------

-- migration 5: reference data, member data, profiles column grant
grant select on public.terms, public.committees, public.positions to anon, authenticated;
grant insert, update, delete on public.terms, public.committees, public.positions to authenticated;

grant select on
  public.profiles,
  public.assignments,
  public.invites,
  public.roster_entries,
  public.audit_log,
  public.verification_requests
to authenticated;
grant insert, update, delete on public.assignments, public.invites, public.roster_entries to authenticated;
grant insert, update on public.verification_requests to authenticated;
grant update (full_name, phone, faculty_year, photo_path, avatar_url, directory_opt_in)
  on public.profiles to authenticated;

-- migration 7: site settings
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

-- migration 9: calls, open_calls, applications
grant select (id, committee_id, status, title, kind, summary, description, commitment, deadline,
              positions, questions, created_at, updated_at)
  on public.calls to anon;
grant select, insert, update, delete on public.calls to authenticated;
grant select on public.open_calls to anon, authenticated;
grant select, update, delete on public.applications to authenticated;

-- service_role keeps everything (importer and admin scripts)
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
