-- Roster search (every word, any order, spelling variants ranked below exact hits), bulk updates
-- from a pasted list (review states, +1 counts, duplicate guard, undo), public "did you mean"
-- (near-complete names only, emails only ever masked) and the verification rules (on the roster
-- or holding a position means verified).
begin;
select plan(37);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');

delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, lgas, ngas, current_position)
values ('k1', 'Mohamed Ahmed Abdelrahman', '', 'mohamed.ahmed@example.com', 'Candidate Member', null, '>2', null),
       ('k2', 'Sara Youssef El Sayed', '', 'sara.youssef99@example.com', 'Associate Member', '1', 'n/a', 'SCORA Core Team Member'),
       ('k3', 'Mahmoud Ali Hassan', '', null, 'Full Member', '2+', '3', null),
       ('k4', 'Omar Nabil Fathy', '', 'omar.nabil@example.com', null, null, null, null),
       ('k5', 'Omar Nabil Fathy', '', 'omar.n2@example.com', 'Candidate Member', null, null, null);

-- ---- helpers --------------------------------------------------------------------------------
select is(app.name_skeleton('Mohammed'), app.name_skeleton('Muhammad'), 'spellings of one name share a skeleton');
select is(app.name_skeleton('Abd El-Rahman'), app.name_skeleton('Abdelrahman'), 'particles and spacing do not matter');
select is(app.name_skeleton('Elsayed'), app.name_skeleton('Al Sayed'), 'a leading el/al is dropped');
select is(app.name_skeleton('Elham'), 'alm', 'short names that merely start with el are left alone');
select is(app.bump_count('>2'), '>3', 'a bumped count keeps its notation');
select is(app.bump_count(''), '1', 'a blank count becomes 1');
select ok(app.bump_count('n/a') is null, 'text without a number cannot be bumped');

-- ---- search ---------------------------------------------------------------------------------
select tests.authenticate_as('member@pgtap.test');
select throws_ok($$ select public.search_roster('omar') $$, '42501', null, 'a plain member cannot search the roster');
select throws_ok($$ select public.match_roster_lines('["x"]'::jsonb) $$, '42501', null, 'a plain member cannot match a list');
select throws_ok(
  $$ select public.bulk_update_roster(array[gen_random_uuid()], 'lga', 'x') $$,
  '42501', null, 'a plain member cannot bulk update'
);

select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is((public.search_roster('') ->> 'total')::int, 5, 'an empty search lists everyone');
select is(
  public.search_roster('abdelrahman mohamed') -> 'rows' -> 0 ->> 'full_name',
  'Mohamed Ahmed Abdelrahman', 'words match in any order and need not be adjacent'
);
select is(
  public.search_roster('muhammad') -> 'rows' -> 0 ->> 'full_name',
  'Mohamed Ahmed Abdelrahman', 'a spelling variant finds the person, ahead of a skeleton twin (Mahmoud)'
);
select is(
  (public.search_roster('mohamed') -> 'rows' -> 0 ->> 'close')::boolean,
  false, 'an exact word is not flagged as a similar spelling'
);
select is(
  (select (e ->> 'close')::boolean from jsonb_array_elements(public.search_roster('mohamed') -> 'rows') e
    where e ->> 'full_name' = 'Mahmoud Ali Hassan'),
  true, '...while a skeleton neighbour is listed after it and flagged'
);
select is((public.search_roster('scora') ->> 'total')::int, 1, 'positions are searchable');
select is(
  public.search_roster('omar.n2') -> 'rows' -> 0 ->> 'email',
  'omar.n2@example.com', 'emails are searchable'
);
select is((public.search_roster('', 'none') ->> 'total')::int, 1, 'the no-status filter still works');
select is((public.search_roster('zzzz qqqq') ->> 'total')::int, 0, 'nonsense finds nobody');

-- ---- matching a pasted list -----------------------------------------------------------------
create temporary table pgtap_match on commit drop as
  select e ->> 'line' as line, e ->> 'state' as state, e -> 'match' ->> 'full_name' as who,
         jsonb_array_length(e -> 'candidates') as candidates
  from jsonb_array_elements(public.match_roster_lines(
    '["SARA.youssef99@example.com", "Mahmoud Ali Hassan", "Sara El Sayed", "Omar Nabil Fathy", "Zzzz Qqqq", "  "]'::jsonb
  )) e;
