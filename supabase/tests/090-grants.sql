-- Table privileges are the first gate before RLS. The hosted project's default privileges
-- would silently hand anon/authenticated ALL on new tables (see migration 20260919160004), so
-- assert the intended grant set directly rather than trusting the local stack's stricter
-- defaults. Any new table must be added here alongside its grants.
begin;
select plan(25);

-- anon: read-only reference data and settings, public columns of calls, nothing else
select ok(has_table_privilege('anon', 'public.committees', 'select'), 'anon reads committees');
select ok(not has_table_privilege('anon', 'public.committees', 'insert'), 'anon cannot insert committees');
select ok(has_table_privilege('anon', 'public.site_settings', 'select'), 'anon reads site_settings');
select ok(not has_table_privilege('anon', 'public.site_settings', 'update'), 'anon cannot update site_settings');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'), 'anon cannot read profiles');
select ok(not has_table_privilege('anon', 'public.applications', 'select'), 'anon cannot read applications');
select ok(not has_table_privilege('anon', 'public.applications', 'insert'), 'anon cannot insert applications directly');
select ok(has_column_privilege('anon', 'public.calls', 'title', 'select'), 'anon reads calls.title');
select ok(not has_column_privilege('anon', 'public.calls', 'notify_email', 'select'), 'anon cannot read calls.notify_email');
select ok(not has_column_privilege('anon', 'public.calls', 'created_by', 'select'), 'anon cannot read calls.created_by');
select ok(has_table_privilege('anon', 'public.open_calls', 'select'), 'anon reads open_calls');

-- authenticated: no direct inserts into applications or profiles; column-limited profile update
select ok(not has_table_privilege('authenticated', 'public.applications', 'insert'), 'authenticated cannot insert applications directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert'), 'authenticated cannot insert profiles');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'membership_status', 'update'), 'authenticated cannot update membership_status');

-- live roster: the roster and its import log stay closed to anon; the token and the lookup
-- counters live in `app`, which no API role can read
select ok(not has_table_privilege('anon', 'public.roster_entries', 'select'), 'anon cannot read roster_entries');
select ok(not has_table_privilege('anon', 'public.roster_sync_runs', 'select'), 'anon cannot read roster_sync_runs');
select ok(not has_table_privilege('authenticated', 'public.roster_sync_runs', 'insert'), 'authenticated cannot write roster_sync_runs');
select ok(not has_table_privilege('authenticated', 'app.roster_sync_token', 'select'), 'authenticated cannot read the sync token hash');
select ok(not has_function_privilege('anon', 'public.import_roster(jsonb, text)', 'execute'), 'anon cannot call import_roster');
select ok(not has_function_privilege('authenticated', 'public.admin_roster_cron_secret_ok(text)', 'execute'), 'only the secret key can check the cron secret');
select ok(not has_function_privilege('authenticated', 'public.admin_roster_sheet_source()', 'execute'), 'only the secret key can read which sheet is connected');

-- roster search, bulk updates, suggestions: EB RPCs are closed to anon, the log is read-only
select ok(not has_function_privilege('anon', 'public.search_roster(text, text, int, int)', 'execute'), 'anon cannot search the roster');
select ok(not has_function_privilege('anon', 'public.bulk_update_roster(uuid[], text, text, text)', 'execute'), 'anon cannot bulk update');
select ok(not has_table_privilege('authenticated', 'public.roster_bulk_updates', 'insert'), 'authenticated cannot write the bulk update log directly');
select ok(has_function_privilege('anon', 'public.check_membership(text, text, text, boolean)', 'execute'), 'anon can check a membership');

select * from finish();
rollback;
