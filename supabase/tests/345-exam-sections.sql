-- The exam's sections, passages and pictures. An exam with questions in both blocks (SCOPE and
-- SCORE) lets each taker choose which to sit, before the start code and at any save until the
-- paper is handed in; never neither. A paper is the shared questions, then each block, with a
-- passage's questions together. Every question is sent, and marking counts only the blocks a
-- paper sits: a mark for the shared questions, one for each block, a total and a rank for each
-- programme. A question may be a picture; a picture must be its own exam's. Sections, passages
-- and pictures are fixed once the first student has started. An exam with no blocks has one
-- grade, as before.
begin;
select plan(65);

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
select tests.create_user('dina@pgtap.test', 'Dina From Google');

delete from public.exams;

-- ids the test needs again, readable by whoever is signed in
create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

-- The keys of a JSON answer, in a fixed order.
create function pg_temp.keys(p jsonb) returns text[]
language sql as $$
  select array(select k from jsonb_object_keys(p) as k order by k collate "C")
$$;

-- What a taker's phone sends to rpc/exam_save: for each question named by its text, the option at
-- that position. Every question here keeps its options in the officers' order, so the position on
-- the paper is the officers' index. The ids come off the taker's own paper, as on a phone.
create function pg_temp.answers(p_word text, p_picks jsonb) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('q', q.item -> 'id', 'c', (p.value)::int, 'f', false))
  from jsonb_array_elements(public.exam_paper(p_word) -> 'questions') as q(item)
  join jsonb_each_text(p_picks) as p on p.key = q.item ->> 'body'
$$;

-- One line for a paper in the results.
create function pg_temp.line(a jsonb) returns text
language sql as $$
  select format('%s sits %s%s answered %s shared %s P %s R %s SCOPE %s#%s SCORE %s#%s all %s#%s',
    a ->> 'full_name',
    case when (a ->> 'sits_scope')::boolean then 1 else 0 end,
    case when (a ->> 'sits_score')::boolean then 1 else 0 end,
    a ->> 'answered', a ->> 'mark_shared',
    coalesce(a ->> 'mark_scope', '-'), coalesce(a ->> 'mark_score', '-'),
    coalesce(a ->> 'total_scope', '-'), coalesce(a ->> 'rank_scope', '-'),
    coalesce(a ->> 'total_score', '-'), coalesce(a ->> 'rank_score', '-'),
    a ->> 'score', a ->> 'rank')
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated;
grant execute on function pg_temp.answers(text, jsonb) to authenticated;
grant execute on function pg_temp.line(jsonb) to authenticated;

-- ---- setting the exam up ---------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Sections exam', 'sections-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'exam', id from public.exams where address_word = 'sections-exam';

-- shared: S1, S2, a passage with S3 and S4, and a picture; SCOPE: P1, P2; SCORE: R1, and a
-- passage with R2 and R3 that comes from a spreadsheet
insert into pgtap_ids select 's1', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S1', '["A", "B", "C", "D"]'::jsonb, 0, true);
insert into pgtap_ids select 's2', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S2', '["A", "B", "C", "D"]'::jsonb, 1, true);
insert into pgtap_ids select 'pas', public.save_exam_passage((select id from pgtap_ids where name = 'exam'), null, '  Read this text.  ', 'shared', null);
insert into pgtap_ids select 's3', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S3', '["A", "B", "C", "D"]'::jsonb, 2, true,
  jsonb_build_object('passage_id', (select id from pgtap_ids where name = 'pas')));
insert into pgtap_ids select 's4', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'S4', '["A", "B", "C", "D"]'::jsonb, 3, true,
  jsonb_build_object('passage_id', (select id from pgtap_ids where name = 'pas'), 'section', 'score'));
insert into pgtap_ids select 'p1', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'P1', '["A", "B", "C", "D"]'::jsonb, 0, true, '{"section": "scope"}'::jsonb);
insert into pgtap_ids select 'p2', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'P2', '["A", "B", "C", "D"]'::jsonb, 1, true, '{"section": "scope"}'::jsonb);
insert into pgtap_ids select 'r1', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'R1', '["A", "B", "C", "D"]'::jsonb, 0, true, '{"section": "score"}'::jsonb);

