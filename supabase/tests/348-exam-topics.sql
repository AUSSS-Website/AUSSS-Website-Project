-- The exam's topics. A section (the shared questions, the SCOPE block, the SCORE block) is split
-- into topics: a name on a question, inside its section, with as many questions as the officers
-- give it. The officers' numbering and every taker's paper keep a topic's questions together,
-- the topics in the order of their first question; a paper shuffles the questions inside their
-- topic. A passage has a topic and its questions take it. The import takes a topic for each row.
-- A topic is part of the paper, so it is fixed once the first student has started.
begin;
select plan(22);

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

-- ids the test needs again, readable by whoever is signed in
create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

-- The keys of a JSON answer, in a fixed order.
create function pg_temp.keys(p jsonb) returns text[]
language sql as $$
  select array(select k from jsonb_object_keys(p) as k order by k collate "C")
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated;

-- The exam's questions as the officers number them: '1:plain[] | 2:ifmsa 1[IFMSA basics] | ...'.
-- Read by the test's own role, which is no exam officer: the numbering is the database's.
create function pg_temp.numbered(p_exam uuid) returns text
language sql as $$
  select string_agg(n.label || ':' || q.body || '[' || q.topic || ']', ' | ' order by n.n)
  from app.exam_question_numbers(p_exam) n
  join public.exam_questions q on q.id = n.question_id
$$;

-- ---- the officers name topics ----------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Topics exam', 'topics-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'exam', id from public.exams where address_word = 'topics-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'plain', '["A", "B"]'::jsonb, 0, true, null);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'ifmsa 1', '["A", "B"]'::jsonb, 0, true, '{"topic": "  IFMSA   basics "}'::jsonb);
insert into pgtap_ids select 'ethics', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'ethics 1', '["A", "B"]'::jsonb, 0, true, '{"topic": "Ethics"}'::jsonb);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'ifmsa 2', '["A", "B"]'::jsonb, 0, true, '{"topic": "IFMSA basics"}'::jsonb);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'scope 1', '["A", "B"]'::jsonb, 0, true, '{"section": "scope", "topic": "Ethics"}'::jsonb);
select tests.clear_auth();

select is(
  pg_temp.numbered((select id from pgtap_ids where name = 'exam')),
  '1:plain[] | 2:ifmsa 1[IFMSA basics] | 3:ifmsa 2[IFMSA basics] | 4:ethics 1[Ethics] | 5P:scope 1[Ethics]',
  'a topic''s name is tidied, its questions stand together, and the topics come in the order of their first question'
);

select is(
  app.tidy_exam_topic(U&'\00A0Exchange\00A0\200B conditions\FEFF'),
  'Exchange conditions',
  'a no-break space or a character that cannot be seen, pasted from a document, does not make a second topic'
);

select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'x', '["A", "B"]'::jsonb, 0, true,
       jsonb_build_object('topic', repeat('x', 81))) $$,
  '22023', 'A topic''s name can have at most 80 characters.',
  'a topic''s name of more than 80 characters is refused'
);

-- ---- a passage has a topic, and its questions take it ------------------------------------------------
insert into pgtap_ids select 'pas', public.save_exam_passage((select id from pgtap_ids where name = 'exam'), null, 'Read me', 'shared', null, 'Ethics');
insert into pgtap_ids select 'inpas', public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'in passage', '["A", "B"]'::jsonb, 0, true,
  jsonb_build_object('passage_id', (select id from pgtap_ids where name = 'pas'), 'topic', 'Something else'));
select is(
  (select topic from public.exam_questions where id = (select id from pgtap_ids where name = 'inpas')),
  'Ethics',
  'a question in a passage takes the passage''s topic, whatever was sent'
);
select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pas'), 'Read me', 'shared', null);
select is(
  (select topic from public.exam_passages where id = (select id from pgtap_ids where name = 'pas')),
  'Ethics',
  'a passage saved with no topic named (a page from before the topics) keeps the topic it has'
);
select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pas'), 'Read me', 'shared', null, 'IFMSA basics');
select is(
  (select topic from public.exam_questions where id = (select id from pgtap_ids where name = 'inpas')),
  'IFMSA basics',
  'a passage that moves to another topic takes its questions with it'
);
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'ethics'), 'ethics 1', '["A", "B"]'::jsonb, 0, true, '{"image_path": null}'::jsonb);
select is(
  (select topic from public.exam_questions where id = (select id from pgtap_ids where name = 'ethics')),
  'Ethics',
  'a save that names no topic leaves the question''s topic as it is'
);

-- ---- the import ----------------------------------------------------------------------------------
select throws_ok(
  $$ select public.import_exam_questions((select id from pgtap_ids where name = 'exam'),
       jsonb_build_array(
         jsonb_build_object('body', 'ok', 'options', '["A", "B"]'::jsonb, 'correct', 0, 'topic', 'Ethics'),
         jsonb_build_object('body', 'bad', 'options', '["A", "B"]'::jsonb, 'correct', 0, 'topic', repeat('y', 81)))) $$,
  '22023', 'Question 2: A topic''s name can have at most 80 characters.',
  'the import names the row whose topic is too long'
);
select is(
  public.import_exam_questions((select id from pgtap_ids where name = 'exam'),
    '[{"body": "i1", "options": ["A", "B"], "correct": 0, "topic": "Ethics"},
      {"body": "i2", "options": ["A", "B"], "correct": 0, "topic": "New topic", "passage": "P text"},
      {"body": "i3", "options": ["A", "B"], "correct": 0, "topic": "New  topic", "passage": "P text"},
      {"body": "i4", "options": ["A", "B"], "correct": 0, "topic": "Other", "passage": "P text"},
      {"body": "i5", "options": ["A", "B"], "correct": 0}]'::jsonb),
  5,
  'the import takes a topic for each row'
);
select is(
  (select count(*) from public.exam_passages where body = 'P text'),
  2::bigint,
  'rows with the same passage share it within a topic; the same text under another topic is a passage of its own'
);
select tests.clear_auth();

