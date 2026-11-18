-- Phase 8, continued: the exam's sections are split into topics.
--
-- A section (the shared questions, the SCOPE block, the SCORE block) was one run of questions.
-- The paper the officers write is in parts with a heading each ("IFMSA", "Exchange conditions",
-- "Ethics"), and the parts are not the same length. A topic is that heading: a name on a
-- question, inside its section. A topic has as many questions as the officers give it, a section
-- has as many topics as they name, and a question with no topic is in its section's part that
-- has no heading.
--
--   exam_questions.topic   the topic's name, '' for none; at most 80 characters
--   exam_passages.topic    a passage has a topic as it has a section, and its questions take it
--
-- What a topic changes:
--   * The officers' numbering (app.exam_question_numbers) goes section by section and, inside a
--     section, topic by topic. The topics stand in the order of their first question.
--   * A taker's paper keeps the topics in that order. Its questions are shuffled inside their
--     topic, where they were shuffled inside their section, so a topic's questions are together
--     on every paper. A passage's questions still stay together and in the officers' order.
--   * rpc/exam_paper tells the page each question's topic, and the page puts each topic under
--     its heading.
--   * A topic is part of the paper, so it is fixed once the first student has started, as the
--     section is.
--   * The import takes a topic for each row (`topic`), and the officers' readings
--     (rpc/exam_sheet, rpc/exam_question_stats) carry it.
-- Marks, ranks and the choice of sections are as they were: a topic has no mark of its own.
--
-- The officers' order (`sort`) may still change after the first start, as before. A paper keeps
-- the order it was given, so a topic moved after some students have started stands in its new
-- place on the papers started afterwards only. Every paper still holds each topic together, and
-- no mark depends on the order.
--
-- An exam with no topic named is exactly the exam it was: every question's topic is '', which is
-- one part to a section.
--
-- save_exam_passage gains `p_topic`, so the function of 20261109120001 is dropped first. The new
-- argument defaults to null, which leaves a passage's topic as it is: a page loaded before this
-- migration still saves a passage.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table public.exam_questions add column if not exists topic text not null default '';
alter table public.exam_questions drop constraint if exists exam_questions_topic_len;
alter table public.exam_questions add constraint exam_questions_topic_len check (length(topic) <= 80);

alter table public.exam_passages add column if not exists topic text not null default '';
alter table public.exam_passages drop constraint if exists exam_passages_topic_len;
alter table public.exam_passages add constraint exam_passages_topic_len check (length(topic) <= 80);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A topic's name as it is kept: trimmed, with one space wherever there was a run of them, so
-- that "Exchange  conditions" in one row of a spreadsheet and "Exchange conditions" in the next
-- are one topic. Null and blank are '', no topic. A cell pasted from a document often holds a
-- space that is not the plain one, or a character that cannot be seen (no-break space, figure
-- space, narrow no-break space, zero-width space, byte order mark), which `\s` does not match in
-- every locale: they are named here, so that two names that look the same are the same topic.
create or replace function app.tidy_exam_topic(p_topic text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    coalesce(p_topic, ''),
    '[\s' || chr(160) || chr(8199) || chr(8239) || chr(8203) || chr(65279) || ']+',
    ' ', 'g'))
$$;