select is(
  (select body from public.exam_passages where id = (select id from pgtap_ids where name = 'pas')),
  'Read this text.',
  'a passage''s text is trimmed'
);
select is(
  (select section from public.exam_questions where id = (select id from pgtap_ids where name = 's4')),
  'shared',
  'a question in a passage takes the passage''s section, whatever was sent'
);
select is(
  public.import_exam_questions(
    (select id from pgtap_ids where name = 'exam'),
    '[{"body": "R2", "options": ["A", "B"], "correct": 0, "keep_order": true, "section": "score", "passage": "A research abstract."},
      {"body": "R3", "options": ["A", "B"], "correct": 1, "keep_order": true, "section": "score", "passage": "A research abstract."}]'::jsonb
  ),
  2,
  'a spreadsheet brings questions with their section and their passage'
);
select is(
  (select count(distinct passage_id) || ' ' || count(*) || ' ' || min(section)
   from public.exam_questions where body in ('R2', 'R3')),
  '1 2 score',
  'rows that follow one another with the same passage share one, in their section'
);
select throws_ok(
  $$ select public.import_exam_questions(
       (select id from pgtap_ids where name = 'exam'),
       '[{"body": "Good", "options": ["A", "B"], "correct": 0},
         {"body": "Bad", "options": ["A", "B"], "correct": 0, "section": "clinical"}]'::jsonb) $$,
  '22023', 'Question 2: Choose the question''s section: shared, SCOPE or SCORE.',
  'a spreadsheet row with an unknown section is named, and nothing is imported'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, '', '["A", "B"]'::jsonb, 0) $$,
  '22023', 'A question needs its text.',
  'a question with no words and no picture is refused'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'Bad', '["A", "B"]'::jsonb, 0, false,
       '{"image_path": "11111111-1111-4111-8111-111111111111/abababababababababababababababab.jpg"}'::jsonb) $$,
  '22023', 'That picture is not one of this exam''s. Upload it again.',
  'a picture in another exam''s folder is refused'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'Bad', '["A", "B"]'::jsonb, 0, false,
       '{"passage_id": "not-a-uuid"}'::jsonb) $$,
  '22023', 'That passage is not there any more.',
  'a passage that is no passage is refused'
);
select throws_ok(
  $$ select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), null, '   ', 'shared', null) $$,
  '22023', 'A passage needs its text or a picture.',
  'an empty passage is refused'
);
insert into pgtap_ids select 'pic', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, '', '["A", "B", "C", "D"]'::jsonb, 2, true,
  jsonb_build_object('image_path', (select id::text from pgtap_ids where name = 'exam') || '/' || repeat('ab', 16) || '.jpg'));
select is(
  (select body || '|' || section || '|' || (image_path = (select id::text from pgtap_ids where name = 'exam') || '/' || repeat('ab', 16) || '.jpg')::text
   from public.exam_questions where id = (select id from pgtap_ids where name = 'pic')),
  '|shared|true',
  'a question may be a picture with no words'
);
select lives_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pic'),
       '', '["A", "B", "C", "D"]'::jsonb, 2, true) $$,
  'a page loaded before the sections existed can still save a question'
);
select is(
  (select (image_path is not null)::text || ' ' || (select (passage_id is not null)::text from public.exam_questions where id = (select id from pgtap_ids where name = 's3'))
   from public.exam_questions where id = (select id from pgtap_ids where name = 'pic')),
  'true true',
  'and that save leaves the picture and the passage alone'
);
select is(
  (select string_agg(coalesce(nullif(q.body, ''), 'PIC') || '=' || (r ->> 'label'), ' ' order by (r ->> 'n')::int)
   from jsonb_array_elements(public.exam_question_stats((select id from pgtap_ids where name = 'exam')) -> 'questions') as r
   join public.exam_questions q on q.id = (r ->> 'question_id')::uuid),
  'S1=1 S2=2 S3=3 S4=4 PIC=5 P1=6P P2=7P R1=6R R2=7R R3=8R',
  'the questions are numbered as on the paper: the shared ones, then each block counting on with its letter'
);
select is(
  public.exam_add_registrations((select id from pgtap_ids where name = 'exam'), array['1001', '1002', '1003', '1004']) ->> 'added',
  '4',
  'four IDs go on the list'
);
select tests.clear_auth();

