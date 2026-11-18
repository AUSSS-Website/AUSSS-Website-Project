-- The exam's contracts and each student's preferences among them. The exam officers add the
-- contracts (a programme, a class, a country, a note); a taker reads them only once they hold an
-- ID on the list, and only through their function. Preferences are given before the start code:
-- in each programme at most two of Class A and two of Class B, any number of Class C, in the
-- student's order, and only from the sections they said they will answer. The paper then sits
-- those sections. Once it has started the preferences are fixed, and so are the contracts but
-- for a country's name and a note. An exam with no contracts asks for nothing.
begin;
select plan(47);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer')
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.create_user('amal@pgtap.test', 'Amal From Google');
select tests.create_user('basel@pgtap.test', 'Basel From Google');
select tests.create_user('carim@pgtap.test', 'Carim From Google');

delete from public.exams;

-- ids the test needs again, readable by whoever is signed in
create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

-- The keys of a JSON answer, in a fixed order.
create function pg_temp.keys(p jsonb) returns text[]
language sql as $$
  select array(select k from jsonb_object_keys(p) as k order by k collate "C")
$$;

-- What a taker's phone sends to rpc/exam_save_preferences: the ids of the contracts of those
-- countries, in that order. The ids come off the taker's own read of the contracts, as on a phone.
create function pg_temp.picks(p_word text, p_countries text[]) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(c.item -> 'id' order by n.pos), '[]'::jsonb)
  from unnest(p_countries) with ordinality as n(country, pos)
  join jsonb_array_elements(public.exam_preferences(p_word) -> 'contracts') as c(item)
    on c.item ->> 'country' = n.country
$$;

-- The countries a taker has chosen, in their order.
create function pg_temp.chosen(p_word text) returns text
language sql as $$
  select coalesce(string_agg(c.item ->> 'country', ', ' order by k.pos), '')
  from (select public.exam_preferences(p_word) as p) x
  cross join lateral jsonb_array_elements_text(x.p -> 'picks') with ordinality as k(id, pos)
  join lateral jsonb_array_elements(x.p -> 'contracts') as c(item) on c.item ->> 'id' = k.id
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated;
grant execute on function pg_temp.picks(text, text[]) to authenticated;
grant execute on function pg_temp.chosen(text) to authenticated;

-- ---- setting the exam up ---------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Contracts exam', 'contracts-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'exam', id from public.exams where address_word = 'contracts-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S1', '["A", "B"]'::jsonb, 0, true, '{"section": "shared"}'::jsonb);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'P1', '["A", "B"]'::jsonb, 0, true, '{"section": "scope"}'::jsonb);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'R1', '["A", "B"]'::jsonb, 0, true, '{"section": "score"}'::jsonb);
select public.exam_add_registrations((select id from pgtap_ids where name = 'exam'), array['3001', '3002']);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[{"programme": "scope", "class": "A", "country": "Spain"}]'::jsonb) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a student cannot add a contract'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'),
       '[{"programme": "scope", "class": "A", "country": "Spain"}, {"programme": "scope", "class": "D", "country": "Nowhere"}]'::jsonb) $$,
  '22023', 'Contract 2: Choose the contract''s class: A, B or C.',
  'a bad row is refused by its number'
);
select is((select count(*) from public.exam_contracts), 0::bigint, 'and nothing of that list was added');
select is(
  public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[
    {"programme": "SCOPE", "class": "a", "country": "  Spain ", "places": 3, "note": "Madrid,  July"},
    {"programme": "scope", "class": "A", "country": "Italy"},
    {"programme": "scope", "class": "A", "country": "Brazil"},
    {"programme": "scope", "class": "B", "country": "Greece"},
    {"programme": "scope", "class": "C", "country": "Tunisia"},
    {"programme": "scope", "class": "C", "country": "Jordan"},
    {"programme": "score", "class": "A", "country": "Germany"},
    {"programme": "score", "class": "B", "country": "Poland"},
    {"programme": "score", "class": "B", "country": "Czechia"},
    {"programme": "score", "class": "B", "country": "Serbia"}
  ]'::jsonb),
  10,
  'the officers add ten contracts at once'
);
select is(
  (select programme || ' | ' || class || ' | ' || country || ' | ' || places || ' | ' || note from public.exam_contracts where country = 'Spain'),
  'scope | A | Spain | 3 | Madrid, July',
  'a contract is tidied: its programme and class however typed, no stray space'
);
select is(
  (select places from public.exam_contracts where country = 'Italy'),
  1,
  'a contract with no number of places has one'
);
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[{"programme": "scope", "class": "A", "country": "Chile", "places": 0}]'::jsonb) $$,
  '22023', 'Contract 1: A contract has between 1 and 999 places.',
  'a contract cannot have no places'
);
insert into pgtap_ids select lower(country), id from public.exam_contracts;
select tests.clear_auth();

-- ---- a student before they hold an ID ----------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select is((select count(*) from public.exam_contracts), 0::bigint, 'a taker reads no contract from the table');
select is(public.exam_door('contracts-exam') -> 'preferences', 'null'::jsonb, 'the door has no preferences for an account with no ID');
select throws_ok(
  $$ select public.exam_preferences('contracts-exam') $$,
  '22023', 'Your student ID is not on the list for this exam.',
  'the contracts are not shown to an account with no ID'
);