-- The officers' numbering of an exam's questions, as in 20261109120001, with the topics: within
-- a section the topics stand in the order of their first question (the lowest `sort` among a
-- topic's questions), and within a topic the order is the officers' own, a passage's questions
-- together where its first one is.
create or replace function app.exam_question_numbers(p_exam uuid)
returns table (question_id uuid, n int, label text)
language sql
stable
set search_path = ''
as $$
  with q as (
    select x.id, x.section, x.topic, x.sort, x.created_at,
           case x.section when 'shared' then 0 when 'scope' then 1 else 2 end as sec,
           coalesce(x.passage_id, x.id) as unit,
           min(x.sort) over w as unit_sort,
           min(x.created_at) over w as unit_made,
           min(x.sort) over t as topic_sort,
           min(x.created_at) over t as topic_made
    from public.exam_questions x
    where x.exam_id = p_exam
    window w as (partition by coalesce(x.passage_id, x.id)),
           t as (partition by x.section, x.topic)
  ),
  placed as (
    select q.id, q.section,
           (row_number() over (
              order by q.sec, q.topic_sort, q.topic_made, q.topic,
                       q.unit_sort, q.unit_made, q.unit, q.sort, q.created_at, q.id))::int as n,
           (row_number() over (
              partition by q.sec
              order by q.topic_sort, q.topic_made, q.topic,
                       q.unit_sort, q.unit_made, q.unit, q.sort, q.created_at, q.id))::int as k
    from q
  )
  select p.id,
         p.n,
         case p.section
           when 'shared' then p.k::text
           when 'scope' then (s.shared + p.k)::text || 'P'
           else (s.shared + p.k)::text || 'R'
         end
  from placed p
  cross join (select (count(*) filter (where q.section = 'shared'))::int as shared from q) s
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- As in 20261109120001, with the topic: it is tidied, a question in a passage takes the
-- passage's topic as it takes its section, and it is part of the paper, so it is fixed once the
-- exam has started.
create or replace function app.normalize_exam_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_options jsonb;
  v_bad boolean;
  v_section text;
  v_topic text;
  -- an insert always changes the paper; an update only when it touches what a taker reads
  v_changes_paper boolean := true;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.exams e where e.id = old.exam_id) then
      return old;
    end if;
    perform 1 from public.exams e where e.id = old.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = old.exam_id) then
      raise exception 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if not exists (select 1 from public.exams e where e.id = old.exam_id) then
      return new;
    end if;
    new.exam_id := old.exam_id;
    new.created_at := old.created_at;
  end if;

  new.image_path := nullif(btrim(coalesce(new.image_path, '')), '');
  new.body := btrim(coalesce(new.body, ''));
  if length(new.body) > 2000 or (new.body = '' and new.image_path is null) then
    raise exception 'A question needs its text.' using errcode = '22023';
  end if;
  if new.image_path is not null and not app.exam_picture_ok(new.exam_id, new.image_path) then
    raise exception 'That picture is not one of this exam''s. Upload it again.' using errcode = '22023';
  end if;

  if new.options is null or jsonb_typeof(new.options) <> 'array' then
    raise exception 'A question needs between 2 and 6 options, none of them empty.' using errcode = '22023';
  end if;
  if jsonb_array_length(new.options) not between 2 and 6 then
    raise exception 'A question needs between 2 and 6 options, none of them empty.' using errcode = '22023';
  end if;
  select jsonb_agg(to_jsonb(btrim(x.v #>> '{}')) order by x.ord),
         bool_or(
           jsonb_typeof(x.v) <> 'string'
           or btrim(x.v #>> '{}') = ''
           or length(btrim(x.v #>> '{}')) > 500
         )
    into v_options, v_bad
  from jsonb_array_elements(new.options) with ordinality as x(v, ord);
  if v_bad then
    raise exception 'A question needs between 2 and 6 options, none of them empty.' using errcode = '22023';
  end if;
  new.options := v_options;
  new.keep_option_order := coalesce(new.keep_option_order, false);
  new.sort := coalesce(new.sort, 0);

  new.section := lower(btrim(coalesce(new.section, 'shared')));
  new.topic := app.tidy_exam_topic(new.topic);
  if new.passage_id is not null then
    select p.section, p.topic into v_section, v_topic
    from public.exam_passages p
    where p.id = new.passage_id and p.exam_id = new.exam_id;
    if not found then
      raise exception 'That passage is not there any more.' using errcode = '22023';
    end if;
    new.section := v_section;
    new.topic := v_topic;
  end if;
  if new.section not in ('shared', 'scope', 'score') then
    raise exception 'Choose the question''s section: shared, SCOPE or SCORE.' using errcode = '22023';
  end if;
  if length(new.topic) > 80 then
    raise exception 'A topic''s name can have at most 80 characters.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_changes_paper := new.body is distinct from old.body
      or new.options is distinct from old.options
      or new.keep_option_order is distinct from old.keep_option_order
      or new.section is distinct from old.section
      or new.topic is distinct from old.topic
      or new.passage_id is distinct from old.passage_id
      or new.image_path is distinct from old.image_path;
  end if;
  if v_changes_paper then
    perform 1 from public.exams e where e.id = new.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = new.exam_id) then
      raise exception 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- As in 20261109120001, with the topic.
create or replace function app.normalize_exam_passage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes_paper boolean := true;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.exams e where e.id = old.exam_id) then
      return old;
    end if;
    perform 1 from public.exams e where e.id = old.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = old.exam_id) then
      raise exception 'The exam has started: passages can no longer be added, removed or changed.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    new.exam_id := old.exam_id;
    new.created_at := old.created_at;
  end if;

  new.image_path := nullif(btrim(coalesce(new.image_path, '')), '');
  new.body := btrim(coalesce(new.body, ''));
  if length(new.body) > 8000 then
    raise exception 'A passage can have at most 8000 characters.' using errcode = '22023';
  end if;
  if new.body = '' and new.image_path is null then
    raise exception 'A passage needs its text or a picture.' using errcode = '22023';
  end if;
  if new.image_path is not null and not app.exam_picture_ok(new.exam_id, new.image_path) then
    raise exception 'That picture is not one of this exam''s. Upload it again.' using errcode = '22023';
  end if;
  new.section := lower(btrim(coalesce(new.section, 'shared')));
  if new.section not in ('shared', 'scope', 'score') then
    raise exception 'Choose the passage''s section: shared, SCOPE or SCORE.' using errcode = '22023';
  end if;
  new.topic := app.tidy_exam_topic(new.topic);
  if length(new.topic) > 80 then
    raise exception 'A topic''s name can have at most 80 characters.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_changes_paper := new.body is distinct from old.body
      or new.section is distinct from old.section
      or new.topic is distinct from old.topic
      or new.image_path is distinct from old.image_path;
  end if;
  if v_changes_paper then
    perform 1 from public.exams e where e.id = new.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = new.exam_id) then
      raise exception 'The exam has started: passages can no longer be added, removed or changed.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- A passage that moves to another section or another topic takes its questions with it.
create or replace function app.spread_passage_section()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.exam_questions q
     set section = new.section, topic = new.topic
   where q.passage_id = new.id
     and (q.section is distinct from new.section or q.topic is distinct from new.topic);
  return null;
end
$$;

drop trigger if exists spread_passage_section on public.exam_passages;
create trigger spread_passage_section after update of section, topic on public.exam_passages
  for each row when (old.section is distinct from new.section or old.topic is distinct from new.topic)
  execute function app.spread_passage_section();

-- ---------------------------------------------------------------------------------------------
-- The takers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/exam_start(word, code, scope, score): as in 20261118120001, and the paper's order keeps
-- each topic together: the shared questions, then the SCOPE block, then the SCORE block; within
-- each, the topics in the officers' order; within a topic, the questions shuffled.
create or replace function public.exam_start(
  p_word text,
  p_code text,
  p_scope boolean default null,
  p_score boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_exam public.exams%rowtype;
  v_attempt uuid;
  v_reg public.exam_registrations%rowtype;
  v_tries int;
  v_order uuid[];
  v_options jsonb;
  v_choice boolean;
  v_scope boolean := true;
  v_score boolean := true;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  select a.id into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
  end if;

  -- the exam as it stands once its row is held: an edit that was under way has landed
  select e.* into v_exam
  from public.exams e
  where e.id = v_exam.id and e.status = 'ready' and e.address_word = v_exam.address_word
  for key share;
  if not found then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  select r.* into v_reg
  from public.exam_registrations r
  where r.exam_id = v_exam.id and r.profile_id = v_uid
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_registered');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid
      and btrim(coalesce(p.full_name, '')) <> ''
      and btrim(coalesce(p.faculty_year, '')) <> ''
      and btrim(coalesce(p.phone, '')) <> ''
      and btrim(coalesce(p.student_id, '')) <> ''
  ) then
    return jsonb_build_object('ok', false, 'reason', 'details');
  end if;

  if v_exam.opens_at is null or v_now < v_exam.opens_at then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  if v_exam.closes_at is not null and v_now >= v_exam.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if v_exam.start_code = ''
     or not exists (select 1 from public.exam_questions q where q.exam_id = v_exam.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_ready');
  end if;

  v_choice := coalesce((app.exam_sections(v_exam.id) ->> 'choice')::boolean, false);
  if exists (select 1 from public.exam_contracts c where c.exam_id = v_exam.id) then
    if v_choice then
      v_scope := coalesce(v_reg.chose_scope, false);
      v_score := coalesce(v_reg.chose_score, false);
    end if;
    if not app.exam_preferences_ok(
      v_exam.id, v_reg.id,
      case when v_choice then v_scope end,
      case when v_choice then v_score end
    ) then
      return jsonb_build_object('ok', false, 'reason', 'preferences');
    end if;
  elsif v_choice and (p_scope is not null or p_score is not null) then
    v_scope := coalesce(p_scope, false);
    v_score := coalesce(p_score, false);
    if not (v_scope or v_score) then
      return jsonb_build_object('ok', false, 'reason', 'sections');
    end if;
  end if;

  select count(*)::int into v_tries
  from app.exam_tries t
  where t.exam_id = v_exam.id and t.profile_id = v_uid and t.kind = 'code'
    and t.at > v_now - interval '10 minutes';
  if v_tries >= 8 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g')) <> v_exam.start_code then
    insert into app.exam_tries (exam_id, profile_id, kind) values (v_exam.id, v_uid, 'code');
    return jsonb_build_object('ok', false, 'reason', 'code', 'tries_left', 8 - (v_tries + 1));
  end if;

  -- One random place for each unit (a single question, or a passage with all its questions),
  -- worked out once: read a second time, a passage's questions could each get their own.
  -- Within a section the topics come in the officers' order, and the units of a topic are
  -- shuffled among themselves.
  with units as materialized (
    select x.unit, random() as place
    from (
      select distinct coalesce(q.passage_id, q.id) as unit
      from public.exam_questions q
      where q.exam_id = v_exam.id
    ) x
  ),
  topics as (
    select q.section, q.topic, min(q.sort) as first_sort, min(q.created_at) as first_made
    from public.exam_questions q
    where q.exam_id = v_exam.id
    group by q.section, q.topic
  )
  select array_agg(
           q.id
           order by case q.section when 'shared' then 0 when 'scope' then 1 else 2 end,
                    t.first_sort, t.first_made, t.topic,
                    u.place, u.unit, q.sort, q.created_at, q.id
         )
    into v_order
  from public.exam_questions q
  join units u on u.unit = coalesce(q.passage_id, q.id)
  join topics t on t.section = q.section and t.topic = q.topic
  where q.exam_id = v_exam.id;

  select coalesce(jsonb_object_agg(q.id::text, o.shown), '{}'::jsonb) into v_options
  from public.exam_questions q
  cross join lateral (
    select jsonb_agg(
             g.i order by case when q.keep_option_order then g.i::double precision else random() end
           ) as shown
    from generate_series(0, jsonb_array_length(q.options) - 1) as g(i)
  ) o
  where q.exam_id = v_exam.id;

  -- a double tap makes one attempt: the second insert does nothing and reads the first's row
  insert into public.exam_attempts (
    exam_id, profile_id, student_id, started_at, question_order, option_orders, sits_scope, sits_score)
  values (v_exam.id, v_uid, v_reg.student_id, v_now, v_order, v_options, v_scope, v_score)
  on conflict (exam_id, profile_id) do nothing;

  select a.id into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end
$$;

-- rpc/exam_paper(word): as in 20261109120001, and every question carries its topic ('' for none).
create or replace function public.exam_paper(p_word text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_exam public.exams%rowtype;
  v_attempt public.exam_attempts%rowtype;
  v_deadline timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  select a.* into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  if not found then
    raise exception 'You have not started this exam.' using errcode = '22023';
  end if;
  v_deadline := app.exam_deadline(v_attempt.started_at, v_exam.minutes);

  if v_attempt.submitted_at is not null or v_now >= v_deadline then
    return jsonb_build_object('state', 'over', 'submitted', v_attempt.submitted_at is not null);
  end if;

  return jsonb_build_object(
    'state', 'sitting',
    'exam', jsonb_build_object(
      'title', v_exam.title,
      'minutes', v_exam.minutes,
      'sections', app.exam_sections(v_exam.id)
    ),
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'started_at', v_attempt.started_at,
      'deadline_at', v_deadline,
      'sits_scope', v_attempt.sits_scope,
      'sits_score', v_attempt.sits_score
    ),
    'now', v_now,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'body', q.body,
          'section', q.section,
          'topic', q.topic,
          'passage', q.passage_id,
          'image', q.image_path,
          'options', coalesce((
            select jsonb_agg(q.options -> s.i::int order by s.pos)
            from jsonb_array_elements_text(v_attempt.option_orders -> q.id::text)
                 with ordinality as s(i, pos)
          ), '[]'::jsonb)
        )
        order by o.pos
      )
      from unnest(v_attempt.question_order) with ordinality as o(question_id, pos)
      join public.exam_questions q on q.id = o.question_id
    ), '[]'::jsonb),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body, 'image', p.image_path) order by p.id)
      from public.exam_passages p
      where p.exam_id = v_exam.id
        and exists (select 1 from public.exam_questions q where q.passage_id = p.id)
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'q', w.question_id,
          'c', (
            select (s.pos - 1)::int
            from jsonb_array_elements_text(v_attempt.option_orders -> w.question_id::text)
                 with ordinality as s(i, pos)
            where s.i::int = w.chosen_option
          ),
          'f', w.flagged
        )
      )
      from public.exam_answers w
      where w.attempt_id = v_attempt.id
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The officers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/save_exam_question(exam, question, body, options, correct, keep_order, more): as in
-- 20261109120001, and `p_more` may also carry
--   topic   the topic's name, '' or null for none (a question in a passage takes the passage's)
-- A key that is absent leaves that column as it is; on a new question it takes the default.
create or replace function public.save_exam_question(
  p_exam uuid,
  p_question uuid,
  p_body text,
  p_options jsonb,
  p_correct int,
  p_keep_order boolean default false,
  p_more jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_question;
  v_more jsonb := case when jsonb_typeof(p_more) = 'object' then p_more else '{}'::jsonb end;
  v_passage uuid;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;

  if (v_more ->> 'passage_id') is not null then
    if (v_more ->> 'passage_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'That passage is not there any more.' using errcode = '22023';
    end if;
    v_passage := (v_more ->> 'passage_id')::uuid;
  end if;

  if p_question is null then
    insert into public.exam_questions (
      exam_id, sort, body, options, keep_option_order, section, topic, passage_id, image_path)
    values (
      p_exam,
      (select coalesce(max(q.sort), 0) + 1 from public.exam_questions q where q.exam_id = p_exam),
      p_body, p_options, coalesce(p_keep_order, false),
      coalesce(v_more ->> 'section', 'shared'),
      coalesce(v_more ->> 'topic', ''),
      v_passage,
      v_more ->> 'image_path'
    )
    returning id into v_id;
  else
    update public.exam_questions q
       set body = p_body,
           options = p_options,
           keep_option_order = coalesce(p_keep_order, false),
           section = case when v_more ? 'section' then coalesce(v_more ->> 'section', 'shared') else q.section end,
           topic = case when v_more ? 'topic' then coalesce(v_more ->> 'topic', '') else q.topic end,
           passage_id = case when v_more ? 'passage_id' then v_passage else q.passage_id end,
           image_path = case when v_more ? 'image_path' then v_more ->> 'image_path' else q.image_path end
     where q.id = p_question and q.exam_id = p_exam;
    if not found then
      raise exception 'That question is not there any more.' using errcode = '22023';
    end if;
  end if;

  insert into public.exam_key as k (question_id, correct_option)
  values (v_id, p_correct)
  on conflict (question_id) do update
    set correct_option = excluded.correct_option
    where k.correct_option is distinct from excluded.correct_option;
  return v_id;
end
$$;

-- rpc/save_exam_passage(exam, passage, body, section, image, topic): as in 20261109120001, with
-- the passage's topic. Null leaves the topic as it is ('' on a new passage); its questions
-- follow it to a new topic as they follow it to a new section.
drop function if exists public.save_exam_passage(uuid, uuid, text, text, text);
create or replace function public.save_exam_passage(
  p_exam uuid,
  p_passage uuid,
  p_body text,
  p_section text default 'shared',
  p_image text default null,
  p_topic text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_passage;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;

  if p_passage is null then
    insert into public.exam_passages (exam_id, section, topic, body, image_path)
    values (p_exam, coalesce(p_section, 'shared'), coalesce(p_topic, ''), coalesce(p_body, ''), p_image)
    returning id into v_id;
  else
    update public.exam_passages p
       set section = coalesce(p_section, 'shared'),
           topic = coalesce(p_topic, p.topic),
           body = coalesce(p_body, ''),
           image_path = p_image
     where p.id = p_passage and p.exam_id = p_exam;
    if not found then
      raise exception 'That passage is not there any more.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end
$$;

-- rpc/import_exam_questions(exam, rows): as in 20261109120001, and a row may also carry
--   topic   the topic's name; absent or empty is no topic
-- Rows that follow one another with the same passage, the same section and the same topic share
-- one passage. A topic is the same topic wherever its name comes again in its section: the rows
-- of a topic need not follow one another, and stand together on the paper all the same.
create or replace function public.import_exam_questions(p_exam uuid, p_rows jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_last int;
  v_row jsonb;
  v_n int;
  v_id uuid;
  v_section text;
  v_topic text;
  v_text text;
  v_passage uuid;
  v_last_text text;
  v_last_section text;
  v_last_topic text;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import between 1 and 500 questions at a time.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 questions at a time.' using errcode = '22023';
  end if;
  -- said once here, and not as 'Question 1: ...'
  if exists (select 1 from public.exam_attempts a where a.exam_id = p_exam) then
    raise exception 'The exam has started: questions can no longer be added, removed or reworded. You can still correct a right answer.'
      using errcode = '22023';
  end if;

  select coalesce(max(q.sort), 0) into v_last from public.exam_questions q where q.exam_id = p_exam;

  for v_row, v_n in
    select x.item, x.pos::int
    from jsonb_array_elements(p_rows) with ordinality as x(item, pos)
    order by x.pos
  loop
    begin
      v_section := case
        when jsonb_typeof(v_row -> 'section') = 'string' and btrim(v_row ->> 'section') <> ''
          then lower(btrim(v_row ->> 'section'))
        else 'shared'
      end;
      v_topic := case
        when jsonb_typeof(v_row -> 'topic') = 'string' then app.tidy_exam_topic(v_row ->> 'topic')
        else ''
      end;
      v_text := case
        when jsonb_typeof(v_row -> 'passage') = 'string' then btrim(v_row ->> 'passage')
        else ''
      end;
      if v_text = '' then
        v_passage := null;
        v_last_text := null;
        v_last_section := null;
        v_last_topic := null;
      elsif v_last_text is distinct from v_text
         or v_last_section is distinct from v_section
         or v_last_topic is distinct from v_topic then
        insert into public.exam_passages (exam_id, section, topic, body)
        values (p_exam, v_section, v_topic, v_text)
        returning id into v_passage;
        v_last_text := v_text;
        v_last_section := v_section;
        v_last_topic := v_topic;
      end if;

      -- a body or a right answer of the wrong kind reads as missing, and the triggers refuse it
      insert into public.exam_questions (
        exam_id, sort, body, options, keep_option_order, section, topic, passage_id)
      values (
        p_exam,
        v_last + v_n,
        case when jsonb_typeof(v_row -> 'body') = 'string' then v_row ->> 'body' end,
        v_row -> 'options',
        coalesce(v_row -> 'keep_order' = 'true'::jsonb, false),
        v_section,
        v_topic,
        v_passage
      )
      returning id into v_id;
      insert into public.exam_key (question_id, correct_option)
      values (
        v_id,
        case
          when jsonb_typeof(v_row -> 'correct') = 'number' and (v_row ->> 'correct') ~ '^[0-9]{1,3}$'
            then (v_row ->> 'correct')::int
        end
      );
    exception when sqlstate '22023' then
      raise exception 'Question %: %', v_n, sqlerrm using errcode = '22023';
    end;
  end loop;
  return jsonb_array_length(p_rows);
end
$$;

-- rpc/exam_sheet(attempt): as in 20261109120001, and each row carries the question's topic.
create or replace function public.exam_sheet(p_attempt uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_exam uuid;
  v_scope boolean;
  v_score boolean;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select a.exam_id, a.sits_scope, a.sits_score into v_exam, v_scope, v_score
  from public.exam_attempts a
  where a.id = p_attempt;
  if not found then
    raise exception 'That paper is not there any more.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempt', (select to_jsonb(r) from app.exam_result_rows(v_exam, p_attempt) r),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body, 'image', p.image_path) order by p.id)
      from public.exam_passages p
      where p.exam_id = v_exam
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'n', nn.n,
          'label', nn.label,
          'question_id', q.id,
          'section', q.section,
          'topic', q.topic,
          'passage', q.passage_id,
          'image', q.image_path,
          'body', q.body,
          'options', q.options,
          'correct', k.correct_option,
          'chosen', w.chosen_option,
          'flagged', coalesce(w.flagged, false),
          'answered_at', w.answered_at,
          'counted', q.section = 'shared'
                     or (q.section = 'scope' and v_scope)
                     or (q.section = 'score' and v_score)
        )
        order by nn.n
      )
      from app.exam_question_numbers(v_exam) nn
      join public.exam_questions q on q.id = nn.question_id
      left join public.exam_key k on k.question_id = q.id
      left join public.exam_answers w on w.attempt_id = p_attempt and w.question_id = q.id
    ), '[]'::jsonb)
  );