-- ---- the pictures' bucket ----------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, owner_id)
select 'exam-pictures', id::text || '/' || repeat('ab', 16) || '.jpg', tests.user_id('leo@pgtap.test')::text
from pgtap_ids where name = 'exam';
select is(
  (select public::text || ' ' || allowed_mime_types::text from storage.buckets where id = 'exam-pictures'),
  'true {image/jpeg}',
  'the pictures'' bucket serves a file by its address and takes JPEGs only'
);
select is(
  (select string_agg(policyname || ':' || cmd, ' ' order by policyname)
   from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'exam_pictures_%'),
  'exam_pictures_delete:DELETE exam_pictures_insert:INSERT exam_pictures_read:SELECT',
  'its files are added, listed and removed by policy, and never overwritten'
);
select is(
  app.exam_picture_free((select id::text from pgtap_ids where name = 'exam') || '/' || repeat('ab', 16) || '.jpg'),
  true,
  'before the first student starts, an exam''s picture may be removed from the bucket'
);
select tests.authenticate_as('leo@pgtap.test');
select is(
  (select count(*) from storage.objects where bucket_id = 'exam-pictures'),
  1::bigint,
  'an exam officer can list the pictures'
);
select tests.clear_auth();
select tests.authenticate_as('amal@pgtap.test');
select is(
  (select count(*) from storage.objects where bucket_id = 'exam-pictures'),
  0::bigint,
  'a taker cannot list them'
);
select is(
  (select count(*) from public.exam_passages),
  0::bigint,
  'and reads no passage from the table'
);
select throws_ok(
  $$ select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), null, 'Mine', 'shared', null) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'or writes one'
);

-- ---- the door and the start ------------------------------------------------------------------------
select is(
  public.exam_door('sections-exam') -> 'exam' -> 'sections',
  '{"shared": 5, "scope": 2, "score": 3, "choice": true}'::jsonb,
  'the door says how many questions each section has, and that there is a choice'
);
select is(
  public.exam_save_details('sections-exam', 'amal taker', 'Year 3', '01000000001', '1001') ->> 'registration',
  'held',
  'Amal''s ID is on the list'
);
select is(
  public.exam_start('sections-exam', 'GO', false, false),
  '{"ok": false, "reason": "sections"}'::jsonb,
  'nobody starts with neither block'
);
select is(
  public.exam_start('sections-exam', 'GO', true, false) ->> 'ok',
  'true',
  'Amal starts with the SCOPE block only'
);
select tests.clear_auth();
select is(
  (select count(*) from app.exam_tries),
  0::bigint,
  'the refusal for neither block cost no try at the start code'
);

select tests.authenticate_as('basel@pgtap.test');
select public.exam_save_details('sections-exam', 'basel taker', 'Year 3', '01000000002', '1002');
select is(public.exam_start('sections-exam', 'GO', false, true) ->> 'ok', 'true', 'Basel starts with the SCORE block only');
select tests.clear_auth();
select tests.authenticate_as('carim@pgtap.test');
select public.exam_save_details('sections-exam', 'carim taker', 'Year 3', '01000000003', '1003');
select is(public.exam_start('sections-exam', 'GO') ->> 'ok', 'true', 'Carim starts as a page loaded before the sections existed does');
select tests.clear_auth();
select tests.authenticate_as('dina@pgtap.test');
select public.exam_save_details('sections-exam', 'dina taker', 'Year 3', '01000000004', '1004');
select is(public.exam_start('sections-exam', 'GO', true) ->> 'ok', 'true', 'Dina starts and names one block only');
select tests.clear_auth();
select is(
  (select string_agg(a.student_id || ':' || a.sits_scope::int || a.sits_score::int, ' ' order by a.student_id)
   from public.exam_attempts a),
  '1001:10 1002:01 1003:11 1004:10',
  'each paper holds its choice: both blocks when none was named, and only the block that was'
);