select is(
  pg_temp.numbered((select id from pgtap_ids where name = 'exam')),
  '1:plain[] | 2:i5[] | 3:ifmsa 1[IFMSA basics] | 4:ifmsa 2[IFMSA basics] | 5:in passage[IFMSA basics] | 6:ethics 1[Ethics] | 7:i1[Ethics] | 8:i2[New topic] | 9:i3[New topic] | 10:i4[Other] | 11P:scope 1[Ethics]',
  'an imported row joins the topic of its name wherever it is in the file, and a row with no topic joins the part with no heading'
);

-- ---- a taker's paper -------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select public.exam_add_registrations((select id from pgtap_ids where name = 'exam'), array['4001']);
select tests.clear_auth();

select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('topics-exam', 'Amal Taker', 'Year 3', '+20 100 123 4567', '4001');
select is(
  public.exam_start('topics-exam', 'GO') ->> 'ok',
  'true',
  'the exam starts'
);
insert into pgtap_ids select 'attempt', (public.exam_door('topics-exam') -> 'attempt' ->> 'id')::uuid;
select is(
  (select string_agg(run, ' | ' order by first)
   from (
     select (q ->> 'section') || '/' || (q ->> 'topic') as run, min(pos) as first, max(pos) - min(pos) + 1 as span, count(*) as n
     from jsonb_array_elements(public.exam_paper('topics-exam') -> 'questions') with ordinality as x(q, pos)
     group by 1
   ) r
   where r.span = r.n),
  'shared/ | shared/IFMSA basics | shared/Ethics | shared/New topic | shared/Other | scope/Ethics',
  'the paper keeps each topic''s questions together, the topics in the officers'' order within their section'
);
select is(
  (select array_agg(distinct pg_temp.keys(q)::text)
   from jsonb_array_elements(public.exam_paper('topics-exam') -> 'questions') as x(q)),
  array['{body,id,image,options,passage,section,topic}'],
  'a question on the paper says its topic, and still nothing of the right answer'
);
select is(
  (select b.q ->> 'body'
   from jsonb_array_elements(public.exam_paper('topics-exam') -> 'questions') with ordinality as a(q, pos)
   join jsonb_array_elements(public.exam_paper('topics-exam') -> 'questions') with ordinality as b(q, pos) on b.pos = a.pos + 1
   where a.q ->> 'body' = 'i2'),
  'i3',
  'a passage''s questions stay together and in the officers'' order inside their topic'
);
select tests.clear_auth();

-- ---- fixed once the exam has started ------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'ethics'),
       'ethics 1', '["A", "B"]'::jsonb, 0, true, '{"topic": "Late"}'::jsonb) $$,
  '22023', 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.',
  'a question''s topic is fixed once the exam has started'
);
select throws_ok(
  $$ select public.save_exam_passage((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'pas'), 'Read me', 'shared', null, 'Late') $$,
  '22023', 'The exam has started: passages can no longer be added, removed or changed.',
  'a passage''s topic is fixed once the exam has started'
);
select lives_ok(
  $$ select public.save_exam_question((select id from pgtap_ids where name = 'exam'), (select id from pgtap_ids where name = 'ethics'),
       'ethics 1', '["A", "B"]'::jsonb, 1, true, '{"topic": " Ethics "}'::jsonb) $$,
  'a right answer can still be corrected, by a page that sends the topic the question already has'
);
select lives_ok(
  $$ update public.exam_questions set sort = sort + 100 where body = 'plain' $$,
  'the officers'' order can still change'
);
select is(
  (select r ->> 'topic'
   from jsonb_array_elements(public.exam_sheet((select id from pgtap_ids where name = 'attempt')) -> 'rows') as x(r)
   where r ->> 'body' = 'i4'),
  'Other',
  'each line of a paper carries its question''s topic'
);
select is(
  (select q ->> 'topic'
   from jsonb_array_elements(public.exam_question_stats((select id from pgtap_ids where name = 'exam')) -> 'questions') as x(q)
   where q ->> 'body' = 'i4'),
  'Other',
  'each question''s figures carry its topic'
);
select tests.clear_auth();

-- ---- an exam with no topics is the exam it was ---------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, minutes, status) values ('Plain exam', 'plain-exam', 60, 'draft');
insert into pgtap_ids select 'plain', id from public.exams where address_word = 'plain-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'plain'), null, 'a', '["A", "B"]'::jsonb, 0, true, null);
select public.save_exam_question((select id from pgtap_ids where name = 'plain'), null, 'b', '["A", "B"]'::jsonb, 0, true, '{"section": "score"}'::jsonb);
select public.save_exam_question((select id from pgtap_ids where name = 'plain'), null, 'c', '["A", "B"]'::jsonb, 0, true, null);
select tests.clear_auth();
select is(
  pg_temp.numbered((select id from pgtap_ids where name = 'plain')),
  '1:a[] | 2:c[] | 3R:b[]',
  'with no topic named, the numbering is by section and the officers'' order, as before'
);

select * from finish();
rollback;
