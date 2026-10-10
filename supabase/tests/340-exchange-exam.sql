-- The exchange exam: the SCOPE and SCORE officers and the Executive Board set one up and nobody
-- else does; a visitor reads nothing. A taker's account reads no table: it reaches its own
-- paper through five functions, and never the key, a grade, the list or anyone else's paper. A
-- student ID is one ID however it is typed, and belongs to the first account that gives it. A
-- paper starts inside the window with the code read out in the hall, runs for the exam's full
-- length on a clock of its own whatever the closing time, and takes no answer once it is handed
-- in or 30 seconds past its deadline. Nothing is stored as a result: the officers' reads mark
-- the papers as they stand, so a corrected key changes the grades. Once a student has started,
-- the exam is fixed where it matters; its closing time, its length upwards and its start code
-- are not.
begin;
select plan(170);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing'),
       ('scoph', 'Public Health', 'SCOPH', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer'),
       ('scoph.lpo', (select id from public.committees where slug = 'scoph'), 'Local Public Health Officer', 'LPO', 'officer'),
       ('scoph.member', (select id from public.committees where slug = 'scoph'), 'Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.create_user('lpo@pgtap.test', 'Public Health Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lore@pgtap.test', 'score.lore');
select tests.assign('lpo@pgtap.test', 'scoph.lpo');
select tests.assign('member@pgtap.test', 'scoph.member');

-- The takers: accounts with no position, as a student has who signs in at the exam's own door.
-- Eman signs in with the wrong Google account first.
select tests.create_user('amal@pgtap.test', 'Amal From Google');
select tests.create_user('basel@pgtap.test', 'Basel From Google');
select tests.create_user('carim@pgtap.test', 'Carim From Google');
select tests.create_user('dina@pgtap.test', 'Dina From Google');
select tests.create_user('wrong@pgtap.test', 'Eman Other Account');
select tests.create_user('eman@pgtap.test', 'Eman From Google');

delete from public.exams;

-- What a taker's phone still holds when the connection drops or the clock runs out: batches of
-- answers made while the paper could be read, sent later.
create temporary table pgtap_waiting (name text primary key, batch jsonb not null) on commit drop;
grant select, insert on pgtap_waiting to authenticated;

-- The keys of a JSON answer, in a fixed order.
create function pg_temp.keys(p jsonb) returns text[]
language sql as $$
  select array(select k from jsonb_object_keys(p) as k order by k collate "C")
$$;

-- What a taker's phone sends to rpc/exam_save: for each question named by its text, the position
-- at which this taker's own paper shows the option with that text (null for no answer), and a
-- flag for the questions listed. Every taker's order is their own, so the test picks by text and
-- reads the position off the paper, as a student does.
create function pg_temp.answers(p_picks jsonb, p_flagged text[] default '{}') returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object(
           'q', q.item -> 'id',
           'c', (select (o.pos - 1)::int
                 from jsonb_array_elements_text(q.item -> 'options') with ordinality as o(txt, pos)
                 where o.txt = p.value),
           'f', (q.item ->> 'body') = any (p_flagged)))
  from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'questions') as q(item)
  join jsonb_each_text(p_picks) as p on p.key = q.item ->> 'body'
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated;
grant execute on function pg_temp.answers(jsonb, text[]) to authenticated;

-- ---- who may set an exam up --------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from public.exams $$, '42501', null, 'a visitor cannot read the exams');
select throws_ok($$ select count(*) from public.exam_questions $$, '42501', null, 'a visitor cannot read the questions');
select throws_ok($$ select count(*) from public.exam_key $$, '42501', null, 'a visitor cannot read the key');
select throws_ok($$ select count(*) from public.exam_registrations $$, '42501', null, 'a visitor cannot read the list of IDs');
select throws_ok($$ select count(*) from public.exam_attempts $$, '42501', null, 'a visitor cannot read the papers');
select throws_ok($$ select count(*) from public.exam_answers $$, '42501', null, 'a visitor cannot read the answers');
select throws_ok($$ select public.exam_door('pgtap-exam') $$, '42501', null, 'a visitor cannot come to an exam''s door without signing in');
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
select throws_ok(
  $$ insert into public.exams (title) values ('Not ours') $$,
  '42501', null,
  'a SCOPH officer cannot set an exam up'
);
select tests.clear_auth();

select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.exams (title) values ('Not mine') $$,
  '42501', null,
  'a member cannot set an exam up'
);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select throws_ok(
  $$ insert into public.exams (title) values ('Not mine either') $$,
  '42501', null,
  'a taker cannot set an exam up'
);
select tests.clear_auth();

select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.exams (title, address_word) values ('The board''s exam', 'board-draft') $$,
  'the Executive Board sets an exam up'
);
select tests.clear_auth();

select tests.authenticate_as('lore@pgtap.test');
select lives_ok(
  $$ insert into public.exams (title) values ('Research exchange exam') $$,
  'a SCORE officer sets an exam up'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ insert into public.exams (title) values ('  Exchange exam 2027  ') $$,
  'a SCOPE officer sets an exam up'
);
select is(
  (select status || ' | ' || (address_word ~ '^[0-9a-f]{12}$') || ' | ' || (created_by = tests.user_id('leo@pgtap.test'))
          || ' | ' || (term_id = app.current_term_id())
   from public.exams where title = 'Exchange exam 2027'),
  'draft | true | true | true',
  'a new exam is a draft with a random word in its address, its author and the current term'
);
select is(
  (select count(*) from public.exams),
  3::bigint,
  'an exam officer sees every exam, another committee''s too'
);

-- ---- what an exam refuses ----------------------------------------------------------------------
select throws_ok(
  $$ update public.exams set address_word = 'two words' where title = 'Exchange exam 2027' $$,
  '22023', 'The word in the address needs 6 to 60 lower-case letters, digits or hyphens.',
  'the word in the address has no spaces'
);
select throws_ok(
  $$ update public.exams set address_word = 'exam1' where title = 'Exchange exam 2027' $$,
  '22023', 'The word in the address needs 6 to 60 lower-case letters, digits or hyphens.',
  'the word in the address has at least six characters'
);
select throws_ok(
  $$ update public.exams set address_word = 'Callback' where title = 'Exchange exam 2027' $$,
  '22023', 'That word is reserved. Choose another.',
  'no exam takes the word the sign-in comes back to'
);
update public.exams set address_word = '  PGTAP-Exam ' where title = 'Exchange exam 2027';
select is(
  (select address_word from public.exams where title = 'Exchange exam 2027'),
  'pgtap-exam',
  'the word is kept trimmed and in lower case'
);
select throws_ok(
  $$ update public.exams set address_word = 'pgtap-exam' where title = 'Research exchange exam' $$,
  '23505', 'Another exam already uses that word. Choose another.',
  'two exams cannot share a word'
);
select throws_ok(
  $$ update public.exams set status = 'ready' where address_word = 'pgtap-exam' $$,
  '22023', 'Set when the exam opens and closes before making it ready.',
  'an exam is not made ready without its times'
);
select throws_ok(
  $$ update public.exams set opens_at = now() + interval '2 hours', closes_at = now() + interval '1 hour'
     where address_word = 'pgtap-exam' $$,
  '22023', 'The exam must close after it opens.',
  'an exam cannot close before it opens'
);
select throws_ok(
  $$ update public.exams set minutes = 4 where address_word = 'pgtap-exam' $$,
  '22023', 'The exam''s length must be between 5 and 600 minutes.',
  'an exam is at least five minutes long'
);