-- ---- the paper ---------------------------------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select is(
  (select jsonb_agg(q ->> 'section' order by t.pos)
   from jsonb_array_elements(public.exam_paper('sections-exam') -> 'questions') with ordinality as t(q, pos)),
  '["shared", "shared", "shared", "shared", "shared", "scope", "scope", "score", "score", "score"]'::jsonb,
  'the paper is the shared questions, then the SCOPE block, then the SCORE block, and every question is sent'
);
select is(
  (select (max(t.pos) filter (where q ->> 'body' = 'S4') - max(t.pos) filter (where q ->> 'body' = 'S3'))
          || ' ' || (max(t.pos) filter (where q ->> 'body' = 'R3') - max(t.pos) filter (where q ->> 'body' = 'R2'))
   from jsonb_array_elements(public.exam_paper('sections-exam') -> 'questions') with ordinality as t(q, pos)),
  '1 1',
  'a passage''s questions stand together, in the officers'' order'
);
select is(
  (select array[jsonb_array_length(p -> 'passages')::text, pg_temp.keys(p -> 'passages' -> 0)::text,
                p -> 'attempt' ->> 'sits_scope', p -> 'attempt' ->> 'sits_score',
                (p -> 'exam' -> 'sections' ->> 'choice')]
   from (select public.exam_paper('sections-exam') as p) x),
  array['2', '{body,id,image}', 'true', 'false', 'true'],
  'the paper carries each passage once, the blocks this taker sits, and the choice'
);
select is(
  (select q ->> 'image'
   from jsonb_array_elements(public.exam_paper('sections-exam') -> 'questions') as q
   where q ->> 'body' = ''),
  (select id::text from pgtap_ids where name = 'exam') || '/' || repeat('ab', 16) || '.jpg',
  'a picture question carries its picture''s place in the bucket'
);