end
$$;

-- rpc/exam_question_stats(exam): as in 20261109120001, and each question carries its topic.
create or replace function public.exam_question_stats(p_exam uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempts', (select count(*)::int from public.exam_attempts a where a.exam_id = p_exam),
    'sections', app.exam_sections(p_exam),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'question_id', q.id,
          'n', nn.n,
          'label', nn.label,
          'section', q.section,
          'topic', q.topic,
          'passage', q.passage_id,
          'image', q.image_path,
          'body', q.body,
          'options', q.options,
          'correct', k.correct_option,
          'sat', t.sat,
          'answered', s.answered,
          'right', s.right_ones,
          'counts', (
            select jsonb_agg(s.chosen -> g.i order by g.i)
            from generate_series(0, jsonb_array_length(q.options) - 1) as g(i)
          )
        )
        order by nn.n
      )
      from app.exam_question_numbers(p_exam) nn
      join public.exam_questions q on q.id = nn.question_id
      left join public.exam_key k on k.question_id = q.id
      cross join lateral (
        select count(*)::int as sat
        from public.exam_attempts a
        where a.exam_id = p_exam
          and (q.section = 'shared'
               or (q.section = 'scope' and a.sits_scope)
               or (q.section = 'score' and a.sits_score))
      ) t
      cross join lateral (
        select count(w.chosen_option)::int as answered,
               (count(*) filter (where w.chosen_option = k.correct_option))::int as right_ones,
               jsonb_build_array(
                 count(*) filter (where w.chosen_option = 0),
                 count(*) filter (where w.chosen_option = 1),
                 count(*) filter (where w.chosen_option = 2),
                 count(*) filter (where w.chosen_option = 3),
                 count(*) filter (where w.chosen_option = 4),
                 count(*) filter (where w.chosen_option = 5)
               ) as chosen
        from public.exam_answers w
        join public.exam_attempts a on a.id = w.attempt_id
        where w.question_id = q.id
          and (q.section = 'shared'
               or (q.section = 'scope' and a.sits_scope)
               or (q.section = 'score' and a.sits_score))
      ) s
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