-- ---- choosing ----------------------------------------------------------------------------------------
select public.exam_save_details('contracts-exam', 'amal taker', 'Year 3', '01000000001', '3001');
select is(
  public.exam_door('contracts-exam') -> 'exam' -> 'contracts',
  '{"scope": 6, "score": 4}'::jsonb,
  'the door says how many contracts each programme has'
);
select is(
  public.exam_door('contracts-exam') -> 'preferences',
  '{"saved": false, "complete": false, "scope": null, "score": null, "picks": 0}'::jsonb,
  'and that this student has chosen nothing yet'
);
select is(
  public.exam_start('contracts-exam', 'GO', true, false),
  '{"ok": false, "reason": "preferences"}'::jsonb,
  'the exam does not start before the preferences are given, and the code is not looked at'
);
select is(
  (select string_agg((c ->> 'programme') || (c ->> 'class') || (c ->> 'country'), ',' order by pos)
   from jsonb_array_elements(public.exam_preferences('contracts-exam') -> 'contracts') with ordinality as x(c, pos)),
  'scopeASpain,scopeAItaly,scopeABrazil,scopeBGreece,scopeCTunisia,scopeCJordan,scoreAGermany,scoreBPoland,scoreBCzechia,scoreBSerbia',
  'the contracts come by programme, class and the officers'' order'
);
select is(
  pg_temp.keys(public.exam_preferences('contracts-exam') -> 'contracts' -> 0),
  array['class', 'country', 'id', 'note', 'places', 'programme'],
  'a contract carries nothing else'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain']), false, false) $$,
  '22023', 'Choose at least one section.',
  'no section is refused'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain', 'Italy', 'Brazil']), true, false) $$,
  '22023', 'Choose at most two Class A contracts in each programme.',
  'three of Class A in one programme are refused'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Poland', 'Czechia', 'Serbia']), false, true) $$,
  '22023', 'Choose at most two Class B contracts in each programme.',
  'three of Class B in one programme are refused'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain', 'Germany']), true, false) $$,
  '22023', 'Choose contracts only from the sections you will answer.',
  'a contract of a programme whose section is not chosen is refused'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain']), true, true) $$,
  '22023', 'Choose at least one contract for the research exchange (SCORE).',
  'a chosen programme needs at least one contract'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain']) || '["not-a-contract"]'::jsonb, true, false) $$,
  '22023', 'The list of contracts has changed. Reload the page and choose again.',
  'an id that is not one of the exam''s contracts is refused, and never cast'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', '{}'::jsonb, true, false) $$,
  '22023', 'That is not a list of contracts.',
  'anything but a list is refused'
);
select is(
  public.exam_save_preferences('contracts-exam',
    pg_temp.picks('contracts-exam', array['Italy', 'Jordan', 'Spain', 'Tunisia', 'Italy', 'Poland', 'Germany']), true, true),
  '{"saved": true, "complete": true, "scope": true, "score": true, "picks": 6}'::jsonb,
  'two of Class A, two of Class C and one of each of the other programme''s are saved'
);
select is(
  pg_temp.chosen('contracts-exam'),
  'Italy, Jordan, Spain, Tunisia, Poland, Germany',
  'in the student''s order, a contract given twice counted once'
);
select is(
  public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Greece', 'Spain']), true, false),
  '{"saved": true, "complete": true, "scope": true, "score": false, "picks": 2}'::jsonb,
  'a second save takes the place of the first'
);
select tests.clear_auth();

-- ---- the officers' guards before the start -----------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ update public.exam_contracts set class = 'B' where id = (select id from pgtap_ids where name = 'spain') $$,
  '22023', 'Students have already chosen this contract, so its programme and class stay. To change them, remove the contract and add it again: it then comes off those students'' lists.',
  'a contract somebody chose keeps its class'
);
select lives_ok(
  $$ update public.exam_contracts set class = 'B' where id = (select id from pgtap_ids where name = 'brazil') $$,
  'one nobody chose may move to another class'
);
update public.exam_contracts set note = '  until  June ', places = 2 where id = (select id from pgtap_ids where name = 'spain');
select is(
  (select note || ' | ' || places from public.exam_contracts where id = (select id from pgtap_ids where name = 'spain')),
  'until June | 2',
  'a note and a number of places may change at any time'
);
delete from public.exam_contracts where id = (select id from pgtap_ids where name = 'greece');
select is((select count(*) from public.exam_contract_picks), 1::bigint, 'removing a contract takes it off the students'' lists');
select is(
  (select string_agg(format('%s scope %s score %s paper %s picks %s', s ->> 'student_id', s ->> 'chose_scope', s ->> 'chose_score',
            coalesce(s ->> 'attempt_id', '-'), jsonb_array_length(s -> 'picks')), '; ')
   from jsonb_array_elements(public.exam_preference_list((select id from pgtap_ids where name = 'exam'))) as s),
  '3001 scope true score false paper - picks 1',
  'the officers read each student''s preferences, before any paper'
);
select tests.clear_auth();