-- ---- answering ---------------------------------------------------------------------------------------
-- The key: S1 A, S2 B, S3 C, S4 D, the picture C, P1 A, P2 B, R1 A, R2 A, R3 B.
-- Amal (SCOPE): S1 and S2 right, P1 right, P2 wrong, and R1 right although she does not sit it.
select is(
  (select array[r ->> 'saved', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam',
           pg_temp.answers('sections-exam', '{"S1": 0, "S2": 1, "P1": 0, "P2": 0, "R1": 0}'::jsonb), false, true, false) as r) x),
  array['5', 'true', 'false'],
  'an answer in a block the paper does not sit is kept all the same'
);
select tests.clear_auth();
-- Basel (SCORE): S1 right, and all three of the block.
select tests.authenticate_as('basel@pgtap.test');
select is(
  (select array[r ->> 'saved', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam',
           pg_temp.answers('sections-exam', '{"S1": 0, "R1": 0, "R2": 0, "R3": 1}'::jsonb)) as r) x),
  array['4', 'false', 'true'],
  'a save that names no blocks leaves the choice as it is'
);
select tests.clear_auth();
-- Carim (both): S1, S3 and S4 right, P1 right, R1 wrong; he hands in.
select tests.authenticate_as('carim@pgtap.test');
select is(
  public.exam_save('sections-exam',
    pg_temp.answers('sections-exam', '{"S1": 0, "S3": 2, "S4": 3, "P1": 0, "R1": 1}'::jsonb), true, true, true) ->> 'submitted',
  'true',
  'Carim hands in with both blocks'
);
select is(
  (select array[r ->> 'state', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam', '[]'::jsonb, false, true, false) as r) x),
  array['over', 'true', 'true'],
  'after the hand-in the choice is fixed'
);
select tests.clear_auth();
-- Dina (SCOPE): one wrong answer; she tries to sit neither block, then adds SCORE.
select tests.authenticate_as('dina@pgtap.test');
select is(
  (select array[r ->> 'saved', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam',
           pg_temp.answers('sections-exam', '{"S1": 1}'::jsonb), false, false, false) as r) x),
  array['1', 'true', 'false'],
  'a save that asks for neither block changes no choice, and the answer that came with it is saved'
);
select is(
  (select array[r ->> 'saved', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam', '[]'::jsonb, false, true, true) as r) x),
  array['0', 'true', 'true'],
  'a taker adds a block with a save, with or without an answer in it'
);
select tests.clear_auth();
-- Dina's paper is moved to ten seconds past its deadline: inside the thirty seconds in which an
-- answer that was on its way still lands, and too late for a change of mind.
update public.exam_attempts set started_at = now() - interval '60 minutes 10 seconds'
where profile_id = tests.user_id('dina@pgtap.test');
select tests.authenticate_as('dina@pgtap.test');
select is(
  (select array[r ->> 'state', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('sections-exam', '[]'::jsonb, false, true, false) as r) x),
  array['over', 'true', 'true'],
  'once the deadline has passed the choice is fixed, also in the thirty seconds a late answer has'
);
select tests.clear_auth();

-- ---- marking -----------------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select is(
  public.exam_results((select id from pgtap_ids where name = 'exam')) -> 'sections',
  '{"shared": 5, "scope": 2, "score": 3, "choice": true}'::jsonb,
  'the results name the sections'
);
select is(
  (select array_agg(pg_temp.line(a) order by t.ord)
   from jsonb_array_elements(public.exam_results((select id from pgtap_ids where name = 'exam')) -> 'attempts') with ordinality as t(a, ord)),
  array[
    'basel taker sits 01 answered 4 shared 1 P - R 3 SCOPE -#- SCORE 4#1 all 4#1',
    'carim taker sits 11 answered 5 shared 3 P 1 R 0 SCOPE 4#1 SCORE 3#2 all 4#1',
    'amal taker sits 10 answered 4 shared 2 P 1 R - SCOPE 3#2 SCORE -#- all 3#3',
    'dina taker sits 11 answered 1 shared 0 P 0 R 0 SCOPE 0#3 SCORE 0#3 all 0#4'
  ],
  'each paper has a mark for the shared questions and for each block it sits, and a total and a rank for each programme it sits'
);
select is(
  (select string_agg(format('%s:%s:%s', r ->> 'label', coalesce(r ->> 'chosen', '-'), case when (r ->> 'counted')::boolean then 'y' else 'n' end), ' ' order by t.ord)
   from jsonb_array_elements(
          public.exam_sheet((select id from public.exam_attempts where profile_id = tests.user_id('amal@pgtap.test'))) -> 'rows'
        ) with ordinality as t(r, ord)),
  '1:0:y 2:1:y 3:-:y 4:-:y 5:-:y 6P:0:y 7P:0:y 6R:0:n 7R:-:n 8R:-:n',
  'a sheet shows an answer in a block its taker does not sit, and marks it as not counted'
);
select is(
  jsonb_array_length(public.exam_sheet((select id from public.exam_attempts where profile_id = tests.user_id('amal@pgtap.test'))) -> 'passages'),
  2,
  'the sheet carries the exam''s passages'
);
select is(
  (select string_agg(format('%s sat %s answered %s right %s', q ->> 'label', q ->> 'sat', q ->> 'answered', q ->> 'right'), ' | ' order by t.ord)
   from jsonb_array_elements(public.exam_question_stats((select id from pgtap_ids where name = 'exam')) -> 'questions') with ordinality as t(q, ord)),
  '1 sat 4 answered 4 right 3 | 2 sat 4 answered 1 right 1 | 3 sat 4 answered 1 right 1 | 4 sat 4 answered 1 right 1 | 5 sat 4 answered 0 right 0'
    || ' | 6P sat 3 answered 2 right 2 | 7P sat 3 answered 1 right 0'
    || ' | 6R sat 3 answered 2 right 1 | 7R sat 3 answered 1 right 1 | 8R sat 3 answered 1 right 1',
  'a block''s figures count the papers that sit it: an answer left in a block its taker does not sit is in none of them'
);

-- ---- fixed once started ------------------------------------------------------------------------------
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 's1'),
       'S1', '["A", "B", "C", "D"]'::jsonb, 0, true, '{"section": "scope"}'::jsonb) $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'a question cannot move to another section after the start'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pic'),
       '', '["A", "B", "C", "D"]'::jsonb, 2, true,
       jsonb_build_object('image_path', (select id::text from pgtap_ids where name = 'exam') || '/' || repeat('cd', 16) || '.jpg')) $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'or change its picture'
);
select throws_ok(
  $$ select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pas'), 'Changed', 'shared', null) $$,
  '22023', 'The exam has started: passages can no longer be added, removed or changed.',
  'a passage cannot change after the start'
);
select throws_ok(
  $$ delete from public.exam_passages where id = (select id from pgtap_ids where name = 'pas') $$,
  '22023', 'The exam has started: passages can no longer be added, removed or changed.',
  'or be removed'
);
select is(
  (select array[
     app.exam_picture_free((select id::text from pgtap_ids where name = 'exam') || '/' || repeat('ab', 16) || '.jpg')::text,
     app.exam_picture_free(gen_random_uuid()::text || '/' || repeat('ab', 16) || '.jpg')::text,
     app.exam_picture_free('no-folder.jpg')::text]),
  array['false', 'true', 'true'],
  'once it has started, an exam''s pictures stay in the bucket; a file in no started exam''s folder is free'
);
select is(
  (select qual like '%exam_picture_free%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'exam_pictures_delete'),
  true,
  'and the bucket''s delete policy asks that'
);
select lives_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'p2'),
       'P2', '["A", "B", "C", "D"]'::jsonb, 0, true) $$,
  'a right answer can still be corrected'
);
select is(
  (select a ->> 'total_scope'
   from jsonb_array_elements(public.exam_results((select id from pgtap_ids where name = 'exam')) -> 'attempts') as a
   where a ->> 'full_name' = 'amal taker'),
  '4',
  'and the programme''s total follows it at the next read'
);