-- The exam is made ready: it opens in an hour and is 90 minutes long, with no start code yet.
update public.exams
set opens_at = now() + interval '1 hour', closes_at = now() + interval '3 hours', minutes = 90, status = 'ready'
where address_word = 'pgtap-exam';
select tests.clear_auth();

-- the exam's id, for the roles that cannot look it up
create temporary table pgtap_exam on commit drop as
  select id from public.exams where address_word = 'pgtap-exam';
grant select on pgtap_exam to authenticated;

-- ---- the questions and the key -----------------------------------------------------------------
select tests.authenticate_as('lpo@pgtap.test');
select is(
  (select count(*) from public.exams),
  0::bigint,
  'a SCOPH officer sees no exam'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'Not ours', '["a", "b"]'::jsonb, 0) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a SCOPH officer cannot write a question'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select public.save_exam_question((select id from pgtap_exam), null, '  Question one  ', '["1A", " 1B ", "1C", "1D"]'::jsonb, 2);
select public.save_exam_question((select id from pgtap_exam), null, 'Question two', '["2A", "2B", "2C"]'::jsonb, 0);
select public.save_exam_question((select id from pgtap_exam), null, 'Question three', '["3A", "3B", "All of the above"]'::jsonb, 2, true);
select tests.clear_auth();

select tests.authenticate_as('lore@pgtap.test');
select is(
  public.import_exam_questions(
    (select id from pgtap_exam),
    '[{"body": "Question four", "options": ["4A", "4B"], "correct": 1, "keep_order": false}]'::jsonb
  ),
  1,
  'a SCORE officer imports a question into the exam a SCOPE officer made'
);
select is(
  (select string_agg(q.body || ' ' || q.options::text || ' ' || k.correct_option, ' | ' order by q.sort)
   from public.exam_questions q
   join public.exam_key k on k.question_id = q.id),
  'Question one ["1A", "1B", "1C", "1D"] 2 | Question two ["2A", "2B", "2C"] 0 | '
    || 'Question three ["3A", "3B", "All of the above"] 2 | Question four ["4A", "4B"] 1',
  'the questions stand in the order they were added, trimmed, each with its right answer beside it'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'No right answer', '["a", "b"]'::jsonb, null) $$,
  '22023', 'Choose which option is right.',
  'a question needs its right answer'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'A right answer it does not have', '["a", "b"]'::jsonb, 2) $$,
  '22023', 'Choose which option is right.',
  'the right answer is one of the question''s own options'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'One option', '["a", " "]'::jsonb, 0) $$,
  '22023', 'A question needs between 2 and 6 options, none of them empty.',
  'a question needs at least two options that say something'
);
select throws_ok(
  $$ select public.import_exam_questions(
       (select id from pgtap_exam),
       '[{"body": "Question five", "options": ["5A", "5B"], "correct": 0},
         {"body": " ", "options": ["6A", "6B"], "correct": 0}]'::jsonb) $$,
  '22023', 'Question 2: A question needs its text.',
  'an import names the row that is wrong'
);
select is(
  (select count(*) from public.exam_questions),
  4::bigint,
  'and adds nothing when one row is wrong'
);
select throws_ok(
  $$ update public.exam_key set correct_option = 0 $$,
  '42501', null,
  'an officer changes a right answer through the function, never in the table'
);
select tests.clear_auth();

-- ---- one ID, however it is typed ---------------------------------------------------------------
-- U&'\0662\0660\0662\0663' is 2023 in Arabic-Indic digits, U&'\06F2\06F0\06F2\06F3' in Persian
-- ones; \200B and \FEFF are characters that cannot be seen
select is(
  app.tidy_student_id(U&'\0662\0660\0662\0663 1234'),
  '20231234',
  'an ID in Arabic numerals with a space is the same ID'
);
select is(
  app.tidy_student_id('2023-1234'),
  '20231234',
  'and so is one with a hyphen'
);
select is(
  app.tidy_student_id(U&' \06F2\06F0\06F2\06F3/12.34_ab\200B\FEFF '),
  '20231234AB',
  'Persian numerals are read, separators and invisible characters go, letters are in upper case'
);
select is(
  app.tidy_student_id(' - . '),
  '',
  'separators alone are no ID'
);
-- \202A and \202C are the marks a chat wraps a number in and \2013 is the dash a word processor
-- makes of a hyphen; \FF11 to \FF14 are full-width digits, \2007 and \202F spaces that do not
-- break, \00AD a soft hyphen and \2060 a word joiner
select is(
  app.tidy_student_id(U&'\202A2023\20131234\202C'),
  '20231234',
  'an ID pasted from a chat, wrapped in marks nobody sees and with a dash for its hyphen, is the same ID'
);
select is(
  app.tidy_student_id(U&'2023\2007\FF11\FF12\202F\FF13\FF14\00AD\2060'),
  '20231234',
  'full-width digits are read, and the spaces and joiners that do not show are dropped'
);

