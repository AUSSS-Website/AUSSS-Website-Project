-- Years spent is counted from the joining year and the academic year (1 September), not typed;
-- upgrades are proposed from GA counts and never applied by the database itself.
begin;
select plan(22);

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

-- ---- the academic year ----------------------------------------------------------------------
select is(app.academic_year_start('2026-08-31'), 2025, '31 August still belongs to the year that began the September before');
select is(app.academic_year_start('2026-09-01'), 2026, '1 September starts the new academic year');
select is(app.academic_year_start('2027-01-15'), 2026, 'January belongs to the year that began in September');
select is(app.years_spent(app.academic_year_start() + 3), 0, 'a joining year in the future is never negative');
select ok(app.years_spent(null) is null, 'an unknown joining year gives no number');

-- ---- the eligibility rule (private helpers, so checked before anyone signs in) ---------------
select is(app.count_floor('>2'), 3, '">2" guarantees three');
select is(app.count_floor('2+'), 2, '"2+" guarantees two');
select is(app.count_floor('n/a'), 0, 'text without a number guarantees none');
select is(app.next_status('Candidate Member', '0', '1'), null::text, 'one National GA is not enough for Associate');
select is(app.next_status('Associate Member', '>1', '3'), 'Full Member', 'two Local and three National GAs earn Full');

-- ---- kept by the database -------------------------------------------------------------------
delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, joined_year, years_spent, status, lgas, ngas)
values ('y1', 'Joined Two Years Ago', '', app.academic_year_start() - 2, 99, 'Candidate Member', null, null),
       ('y2', 'No Joining Year', '', null, 4, 'Candidate Member', '1', null),
       ('y3', 'Candidate Two NGAs', '', null, null, 'Candidate Member', '0', '>1'),
       ('y4', 'Associate Ready', '', null, null, 'Associate Member', '2+', '3'),
       ('y5', 'Associate Short', '', null, null, 'Associate Member', '2', '2'),
       ('y6', 'Suspended Candidate', '', null, null, 'Suspended', '5', '5'),
       ('y7', 'Already Full', '', null, null, 'Full Member', '9', '9');
select is((select years_spent from public.roster_entries where source_key = 'y1'), 2, 'a typed years-spent is replaced by the count');
select is((select years_spent from public.roster_entries where source_key = 'y2'), 4, 'without a joining year the typed value stays');

-- the rollover job only rewrites rows that are out of date
update public.roster_entries set years_spent = years_spent where true;
select is(app.refresh_years_spent(), 0, 'nothing to roll over when every row is current');

-- the sheet's own number must not make a row look changed on every pull
select tests.authenticate_as('eb@pgtap.test');
select is(
  public.import_roster(jsonb_build_array(jsonb_build_object(
    'full_name', 'Sheet Person', 'joined_year', (app.academic_year_start() - 1)::text, 'years_spent', '0',
    'status', 'Candidate Member'))) ->> 'inserted',
  '1', 'a sheet row is imported'
);
select is(
  public.import_roster(jsonb_build_array(jsonb_build_object(
    'full_name', 'Sheet Person', 'joined_year', (app.academic_year_start() - 1)::text, 'years_spent', '0',
    'status', 'Candidate Member'))) ->> 'unchanged',
  '1', 'the same row with the sheet''s stale years-spent counts as unchanged'
);
select is(
  (select years_spent from public.roster_entries where full_name = 'Sheet Person'), 1,
  '...and keeps the counted value'
);
update public.roster_entries set joined_year = app.academic_year_start() - 5 where source_key = 'y2';
select is((select years_spent from public.roster_entries where source_key = 'y2'), 5, 'editing the joining year recounts');

-- ---- the EB's list ------------------------------------------------------------------------
select results_eq(
  $$ select e ->> 'full_name', e ->> 'next'
     from jsonb_array_elements(public.roster_upgrade_candidates()) e order by 1 $$,
  $$ values ('Associate Ready', 'Full Member'), ('Candidate Two NGAs', 'Associate Member'),
            ('No Joining Year', 'Associate Member') $$,
  'the list holds exactly the members whose counts reach the next tier (not suspended, not short, not already Full)'
);
select is(
  (select status from public.roster_entries where source_key = 'y4'),
  'Associate Member', 'being eligible changes nothing by itself'
);

-- "not now" hides a member for this academic year, for that target only
update public.roster_entries
  set upgrade_dismissed_for = 'Full Member', upgrade_dismissed_at = now()
where source_key = 'y4';
select is(jsonb_array_length(public.roster_upgrade_candidates()), 2, 'a member set aside leaves the list');
select ok(
  (select portal_edited_at is null from public.roster_entries where source_key = 'y4'),
  'setting someone aside is not an edit of their record'
);
update public.roster_entries
  set upgrade_dismissed_at = (make_date(app.academic_year_start(), 9, 1) - 1)::timestamptz
where source_key = 'y4';
select is(jsonb_array_length(public.roster_upgrade_candidates()), 3, '...and returns once that decision is from a previous year');

select tests.clear_auth();
select * from finish();
rollback;
