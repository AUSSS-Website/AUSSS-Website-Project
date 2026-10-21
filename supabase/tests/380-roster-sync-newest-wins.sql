-- The roster sync, 20261021130001: the newest change wins, field by field. A value edited in the
-- portal stays until the sheet changes that same field, and the rest of the row goes on
-- following the sheet; when both change a field between two imports the portal's value stays;
-- a row with no record keeps all its portal values, as before; "Follow the spreadsheet again"
-- hands the whole row back; the record is the import's alone; and the scheduled pull runs once
-- a day.
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
select tests.assign('eb@pgtap.test', 'eb.president');

-- ---- the sheet as it stood ------------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Associate Member","joined_year":"2024","lgas":"1","ngas":"4","current_position":"Magazine editor"},
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"2","ngas":"3"},
    {"full_name":"Nour Samir","email":"nour@example.com","status":"Candidate Member","joined_year":"2025"}
  ]'::jsonb, 'sheet one') ->> 'inserted',
  '3', 'the first import adds three members'
);
select tests.clear_auth();
select is(
  (select count(*)::int from app.roster_sheet_lines l
     join public.roster_entries r on r.id = l.entry_id
    where r.email_normalized in ('lina@example.com', 'karim@example.com', 'nour@example.com')),
  3, 'and records what the sheet said for each of them'
);

-- ---- two edits in the portal ----------------------------------------------------------------
-- Lina's position text is tidied away, Karim's NGAs are corrected.
select tests.authenticate_as('eb@pgtap.test');
update public.roster_entries set current_position = null where email_normalized = 'lina@example.com';
update public.roster_entries set ngas = '4' where email_normalized = 'karim@example.com';
select is(
  (select count(*)::int from public.roster_entries
    where email_normalized in ('lina@example.com', 'karim@example.com') and portal_edited_at is not null),
  2, 'both edits make their rows the portal''s'
);

-- ---- the same sheet again -------------------------------------------------------------------
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Associate Member","joined_year":"2024","lgas":"1","ngas":"4","current_position":"Magazine editor"},
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"2","ngas":"3"},
    {"full_name":"Nour Samir","email":"nour@example.com","status":"Candidate Member","joined_year":"2025"}
  ]'::jsonb, 'sheet one') - 'missing_names' - 'profiles_checked',
  '{"received":3,"inserted":0,"updated":0,"unchanged":1,"kept_portal_edits":2,"skipped_invalid":0,"skipped_duplicates":0,"missing_from_sheet":0}'::jsonb,
  'a sheet that has not changed leaves both portal edits alone'
);
select results_eq(
  $$ select coalesce(current_position, '-'), ngas from public.roster_entries
      where email_normalized in ('lina@example.com', 'karim@example.com') order by full_name $$,
  $$ values ('-', '4'), ('-', '4') $$,
  'the tidied position and the corrected count are still there'
);

-- ---- the sheet moves on ---------------------------------------------------------------------
-- Lina is promoted with one more LGA; Karim's NGAs move on in the sheet too; Nour's status changes.
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Full Member","joined_year":"2024","lgas":"2","ngas":"4","current_position":"Magazine editor"},
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"2","ngas":"5"},
    {"full_name":"Nour Samir","email":"nour@example.com","status":"Associate Member","joined_year":"2025"}
  ]'::jsonb, 'sheet two') - 'missing_names' - 'profiles_checked',
  '{"received":3,"inserted":0,"updated":3,"unchanged":0,"kept_portal_edits":0,"skipped_invalid":0,"skipped_duplicates":0,"missing_from_sheet":0}'::jsonb,
  'every row the sheet changed is updated, edited in the portal or not'
);
select results_eq(
  $$ select full_name, status, lgas, ngas, coalesce(current_position, '-') from public.roster_entries
      where email_normalized in ('lina@example.com', 'karim@example.com', 'nour@example.com')
      order by full_name $$,
  $$ values ('Karim Adel', 'Full Member', '2', '5', '-'),
            ('Lina Fares', 'Full Member', '2', '4', '-'),
            ('Nour Samir', 'Associate Member', null::text, null::text, '-') $$,
  'the sheet''s new values arrive, Karim''s NGAs take the sheet''s newer count, and Lina''s tidied position stays tidied'
);
select ok(
  (select portal_edited_at is not null from public.roster_entries where email_normalized = 'lina@example.com'),
  'Lina''s row is still the portal''s, for the field the sheet has not changed'
);
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Full Member","joined_year":"2024","lgas":"2","ngas":"4","current_position":"Magazine editor"},
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"2","ngas":"5"},
    {"full_name":"Nour Samir","email":"nour@example.com","status":"Associate Member","joined_year":"2025"}
  ]'::jsonb, 'sheet two') - 'missing_names' - 'profiles_checked',
  '{"received":3,"inserted":0,"updated":0,"unchanged":2,"kept_portal_edits":1,"skipped_invalid":0,"skipped_duplicates":0,"missing_from_sheet":0}'::jsonb,
  'the same sheet once more changes nothing'
);