-- ---- the list ------------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select is(
  public.exam_add_registrations(
    (select id from pgtap_exam),
    array['2023-1234', '2023 5678', '20231234', ' - ', repeat('9', 41), '2023/9012', 'AB-77']
  ),
  '{"added": 4, "already": 1, "invalid": 2}'::jsonb,
  'an officer adds IDs: four are new, one is the first again in another spelling, two are no ID'
);
select is(
  public.exam_add_registrations((select id from pgtap_exam), array['2023.1234', '5555', '7777']),
  '{"added": 2, "already": 1, "invalid": 0}'::jsonb,
  'an ID that is on the list is not added twice'
);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select is(
  public.exam_door('no-such-exam'),
  '{"exam": null}'::jsonb,
  'an address with no exam behind it says so and nothing more'
);
select is(
  public.exam_door('board-draft'),
  '{"exam": null}'::jsonb,
  'a draft is not there for a student either'
);
select throws_ok(
  $$ select public.exam_paper('board-draft') $$,
  '22023', 'There is no exam at this address.',
  'and has no paper'
);
-- the exam's trigger runs before row-level security: it must not say "that word is taken" here
select throws_ok(
  $$ insert into public.exams (title, address_word) values ('Is it there?', 'board-draft') $$,
  '42501', null,
  'nor can a student learn that a draft''s word is in use: whatever the word, setting an exam up is refused the same way'
);
select is(
  (select (d -> 'exam' ->> 'title') || ' | ' || (d -> 'exam' ->> 'phase') || ' | ' || (d -> 'exam' ->> 'questions')
          || ' | ' || (d -> 'exam' ->> 'minutes') || ' | ' || (d ->> 'registration') || ' | ' || jsonb_typeof(d -> 'attempt')
          || ' | ' || (d -> 'me' ->> 'email')
   from (select public.exam_door(' PGTAP-Exam ') as d) x),
  'Exchange exam 2027 | before | 4 | 90 | none | null | amal@pgtap.test',
  'the door of an exam that has not opened: its title and size, no ID held, no paper'
);
select is(
  (select pg_temp.keys(d) || pg_temp.keys(d -> 'exam') || pg_temp.keys(d -> 'me')
   from (select public.exam_door('pgtap-exam') as d) x),
  array['attempt', 'exam', 'me', 'now', 'registration',
        'closes_at', 'minutes', 'opens_at', 'phase', 'questions', 'title',
        'email', 'faculty_year', 'full_name', 'phone', 'student_id'],
  'the door says nothing else: no start code, no key'
);
select is(
  public.exam_start('pgtap-exam', 'anything') ->> 'reason',
  'not_registered',
  'a student who holds no ID on the list cannot start'
);
select throws_ok(
  $$ select public.exam_save_details('pgtap-exam', 'Al', 'Year 3', '01000000001', '2023-1234') $$,
  '22023', 'Enter your full name.',
  'two letters are not a full name'
);
select throws_ok(
  $$ select public.exam_save_details('pgtap-exam', 'amal taker', ' ', '01000000001', '2023-1234') $$,
  '22023', 'Choose your year.',
  'the year is asked for'
);
select throws_ok(
  $$ select public.exam_save_details('pgtap-exam', 'amal taker', 'Year 3', '12345', '2023-1234') $$,
  '22023', 'Enter a phone number we can reach you on.',
  'five digits are not a phone number'
);
select throws_ok(
  $$ select public.exam_save_details('pgtap-exam', 'amal taker', 'Year 3', '01000000001', ' - ') $$,
  '22023', 'Enter your student ID.',
  'a student ID is asked for'
);
select is(
  public.exam_save_details('pgtap-exam', 'amal taker', 'Year 3', '01000000001', '2023-0000') ->> 'registration',
  'not_listed',
  'an ID that is not on the list is not listed'
);
-- the ID and the phone number in Arabic numerals, the ID with a space the list does not have
select is(
  public.exam_save_details(
    'pgtap-exam', 'amal taker', 'Year 3',
    U&'\0660\0661\0660\0660\0660\0660\0660\0660\0660\0660\0661', U&'\0662\0660\0662\0663 1234'
  ) ->> 'registration',
  'held',
  'an ID on the list is held by the account that gives it, typed in Arabic numerals with a space'
);
select is(
  (select (d ->> 'registration') || ' | ' || (d -> 'me' ->> 'full_name') || ' | ' || (d -> 'me' ->> 'faculty_year')
   from (select public.exam_door('pgtap-exam') as d) x),
  'held | amal taker | Year 3',
  'the door then shows the ID as held and the details as they were saved'
);
select is(
  public.exam_save_details('pgtap-exam', 'amal taker', 'Year 3', '01000000001', '2023-1234') ->> 'registration',
  'held',
  'the same ID in another spelling is still theirs'
);
select throws_ok(
  $$ select public.exam_save_details('pgtap-exam', 'amal taker', 'Year 3', '01000000001', '2023 5678') $$,
  '22023', 'Your student ID is confirmed and cannot be changed here. Ask an exchange officer if it is wrong.',
  'an ID that is held cannot be swapped for another'
);
select throws_ok(
  $$ update public.profiles set student_id = '2023 5678' where id = (select auth.uid()) $$,
  '42501', null,
  'nor written into the profile directly'
);
select is(
  public.exam_start('pgtap-exam', 'anything') ->> 'reason',
  'not_open',
  'nobody starts before the exam opens'
);
select tests.clear_auth();

select tests.authenticate_as('basel@pgtap.test');
select is(
  public.exam_save_details('pgtap-exam', 'Basel Taker', 'Year 4', '01000000002', '20231234') ->> 'registration',
  'taken',
  'a second account that gives the same ID is told it is taken'
);
-- nine more misses make ten within the hour
select public.exam_save_details('pgtap-exam', 'Basel Taker', 'Year 4', '01000000002', 'guess ' || g)
from generate_series(1, 9) as g;
select is(
  public.exam_save_details('pgtap-exam', 'Basel Taker', 'Year 4', '01000000002', '2023 5678') ->> 'registration',
  'locked',
  'ten misses lock the check, also for an ID that is on the list'
);
select is(
  (select count(*) from public.exam_registrations),
  0::bigint,
  'a taker cannot read the list'
);
select throws_ok(
  $$ select public.exam_registration_list((select id from pgtap_exam)) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor ask for it'
);
select tests.clear_auth();

select ok(
  (select profile_id is null from public.exam_registrations where student_key = '20235678'),
  'while the check is locked the list is not looked at: the ID is still free'
);
select is(
  (select count(*) from app.exam_tries where kind = 'id' and profile_id = tests.user_id('basel@pgtap.test')),
  10::bigint,
  'each miss was counted'
);
-- an hour later
update app.exam_tries set at = at - interval '61 minutes' where kind = 'id';

select tests.authenticate_as('basel@pgtap.test');
select is(
  public.exam_save_details('pgtap-exam', 'Basel Taker', 'Year 4', '01000000002', '2023 5678') ->> 'registration',
  'held',
  'after an hour the check opens again'
);
select tests.clear_auth();

select tests.authenticate_as('carim@pgtap.test');
select public.exam_save_details('pgtap-exam', 'Carim Taker', 'Year 5', '01000000003', '20239012');
select tests.clear_auth();

