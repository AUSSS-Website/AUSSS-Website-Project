-- Phase 8, continued: the exam's sections, its passages and its pictures.
--
-- The exchange exam on paper ends with two blocks of questions, "Clinical Section for SCOPE
-- Contracts" (81P to 100P) and "Research Section for SCORE Contracts" (81R to 100R). Every
-- student answers the shared questions and then one block or both, and gets a mark for each
-- programme: the shared questions plus that programme's block. The paper also has reading
-- passages that several questions share, and questions that are a picture. Until now the site's
-- exam was one flat list of questions in words, with one grade.
--
--   exam_questions.section    'shared', 'scope' (the professional exchange's block) or 'score'
--                             (the research exchange's block)
--   exam_questions.passage_id the passage this question is read with, if any
--   exam_questions.image_path the question's picture in the bucket `exam-pictures`, if any; a
--                             question may now be a picture with no words
--   exam_passages             a text, a picture or both, read with several questions; it has a
--                             section, and its questions take that section
--   exam_attempts.sits_scope, which blocks this taker answers. Chosen before the start code and
--   exam_attempts.sits_score  changed at will until the paper is handed in or its time is up
--
-- The choice exists only in an exam that has questions in both blocks. In any other exam every
-- question is on everybody's paper and there is one grade, as before.
--
-- A taker's paper: the shared questions, then the SCOPE block, then the SCORE block, each
-- shuffled within itself. A passage's questions stay together and in the officers' order; the
-- passage moves among the single questions as one. rpc/exam_paper sends every question, each
-- with its section, and the page shows the blocks the taker chose: a change of mind needs no
-- second download. The choice travels with rpc/exam_save, which every phone already calls, so
-- 400 phones get no new function to call and a hand-in fixes the choice in the same write.
--
-- Marking is still a count at the moment the officers read. An answer in a block the taker does
-- not sit stays where it is and is not counted. Each paper now has a mark for the shared
-- questions, one for each block it sits, and a total for each programme (shared plus block),
-- with a rank among the papers that sit that programme. `score` and `rank` stay: everything the
-- paper sits, in one number.
--
-- Pictures are in a public bucket under <exam id>/<32 random hex digits>.jpg. Public, because
-- 400 phones fetch them in the same minute and a public file costs the database nothing; the
-- name cannot be guessed, the bucket cannot be listed by a taker, and a name is handed out only
-- by rpc/exam_paper, after the start code. Like the wording, a picture is fixed once the first
-- student has started.
--
-- Three functions change their arguments, so the old ones are dropped: exam_start and exam_save
-- gain the choice (two booleans that default to null, so a page loaded before this migration
-- still starts and saves), and save_exam_question gains `p_more`, a JSON object with any of
-- `section`, `passage_id` and `image_path`. A key that is absent leaves that column alone, so an
-- old page that corrects a right answer cannot wipe a picture.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table public.exam_questions add column if not exists section text not null default 'shared';
alter table public.exam_questions drop constraint if exists exam_questions_section;
alter table public.exam_questions add constraint exam_questions_section
  check (section in ('shared', 'scope', 'score'));

create table if not exists public.exam_passages (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  section text not null default 'shared',
  body text not null default '',
  image_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_passages_section check (section in ('shared', 'scope', 'score')),
  constraint exam_passages_body_len check (length(body) <= 8000),
  constraint exam_passages_something check (length(body) >= 1 or image_path is not null),
  constraint exam_passages_image_path check (
    image_path is null
    or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.jpg$'
  )
);

create index if not exists exam_passages_exam_id_idx on public.exam_passages (exam_id);

-- A passage that is removed leaves its questions as single questions.
alter table public.exam_questions
  add column if not exists passage_id uuid null references public.exam_passages (id) on delete set null;
alter table public.exam_questions add column if not exists image_path text null;

create index if not exists exam_questions_passage_id_idx on public.exam_questions (passage_id);

-- a question is words, a picture or both
alter table public.exam_questions drop constraint if exists exam_questions_body_len;
alter table public.exam_questions add constraint exam_questions_body_len
  check (length(body) <= 2000 and (length(body) >= 1 or image_path is not null));
alter table public.exam_questions drop constraint if exists exam_questions_image_path;
alter table public.exam_questions add constraint exam_questions_image_path check (
  image_path is null
  or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.jpg$'
);

-- Both true in an exam without the choice.
alter table public.exam_attempts add column if not exists sits_scope boolean not null default true;
alter table public.exam_attempts add column if not exists sits_score boolean not null default true;
alter table public.exam_attempts drop constraint if exists exam_attempts_sits;
alter table public.exam_attempts add constraint exam_attempts_sits check (sits_scope or sits_score);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Whether a picture's place in the bucket is one of that exam's: <exam id>/<32 hex digits>.jpg.
create or replace function app.exam_picture_ok(p_exam uuid, p_path text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_path is not null and p_exam is not null
     and p_path ~ ('^' || p_exam::text || '/[0-9a-f]{32}\.jpg$')
$$;

-- Whether a file in the pictures' bucket may be removed: not while the exam whose folder it is
-- in has a paper. A started exam's pictures are part of every paper, as its wording is. Once
-- the exam's papers are gone (the term ended, or the exam was deleted) its folder can be cleared.
-- A name that is in no exam's folder is free. Called from the bucket's delete policy.
create or replace function app.exam_picture_free(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.exam_attempts a
    where a.exam_id = case
      when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(p_name, '/', 1)::uuid
    end
  )
$$;

-- How many questions an exam has in each section, and whether its takers choose: they do when
-- both blocks have questions. { shared, scope, score, choice }.
create or replace function app.exam_sections(p_exam uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'shared', (count(*) filter (where q.section = 'shared'))::int,
    'scope', (count(*) filter (where q.section = 'scope'))::int,
    'score', (count(*) filter (where q.section = 'score'))::int,
    'choice', count(*) filter (where q.section = 'scope') > 0
              and count(*) filter (where q.section = 'score') > 0
  )
  from public.exam_questions q
  where q.exam_id = p_exam
$$;

-- The officers' numbering of an exam's questions, as on the paper: the shared questions first
-- (1, 2, ...), then the SCOPE block and the SCORE block, each counting on from the last shared
-- question with its letter (81P ... and 81R ...). `n` runs through all of them without a gap
-- and is what the lists are ordered by; `label` is what is shown. Within a section the order is
-- the officers' own (sort), and a passage's questions stand together where its first one is.
create or replace function app.exam_question_numbers(p_exam uuid)
returns table (question_id uuid, n int, label text)
language sql
stable
set search_path = ''
as $$
  with q as (
    select x.id, x.section, x.sort, x.created_at,
           case x.section when 'shared' then 0 when 'scope' then 1 else 2 end as sec,
           coalesce(x.passage_id, x.id) as unit,
           min(x.sort) over w as unit_sort,
           min(x.created_at) over w as unit_made
    from public.exam_questions x
    where x.exam_id = p_exam
    window w as (partition by coalesce(x.passage_id, x.id))
  ),
  placed as (
    select q.id, q.section,
           (row_number() over (
              order by q.sec, q.unit_sort, q.unit_made, q.unit, q.sort, q.created_at, q.id))::int as n,
           (row_number() over (
              partition by q.sec
              order by q.unit_sort, q.unit_made, q.unit, q.sort, q.created_at, q.id))::int as k
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

-- As in 20261010120001, with the section, the passage and the picture:
--   * a question needs words or a picture;
--   * its picture must be one of its own exam's;
--   * a question in a passage takes the passage's section, whatever was sent;
--   * all three are part of the paper, so they are fixed once the exam has started.
-- An update that comes from the exam itself being deleted passes, as a delete does: the exam's
-- passages go with it, and each takes itself out of its questions on the way.
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
  if new.passage_id is not null then
    select p.section into v_section
    from public.exam_passages p
    where p.id = new.passage_id and p.exam_id = new.exam_id;
    if not found then
      raise exception 'That passage is not there any more.' using errcode = '22023';
    end if;
    new.section := v_section;
  end if;
  if new.section not in ('shared', 'scope', 'score') then
    raise exception 'Choose the question''s section: shared, SCOPE or SCORE.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_changes_paper := new.body is distinct from old.body
      or new.options is distinct from old.options
      or new.keep_option_order is distinct from old.keep_option_order
      or new.section is distinct from old.section
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

-- Tidies a passage and locks it once the exam has started, as a question is locked: it is part
-- of every paper built from then on. A delete that comes from the exam itself being deleted
-- passes.
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

  if tg_op = 'UPDATE' then
    v_changes_paper := new.body is distinct from old.body
      or new.section is distinct from old.section
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

-- A passage that moves to another section takes its questions with it.
create or replace function app.spread_passage_section()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.exam_questions q
     set section = new.section
   where q.passage_id = new.id and q.section is distinct from new.section;
  return null;
end
$$;

drop trigger if exists normalize_exam_passage on public.exam_passages;
create trigger normalize_exam_passage before insert or update or delete on public.exam_passages
  for each row execute function app.normalize_exam_passage();
drop trigger if exists spread_passage_section on public.exam_passages;
create trigger spread_passage_section after update of section on public.exam_passages
  for each row when (old.section is distinct from new.section)
  execute function app.spread_passage_section();
drop trigger if exists set_updated_at on public.exam_passages;
create trigger set_updated_at before update on public.exam_passages
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.exam_passages;
create trigger audit after insert or update or delete on public.exam_passages
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- The takers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/exam_door(word): as in 20261010120001, and the exam also says how many questions each
-- section has and whether there is a choice (`sections`), and a paper says which blocks it sits.
create or replace function public.exam_door(p_word text)
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
    return jsonb_build_object('exam', null);
  end if;

  select a.* into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  v_deadline := app.exam_deadline(v_attempt.started_at, v_exam.minutes);

  return jsonb_build_object(
    'exam', jsonb_build_object(
      'title', v_exam.title,
      'opens_at', v_exam.opens_at,
      'closes_at', v_exam.closes_at,
      'minutes', v_exam.minutes,
      'questions', (select count(*)::int from public.exam_questions q where q.exam_id = v_exam.id),
      'sections', app.exam_sections(v_exam.id),
      'phase', case
        when v_exam.closes_at is not null and v_now >= v_exam.closes_at then 'closed'
        when v_exam.opens_at is null or v_now < v_exam.opens_at then 'before'
        else 'open'
      end
    ),
    'me', (
      select jsonb_build_object(
        'full_name', p.full_name,
        'faculty_year', p.faculty_year,
        'phone', p.phone,
        'student_id', p.student_id,
        'email', p.email
      )
      from public.profiles p
      where p.id = v_uid
    ),
    'registration', case
      when exists (
        select 1 from public.exam_registrations r
        where r.exam_id = v_exam.id and r.profile_id = v_uid
      ) then 'held'
      else 'none'
    end,
    'attempt', case
      when v_attempt.id is null then null
      else jsonb_build_object(
        'id', v_attempt.id,
        'started_at', v_attempt.started_at,
        'deadline_at', v_deadline,
        'submitted_at', v_attempt.submitted_at,
        'over', v_attempt.submitted_at is not null or v_now >= v_deadline,
        'sits_scope', v_attempt.sits_scope,
        'sits_score', v_attempt.sits_score
      )
    end,
    'now', v_now
  );
end
$$;

-- rpc/exam_start(word, code, scope, score): as in 20261010120001, with the choice of blocks.
--   * In an exam with the choice, `p_scope` and `p_score` say which blocks this taker sits. Both
--     null means both blocks: that is what a page loaded before this migration sends. Neither
--     block is refused with the reason 'sections', before the code is looked at, so it costs no
--     try.
--   * In any other exam the two are ignored and the paper sits everything.
--   * The paper's order: the shared questions, then the SCOPE block, then the SCORE block, each
--     shuffled within itself. A passage's questions keep the officers' order and stay together.
drop function if exists public.exam_start(text, text);
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
  v_listed text;
  v_tries int;
  v_order uuid[];
  v_options jsonb;
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

  select r.student_id into v_listed
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

  if (app.exam_sections(v_exam.id) ->> 'choice')::boolean
     and (p_scope is not null or p_score is not null) then
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
  with units as materialized (
    select x.unit, random() as place
    from (
      select distinct coalesce(q.passage_id, q.id) as unit
      from public.exam_questions q
      where q.exam_id = v_exam.id
    ) x
  )
  select array_agg(
           q.id
           order by case q.section when 'shared' then 0 when 'scope' then 1 else 2 end,
                    u.place, u.unit, q.sort, q.created_at, q.id
         )
    into v_order
  from public.exam_questions q
  join units u on u.unit = coalesce(q.passage_id, q.id)
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
  values (v_exam.id, v_uid, v_listed, v_now, v_order, v_options, v_scope, v_score)
  on conflict (exam_id, profile_id) do nothing;

  select a.id into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end
$$;

-- rpc/exam_paper(word): as in 20261010120001, and
--   * the exam says how many questions each section has and whether there is a choice;
--   * the attempt says which blocks it sits;
--   * every question carries its section, its passage's id and its picture's place in the
--     bucket (either may be null), and the passages that have a question come once each, in
--     `passages`.
-- Every question of the exam is sent, also those of a block this taker does not sit: the page
-- hides them, and shows them the moment the taker adds the block.
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

-- rpc/exam_save(word, answers, hand_in, scope, score): as in 20261010120001, and it carries
-- the taker's choice of blocks.
--   * When both `p_scope` and `p_score` are given, at least one of them is true, the exam has
--     the choice, the paper is not handed in and its deadline has not passed, the paper's choice
--     becomes that. The thirty seconds after the deadline are for answers that were already on
--     their way, not for a change of mind. Anything else leaves the choice as it is, without a
--     word: a refusal here would lose the answers that came with it. Null for both is what a
--     page loaded before this migration sends.
--   * An answer is saved for any question of the exam, also one in a block the paper does not
--     sit at the moment: it is kept, and counts if the block is added again.
--   * Every answer says which blocks the paper sits now (`sits_scope`, `sits_score`).
drop function if exists public.exam_save(text, jsonb, boolean);
create or replace function public.exam_save(
  p_word text,
  p_answers jsonb,
  p_hand_in boolean default false,
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
  v_attempt public.exam_attempts%rowtype;
  v_deadline timestamptz;
  v_saved int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'That is not a list of answers.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_answers) > 300 then
    raise exception 'That is not a list of answers.' using errcode = '22023';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  select a.* into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid
  for no key update;
  if not found then
    raise exception 'You have not started this exam.' using errcode = '22023';
  end if;
  v_deadline := app.exam_deadline(v_attempt.started_at, v_exam.minutes);

  if v_attempt.submitted_at is not null then
    return jsonb_build_object(
      'state', 'over', 'submitted', true, 'saved', 0, 'deadline_at', v_deadline, 'now', v_now,
      'sits_scope', v_attempt.sits_scope, 'sits_score', v_attempt.sits_score);
  end if;
  if v_now > v_deadline + interval '30 seconds' then
    return jsonb_build_object(
      'state', 'over', 'submitted', false, 'saved', 0, 'deadline_at', v_deadline, 'now', v_now,
      'sits_scope', v_attempt.sits_scope, 'sits_score', v_attempt.sits_score);
  end if;

  -- the exam is read for its sections only when the choice really changes, which is rare
  if p_scope is not null and p_score is not null and (p_scope or p_score)
     and v_now < v_deadline
     and (p_scope is distinct from v_attempt.sits_scope or p_score is distinct from v_attempt.sits_score)
     and (app.exam_sections(v_exam.id) ->> 'choice')::boolean then
    update public.exam_attempts a
       set sits_scope = p_scope, sits_score = p_score
     where a.id = v_attempt.id;
    v_attempt.sits_scope := p_scope;
    v_attempt.sits_score := p_score;
  end if;

  if jsonb_array_length(p_answers) > 0 then
    insert into public.exam_answers as w (attempt_id, question_id, chosen_option, flagged, answered_at)
    select v_attempt.id, v.question_id, v.chosen, v.flagged, v_now
    from (
      select distinct on (o.question_id)
             o.question_id,
             (o.shown ->> i.c_pos)::int as chosen,
             i.flagged
      from (
        select x.pos,
               lower(btrim(x.item ->> 'q')) as q,
               coalesce(jsonb_typeof(x.item -> 'c'), 'null') as c_kind,
               case
                 when jsonb_typeof(x.item -> 'c') = 'number' and (x.item ->> 'c') ~ '^[0-5]$'
                   then (x.item ->> 'c')::int
               end as c_pos,
               coalesce(x.item -> 'f' = 'true'::jsonb, false) as flagged
        from jsonb_array_elements(p_answers) with ordinality as x(item, pos)
        where jsonb_typeof(x.item) = 'object' and x.item ? 'c'
      ) i
      join (
        select u.question_id, v_attempt.option_orders -> u.question_id::text as shown
        from unnest(v_attempt.question_order) as u(question_id)
      ) o on o.question_id::text = i.q
      where i.c_kind = 'null' or i.c_pos < jsonb_array_length(o.shown)
      order by o.question_id, i.pos desc
    ) v
    on conflict (attempt_id, question_id) do update
      set chosen_option = excluded.chosen_option,
          flagged = excluded.flagged,
          answered_at = case
            when w.chosen_option is distinct from excluded.chosen_option then excluded.answered_at
            else w.answered_at
          end;
    get diagnostics v_saved = row_count;
  end if;

  if coalesce(p_hand_in, false) then
    update public.exam_attempts a set submitted_at = v_now where a.id = v_attempt.id;
    return jsonb_build_object(
      'state', 'over', 'submitted', true, 'saved', v_saved, 'deadline_at', v_deadline, 'now', v_now,
      'sits_scope', v_attempt.sits_scope, 'sits_score', v_attempt.sits_score);
  end if;

  return jsonb_build_object(
    'state', case when v_now >= v_deadline then 'over' else 'sitting' end,
    'submitted', false,
    'saved', v_saved,
    'deadline_at', v_deadline,
    'now', v_now,
    'sits_scope', v_attempt.sits_scope,
    'sits_score', v_attempt.sits_score
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The officers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/save_exam_question(exam, question, body, options, correct, keep_order, more): as in
-- 20261010120001, with `p_more`: a JSON object with any of
--   section     'shared', 'scope' or 'score' (a question in a passage takes the passage's)
--   passage_id  the passage it is read with, or null for none
--   image_path  its picture's place in the bucket, or null for none
-- A key that is absent leaves that column as it is; on a new question it takes the default.
drop function if exists public.save_exam_question(uuid, uuid, text, jsonb, int, boolean);
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
      exam_id, sort, body, options, keep_option_order, section, passage_id, image_path)
    values (
      p_exam,
      (select coalesce(max(q.sort), 0) + 1 from public.exam_questions q where q.exam_id = p_exam),
      p_body, p_options, coalesce(p_keep_order, false),
      coalesce(v_more ->> 'section', 'shared'),
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

-- rpc/save_exam_passage(exam, passage, body, section, image): adds a passage (passage null) or
-- changes one. The trigger tidies and refuses; its questions follow it to a new section.
create or replace function public.save_exam_passage(
  p_exam uuid,
  p_passage uuid,
  p_body text,
  p_section text default 'shared',
  p_image text default null
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
    insert into public.exam_passages (exam_id, section, body, image_path)
    values (p_exam, coalesce(p_section, 'shared'), coalesce(p_body, ''), p_image)
    returning id into v_id;
  else
    update public.exam_passages p
       set section = coalesce(p_section, 'shared'), body = coalesce(p_body, ''), image_path = p_image
     where p.id = p_passage and p.exam_id = p_exam;
    if not found then
      raise exception 'That passage is not there any more.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end
$$;

-- rpc/import_exam_questions(exam, rows): as in 20261010120001, and a row may also carry
--   section  'shared', 'scope' or 'score'; absent or empty is 'shared'
--   passage  the text the question is read with. Rows that follow one another with the same
--            passage and the same section share one passage; the same text again further down
--            is a passage of its own.
-- Pictures do not come in a spreadsheet: they are added to a question or a passage afterwards.
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
  v_text text;
  v_passage uuid;
  v_last_text text;
  v_last_section text;
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
      v_text := case
        when jsonb_typeof(v_row -> 'passage') = 'string' then btrim(v_row ->> 'passage')
        else ''
      end;
      if v_text = '' then
        v_passage := null;
        v_last_text := null;
        v_last_section := null;
      elsif v_last_text is distinct from v_text or v_last_section is distinct from v_section then
        insert into public.exam_passages (exam_id, section, body)
        values (p_exam, v_section, v_text)
        returning id into v_passage;
        v_last_text := v_text;
        v_last_section := v_section;
      end if;

      -- a body or a right answer of the wrong kind reads as missing, and the triggers refuse it
      insert into public.exam_questions (exam_id, sort, body, options, keep_option_order, section, passage_id)
      values (
        p_exam,
        v_last + v_n,
        case when jsonb_typeof(v_row -> 'body') = 'string' then v_row ->> 'body' end,
        v_row -> 'options',
        coalesce(v_row -> 'keep_order' = 'true'::jsonb, false),
        v_section,
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

-- One row for each attempt of an exam (or for one attempt), marked as it stands now.
--   sits_scope, sits_score   whether the paper sits that block: the taker's choice, and false
--                            in an exam that has no question in the block
--   answered                 the questions it answered, of those it sits
--   mark_shared              its right answers among the shared questions
--   mark_scope, mark_score   its right answers in each block it sits; null for a block it does
--                            not sit
--   total_scope, total_score the shared mark plus the block's: the programme's mark; null as above
--   score                    everything it sits, in one number: the grade of an exam with no blocks
-- The return type changes, so the function of 20261010120001 is dropped first.
drop function if exists app.exam_result_rows(uuid, uuid);
create or replace function app.exam_result_rows(p_exam uuid, p_attempt uuid default null)
returns table (
  attempt_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  phone text,
  faculty_year text,
  student_id text,
  started_at timestamptz,
  submitted_at timestamptz,
  finished_at timestamptz,
  state text,
  answered int,
  score int,
  seconds int,
  sits_scope boolean,
  sits_score boolean,
  mark_shared int,
  mark_scope int,
  mark_score int,
  total_scope int,
  total_score int
)
language sql
stable
set search_path = ''
as $$
  with size as (
    select count(*) filter (where q.section = 'scope') > 0 as has_scope,
           count(*) filter (where q.section = 'score') > 0 as has_score
    from public.exam_questions q
    where q.exam_id = p_exam
  ),
  sat as (
    select a.id, a.profile_id, a.student_id, a.started_at, a.submitted_at,
           app.exam_deadline(a.started_at, e.minutes) as deadline_at,
           a.sits_scope and z.has_scope as in_scope,
           a.sits_score and z.has_score as in_score
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    cross join size z
    where a.exam_id = p_exam and (p_attempt is null or a.id = p_attempt)
  ),
  marks as (
    select w.attempt_id,
           (count(w.chosen_option) filter (
              where q.section = 'shared'
                 or (q.section = 'scope' and s.in_scope)
                 or (q.section = 'score' and s.in_score)))::int as answered,
           (count(*) filter (where q.section = 'shared' and w.chosen_option = k.correct_option))::int as shared_right,
           (count(*) filter (where q.section = 'scope' and w.chosen_option = k.correct_option))::int as scope_right,
           (count(*) filter (where q.section = 'score' and w.chosen_option = k.correct_option))::int as score_right
    from public.exam_answers w
    join sat s on s.id = w.attempt_id
    join public.exam_questions q on q.id = w.question_id
    left join public.exam_key k on k.question_id = w.question_id
    group by w.attempt_id
  )
  select s.id, s.profile_id, left(btrim(p.full_name), 120), p.email, left(btrim(p.phone), 30),
         left(btrim(p.faculty_year), 40), s.student_id,
         s.started_at, s.submitted_at, f.finished_at,
         case
           when s.submitted_at is not null then 'handed_in'
           when now() >= s.deadline_at then 'timed_out'
           else 'sitting'
         end,
         coalesce(m.answered, 0),
         coalesce(m.shared_right, 0)
           + case when s.in_scope then coalesce(m.scope_right, 0) else 0 end
           + case when s.in_score then coalesce(m.score_right, 0) else 0 end,
         round(extract(epoch from (f.finished_at - s.started_at)))::int,
         s.in_scope,
         s.in_score,
         coalesce(m.shared_right, 0),
         case when s.in_scope then coalesce(m.scope_right, 0) end,
         case when s.in_score then coalesce(m.score_right, 0) end,
         case when s.in_scope then coalesce(m.shared_right, 0) + coalesce(m.scope_right, 0) end,
         case when s.in_score then coalesce(m.shared_right, 0) + coalesce(m.score_right, 0) end
  from sat s
  join public.profiles p on p.id = s.profile_id
  left join marks m on m.attempt_id = s.id
  cross join lateral (
    select coalesce(s.submitted_at, case when now() >= s.deadline_at then s.deadline_at end) as finished_at
  ) f
$$;

-- rpc/exam_results(exam): as in 20261010120001, and
--   sections                 how many questions each section has, and whether there is a choice
--   rank_scope, rank_score   a paper's place among the papers that sit that programme, by the
--                            programme's total; null for a paper that does not sit it
-- `rank` and the order of the list are still by `score`.
create or replace function public.exam_results(p_exam uuid)
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
    'questions', (select count(*)::int from public.exam_questions q where q.exam_id = p_exam),
    'sections', app.exam_sections(p_exam),
    'now', now(),
    'attempts', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.score desc, lower(r.full_name), r.attempt_id)
      from (
        select x.*,
               (rank() over (order by x.score desc))::int as rank,
               case when x.sits_scope then
                 (rank() over (partition by x.sits_scope order by x.total_scope desc nulls last))::int
               end as rank_scope,
               case when x.sits_score then
                 (rank() over (partition by x.sits_score order by x.total_score desc nulls last))::int
               end as rank_score
        from app.exam_result_rows(p_exam) x
      ) r
    ), '[]'::jsonb)
  );
end
$$;

-- rpc/exam_sheet(attempt): as in 20261010120001, and each row carries the question's section,
-- its number as the paper shows it (`label`), its passage's id, its picture, and whether this
-- paper sits it (`counted`). The exam's passages come once each, in `passages`.
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

-- rpc/exam_question_stats(exam): as in 20261010120001, and each question carries its section,
-- its number as the paper shows it (`label`), its passage's id and its picture. A question in
-- a block is counted over the papers that sit that block only (`sat` says how many those are);
-- an answer left behind in a block its taker dropped is in none of the figures.
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
-- Storage: public bucket `exam-pictures`, written by the exam officers under <exam id>/…
-- ---------------------------------------------------------------------------------------------

-- The portal shrinks a picture to a JPEG before it uploads it, so nothing else is taken.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-pictures', 'exam-pictures', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves a file to whoever has its address and lists nothing without a policy.
-- The select policy lets the exam officers list an exam's folder, to clear it when the exam is
-- removed; no taker can list. A replaced picture is a new file under a new name, so there is no
-- update policy, and a file a paper points at cannot be overwritten. Nor can it be removed: the
-- delete policy leaves the folder of an exam that has started alone (app.exam_picture_free).
drop policy if exists exam_pictures_read on storage.objects;
create policy exam_pictures_read on storage.objects
  for select to authenticated
  using (bucket_id = 'exam-pictures' and (select app.is_exam_officer()));
drop policy if exists exam_pictures_insert on storage.objects;
create policy exam_pictures_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exam-pictures'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.jpg$'
    and (select app.is_exam_officer())
  );
drop policy if exists exam_pictures_delete on storage.objects;
create policy exam_pictures_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'exam-pictures'
    and (select app.is_exam_officer())
    and app.exam_picture_free(name)
  );

-- ---------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------

alter table public.exam_passages enable row level security;

drop policy if exists exam_passages_select on public.exam_passages;
create policy exam_passages_select on public.exam_passages
  for select to authenticated
  using ((select app.is_exam_officer()));
drop policy if exists exam_passages_delete on public.exam_passages;
create policy exam_passages_delete on public.exam_passages
  for delete to authenticated
  using ((select app.is_exam_officer()));

alter function app.exam_picture_ok(uuid, text) owner to postgres;
alter function app.exam_picture_free(text) owner to postgres;
alter function app.exam_sections(uuid) owner to postgres;
alter function app.exam_question_numbers(uuid) owner to postgres;
alter function app.normalize_exam_question() owner to postgres;
alter function app.normalize_exam_passage() owner to postgres;
alter function app.spread_passage_section() owner to postgres;
alter function app.exam_result_rows(uuid, uuid) owner to postgres;
alter function public.exam_door(text) owner to postgres;
alter function public.exam_start(text, text, boolean, boolean) owner to postgres;
alter function public.exam_paper(text) owner to postgres;
alter function public.exam_save(text, jsonb, boolean, boolean, boolean) owner to postgres;
alter function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) owner to postgres;
alter function public.save_exam_passage(uuid, uuid, text, text, text) owner to postgres;
alter function public.import_exam_questions(uuid, jsonb) owner to postgres;
alter function public.exam_results(uuid) owner to postgres;
alter function public.exam_sheet(uuid) owner to postgres;
alter function public.exam_question_stats(uuid) owner to postgres;

revoke execute on function app.exam_picture_ok(uuid, text) from public;
-- called from a policy, so the role the policy is for must be able to call it
revoke execute on function app.exam_picture_free(text) from public;
grant execute on function app.exam_picture_free(text) to authenticated;
revoke execute on function app.exam_sections(uuid) from public;
revoke execute on function app.exam_question_numbers(uuid) from public;
revoke execute on function app.normalize_exam_question() from public;
revoke execute on function app.normalize_exam_passage() from public;
revoke execute on function app.spread_passage_section() from public;
revoke execute on function app.exam_result_rows(uuid, uuid) from public;

revoke execute on function public.exam_door(text) from public, anon;
grant execute on function public.exam_door(text) to authenticated;
revoke execute on function public.exam_start(text, text, boolean, boolean) from public, anon;
grant execute on function public.exam_start(text, text, boolean, boolean) to authenticated;
revoke execute on function public.exam_paper(text) from public, anon;
grant execute on function public.exam_paper(text) to authenticated;
revoke execute on function public.exam_save(text, jsonb, boolean, boolean, boolean) from public, anon;
grant execute on function public.exam_save(text, jsonb, boolean, boolean, boolean) to authenticated;
revoke execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) from public, anon;
grant execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean, jsonb) to authenticated;
revoke execute on function public.save_exam_passage(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.save_exam_passage(uuid, uuid, text, text, text) to authenticated;
revoke execute on function public.import_exam_questions(uuid, jsonb) from public, anon;
grant execute on function public.import_exam_questions(uuid, jsonb) to authenticated;
revoke execute on function public.exam_results(uuid) from public, anon;
grant execute on function public.exam_results(uuid) to authenticated;
revoke execute on function public.exam_sheet(uuid) from public, anon;
grant execute on function public.exam_sheet(uuid) to authenticated;
revoke execute on function public.exam_question_stats(uuid) from public, anon;
grant execute on function public.exam_question_stats(uuid) to authenticated;

-- A passage is read and removed directly by the exam officers (by policy); its wording, its
-- section and its picture go through rpc/save_exam_passage, as a question's do.
revoke all on public.exam_passages from anon, authenticated;
grant select, delete on public.exam_passages to authenticated;
grant all on public.exam_passages to service_role;