-- ---- the start ---------------------------------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select is(
  public.exam_start('contracts-exam', 'GO', false, true) ->> 'ok',
  'true',
  'with her preferences given, Amal starts'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Spain']), true, false) $$,
  '22023', 'Your exam has started, so your contract preferences can no longer change.',
  'preferences are fixed once the paper exists'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select is(
  (select sits_scope || ' ' || sits_score from public.exam_attempts where student_id = '3001'),
  'true false',
  'the paper sits the section chosen with the preferences, whatever the page sent'
);
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[{"programme": "scope", "class": "A", "country": "Chile"}]'::jsonb) $$,
  '22023', 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.',
  'no contract is added once the exam has started'
);
select throws_ok(
  $$ delete from public.exam_contracts where id = (select id from pgtap_ids where name = 'italy') $$,
  '22023', 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.',
  'none is removed'
);
select throws_ok(
  $$ update public.exam_contracts set class = 'C' where id = (select id from pgtap_ids where name = 'italy') $$,
  '22023', 'The exam has started: a contract''s programme and class can no longer change.',
  'and none changes its class'
);
select lives_ok(
  $$ update public.exam_contracts set country = 'Italia' where id = (select id from pgtap_ids where name = 'italy') $$,
  'a country can still be corrected'
);
select tests.clear_auth();

-- ---- a released ID -----------------------------------------------------------------------------------
select tests.authenticate_as('basel@pgtap.test');
select public.exam_save_details('contracts-exam', 'basel taker', 'Year 4', '01000000002', '3002');
select public.exam_save_preferences('contracts-exam', pg_temp.picks('contracts-exam', array['Germany', 'Poland']), false, true);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select public.exam_release_registration((select id from public.exam_registrations where student_id = '3002'));
select is(
  (select format('%s %s %s %s', r.chose_scope is null, r.chose_score is null, r.preferences_at is null,
            (select count(*) from public.exam_contract_picks k where k.registration_id = r.id))
   from public.exam_registrations r where r.student_id = '3002'),
  't t t 0',
  'an ID released from its account keeps none of that account''s preferences'
);
select tests.clear_auth();

-- ---- who else ----------------------------------------------------------------------------------------
select tests.authenticate_as('carim@pgtap.test');
select throws_ok(
  $$ select public.exam_preference_list((select id from pgtap_ids where name = 'exam')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a student cannot read everybody''s preferences'
);
select throws_ok(
  $$ select public.exam_save_preferences('contracts-exam', '[]'::jsonb, true, false) $$,
  '22023', 'Your student ID is not on the list for this exam.',
  'an account with no ID on the list cannot save preferences'
);
select tests.clear_auth();

-- ---- an exam with no choice of sections --------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Flat exam', 'flat-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'flat', id from public.exams where address_word = 'flat-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'flat'), null, 'Q1', '["A", "B"]'::jsonb, 0, true);
select public.exam_add_registrations((select id from pgtap_ids where name = 'flat'), array['3001']);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('flat-exam', 'amal taker', 'Year 3', '01000000001', '3001');
select is(
  (select (d -> 'exam' -> 'contracts')::text || ' ' || (d -> 'preferences' ->> 'complete')
   from (select public.exam_door('flat-exam') as d) x),
  '{"scope": 0, "score": 0} true',
  'an exam with no contracts asks for no preferences'
);
select throws_ok(
  $$ select public.exam_save_preferences('flat-exam', '[]'::jsonb) $$,
  '22023', 'This exam has no contracts to choose from.',
  'and has none to save'
);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select public.import_exam_contracts((select id from pgtap_ids where name = 'flat'), '[
  {"programme": "scope", "class": "A", "country": "Peru"},
  {"programme": "score", "class": "A", "country": "Japan"}
]'::jsonb);
select tests.clear_auth();
select tests.authenticate_as('amal@pgtap.test');
select is(
  public.exam_start('flat-exam', 'GO'),
  '{"ok": false, "reason": "preferences"}'::jsonb,
  'once it has contracts, the start waits for the preferences'
);
select throws_ok(
  $$ select public.exam_save_preferences('flat-exam', '[]'::jsonb) $$,
  '22023', 'Choose at least one contract.',
  'at least one contract must be chosen'
);
select is(
  public.exam_save_preferences('flat-exam', pg_temp.picks('flat-exam', array['Japan'])),
  '{"saved": true, "complete": true, "scope": null, "score": null, "picks": 1}'::jsonb,
  'with no choice of sections, a contract of either programme can be chosen and no section is asked'
);
select is(public.exam_start('flat-exam', 'GO') ->> 'ok', 'true', 'and the exam then starts');
select tests.clear_auth();

-- ---- the exam goes, and everything with it -----------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
delete from public.exams;
select is(
  (select count(*) from public.exam_contracts) + (select count(*) from public.exam_contract_picks),
  0::bigint,
  'deleting an exam takes its contracts and the students'' picks with it'
);
select tests.clear_auth();

select * from finish();
rollback;