select tests.authenticate_as('dina@pgtap.test');
select is(
  public.exam_save_details('pgtap-exam', 'Dina Taker', 'Intern', '01000000004', 'ab 77') ->> 'registration',
  'held',
  'letters match whatever their case'
);
select tests.clear_auth();

select tests.authenticate_as('wrong@pgtap.test');
select public.exam_save_details('pgtap-exam', 'Eman Taker', 'Year 2', '01000000005', '5555');
select tests.clear_auth();

-- ---- starting ----------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ update public.exams set opens_at = now() - interval '1 hour' where address_word = 'pgtap-exam' $$,
  'until the first student starts the opening time can move'
);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select is(
  public.exam_door('pgtap-exam') -> 'exam' ->> 'phase',
  'open',
  'the door says the exam is open'
);
select is(
  public.exam_start('pgtap-exam', 'anything') ->> 'reason',
  'not_ready',
  'nobody starts an exam that has no start code yet'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
update public.exams set start_code = ' go 2027 ' where address_word = 'pgtap-exam';
select is(
  (select start_code from public.exams where address_word = 'pgtap-exam'),
  'GO2027',
  'the start code is kept in upper case with no spaces'
);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select is(
  (select (r ->> 'reason') || ' ' || (r ->> 'tries_left') from (select public.exam_start('pgtap-exam', 'go 2026') as r) x),
  'code 7',
  'a wrong code is refused and says how many tries are left'
);
-- seven more wrong codes make eight within ten minutes
select public.exam_start('pgtap-exam', 'wrong ' || g) from generate_series(1, 7) as g;
select is(
  public.exam_start('pgtap-exam', 'GO2027') ->> 'reason',
  'locked',
  'eight wrong codes lock the start, also for the right code'
);
select tests.clear_auth();

select is(
  (select count(*) from public.exam_attempts),
  0::bigint,
  'no wrong code started a paper'
);
-- ten minutes later
update app.exam_tries set at = at - interval '11 minutes' where kind = 'code';

-- Dina holds her ID, but her profile has since lost its phone number.
update public.profiles set phone = null where id = tests.user_id('dina@pgtap.test');
select tests.authenticate_as('dina@pgtap.test');
select is(
  public.exam_start('pgtap-exam', 'GO2027') ->> 'reason',
  'details',
  'a student whose details are not complete is sent back to give them'
);
select public.exam_save_details('pgtap-exam', 'Dina Taker', 'Intern', '01000000004', 'AB-77');
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select ok(
  (public.exam_start('pgtap-exam', ' go 2027 ') ->> 'ok')::boolean,
  'after ten minutes the right code, typed in lower case with spaces, starts the paper'
);
select is(
  public.exam_start('pgtap-exam', '') ->> 'attempt_id',
  public.exam_door('pgtap-exam') -> 'attempt' ->> 'id',
  'a second call gives the same paper back and asks for no code'
);
select tests.clear_auth();

select is(
  (select count(*) || ' ' || min(student_id) from public.exam_attempts
   where profile_id = tests.user_id('amal@pgtap.test')),
  '1 2023-1234',
  'there is one paper, and it carries the ID as the officers wrote it'
);

-- ---- once a student has started ------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ update public.exams set opens_at = now() - interval '2 hours' where address_word = 'pgtap-exam' $$,
  '22023', 'The exam has started: its opening time cannot change.',
  'once a student has started the opening time stays'
);
select throws_ok(
  $$ update public.exams set minutes = 60 where address_word = 'pgtap-exam' $$,
  '22023', 'The exam has started: it can be made longer, not shorter.',
  'the exam cannot be made shorter'
);
select throws_ok(
  $$ update public.exams set status = 'draft' where address_word = 'pgtap-exam' $$,
  '22023', 'The exam has started: it cannot go back to a draft.',
  'it cannot go back to a draft'
);
select throws_ok(
  $$ update public.exams set address_word = 'another-word' where address_word = 'pgtap-exam' $$,
  '22023', 'The exam has started: the word in its address cannot change.',
  'the word in its address stays'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'A late question', '["a", "b"]'::jsonb, 0) $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'no question is added'
);
select throws_ok(
  $$ delete from public.exam_questions where body = 'Question four' $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'none is removed'
);
select throws_ok(
  $$ select public.save_exam_question(
       (select id from pgtap_exam), (select id from public.exam_questions where body = 'Question three'),
       'Question three, reworded', '["3A", "3B", "All of the above"]'::jsonb, 2, true) $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'and none is reworded'
);
select lives_ok(
  $$ update public.exams set minutes = 120 where address_word = 'pgtap-exam' $$,
  'the exam can still be made longer'
);
select lives_ok(
  $$ update public.exams set start_code = 'go 2027 b' where address_word = 'pgtap-exam' $$,
  'and the start code can change at any moment'
);
select tests.clear_auth();

-- ---- the paper -----------------------------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select is(
  pg_temp.keys(public.exam_paper('pgtap-exam')),
  array['answers', 'attempt', 'exam', 'now', 'questions', 'state'],
  'a paper is the exam''s name and length, the clock, the questions and the answers so far: no key and no grade'
);
select is(
  (select pg_temp.keys(p -> 'exam') || pg_temp.keys(p -> 'attempt') from (select public.exam_paper('pgtap-exam') as p) x),
  array['minutes', 'title', 'deadline_at', 'id', 'started_at'],
  'of the exam it gives the title and the length, of the attempt its start and its deadline'
);
select is(
  (select array_agg(distinct pg_temp.keys(q)::text)
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'questions') as q),
  array['{body,id,options}'],
  'a question on the paper is its text and its options: no right answer, no officers'' order'
);
select is(
  (select array_agg(q ->> 'body' order by q ->> 'body')
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'questions') as q),
  array['Question four', 'Question one', 'Question three', 'Question two'],
  'the paper has every question of the exam exactly once'
);
select is(
  (select array(select jsonb_array_elements_text(q -> 'options') order by 1)
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'questions') as q
   where q ->> 'body' = 'Question one'),
  array['1A', '1B', '1C', '1D'],
  'a question has all its options, in this taker''s order'
);
select is(
  (select q -> 'options'
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'questions') as q
   where q ->> 'body' = 'Question three'),
  '["3A", "3B", "All of the above"]'::jsonb,
  'a question that keeps its option order is shown as the officers wrote it'
);
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'submitted') || ' ' || (r ->> 'saved') || ' '
          || ((r ->> 'deadline_at')::timestamptz = now() + interval '120 minutes')
   from (select public.exam_save('pgtap-exam', '[]'::jsonb) as r) x),
  'sitting false 0 true',
  'an empty save is a heartbeat: it gives the deadline back, here with the extra time the officers gave'
);
select is(
  pg_temp.keys(public.exam_save('pgtap-exam', '[]'::jsonb)),
  array['deadline_at', 'now', 'saved', 'state', 'submitted'],
  'a save answers with the clock and a count: no grade, and nothing about which answers are right'
);