select results_eq(
  $$ select line, state from pgtap_match order by line $$,
  $$ values ('Mahmoud Ali Hassan', 'matched'), ('Omar Nabil Fathy', 'ambiguous'),
            ('SARA.youssef99@example.com', 'matched'), ('Sara El Sayed', 'likely'), ('Zzzz Qqqq', 'none') $$,
  'email and exact name are certain, a clear partial name is likely, a shared name is ambiguous'
);
select is(
  (select candidates from pgtap_match where line = 'Omar Nabil Fathy'),
  2, 'an ambiguous line offers both people'
);

-- ---- bulk update + undo ---------------------------------------------------------------------
create temporary table pgtap_bulk on commit drop as
  select public.bulk_update_roster(
    (select array_agg(id) from public.roster_entries where source_key in ('k1', 'k2', 'k3')),
    'nga', '  NGA   Alexandria ') as r;
select is((select (r ->> 'updated')::int from pgtap_bulk), 2, 'two counts were bumped');
select is(
  (select r -> 'skipped' -> 0 ->> 'reason' from pgtap_bulk),
  '"n/a" is not a number', 'a count that is not a number is reported, not guessed'
);
select results_eq(
  $$ select source_key, ngas from public.roster_entries where source_key in ('k1', 'k2', 'k3') order by 1 $$,
  $$ values ('k1', '>3'), ('k2', 'n/a'), ('k3', '4') $$,
  'counts keep their notation'
);
select ok(
  (select portal_edited_at is not null from public.roster_entries where source_key = 'k1'),
  'a bulk update makes the portal the owner of the row, so the sheet will not undo it'
);
select throws_ok(
  $$ select public.bulk_update_roster(
       (select array_agg(id) from public.roster_entries where source_key = 'k4'), 'nga', 'nga alexandria') $$,
  '22023', null, 'the same event cannot be applied twice'
);
update public.roster_entries set ngas = '9' where source_key = 'k3';
select is(
  public.undo_roster_bulk_update((select (r ->> 'log_id')::bigint from pgtap_bulk)) - 'skipped',
  '{"restored": 1}'::jsonb, 'undo puts values back, except where someone changed them again'
);
select is(
  (select ngas from public.roster_entries where source_key = 'k1'), '>2', 'the undone count is back'
);

-- ---- public "did you mean" ------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  public.check_membership('Mohammed Ahmad Abdel Rahman', '') -> 'suggestions' -> 'names',
  '["Mohamed Ahmed Abdelrahman"]'::jsonb, 'a near-complete misspelt name is suggested'
);
select ok(
  public.check_membership('Mohamed', '') -> 'suggestions' is null, 'one word suggests nothing'
);
select ok(
  public.check_membership('mo ah', '') -> 'suggestions' is null, 'prefixes suggest nothing'
);
select is(
  public.check_membership('', 'sara.yousef99@example.com') -> 'suggestions' ->> 'email',
  's•••9@example.com', 'a near-miss email is hinted at, masked'
);
select is(
  public.check_membership('', 'sara.yousef99@example.com', null, true) ->> 'state',
  'found', 'confirming the hint returns the membership facts'
);
select ok(
  public.check_membership('', 'someone.else@nowhere.test') -> 'suggestions' is null,
  'an unrelated email gets no hint'
);

-- ---- verified by roster or by position ------------------------------------------------------
select tests.clear_auth();
select tests.create_user('omar.nabil@example.com', 'Omar');
select is(
  (select membership_status from public.profiles where id = tests.user_id('omar.nabil@example.com')),
  'candidate', 'an email on the roster is verified even when the row has no status'
);
select tests.invite('lore.officer@pgtap.test', 'score.lore');
select tests.create_user('lore.officer@pgtap.test', 'Officer Not On Roster');
select is(
  (select membership_status from public.profiles where id = tests.user_id('lore.officer@pgtap.test')),
  'active', 'an invited officer is verified at first sign-in without being on the roster'
);
select tests.create_user('late.officer@pgtap.test', 'Assigned Later');
select tests.assign('late.officer@pgtap.test', 'score.lore');
select is(
  (select membership_status from public.profiles where id = tests.user_id('late.officer@pgtap.test')),
  'active', 'being given a position verifies an existing unverified profile'
);

select * from finish();
rollback;
