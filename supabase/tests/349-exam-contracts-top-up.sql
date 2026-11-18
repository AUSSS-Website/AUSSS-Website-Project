-- Adding contracts to an exam that already has them. A row that is a contract the exam has (the
-- same programme, class, country and note, whatever the capitals) adds its number to that one
-- and makes no new contract; that holds inside one list too. Anything else is a new contract.
-- The officers can also remove every contract of an exam at once, until the exam has started.
begin;
select plan(12);

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

delete from public.exams;

create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

-- The exam's contracts in the officers' order: 'scope A Spain x5 [] | ...'.
create function pg_temp.listed(p_exam uuid) returns text
language sql as $$
  select coalesce(string_agg(c.programme || ' ' || c.class || ' ' || c.country || ' x' || c.places || ' [' || c.note || ']', ' | '
                             order by c.sort, c.created_at, c.id), '')
  from public.exam_contracts c
  where c.exam_id = p_exam
$$;
grant execute on function pg_temp.listed(uuid) to authenticated;

select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Top-up exam', 'top-up-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'exam', id from public.exams where address_word = 'top-up-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S1', '["A", "B"]'::jsonb, 0, true, null);
select public.exam_add_registrations((select id from pgtap_ids where name = 'exam'), array['5001']);

-- ---- the same contract on several lines of one list ------------------------------------------------
select is(
  public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[
    {"programme": "scope", "class": "A", "country": "Spain"},
    {"programme": "score", "class": "B", "country": "Poland", "note": "Warsaw"},
    {"programme": "SCOPE", "class": "a", "country": "  spain "},
    {"programme": "scope", "class": "A", "country": "Spain", "places": 3},
    {"programme": "score", "class": "B", "country": "Poland", "note": "warsaw"},
    {"programme": "scope", "class": "A", "country": "Spain", "note": "Madrid"}
  ]'::jsonb),
  3,
  'six lines that are three contracts make three contracts'
);
select is(
  pg_temp.listed((select id from pgtap_ids where name = 'exam')),
  'scope A Spain x5 [] | score B Poland x2 [Warsaw] | scope A Spain x1 [Madrid]',
  'the lines of one contract are counted together at its first line; another note is another contract'
);

-- ---- a later list adds to what is there --------------------------------------------------------------
select is(
  public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[
    {"programme": "scope", "class": "A", "country": "SPAIN", "places": 2},
    {"programme": "scope", "class": "B", "country": "Spain"},
    {"programme": "score", "class": "A", "country": "Spain"}
  ]'::jsonb),
  2,
  'a list that names a contract the exam has makes only the ones it has not'
);
select is(
  pg_temp.listed((select id from pgtap_ids where name = 'exam')),
  'scope A Spain x7 [] | score B Poland x2 [Warsaw] | scope A Spain x1 [Madrid] | scope B Spain x1 [] | score A Spain x1 []',
  'its number is added to the contract already there; another class or another programme is another contract'
);
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'),
       '[{"programme": "scope", "class": "A", "country": "Italy"}, {"programme": "scope", "class": "A", "country": "Spain", "places": 0}]'::jsonb) $$,
  '22023', 'Contract 2: A contract has between 1 and 999 places.',
  'a row with no places is refused by its number, also when it names a contract the exam has'
);
select throws_ok(
  $$ select public.import_exam_contracts((select id from pgtap_ids where name = 'exam'),
       '[{"programme": "scope", "class": "A", "country": "Italy"}, {"programme": "scope", "class": "A", "country": "Spain", "places": 993}]'::jsonb) $$,
  '22023', 'Contract 2: A contract has between 1 and 999 places.',
  'a number that would take a contract past 999 is refused'
);
select is(
  pg_temp.listed((select id from pgtap_ids where name = 'exam')),
  'scope A Spain x7 [] | score B Poland x2 [Warsaw] | scope A Spain x1 [Madrid] | scope B Spain x1 [] | score A Spain x1 []',
  'and a refused list changes nothing: the Italy before the bad row is not added'
);
select tests.clear_auth();

-- ---- a contract a student chose can be added to, and all can be removed -------------------------------
select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('top-up-exam', 'amal taker', 'Year 3', '01000000001', '5001');
select public.exam_save_preferences('top-up-exam',
  (select jsonb_agg(c -> 'id') from jsonb_array_elements(public.exam_preferences('top-up-exam') -> 'contracts') as x(c)
   where c ->> 'country' = 'Poland'));
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select is(
  public.import_exam_contracts((select id from pgtap_ids where name = 'exam'), '[{"programme": "score", "class": "B", "country": "Poland", "note": "Warsaw"}]'::jsonb),
  0,
  'a contract a student has chosen can be added to'
);
select is(
  (select count(*) from public.exam_contract_picks),
  1::bigint,
  'and the student''s choice of it stands'
);
select lives_ok(
  $$ delete from public.exam_contracts where exam_id = (select id from pgtap_ids where name = 'exam') $$,
  'the officers can remove every contract of an exam at once'
);
select is(
  (select count(*) from public.exam_contracts) + (select count(*) from public.exam_contract_picks),
  0::bigint,
  'which takes them off the students'' lists too'
);
select is(
  (public.exam_door('top-up-exam') -> 'exam' -> 'contracts')::text,
  '{"scope": 0, "score": 0}',
  'and the exam then asks its students for no preferences'
);
select tests.clear_auth();

select * from finish();
rollback;