-- ---- saving --------------------------------------------------------------------------------------
select is(
  public.exam_save('pgtap-exam', pg_temp.answers('{"Question one": "1A"}')) ->> 'saved',
  '1',
  'an answer is saved as it is chosen'
);
-- a change of mind
select public.exam_save('pgtap-exam', pg_temp.answers('{"Question one": "1C"}'));
select is(
  public.exam_save(
    'pgtap-exam',
    pg_temp.answers('{"Question two": "2A"}')
    || jsonb_build_array(
         -- a question that is not on this paper
         jsonb_build_object('q', gen_random_uuid(), 'c', 0, 'f', false),
         -- positions the question does not have: it has three options, and none is below zero or a half
         jsonb_build_object('q', pg_temp.answers('{"Question three": "3A"}') -> 0 -> 'q', 'c', 3, 'f', false),
         jsonb_build_object('q', pg_temp.answers('{"Question four": "4A"}') -> 0 -> 'q', 'c', -1, 'f', false),
         jsonb_build_object('q', pg_temp.answers('{"Question four": "4A"}') -> 0 -> 'q', 'c', 1.5, 'f', false),
         -- an item with no position at all, for a question that has an answer: read as "no
         -- answer" it would wipe that answer
         jsonb_build_object('q', pg_temp.answers('{"Question one": "1C"}') -> 0 -> 'q', 'f', true),
         -- and items that are no answer at all
         jsonb_build_object('q', 'not an id', 'c', 0),
         jsonb_build_object('c', 0),
         '"not an answer"'::jsonb
       )
  ) ->> 'saved',
  '1',
  'a question that is not on the paper, a position the question does not have, an item with no position and an item that is no answer are skipped without a word'
);
-- a flag with no answer, and a question sent twice in one save
select public.exam_save(
  'pgtap-exam',
  pg_temp.answers('{"Question four": null}', array['Question four'])
  || pg_temp.answers('{"Question three": "3B"}')
  || pg_temp.answers('{"Question three": "3A"}')
);
select is(
  (select array_agg(distinct pg_temp.keys(a)::text)
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'answers') as a),
  array['{c,f,q}'],
  'the paper gives each answer back as a question, a position and a flag: nothing says whether it is right'
);
select is(
  (select a -> 'c'
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'answers') as a
   where a -> 'q' = pg_temp.answers('{"Question one": "1C"}') -> 0 -> 'q'),
  pg_temp.answers('{"Question one": "1C"}') -> 0 -> 'c',
  'and at the position this taker chose it at'
);
select is(
  (select (a ->> 'c') is null and (a ->> 'f')::boolean
   from jsonb_array_elements(public.exam_paper('pgtap-exam') -> 'answers') as a
   where a -> 'q' = pg_temp.answers('{"Question four": null}') -> 0 -> 'q'),
  true,
  'a flag with no answer is kept as that'
);
select tests.clear_auth();

select is(
  (select string_agg(
            q.body || ' ' || coalesce(w.chosen_option::text, 'none') || case when w.flagged then ' flagged' else '' end,
            ', ' order by q.sort)
   from public.exam_answers w
   join public.exam_questions q on q.id = w.question_id
   join public.exam_attempts a on a.id = w.attempt_id
   where a.profile_id = tests.user_id('amal@pgtap.test')),
  'Question one 2, Question two 0, Question three 0, Question four none flagged',
  'each answer is kept once, under the officers'' own numbering whatever order the taker saw; a question sent twice keeps its last answer, and the item with no position wiped nothing'
);

-- Fifty minutes into Amal's paper; her answers so far were given ten minutes ago.
update public.exam_attempts set started_at = now() - interval '50 minutes'
where profile_id = tests.user_id('amal@pgtap.test');
update public.exam_answers w set answered_at = now() - interval '10 minutes'
from public.exam_attempts a
where a.id = w.attempt_id and a.profile_id = tests.user_id('amal@pgtap.test');

select tests.authenticate_as('amal@pgtap.test');
-- question one gets a flag and keeps its answer; question two gets another answer
select public.exam_save(
  'pgtap-exam',
  pg_temp.answers('{"Question one": "1C", "Question two": "2B"}', array['Question one'])
);
select tests.clear_auth();

select is(
  (select string_agg(q.body || ' ' || (w.answered_at = now()), ', ' order by q.sort)
   from public.exam_answers w
   join public.exam_questions q on q.id = w.question_id
   join public.exam_attempts a on a.id = w.attempt_id
   where a.profile_id = tests.user_id('amal@pgtap.test') and q.body in ('Question one', 'Question two')),
  'Question one false, Question two true',
  'the time of an answer moves when the answer changes, not when only its flag does'
);

select tests.authenticate_as('amal@pgtap.test');
insert into pgtap_waiting values ('amal, after the hand-in', pg_temp.answers('{"Question one": "1A"}'));
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'submitted') || ' ' || (r ->> 'saved')
   from (select public.exam_save('pgtap-exam', pg_temp.answers('{"Question one": "1C", "Question two": "2A"}'), true) as r) x),
  'over true 2',
  'handing in saves what came with it and ends the paper'
);
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'submitted') || ' ' || (r ->> 'saved')
   from (select public.exam_save('pgtap-exam', (select batch from pgtap_waiting where name = 'amal, after the hand-in')) as r) x),
  'over true 0',
  'a save after the hand-in is told the paper is over and saves nothing'
);
select is(
  public.exam_paper('pgtap-exam'),
  '{"state": "over", "submitted": true}'::jsonb,
  'the paper is closed: it says it was handed in and shows no question'
);
select is(
  (select pg_temp.keys(d -> 'attempt') || array[d -> 'attempt' ->> 'over', ((d -> 'attempt' ->> 'submitted_at') is not null)::text]
   from (select public.exam_door('pgtap-exam') as d) x),
  array['deadline_at', 'id', 'over', 'started_at', 'submitted_at', 'true', 'true'],
  'the door shows the paper as over and handed in, with its times and nothing else'
);
select tests.clear_auth();

select is(
  (select w.chosen_option
   from public.exam_answers w
   join public.exam_questions q on q.id = w.question_id
   join public.exam_attempts a on a.id = w.attempt_id
   where a.profile_id = tests.user_id('amal@pgtap.test') and q.body = 'Question one'),
  2,
  'the answer handed in is the answer kept'
);

