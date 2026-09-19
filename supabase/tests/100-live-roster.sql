-- Live roster: the merge routine keeps portal edits and never deletes, a status edit on a linked
-- row reaches the profile, the public lookup answers with membership facts only, and the import
-- routes are closed to everyone but the EB / a valid sheet token.
begin;
select plan(25);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');

-- ---- who may import -------------------------------------------------------------------------
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.import_roster('[{"full_name":"X"}]'::jsonb) $$,
  '42501', null, 'a plain member cannot import the roster'
);
select throws_ok(
  $$ select public.rotate_roster_sync_token() $$,
  '42501', null, 'a plain member cannot issue the sync token'
);
select tests.clear_auth();
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.sync_roster_from_sheet('rst_nope', '[{"full_name":"X"}]'::jsonb) $$,
  '42501', null, 'a wrong sync token is refused'
);
select throws_ok(
  $$ select public.admin_import_roster('[{"full_name":"X"}]'::jsonb) $$,
  '42501', null, 'anon cannot call the script import'
);

-- ---- first import (EB upload) ---------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is(
  public.import_roster(
    '[{"full_name":"  Sara   Ali ","email":"Sara@Example.com ","status":"Candidate Member","joined_year":"2025","years_spent":"0","lgas":"","ngas":">2"},
      {"full_name":"Omar Nabil","email":"","status":"Full Member","joined_year":"n/a","current_position":"Supervising Council"},
      {"full_name":"Omar Nabil","email":"","status":"Full Member"},
      {"full_name":"","email":"ghost@example.com"},
      {"full_name":"Plain Member","email":"member@pgtap.test","status":"Associate Member","joined_year":"2023"}]'::jsonb,
    'As of test'
  ) - 'missing_names' - 'profiles_checked',
  '{"received":5,"inserted":3,"updated":0,"unchanged":0,"kept_portal_edits":0,"skipped_invalid":1,"skipped_duplicates":1,"missing_from_sheet":0}'::jsonb,
  'the EB imports: blank names and exact duplicates are skipped'
);
select is(
  (select full_name || '|' || name_normalized || '|' || email_normalized || '|' || origin
     from public.roster_entries where email_normalized = 'sara@example.com'),
  'Sara Ali|sara ali|sara@example.com|sheet',
  'imported rows are tidied and owned by the sheet'
);
select ok(
  (select portal_edited_at is null from public.roster_entries where email_normalized = 'sara@example.com'),
  'an import by a signed-in EB is not a portal edit'
);
select ok(
  (select joined_year is null from public.roster_entries where full_name = 'Omar Nabil'),
  'a year that is not a number becomes null'
);
select is(
  (select membership_status || '/' || membership_tier from public.profiles where id = tests.user_id('member@pgtap.test')),
  'active/Associate Member', 'the import links a signed-in member by email'
);

-- ---- portal edits ---------------------------------------------------------------------------
update public.roster_entries set status = 'Associate Member' where email_normalized = 'sara@example.com';
select ok(
  (select portal_edited_at is not null from public.roster_entries where email_normalized = 'sara@example.com'),
  'editing a row in the portal stamps it'
);
update public.roster_entries set status = 'Candidate Member' where email_normalized = 'member@pgtap.test';
select is(
  (select membership_status || '/' || membership_tier from public.profiles where id = tests.user_id('member@pgtap.test')),
  'candidate/Candidate Member', 'a status edit on a linked row reaches the profile'
);
insert into public.roster_entries (full_name, email) values ('Portal Made', 'pm@example.com');
select is(
  (select origin || '|' || (source_key like 'portal:%')::text from public.roster_entries where full_name = 'Portal Made'),
  'portal|true', 'a row added in the portal gets its own key and origin'
);
select throws_ok(
  $$ insert into public.roster_entries (full_name) values ('   ') $$,
  '22023', 'A member needs a name.', 'a roster row needs a name'
);

-- ---- second import: the sheet moved on ------------------------------------------------------
select is(
  public.import_roster(
    '[{"full_name":"Sara Ali","email":"sara@example.com","status":"Candidate Member","joined_year":"2025","years_spent":"1","ngas":">2"},
      {"full_name":"Omar Nabil","email":"omar@example.com","status":"Full Member","current_position":"Supervising Council"},
      {"full_name":"New Person","status":"Candidate Member"}]'::jsonb
  ) - 'profiles_checked',
  '{"received":3,"inserted":1,"updated":1,"unchanged":0,"kept_portal_edits":1,"skipped_invalid":0,"skipped_duplicates":0,"missing_from_sheet":0,"missing_names":[]}'::jsonb,
  'portal-edited rows are kept, a row that gained an email is updated in place, portal rows are not "missing"'
);
select is(
  (select status from public.roster_entries where email_normalized = 'sara@example.com'),
  'Associate Member', 'the portal edit survived the import'
);
select is(
  (select count(*)::int from public.roster_entries where name_normalized = 'omar nabil'),
  1, 'gaining an email did not duplicate the member'
);
select is(
  (select count(*)::int from public.roster_sync_runs where source = 'upload'),
  2, 'every import is logged'
);

-- ---- sheet sync token -----------------------------------------------------------------------
select ok(public.rotate_roster_sync_token() like 'rst_%', 'the EB is handed a fresh token');
select is(
  public.roster_sync_token_info() ->> 'active', 'true', 'the EB sees that a token is active'
);
-- only the hash is stored, so plant a known token as postgres to play the sheet's script
select tests.clear_auth();
update app.roster_sync_token
  set token_hash = encode(sha256(convert_to('rst_pgtap', 'UTF8')), 'hex');
select tests.authenticate_as_anon();
select is(
  public.sync_roster_from_sheet(
    'rst_pgtap',
    '[{"full_name":"New Person","status":"Associate Member"}]'::jsonb
  ) ->> 'updated',
  '1', 'the sheet script syncs with a valid token'
);

-- ---- public lookup --------------------------------------------------------------------------
select is(
  public.check_membership('', ' OMAR@example.com '),
  '{"state":"found","record":{"status":"Full Member","yearJoined":"","yearsSpent":"","lgas":"","ngas":"","currentPosition":"Supervising Council"}}'::jsonb,
  'lookup by email returns membership facts and nothing that identifies the person'
);
select is(
  public.check_membership('sara  ALI', '') -> 'record' ->> 'ngas',
  '>2', 'lookup by name ignores case and spacing'
);
select is(
  public.check_membership('', '', 'supervising-council') ->> 'state',
  'found', 'the supervising council holder is found by role'
);
select is(
  public.check_membership('Nobody Here', '') ->> 'state',
  'not-found', 'an unknown name is not found'
);
select throws_ok(
  $$ select count(*) from public.roster_entries $$,
  '42501', null, 'anon still cannot read the roster itself'
);

select tests.clear_auth();
select * from finish();
rollback;