-- ---- an exam with no blocks ------------------------------------------------------------------------
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Plain exam', 'plain-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'plain', id from public.exams where address_word = 'plain-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'plain'), null, 'Only', '["A", "B"]'::jsonb, 0, true);
select public.exam_add_registrations((select id from pgtap_ids where name = 'plain'), array['1001']);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('plain-exam', 'amal taker', 'Year 3', '01000000001', '1001');
select is(
  public.exam_start('plain-exam', 'GO', false, false) ->> 'ok',
  'true',
  'in an exam with no choice the two blocks named at the start are ignored'
);
select is(
  (select array[r ->> 'submitted', r ->> 'sits_scope', r ->> 'sits_score']
   from (select public.exam_save('plain-exam', pg_temp.answers('plain-exam', '{"Only": 0}'::jsonb), true, true, false) as r) x),
  array['true', 'true', 'true'],
  'and a save cannot change them'
);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select is(
  (select pg_temp.line(r -> 'attempts' -> 0) || ' choice ' || (r -> 'sections' ->> 'choice')
   from (select public.exam_results((select id from pgtap_ids where name = 'plain')) as r) x),
  'amal taker sits 00 answered 1 shared 1 P - R - SCOPE -#- SCORE -#- all 1#1 choice false',
  'such an exam has one grade and one ranking, as before'
);

-- ---- passages before the start, and deleting --------------------------------------------------------
insert into public.exams (title, address_word) values ('Third exam', 'third-exam');
insert into pgtap_ids select 'third', id from public.exams where address_word = 'third-exam';
insert into pgtap_ids select 'pas3', public.save_exam_passage((select id from pgtap_ids where name = 'third'), null, 'Text', 'scope', null);
insert into pgtap_ids select 'q3', public.save_exam_question((select id from pgtap_ids where name = 'third'), null, 'In a passage', '["A", "B"]'::jsonb, 0, false,
  jsonb_build_object('passage_id', (select id from pgtap_ids where name = 'pas3')));
select is(
  (select section from public.exam_questions where id = (select id from pgtap_ids where name = 'q3')),
  'scope',
  'a new question in a passage is in the passage''s section'
);
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'third'), null, 'Wrong exam', '["A", "B"]'::jsonb, 0, false,
       jsonb_build_object('passage_id', (select id from pgtap_ids where name = 'pas'))) $$,
  '22023', 'That passage is not there any more.',
  'a question cannot be read with another exam''s passage'
);
select lives_ok(
  $$ select public.save_exam_passage((select id from pgtap_ids where name = 'third'), (select id from pgtap_ids where name = 'pas3'), 'Text', 'score', null) $$,
  'before the start a passage can move to another section'
);
select is(
  (select section from public.exam_questions where id = (select id from pgtap_ids where name = 'q3')),
  'score',
  'and takes its questions with it'
);
select lives_ok(
  $$ delete from public.exam_passages where id = (select id from pgtap_ids where name = 'pas3') $$,
  'before the start a passage can be removed'
);
select is(
  (select section || ' ' || (passage_id is null)::text from public.exam_questions where id = (select id from pgtap_ids where name = 'q3')),
  'score true',
  'which leaves its question a single one, in its section'
);
select lives_ok(
  $$ delete from public.exams where id = (select id from pgtap_ids where name = 'exam') $$,
  'an exam that has started, with passages, pictures and papers, can still be deleted whole'
);
select is(
  (select (select count(*) from public.exam_passages) || ' ' || (select count(*) from public.exam_questions)
          || ' ' || (select count(*) from public.exam_attempts)),
  '0 2 1',
  'its passages, questions and papers go with it, and the other exams keep theirs'
);
select tests.clear_auth();

select * from finish();
rollback;