select tests.authenticate_as('dina@pgtap.test');
select throws_ok(
  $$ select public.exam_paper('pgtap-exam') $$,
  '22023', 'You have not started this exam.',
  'a student who has not started has no paper'
);
select throws_ok(
  $$ select public.exam_save('pgtap-exam', '[]'::jsonb) $$,
  '22023', 'You have not started this exam.',
  'and nothing to save into'
);
select tests.clear_auth();

-- Basel starts, answers two questions, and the clock runs out with two more on their way.
select tests.authenticate_as('basel@pgtap.test');
select ok(
  (public.exam_start('pgtap-exam', 'GO2027B') ->> 'ok')::boolean,
  'a second student starts, with the new code'
);
select public.exam_save('pgtap-exam', pg_temp.answers('{"Question one": "1A", "Question two": "2A"}'));
insert into pgtap_waiting values
  ('basel, on its way', pg_temp.answers('{"Question four": "4A"}')),
  ('basel, too late', pg_temp.answers('{"Question three": "3B"}'));
select tests.clear_auth();

-- twenty seconds past Basel's deadline
update public.exam_attempts set started_at = now() - interval '120 minutes 20 seconds'
where profile_id = tests.user_id('basel@pgtap.test');

select tests.authenticate_as('basel@pgtap.test');
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'submitted') || ' ' || (r ->> 'saved')
   from (select public.exam_save('pgtap-exam', (select batch from pgtap_waiting where name = 'basel, on its way')) as r) x),
  'over false 1',
  'a save that was on its way when the clock ran out still lands within 30 seconds'
);
select tests.clear_auth();

-- thirty-one seconds past it
update public.exam_attempts set started_at = now() - interval '120 minutes 31 seconds'
where profile_id = tests.user_id('basel@pgtap.test');

select tests.authenticate_as('basel@pgtap.test');
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'submitted') || ' ' || (r ->> 'saved')
   from (select public.exam_save('pgtap-exam', (select batch from pgtap_waiting where name = 'basel, too late')) as r) x),
  'over false 0',
  'a save 31 seconds past the deadline saves nothing'
);
select is(
  public.exam_paper('pgtap-exam'),
  '{"state": "over", "submitted": false}'::jsonb,
  'a paper whose time ran out is closed, and says it was not handed in'
);
select tests.clear_auth();

select is(
  (select count(*)
   from public.exam_answers w
   join public.exam_attempts a on a.id = w.attempt_id
   where a.profile_id = tests.user_id('basel@pgtap.test')),
  3::bigint,
  'the answer that came too late was not kept'
);

-- ---- the key and the grade are out of a taker's reach -----------------------------------------------
-- Carim starts and is still sitting: there are rows in every table now.
select tests.authenticate_as('carim@pgtap.test');
select ok(
  (public.exam_start('pgtap-exam', 'go2027b') ->> 'ok')::boolean,
  'a third student starts'
);
select public.exam_save(
  'pgtap-exam',
  pg_temp.answers('{"Question one": "1C", "Question two": "2B", "Question three": "All of the above"}')
);
select throws_ok(
  $$ select public.exam_save('pgtap-exam', '{"q": "one"}'::jsonb) $$,
  '22023', 'That is not a list of answers.',
  'a save that is not a list is refused'
);
select is((select count(*) from public.exams), 0::bigint, 'a taker reads no exam, so neither its word nor its start code');
select is((select count(*) from public.exam_questions), 0::bigint, 'no question outside their paper');
select is((select count(*) from public.exam_key), 0::bigint, 'no right answer');
select is((select count(*) from public.exam_attempts), 0::bigint, 'no paper, not even their own');
select is((select count(*) from public.exam_answers), 0::bigint, 'and no answer');
select throws_ok(
  $$ select public.exam_results((select id from pgtap_exam)) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a taker cannot read the results'
);
select throws_ok(
  $$ select public.exam_sheet((public.exam_door('pgtap-exam') -> 'attempt' ->> 'id')::uuid) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor their own marked paper'
);
select throws_ok(
  $$ select public.exam_question_stats((select id from pgtap_exam)) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor how the questions went'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_exam), null, 'Mine', '["a", "b"]'::jsonb, 0) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a taker cannot write a question or a right answer'
);
select throws_ok(
  $$ select public.exam_add_registrations((select id from pgtap_exam), array['0000']) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor put an ID on the list'
);
select throws_ok(
  $$ select public.exam_delete_attempt((public.exam_door('pgtap-exam') -> 'attempt' ->> 'id')::uuid) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor delete their paper to start again'
);
select throws_ok(
  $$ insert into public.exam_answers (attempt_id, question_id, chosen_option)
     select (public.exam_door('pgtap-exam') -> 'attempt' ->> 'id')::uuid, gen_random_uuid(), 0 $$,
  '42501', null,
  'nor write an answer past the function'
);
select ok(
  position('GO2027' in upper(public.exam_door('pgtap-exam')::text || public.exam_paper('pgtap-exam')::text)) = 0,
  'neither the door nor the paper carries the start code'
);
select tests.clear_auth();