alter function app.tidy_exam_topic(text) owner to postgres;
alter function app.exam_question_numbers(uuid) owner to postgres;
alter function app.normalize_exam_question() owner to postgres;
alter function app.normalize_exam_passage() owner to postgres;
alter function app.spread_passage_section() owner to postgres;
alter function public.exam_start(text, text, boolean, boolean) owner to postgres;
alter function public.exam_paper(text) owner to postgres;
alter function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) owner to postgres;
alter function public.save_exam_passage(uuid, uuid, text, text, text, text) owner to postgres;
alter function public.import_exam_questions(uuid, jsonb) owner to postgres;
alter function public.exam_sheet(uuid) owner to postgres;
alter function public.exam_question_stats(uuid) owner to postgres;

revoke execute on function app.tidy_exam_topic(text) from public;
revoke execute on function app.exam_question_numbers(uuid) from public;
revoke execute on function app.normalize_exam_question() from public;
revoke execute on function app.normalize_exam_passage() from public;
revoke execute on function app.spread_passage_section() from public;

revoke execute on function public.exam_start(text, text, boolean, boolean) from public, anon;
grant execute on function public.exam_start(text, text, boolean, boolean) to authenticated;
revoke execute on function public.exam_paper(text) from public, anon;
grant execute on function public.exam_paper(text) to authenticated;
revoke execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) from public, anon;
grant execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) to authenticated;
revoke execute on function public.save_exam_passage(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_exam_passage(uuid, uuid, text, text, text, text) to authenticated;
revoke execute on function public.import_exam_questions(uuid, jsonb) from public, anon;
grant execute on function public.import_exam_questions(uuid, jsonb) to authenticated;
revoke execute on function public.exam_sheet(uuid) from public, anon;
grant execute on function public.exam_sheet(uuid) to authenticated;
revoke execute on function public.exam_question_stats(uuid) from public, anon;
grant execute on function public.exam_question_stats(uuid) to authenticated;