-- ---- the sheet changes the field the portal edited ------------------------------------------
-- (Each import is its own statement: a query in the same statement would not see what it wrote.)
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Full Member","joined_year":"2024","lgas":"2","ngas":"4","current_position":"Magazine chief editor"}
  ]'::jsonb, 'sheet three') ->> 'updated',
  '1', 'the sheet changes the position text the portal had tidied away'
);
select is(
  (select current_position from public.roster_entries where email_normalized = 'lina@example.com'),
  'Magazine chief editor',
  'a field the sheet changes after a portal edit takes the sheet''s value'
);
update public.roster_entries set status = 'Associate Member' where email_normalized = 'lina@example.com';
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Full Member","joined_year":"2024","lgas":"2","ngas":"4","current_position":"Magazine chief editor"}
  ]'::jsonb, 'sheet three') ->> 'kept_portal_edits',
  '1', 'the portal changes the status afterwards, and the sheet stays as it was'
);
select is(
  (select status from public.roster_entries where email_normalized = 'lina@example.com'),
  'Associate Member',
  'a portal edit made after the sheet''s change holds until the sheet changes that field again'
);

-- ---- both sides change the same field between two imports ------------------------------------
update public.roster_entries set lgas = '9' where email_normalized = 'lina@example.com';
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"lina@example.com","status":"Full Member","joined_year":"2024","lgas":"3","ngas":"4","current_position":"Magazine chief editor"}
  ]'::jsonb, 'sheet five') ->> 'kept_portal_edits',
  '1', 'the portal and the sheet both change Lina''s LGAs before the next import'
);
select is(
  (select lgas from public.roster_entries where email_normalized = 'lina@example.com'),
  '9', 'when both changed a field, nobody can tell which came last, so the portal''s value stays'
);
select is(
  public.import_roster('[
    {"full_name":"Lina Fares","email":"LINA@example.com","status":"Full Member","joined_year":"2024","lgas":"4","ngas":"4","current_position":"Magazine chief editor"}
  ]'::jsonb, 'sheet six') ->> 'updated',
  '1', 'the sheet changes the LGAs again (and the capitals of the email, which is no change)'
);
select is(
  (select lgas || '|' || email from public.roster_entries where email_normalized = 'lina@example.com'),
  '4|lina@example.com', 'the sheet''s next change wins, and the email is left as it was'
);

-- ---- a row with no record of what the sheet said --------------------------------------------
select tests.clear_auth();
delete from app.roster_sheet_lines
 where entry_id = (select id from public.roster_entries where email_normalized = 'karim@example.com');
select tests.authenticate_as('eb@pgtap.test');
select is(
  public.import_roster('[
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"3","ngas":"6"}
  ]'::jsonb, 'sheet four') ->> 'kept_portal_edits',
  '1', 'a portal-edited row with nothing on record is reported as kept'
);
select is(
  (select lgas || '/' || ngas from public.roster_entries where email_normalized = 'karim@example.com'),
  '2/5',
  'and keeps every portal value, as before'
);
select tests.clear_auth();
select ok(
  exists (select 1 from app.roster_sheet_lines l join public.roster_entries r on r.id = l.entry_id
           where r.email_normalized = 'karim@example.com' and l.line ->> 'lgas' = '3'),
  'from then on what the sheet said is on record for it'
);

-- ---- handed back to the sheet ---------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
update public.roster_entries set portal_edited_at = null, portal_edited_by = null
 where email_normalized = 'karim@example.com';
select is(
  public.import_roster('[
    {"full_name":"Karim Adel","email":"karim@example.com","status":"Full Member","joined_year":"2022","lgas":"3","ngas":"6"}
  ]'::jsonb, 'sheet four') ->> 'updated',
  '1', 'a row handed back is updated by the next import'
);
select is(
  (select lgas || '/' || ngas from public.roster_entries where email_normalized = 'karim@example.com'),
  '3/6',
  '"Follow the spreadsheet again" hands the whole row back to the sheet'
);
select tests.clear_auth();

-- ---- the record is the import's alone -------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'app.roster_sheet_lines', 'select')
  and not has_table_privilege('anon', 'app.roster_sheet_lines', 'select'),
  'nobody signed in or out can read what the sheet said'
);
select ok(
  not has_function_privilege('authenticated', 'app.roster_sheet_line(text, text, text, int, int, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'app.roster_sheet_line(text, text, text, int, int, text, text, text)', 'execute'),
  'nor call the helper that shapes it'
);

-- ---- once a day ------------------------------------------------------------------------------
select is(
  (select schedule from cron.job where jobname = 'roster-sheet-sync'),
  '7 2 * * *',
  'the scheduled pull runs once a day, at 02:07 UTC'
);

select * from finish();
rollback;