-- ---- marking -------------------------------------------------------------------------------------
-- The key is 1C, 2A, All of the above, 4B. Amal handed in 1C, 2A, 3A and a flag; Carim is
-- sitting with 1C, 2B and All of the above; Basel's time ran out on 1A, 2A and 4A.
select tests.authenticate_as('eb@pgtap.test');
select is(
  (select string_agg(format('%s %s/%s rank %s', a ->> 'full_name', a ->> 'score', r ->> 'questions', a ->> 'rank'), ' | ' order by t.ord)
   from (select public.exam_results((select id from pgtap_exam)) as r) x,
        jsonb_array_elements(x.r -> 'attempts') with ordinality as t(a, ord)),
  'amal taker 2/4 rank 1 | Carim Taker 2/4 rank 1 | Basel Taker 1/4 rank 3',
  'the results: the highest grade first, equal grades share a rank and stand in the order of their names'
);
select is(
  (select string_agg(
            format('%s %s %s %s', a ->> 'state', a ->> 'answered', coalesce(round((a ->> 'seconds')::numeric)::text, 'none'),
                   coalesce(((a ->> 'finished_at')::timestamptz - (a ->> 'started_at')::timestamptz)::text, 'none')),
            ' | ' order by t.ord)
   from jsonb_array_elements(public.exam_results((select id from pgtap_exam)) -> 'attempts') with ordinality as t(a, ord)),
  'handed_in 3 3000 00:50:00 | sitting 3 none none | timed_out 3 7200 02:00:00',
  'each paper''s state, how many questions it answered and how long it took: one that timed out took the exam''s length'
);
select is(
  (select pg_temp.keys(r) || array_agg(distinct pg_temp.keys(a)::text)
   from (select public.exam_results((select id from pgtap_exam)) as r) x,
        jsonb_array_elements(x.r -> 'attempts') as a
   group by x.r),
  array['attempts', 'now', 'questions',
        '{answered,attempt_id,email,faculty_year,finished_at,full_name,phone,profile_id,rank,score,seconds,started_at,state,student_id,submitted_at}'],
  'the results name the size of the exam, the time, and for each paper the taker''s details and marks'
);
select lives_ok(
  $$ select public.save_exam_question(
       (select id from pgtap_exam), (select id from public.exam_questions where body = 'Question three'),
       'Question three', '["3A", "3B", "All of the above"]'::jsonb, 0, true) $$,
  'after the start a right answer can still be corrected'
);
select is(
  (select string_agg(format('%s %s/%s rank %s', a ->> 'full_name', a ->> 'score', r ->> 'questions', a ->> 'rank'), ' | ' order by t.ord)
   from (select public.exam_results((select id from pgtap_exam)) as r) x,
        jsonb_array_elements(x.r -> 'attempts') with ordinality as t(a, ord)),
  'amal taker 3/4 rank 1 | Basel Taker 1/4 rank 2 | Carim Taker 1/4 rank 2',
  'a corrected key changes the grades at the next read: nothing was stored'
);
select is(
  (select string_agg(format('%s:%s:%s:%s', r ->> 'n', r ->> 'correct', coalesce(r ->> 'chosen', 'none'), r ->> 'flagged'), ' | ' order by t.ord)
   from jsonb_array_elements(
          public.exam_sheet((select id from public.exam_attempts where profile_id = tests.user_id('amal@pgtap.test'))) -> 'rows'
        ) with ordinality as t(r, ord)),
  '1:2:2:false | 2:0:0:false | 3:0:0:false | 4:1:none:true',
  'a taker''s sheet: every question in the officers'' order, with the right option, the chosen one and the flag'
);
select is(
  (select array[s -> 'attempt' ->> 'full_name', s -> 'attempt' ->> 'score', s -> 'attempt' ->> 'state',
                (s -> 'attempt' ? 'rank')::text, pg_temp.keys(s)::text, pg_temp.keys(s -> 'rows' -> 0)::text]
   from (select public.exam_sheet((select id from public.exam_attempts where profile_id = tests.user_id('amal@pgtap.test'))) as s) x),
  array['amal taker', '3', 'handed_in', 'false', '{attempt,rows}', '{answered_at,body,chosen,correct,flagged,n,options,question_id}'],
  'the sheet carries the taker''s details and marks as the results do, without a rank'
);
select is(
  (select (s ->> 'attempts') || ' papers: '
          || (select string_agg(format('%s %s %s %s', q ->> 'n', q ->> 'answered', q ->> 'right', q ->> 'counts'), ' | ' order by t.ord)
              from jsonb_array_elements(s -> 'questions') with ordinality as t(q, ord))
   from (select public.exam_question_stats((select id from pgtap_exam)) as s) x),
  '3 papers: 1 3 2 [1, 0, 2, 0] | 2 3 2 [2, 1, 0] | 3 2 1 [1, 0, 1] | 4 1 0 [1, 0]',
  'the question figures agree with the answers: how many answered, how many were right, how often each option was chosen'
);
select is(
  pg_temp.keys(public.exam_question_stats((select id from pgtap_exam)) -> 'questions' -> 0),
  array['answered', 'body', 'correct', 'counts', 'n', 'options', 'question_id', 'right'],
  'each question''s figures come with its text, its options and its right answer'
);
select lives_ok(
  $$ update public.exam_questions set sort = sort + 10 $$,
  'a question''s place in the officers'' order can still change'
);

-- ---- the officers and the list --------------------------------------------------------------------
select is(
  (select string_agg(format('%s %s %s', r ->> 'student_id', coalesce(r -> 'holder' ->> 'email', 'free'), r ->> 'started'), ' | ' order by t.ord)
   from jsonb_array_elements(public.exam_registration_list((select id from pgtap_exam))) with ordinality as t(r, ord)),
  '2023-1234 amal@pgtap.test true | 2023 5678 basel@pgtap.test true | 2023/9012 carim@pgtap.test true | '
    || '5555 wrong@pgtap.test false | 7777 free false | AB-77 dina@pgtap.test false',
  'the list in the order of its IDs: who holds each one, and who has started'
);
select is(
  (select pg_temp.keys(l -> 0) || pg_temp.keys(l -> 0 -> 'holder')
   from (select public.exam_registration_list((select id from pgtap_exam)) as l) x),
  array['claimed_at', 'created_at', 'holder', 'id', 'started', 'student_id', 'email', 'full_name', 'profile_id'],
  'a line of the list is the ID, when it was added and taken, and the holder''s name and email'
);
select lives_ok(
  $$ select public.exam_release_registration((select id from public.exam_registrations where student_key = '5555')) $$,
  'an officer frees an ID from the account that holds it'
);
select ok(
  (select profile_id is null and claimed_at is null from public.exam_registrations where student_key = '5555'),
  'the ID is free again'
);
select throws_ok(
  $$ select public.exam_release_registration((select id from public.exam_registrations where student_key = '20231234')) $$,
  '22023', 'This student has already started the exam.',
  'an ID is not freed from a student who has started'
);
select throws_ok(
  $$ delete from public.exam_registrations where student_key = '20231234' $$,
  '22023', 'This student has already started the exam, so the ID stays on the list.',
  'nor taken off the list'
);
delete from public.exam_registrations where student_key = '7777';
select is(
  (select count(*) from public.exam_registrations where student_key = '7777'),
  0::bigint,
  'an officer takes an ID nobody started with off the list'
);
select lives_ok(
  $$ select public.exam_delete_attempt((select id from public.exam_attempts where profile_id = tests.user_id('basel@pgtap.test'))) $$,
  'an officer deletes a paper'
);
select tests.clear_auth();

select is(
  (select (select count(*) from public.exam_attempts) || ' papers, ' || (select count(*) from public.exam_answers) || ' answers'),
  '2 papers, 7 answers',
  'the paper is gone, and its answers with it'
);
select is(
  (select array_agg(l.action || ' ' || pg_temp.keys(l.before)::text order by l.action)
   from public.audit_log l
   where l.table_name in ('exam_registrations', 'exam_attempts', 'exam_answers')),
  array['DELETE {exam_id,profile_id,started_at,submitted_at}', 'RELEASE {exam_id,profile_id}'],
  'the audit log has one slim line for each of the two: which exam and which account, no student ID and no answer; the list, the papers and the answers leave no other line'
);

select tests.authenticate_as('basel@pgtap.test');
select ok(
  (public.exam_start('pgtap-exam', 'GO2027B') ->> 'ok')::boolean,
  'the student whose paper was deleted starts again'
);
select is(
  jsonb_array_length(public.exam_paper('pgtap-exam') -> 'answers'),
  0,
  'on a paper with no answer on it'
);
select tests.clear_auth();

select tests.authenticate_as('eman@pgtap.test');
select is(
  public.exam_save_details('pgtap-exam', 'Eman Taker', 'Year 2', '01000000005', '5555') ->> 'registration',
  'held',
  'the freed ID goes to the account the student meant to use'
);
select tests.clear_auth();

-- ---- each taker's own clock ------------------------------------------------------------------------
-- now() does not move inside the transaction, so time passes by moving rows. Carim started two
-- minutes ago, and the officers then close the exam as of one minute ago: his paper began one
-- minute before the closing time, and it is now one minute after it.
update public.exam_attempts set started_at = now() - interval '2 minutes'
where profile_id = tests.user_id('carim@pgtap.test');

select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ update public.exams set closes_at = now() - interval '1 minute' where address_word = 'pgtap-exam' $$,
  'after a start the closing time can still move earlier'
);
select tests.clear_auth();

select has_function(
  'app', 'exam_deadline', array['timestamp with time zone', 'integer'],
  'a deadline is worked out from a paper''s start and the exam''s length, with no closing time in it'
);

select tests.authenticate_as('carim@pgtap.test');
select is(
  (select (d -> 'exam' ->> 'phase') || ' ' || (d -> 'attempt' ->> 'over') from (select public.exam_door('pgtap-exam') as d) x),
  'closed false',
  'the exam has closed to new starts, and a paper that is running is not over'
);
select is(
  (select (d -> 'attempt' ->> 'deadline_at')::timestamptz from (select public.exam_door('pgtap-exam') as d) x),
  (select (d -> 'attempt' ->> 'started_at')::timestamptz + make_interval(mins => (d -> 'exam' ->> 'minutes')::int)
   from (select public.exam_door('pgtap-exam') as d) x),
  'a paper started one minute before the closing time has the exam''s full length from its own start'
);
select cmp_ok(
  (select (d -> 'attempt' ->> 'deadline_at')::timestamptz from (select public.exam_door('pgtap-exam') as d) x),
  '>',
  (select (d -> 'exam' ->> 'closes_at')::timestamptz from (select public.exam_door('pgtap-exam') as d) x),
  'so its deadline is later than the closing time'
);
select is(
  public.exam_paper('pgtap-exam') ->> 'state',
  'sitting',
  'it is still being sat after the exam has closed'
);
select is(
  (select (r ->> 'state') || ' ' || (r ->> 'saved')
   from (select public.exam_save('pgtap-exam', pg_temp.answers('{"Question four": "4B"}')) as r) x),
  'sitting 1',
  'and its answers are still saved'
);
select tests.clear_auth();

select tests.authenticate_as('dina@pgtap.test');
select is(
  public.exam_start('pgtap-exam', 'GO2027B') ->> 'reason',
  'closed',
  'a student who has not started by the closing time cannot start, even with the code'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ update public.exams set closes_at = now() + interval '1 hour' where address_word = 'pgtap-exam' $$,
  'and the closing time can move later again'
);
select tests.clear_auth();

select tests.authenticate_as('dina@pgtap.test');
select ok(
  (public.exam_start('pgtap-exam', 'GO2027B') ->> 'ok')::boolean,
  'which lets a late student start'
);
select tests.clear_auth();

-- ---- what a taker writes into their own profile afterwards -----------------------------------------
-- A profile's owner may write their name, year and phone directly, where no length is checked.
-- The officers' reads carry those three for every paper, so they come cut to what the door allows.
select tests.authenticate_as('carim@pgtap.test');
update public.profiles
set full_name = repeat('n', 5000), faculty_year = repeat('y', 5000), phone = repeat('7', 5000)
where id = (select auth.uid());
select tests.clear_auth();

select tests.authenticate_as('eb@pgtap.test');
select is(
  (select format('%s %s %s', length(a ->> 'full_name'), length(a ->> 'faculty_year'), length(a ->> 'phone'))
   from jsonb_array_elements(public.exam_results((select id from pgtap_exam)) -> 'attempts') as a
   where a ->> 'email' = 'carim@pgtap.test'),
  '120 40 30',
  'a name, a year and a phone that a taker made very long afterwards reach the results cut to the lengths the door allows'
);
select is(
  (select length(r -> 'holder' ->> 'full_name')
   from jsonb_array_elements(public.exam_registration_list((select id from pgtap_exam))) as r
   where r -> 'holder' ->> 'email' = 'carim@pgtap.test'),
  120,
  'and the name reaches the list the same way'
);
select tests.clear_auth();

-- ---- deleting the exam -----------------------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ delete from public.exams where address_word = 'pgtap-exam' $$,
  'an officer deletes an exam that students have sat'
);
select tests.clear_auth();

select is(
  (select format('%s questions, %s right answers, %s IDs, %s papers, %s answers, %s tries',
                 (select count(*) from public.exam_questions), (select count(*) from public.exam_key),
                 (select count(*) from public.exam_registrations), (select count(*) from public.exam_attempts),
                 (select count(*) from public.exam_answers), (select count(*) from app.exam_tries))),
  '0 questions, 0 right answers, 0 IDs, 0 papers, 0 answers, 0 tries',
  'nothing of it is left'
);
select is(
  (select count(*) from public.exams),
  2::bigint,
  'the other exams are untouched'
);
select ok(
  (select student_id is not null and full_name = 'amal taker' from public.profiles where id = tests.user_id('amal@pgtap.test')),
  'and the takers keep their accounts and the details they gave'
);

-- ---- the account that set an exam up is deleted -----------------------------------------------------
-- created_by is "on delete set null", and that is an update of the exam's row: the exam's trigger
-- keeps an exam's author as it was, but must let this one change through.
select lives_ok(
  $$ delete from public.profiles where id = tests.user_id('lore@pgtap.test') $$,
  'the account of the officer who set an exam up can be deleted'
);
select is(
  (select count(*) || ' ' || count(created_by) from public.exams where title = 'Research exchange exam'),
  '1 0',
  'and the exam stays, with no author'
);

select * from finish();
rollback;
