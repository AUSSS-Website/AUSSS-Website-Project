-- Phase 8: the exchange exam.
--
-- Until now the site had no part in the exchange team's exam. It moves onto the site: about 400
-- registered students sit it on their phones in a hall, at a hidden address /exam/<word> with a
-- Google sign-in of its own, and the database marks it. The SCOPE and SCORE officers and the
-- Executive Board (the "exam officers") set it up and read the results on the portal's Exam
-- page.
--
--   profiles.student_id   a taker's student ID as they typed it; written only by
--                         rpc/exam_save_details, never by the row's owner directly
--   exams                 one exam: its title, the hidden last word of its address, whether
--                         students may come in (draft or ready), the window in which a student
--                         may start, its length in minutes, and the start code read out in the
--                         hall
--   exam_questions        the questions as the officers wrote them, each with 2 to 6 options
--   exam_key              the right answer of each question, in a table of its own so that
--                         nothing that reads a question can carry it along
--   exam_registrations    the student IDs that may sit, uploaded by the officers, and the
--                         account that holds each one; IDs are compared after tidying
--                         (student_key), so a typing habit locks nobody out
--   exam_attempts         one per taker per exam: when they started, when they handed in, and
--                         the order of the questions and of each question's options, which is
--                         theirs alone
--   exam_answers          one row per question a taker answered or flagged
--   app.exam_tries        wrong student IDs and wrong start codes, kept only to limit them
--
-- Who writes: the exam officers (app.is_exam_officer). They read all six tables. An exam's own
-- row they write directly; they also reorder and remove questions and remove IDs directly. The
-- wording of a question, its key and new IDs go through RPCs, which check them.
--
-- A taker's account matches no policy on any of these tables. It reaches its own rows through
-- five RPCs and nothing else: exam_door (what to show), exam_save_details (name, year, phone
-- and student ID, and the check against the list), exam_start (the start code), exam_paper (the
-- questions in this taker's order, without the key) and exam_save (answers, the heartbeat and
-- the hand-in). None of them returns the key, a grade, or which answers were right.
--
-- The clock is the database's, and each taker has their own. A taker's time runs from the moment
-- they start, for the exam's full length (app.exam_deadline). The opening and closing times only
-- say when a student may start: closing never cuts short a paper that is running.
--
-- Nothing is marked or stored as a result. A grade is the count of a taker's answers that match
-- the key, counted when the officers read it, and an attempt is over when it was handed in or
-- its deadline has passed. So correcting a right answer or lengthening the exam needs no
-- re-marking: the next read is simply different.
--
-- Once the first student has started, the exam is fixed where it matters: its opening time, the
-- word in its address, and the wording, options and number of its questions. It can still be
-- made longer, its closing time can move either way, the start code can change at any moment,
-- and a wrong key can be corrected. A start and a change to one of the fixed things take turns
-- on the exam's row, so the very first start and an officer's edit cannot each miss the other.
--
-- The list, the attempts and the answers are deleted when the exam's term ends (the next
-- migration); the exam, its questions and its key stay.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A student ID as it is compared: Arabic-Indic (U+0660 to U+0669), Persian (U+06F0 to U+06F9)
-- and full-width (U+FF10 to U+FF19) digits read as Western ones; whitespace, characters that
-- cannot be seen, and the separators - . _ / \ and every kind of dash dropped; letters in upper
-- case. '' when nothing is left. The same ID typed in Arabic numerals with a space, or with a
-- hyphen, is one ID, and so is one pasted from a chat or a document, which often wraps a number
-- in marks nobody can see (U+202A ... U+202C) or turns its hyphen into a dash. Used in a
-- generated column, so every role that writes that table needs execute on it.
create or replace function app.tidy_student_id(p_id text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- translate() maps the first thirty characters of its list (the three sets of digits) to
  -- Western digits and drops the rest of it. The spaces and the invisible characters are named
  -- one by one, because which of them \s knows depends on the database's locale; \s then takes
  -- the plain ones (space, tab, line break).
  select upper(
    regexp_replace(
      translate(
        coalesce(p_id, ''),
        -- digits: Arabic-Indic, Persian, full-width
        U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669'
          || U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9'
          || U&'\FF10\FF11\FF12\FF13\FF14\FF15\FF16\FF17\FF18\FF19'
          -- spaces: no-break, the typographic ones (U+2000 to U+200A), line and paragraph
          -- separators, narrow no-break, ideographic
          || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'
          -- invisible: soft hyphen, zero-width characters, direction marks and their
          -- embeddings and isolates, word joiner, byte order mark
          || U&'\00AD\061C\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2066\2067\2068\2069\FEFF'
          -- separators: - . _ / \ then the dashes (U+2010 to U+2015) and the minus sign
          || U&'-._/\\\2010\2011\2012\2013\2014\2015\2212',
        '012345678901234567890123456789'
      ),
      '\s+', '', 'g'
    )
  )
$$;

-- The exam officers: the EB (which includes the webmaster) and the officers of SCOPE and SCORE.
create or replace function app.is_exam_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb()
    or coalesce(app.is_officer_of(app.committee_id_by_slug('scope')), false)
    or coalesce(app.is_officer_of(app.committee_id_by_slug('score')), false)
$$;

-- When a taker's time is up: the exam's length after they started. Every taker has the full
-- length on a clock of their own, so the exam's closing time plays no part in it (the webmaster,
-- 2026-10-10). The interval is in minutes only, so no time zone comes into the sum.
create or replace function app.exam_deadline(p_started timestamptz, p_minutes int)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_started + make_interval(mins => p_minutes)
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- No update grant on this column for the row's owner: once it has matched an exam's list it
-- may not change, and only rpc/exam_save_details knows whether it has.
alter table public.profiles add column if not exists student_id text null;
alter table public.profiles drop constraint if exists profiles_student_id_len;
alter table public.profiles
  add constraint profiles_student_id_len check (student_id is null or length(student_id) between 1 and 40);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  -- the term it is sat in: filled by the trigger, and what the rollover clears the exam by
  term_id uuid not null references public.terms (id) on delete restrict,
  title text not null,
  -- the hidden last part of /exam/<word>. The site's code is public, so the word lives here,
  -- where no taker's account can read it, and the officers can change it.
  address_word text not null unique,
  -- 'ready' means students may sign in, give their details and have their ID checked
  status text not null default 'draft',
  -- the window in which a student may start
  opens_at timestamptz null,
  closes_at timestamptz null,
  minutes int not null default 120,
  -- read out in the hall; stored tidied (upper case, no whitespace); '' until the officers set it
  start_code text not null default '',
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exams_title_len check (length(title) between 1 and 140),
  constraint exams_word_shape check (
    address_word ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(address_word) between 6 and 60
    and address_word <> 'callback'
  ),
  constraint exams_status check (status in ('draft', 'ready')),
  constraint exams_minutes check (minutes between 5 and 600),
  constraint exams_start_code_len check (length(start_code) <= 40),
  constraint exams_window check (opens_at is null or closes_at is null or closes_at > opens_at),
  constraint exams_ready_window check (
    status <> 'ready' or (opens_at is not null and closes_at is not null)
  )
);

create index if not exists exams_term_id_idx on public.exams (term_id);
create index if not exists exams_created_by_idx on public.exams (created_by);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  -- the officers' order; every taker gets an order of their own (exam_attempts.question_order)
  sort int not null default 0,
  body text not null,
  -- an array of 2 to 6 strings, in the order the officers wrote them
  options jsonb not null,
  -- for a question whose last option is 'All of the above': its options are not shuffled
  keep_option_order boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_questions_body_len check (length(body) between 1 and 2000),
  constraint exam_questions_options check (
    case when jsonb_typeof(options) = 'array' then jsonb_array_length(options) between 2 and 6
         else false end
  )
);

create index if not exists exam_questions_exam_sort_idx on public.exam_questions (exam_id, sort);

create table if not exists public.exam_key (
  question_id uuid primary key references public.exam_questions (id) on delete cascade,
  -- 0-based, into the question's options as the officers wrote them
  correct_option int not null,
  updated_at timestamptz not null default now(),
  constraint exam_key_option check (correct_option between 0 and 5)
);

create table if not exists public.exam_registrations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  -- as the officers typed it
  student_id text not null,
  -- stored, so a later change to app.tidy_student_id must also write the rows again
  -- (update ... set student_id = student_id) for the keys to follow it
  student_key text generated always as (app.tidy_student_id(student_id)) stored,
  -- the account that holds this ID, from the moment its details matched. A deleted account
  -- leaves the ID free and claimed_at as it was, so no check ties the two together.
  profile_id uuid null references public.profiles (id) on delete set null,
  claimed_at timestamptz null,
  added_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint exam_registrations_student_id_len check (length(student_id) between 1 and 40),
  constraint exam_registrations_student_key check (student_key <> ''),
  constraint exam_registrations_exam_key unique (exam_id, student_key)
);

-- one ID for each account in an exam
create unique index if not exists exam_registrations_exam_profile_key
  on public.exam_registrations (exam_id, profile_id) where profile_id is not null;
create index if not exists exam_registrations_profile_id_idx on public.exam_registrations (profile_id);
create index if not exists exam_registrations_added_by_idx on public.exam_registrations (added_by);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- the ID as it is on the list, copied at the start
  student_id text not null,
  started_at timestamptz not null default now(),
  -- set only when the taker hands in; an attempt whose time ran out keeps it null
  submitted_at timestamptz null,
  -- every question of the exam, in this taker's order
  question_order uuid[] not null,
  -- { "<question id>": [2, 0, 3, 1], ... }: the position shown to this taker gives the
  -- officers' index
  option_orders jsonb not null default '{}'::jsonb,
  constraint exam_attempts_exam_profile_key unique (exam_id, profile_id)
);

create index if not exists exam_attempts_profile_id_idx on public.exam_attempts (profile_id);

create table if not exists public.exam_answers (
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  question_id uuid not null references public.exam_questions (id) on delete cascade,
  -- the officers' index; null for a question that is flagged but not answered, or cleared
  chosen_option int null,
  flagged boolean not null default false,
  -- moves only when the chosen option changes
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  constraint exam_answers_option check (chosen_option is null or chosen_option between 0 and 5)
);

create index if not exists exam_answers_question_id_idx on public.exam_answers (question_id);

-- Wrong tries, for the limits only: 'id' is a student ID that was not on the list or was held
-- by another account, 'code' a wrong start code. No API role reads or writes it.
create table if not exists app.exam_tries (
  id bigint generated always as identity primary key,
  exam_id uuid not null references public.exams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('id', 'code')),
  at timestamptz not null default now()
);

create index if not exists exam_tries_lookup_idx on app.exam_tries (exam_id, profile_id, kind, at);
create index if not exists exam_tries_profile_id_idx on app.exam_tries (profile_id);

alter table app.exam_tries enable row level security;
revoke all on app.exam_tries from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- Tidies what the officers typed and guards the exam.
--   * A new exam with no word in its address gets a random one.
--   * created_by is always the caller and the term is the current one; neither changes later.
--     One thing may still empty created_by: the deletion of its author's account. The foreign
--     key's "set null" is itself an update of this row, and putting the old value back would
--     leave the exam pointing at a profile that is gone.
--   * Once any student has started, the exam is fixed where it matters: its opening time and
--     the word in its address stay, it cannot go back to a draft, and it can be made longer
--     but not shorter. Those refusals come before the plain ones, because they say why. The
--     closing time is not among them: it only says who may still start, and it moves either
--     way at any time.
--   * A change to one of those fixed things first takes the exam's row for itself. That waits
--     for a start that is under way (rpc/exam_start holds the row while it builds a paper), so
--     the change either lands before the paper is built or finds the attempt and is refused.
--   * Only an exam officer is told that a word is taken. This trigger runs before row-level
--     security does, so for anyone else that sentence would say which words exist, a draft's
--     too; they are refused by row-level security instead, and the unique constraint holds for
--     every writer.
create or replace function app.normalize_exam()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := left(btrim(coalesce(new.title, '')), 140);
  if new.title = '' then
    raise exception 'An exam needs a title.' using errcode = '22023';
  end if;
  new.address_word := lower(btrim(coalesce(new.address_word, '')));
  if tg_op = 'INSERT' and new.address_word = '' then
    new.address_word := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;
  new.start_code := upper(regexp_replace(coalesce(new.start_code, ''), '\s+', '', 'g'));

  if tg_op = 'UPDATE' then
    new.term_id := old.term_id;
    -- the author stays; only "on delete set null" empties it
    if new.created_by is not null then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    if new.opens_at is distinct from old.opens_at
       or new.minutes is distinct from old.minutes
       or new.status is distinct from old.status
       or new.address_word is distinct from old.address_word then
      -- waits for a start that is under way, so that the check below sees its attempt
      perform 1 from public.exams e where e.id = old.id for update;
      if exists (select 1 from public.exam_attempts a where a.exam_id = old.id) then
        if new.opens_at is distinct from old.opens_at then
          raise exception 'The exam has started: its opening time cannot change.' using errcode = '22023';
        end if;
        if new.minutes < old.minutes then
          raise exception 'The exam has started: it can be made longer, not shorter.' using errcode = '22023';
        end if;
        if old.status = 'ready' and new.status is distinct from 'ready' then
          raise exception 'The exam has started: it cannot go back to a draft.' using errcode = '22023';
        end if;
        if new.address_word is distinct from old.address_word then
          raise exception 'The exam has started: the word in its address cannot change.' using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  if new.address_word !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(new.address_word) not between 6 and 60 then
    raise exception 'The word in the address needs 6 to 60 lower-case letters, digits or hyphens.'
      using errcode = '22023';
  end if;
  -- /exam/callback is where the sign-in comes back to
  if new.address_word = 'callback' then
    raise exception 'That word is reserved. Choose another.' using errcode = '22023';
  end if;
  -- said to an exam officer only; anyone else goes on to row-level security's refusal
  if app.is_exam_officer()
     and exists (select 1 from public.exams e where e.address_word = new.address_word and e.id <> new.id) then
    raise exception 'Another exam already uses that word. Choose another.' using errcode = '23505';
  end if;
  if length(new.start_code) > 40 then
    raise exception 'The start code can have at most 40 characters.' using errcode = '22023';
  end if;
  if new.minutes is null or new.minutes not between 5 and 600 then
    raise exception 'The exam''s length must be between 5 and 600 minutes.' using errcode = '22023';
  end if;
  if new.opens_at is not null and new.closes_at is not null and new.closes_at <= new.opens_at then
    raise exception 'The exam must close after it opens.' using errcode = '22023';
  end if;
  if new.status = 'ready' and (new.opens_at is null or new.closes_at is null) then
    raise exception 'Set when the exam opens and closes before making it ready.' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.term_id := coalesce(new.term_id, app.current_term_id());
    if new.term_id is null then
      raise exception 'There is no current term.' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- Tidies a question and locks it once the exam has started: every taker's paper is built from
-- the questions as they stood at the first start, so from then on none may be added, removed or
-- reworded. Its place in the officers' order may still change, and so may its key (exam_key).
-- A delete that comes from the exam itself being deleted passes: the exam's row is already
-- gone when the cascade reaches its questions.
-- Before it asks whether the exam has started, a change to the paper takes the exam's row for
-- itself. That waits for a start that is under way (rpc/exam_start holds the row while it builds
-- a paper), so the change either lands before the paper is built or finds the attempt and is
-- refused; a paper never lacks a question the exam has, or holds one it has not.
create or replace function app.normalize_exam_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_options jsonb;
  v_bad boolean;
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

  new.body := btrim(coalesce(new.body, ''));
  if new.body = '' or length(new.body) > 2000 then
    raise exception 'A question needs its text.' using errcode = '22023';
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

  if tg_op = 'UPDATE' then
    new.exam_id := old.exam_id;
    new.created_at := old.created_at;
    v_changes_paper := new.body is distinct from old.body
      or new.options is distinct from old.options
      or new.keep_option_order is distinct from old.keep_option_order;
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

-- The right answer must be one of the question's options.
create or replace function app.guard_exam_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' then
    new.question_id := old.question_id;
  end if;
  select jsonb_array_length(q.options) into v_count
  from public.exam_questions q
  where q.id = new.question_id;
  -- a question that is not there is the foreign key's to refuse
  if found and (new.correct_option is null or new.correct_option < 0 or new.correct_option >= v_count) then
    raise exception 'Choose which option is right.' using errcode = '22023';
  end if;
  return new;
end
$$;

-- An ID stays on the list once the account that holds it has started: the attempt carries it.
-- A delete that comes from the exam itself being deleted passes, as for the questions.
create or replace function app.guard_exam_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.profile_id is null then
    return old;
  end if;
  if not exists (select 1 from public.exams e where e.id = old.exam_id) then
    return old;
  end if;
  if exists (
    select 1 from public.exam_attempts a
    where a.exam_id = old.exam_id and a.profile_id = old.profile_id
  ) then
    raise exception 'This student has already started the exam, so the ID stays on the list.'
      using errcode = '22023';
  end if;
  return old;
end
$$;

drop trigger if exists normalize_exam on public.exams;
create trigger normalize_exam before insert or update on public.exams
  for each row execute function app.normalize_exam();
drop trigger if exists set_updated_at on public.exams;
create trigger set_updated_at before update on public.exams
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.exams;
create trigger audit after insert or update or delete on public.exams
  for each row execute function app.audit();

drop trigger if exists normalize_exam_question on public.exam_questions;
create trigger normalize_exam_question before insert or update or delete on public.exam_questions
  for each row execute function app.normalize_exam_question();
drop trigger if exists set_updated_at on public.exam_questions;
create trigger set_updated_at before update on public.exam_questions
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.exam_questions;
create trigger audit after insert or update or delete on public.exam_questions
  for each row execute function app.audit();

-- The key has no `id`, so the audit log's row_id is empty for it; the question's id is in the
-- entry's before and after.
drop trigger if exists guard_exam_key on public.exam_key;
create trigger guard_exam_key before insert or update on public.exam_key
  for each row execute function app.guard_exam_key();
drop trigger if exists set_updated_at on public.exam_key;
create trigger set_updated_at before update on public.exam_key
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.exam_key;
create trigger audit after insert or update or delete on public.exam_key
  for each row execute function app.audit();

drop trigger if exists guard_exam_registration on public.exam_registrations;
create trigger guard_exam_registration before delete on public.exam_registrations
  for each row execute function app.guard_exam_registration();

-- No audit trigger on exam_registrations, exam_attempts or exam_answers, on purpose. Their rows
-- are deleted when the term ends, and the audit log would keep the student IDs and the answers
-- after that; answers are also written hundreds of times a minute during a sitting. The two
-- officer actions on them that matter (releasing an ID, deleting an attempt) each write one
-- slim row to audit_log from their RPC, with no student ID and no answers in it.

-- ---------------------------------------------------------------------------------------------
-- The exam behind an address
-- ---------------------------------------------------------------------------------------------

-- The ready exam whose address ends in that word; a null row when there is none, which is also
-- what a draft looks like from outside. Only the takers' RPCs call it.
create or replace function app.exam_by_word(p_word text)
returns public.exams
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
  from public.exams e
  where e.address_word = lower(btrim(p_word)) and e.status = 'ready'
$$;

-- ---------------------------------------------------------------------------------------------
-- The takers' RPCs. p_word is the last part of the address. Each reads only the caller's own
-- rows, and none returns the key, a grade, or which answers were right.
-- ---------------------------------------------------------------------------------------------

-- rpc/exam_door(word): everything the page needs to decide what to show. { exam: null } when
-- no ready exam has that word. `phase` is about starting only: 'closed' says that nobody else
-- may start, and a paper that is already running shows beside it as an attempt that is not over.
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
        'over', v_attempt.submitted_at is not null or v_now >= v_deadline
      )
    end,
    'now', v_now
  );
end
$$;

-- rpc/exam_save_details(word, name, year, phone, student ID): saves the taker's details to
-- their profile and checks the ID against the exam's list. The answer says how the check went:
--   held        the ID is on the list and belongs to this account
--   taken       it is on the list, held by another account
--   not_listed  it is not on the list
--   locked      10 or more misses from this account for this exam in the last hour; the list
--               is not looked at while locked
-- A miss is returned and not raised, because a raise would undo the try it has just recorded.
-- No taker can read the list: an account learns only whether its own ID is on it.
create or replace function public.exam_save_details(
  p_word text,
  p_full_name text,
  p_faculty_year text,
  p_phone text,
  p_student_id text
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
  v_name text := btrim(coalesce(p_full_name, ''));
  v_year text := btrim(coalesce(p_faculty_year, ''));
  -- Arabic-Indic and Persian digits read as Western ones
  v_phone text := btrim(translate(
    coalesce(p_phone, ''),
    U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
    '01234567890123456789'
  ));
  v_typed text := btrim(coalesce(p_student_id, ''));
  v_key text := app.tidy_student_id(p_student_id);
  v_holder uuid;
  v_result text;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'Enter your full name.' using errcode = '22023';
  end if;
  if v_year = '' or length(v_year) > 40 then
    raise exception 'Choose your year.' using errcode = '22023';
  end if;
  if length(v_phone) > 30 or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'Enter a phone number we can reach you on.' using errcode = '22023';
  end if;
  if v_key = '' or length(v_typed) > 40 then
    raise exception 'Enter your student ID.' using errcode = '22023';
  end if;
  -- an ID that has matched a list is this account's for good; an officer can release it
  if exists (
    select 1 from public.exam_registrations r
    where r.profile_id = v_uid and r.student_key <> v_key
  ) then
    raise exception 'Your student ID is confirmed and cannot be changed here. Ask an exchange officer if it is wrong.'
      using errcode = '22023';
  end if;

  -- only when something differs, so a second tap leaves no entry in the audit log
  update public.profiles p
     set full_name = v_name, faculty_year = v_year, phone = v_phone, student_id = v_typed
   where p.id = v_uid
     and (p.full_name, p.faculty_year, p.phone, p.student_id)
         is distinct from (v_name, v_year, v_phone, v_typed);

  if exists (
    select 1 from public.exam_registrations r
    where r.exam_id = v_exam.id and r.profile_id = v_uid
  ) then
    v_result := 'held';
  elsif (
    select count(*) from app.exam_tries t
    where t.exam_id = v_exam.id and t.profile_id = v_uid and t.kind = 'id'
      and t.at > v_now - interval '1 hour'
  ) >= 10 then
    v_result := 'locked';
  else
    -- takes the row only while nobody holds it, so two accounts cannot both win
    update public.exam_registrations r
       set profile_id = v_uid, claimed_at = v_now
     where r.exam_id = v_exam.id and r.student_key = v_key and r.profile_id is null;
    if found then
      v_result := 'held';
    else
      select r.profile_id into v_holder
      from public.exam_registrations r
      where r.exam_id = v_exam.id and r.student_key = v_key;
      if not found then
        v_result := 'not_listed';
      elsif v_holder = v_uid then
        -- a second tap that arrived while the first was taking the row
        v_result := 'held';
      else
        v_result := 'taken';
      end if;
    end if;
    if v_result <> 'held' then
      insert into app.exam_tries (exam_id, profile_id, kind) values (v_exam.id, v_uid, 'id');
    end if;
  end if;

  return jsonb_build_object(
    'registration', v_result,
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
    )
  );
end
$$;

-- rpc/exam_start(word, code): starts the caller's attempt, or says why not.
-- { ok: true, attempt_id } or { ok: false, reason }, checked in this order:
--   (already started)  ok, with no code asked: this is how a refresh carries on
--   not_registered     the account holds no ID on the list
--   details            its profile lacks a name, year, phone or student ID
--   not_open, closed   outside the window in which a student may start
--   not_ready          the exam has no questions, or no start code yet
--   locked             8 or more wrong codes from this account in the last 10 minutes
--   code               a wrong code, with tries_left; returned and not raised, so the try stays
-- The attempt fixes this taker's order: every question in random order, and each question's
-- options in a random order unless it keeps its own.
-- A call that goes past the first check holds two rows to its end, the exam's first and then
-- the caller's own line of the list:
--   * the exam's (a key-share lock: the one the attempt's foreign key takes anyway, only
--     earlier; 400 starts hold it together, and an update of the start code or of the closing
--     time alone does not wait for it). An officer's change to the questions or to the exam's
--     fixed things, and the rollover's clearing, take that row for themselves, so each waits
--     for this start or this start for it, and the exam is read again once the row is held.
--     A start lasts a few milliseconds, so nobody waits for longer than that.
--   * the line of the list, so a release or a removal of the ID waits and then finds the
--     attempt, and calls from one account take turns, which keeps the count of wrong codes exact.
create or replace function public.exam_start(p_word text, p_code text)
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

  select array_agg(q.id order by random()) into v_order
  from public.exam_questions q
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
  insert into public.exam_attempts (exam_id, profile_id, student_id, started_at, question_order, option_orders)
  values (v_exam.id, v_uid, v_listed, v_now, v_order, v_options)
  on conflict (exam_id, profile_id) do nothing;

  select a.id into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end
$$;

-- rpc/exam_paper(word): the caller's paper. The questions come in this taker's order, each with
-- its options in this taker's order, and an answer's `c` is the position as shown to them.
-- Nothing here names the key or the officers' order. Once the attempt is over it returns
-- { state: 'over', submitted } and no question.
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
    'exam', jsonb_build_object('title', v_exam.title, 'minutes', v_exam.minutes),
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'started_at', v_attempt.started_at,
      'deadline_at', v_deadline
    ),
    'now', v_now,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'body', q.body,
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

-- rpc/exam_save(word, answers, hand_in): saves answers as they are chosen, and hands in.
-- answers is [{ q: <question id>, c: <position as shown, or null>, f: <flagged> }, ...]; an
-- empty list is a heartbeat that returns the current deadline (the officers may have moved it).
-- Returns { state, submitted, saved, deadline_at, now }.
--   * An item is saved when its question is on this taker's paper and its position `c` is null
--     or one of that question's; anything else is skipped without a word and not counted. An
--     item with no `c` at all is skipped too: read as "no answer" it would wipe the answer
--     already saved. Items are read as text and checked before any cast, so a malformed one can
--     never raise and lose the rest of the batch. A question that appears twice takes its last
--     item.
--   * The exam's closing time is never looked at here: a paper started before it is saved until
--     its own deadline.
--   * Nothing is saved after a hand-in, or more than 30 seconds past the deadline. The 30
--     seconds let a save that was already on its way when the clock ran out still land.
--   * About 400 takers save at once, so a call is one read of the exam by its word, one of the
--     attempt, and one statement that writes. The attempt's row is locked for the length of
--     the call, so a hand-in and a late save cannot cross.
create or replace function public.exam_save(p_word text, p_answers jsonb, p_hand_in boolean default false)
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
      'state', 'over', 'submitted', true, 'saved', 0, 'deadline_at', v_deadline, 'now', v_now);
  end if;
  if v_now > v_deadline + interval '30 seconds' then
    return jsonb_build_object(
      'state', 'over', 'submitted', false, 'saved', 0, 'deadline_at', v_deadline, 'now', v_now);
  end if;

  if jsonb_array_length(p_answers) > 0 then
    insert into public.exam_answers as w (attempt_id, question_id, chosen_option, flagged, answered_at)
    select v_attempt.id, v.question_id, v.chosen, v.flagged, v_now
    from (
      select distinct on (o.question_id)
             o.question_id,
             -- the position shown to this taker, read back as the officers' index
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
      -- matched as text against the paper's own questions, so an id that is not one never
      -- reaches a cast
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
      'state', 'over', 'submitted', true, 'saved', v_saved, 'deadline_at', v_deadline, 'now', v_now);
  end if;

  return jsonb_build_object(
    'state', case when v_now >= v_deadline then 'over' else 'sitting' end,
    'submitted', false,
    'saved', v_saved,
    'deadline_at', v_deadline,
    'now', v_now
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The officers' RPCs. Each is for the exam officers alone.
-- ---------------------------------------------------------------------------------------------

-- rpc/save_exam_question(exam, question, body, options, correct, keep_order): adds a question
-- at the end (question null) or changes one, and writes its key with it. The triggers tidy and
-- refuse; after the exam has started only the right answer may differ.
create or replace function public.save_exam_question(
  p_exam uuid,
  p_question uuid,
  p_body text,
  p_options jsonb,
  p_correct int,
  p_keep_order boolean default false
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
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;

  if p_question is null then
    insert into public.exam_questions (exam_id, sort, body, options, keep_option_order)
    values (
      p_exam,
      (select coalesce(max(q.sort), 0) + 1 from public.exam_questions q where q.exam_id = p_exam),
      p_body, p_options, coalesce(p_keep_order, false)
    )
    returning id into v_id;
  else
    update public.exam_questions q
       set body = p_body, options = p_options, keep_option_order = coalesce(p_keep_order, false)
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

-- rpc/import_exam_questions(exam, rows): adds the questions of a spreadsheet after the last
-- one, in the order given: [{ body, options: [..], correct: 0, keep_order: false }, ...], 1 to
-- 500 rows. All or nothing: a bad row raises with its number ('Question 7: ...') and nothing
-- is added. Returns how many were added.
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
      -- a body or a right answer of the wrong kind reads as missing, and the triggers refuse it
      insert into public.exam_questions (exam_id, sort, body, options, keep_option_order)
      values (
        p_exam,
        v_last + v_n,
        case when jsonb_typeof(v_row -> 'body') = 'string' then v_row ->> 'body' end,
        v_row -> 'options',
        coalesce(v_row -> 'keep_order' = 'true'::jsonb, false)
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

-- rpc/exam_add_registrations(exam, ids): puts student IDs on the exam's list, at most 5000 a
-- call. Returns { added, already, invalid }: invalid are empty once tidied or longer than 40
-- characters; already are on the list, or a second time in this upload.
create or replace function public.exam_add_registrations(p_exam uuid, p_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_invalid int;
  v_added int;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_ids), 0) > 5000 then
    raise exception 'Add at most 5000 IDs at a time.' using errcode = '22023';
  end if;

  -- each ID once, in its first spelling, so no row of the list is touched twice
  with given as (
    select u.pos, btrim(coalesce(u.id, '')) as typed, app.tidy_student_id(u.id) as key
    from unnest(coalesce(p_ids, '{}'::text[])) with ordinality as u(id, pos)
  ),
  good as (
    select distinct on (g.key) g.typed
    from given g
    where g.key <> '' and length(g.typed) <= 40
    order by g.key, g.pos
  ),
  added as (
    insert into public.exam_registrations (exam_id, student_id, added_by)
    select p_exam, g.typed, v_uid from good g
    on conflict (exam_id, student_key) do nothing
    returning 1
  )
  select (select count(*) from given)::int,
         (select count(*) from given g where g.key = '' or length(g.typed) > 40)::int,
         (select count(*) from added)::int
    into v_total, v_invalid, v_added;

  return jsonb_build_object(
    'added', v_added,
    'already', v_total - v_invalid - v_added,
    'invalid', v_invalid
  );
end
$$;

-- rpc/exam_release_registration(registration): frees an ID from the account that holds it, for
-- a student who signed in with the wrong account. Refused once that account has started. The
-- audit log gets one slim row: which exam and which account, no student ID.
create or replace function public.exam_release_registration(p_registration uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exam_registrations%rowtype;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select r.* into v_row from public.exam_registrations r where r.id = p_registration for update;
  if not found then
    raise exception 'That ID is not there any more.' using errcode = '22023';
  end if;
  if v_row.profile_id is null then
    return;
  end if;
  if exists (
    select 1 from public.exam_attempts a
    where a.exam_id = v_row.exam_id and a.profile_id = v_row.profile_id
  ) then
    raise exception 'This student has already started the exam.' using errcode = '22023';
  end if;

  update public.exam_registrations r
     set profile_id = null, claimed_at = null
   where r.id = p_registration;
  insert into public.audit_log (actor, table_name, row_id, action, before, after)
  values (
    v_uid, 'exam_registrations', p_registration::text, 'RELEASE',
    jsonb_build_object('exam_id', v_row.exam_id, 'profile_id', v_row.profile_id),
    null
  );
end
$$;

-- rpc/exam_registration_list(exam): the list in the order of the tidied IDs, each with the
-- account that holds it (name and email) and whether that account has started. The name is the
-- holder's profile as it reads now, cut to the length rpc/exam_save_details allows: a profile's
-- owner can also write it directly, where no length is checked.
create or replace function public.exam_registration_list(p_exam uuid)
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

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'student_id', r.student_id,
        'created_at', r.created_at,
        'claimed_at', r.claimed_at,
        'holder', case
          when r.profile_id is null then null
          else jsonb_build_object(
            'profile_id', r.profile_id,
            'full_name', left(btrim(p.full_name), 120),
            'email', p.email
          )
        end,
        'started', a.id is not null
      )
      order by r.student_key, r.id
    )
    from public.exam_registrations r
    left join public.profiles p on p.id = r.profile_id
    left join public.exam_attempts a on a.exam_id = r.exam_id and a.profile_id = r.profile_id
    where r.exam_id = p_exam
  ), '[]'::jsonb);
end
$$;

-- One row per attempt of an exam (or the one attempt asked for), marked as it stands now:
--   state        handed_in, timed_out (the deadline passed and it was never handed in), sitting
--   finished_at  when it was handed in, else the deadline once that has passed
--   seconds      from the start to finished_at; null while sitting
--   answered     answers with an option chosen
--   score        answers whose option is the key's
-- Nothing is stored: a corrected key or a longer exam shows in the next read. Called only by
-- the officers' RPCs below.
-- The name, year and phone are the taker's profile as it reads now, each cut to the length
-- rpc/exam_save_details allows: a profile's owner can also write those three directly, where no
-- length is checked, and every read of the results carries them for every paper. What ties a
-- paper to a student is the ID from the list, copied at the start, and the account's email;
-- neither can be changed by the taker.
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
  seconds int
)
language sql
stable
set search_path = ''
as $$
  with sat as (
    select a.id, a.profile_id, a.student_id, a.started_at, a.submitted_at,
           app.exam_deadline(a.started_at, e.minutes) as deadline_at
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    where a.exam_id = p_exam and (p_attempt is null or a.id = p_attempt)
  ),
  marks as (
    select w.attempt_id,
           count(w.chosen_option)::int as answered,
           (count(*) filter (where w.chosen_option = k.correct_option))::int as score
    from public.exam_answers w
    join sat s on s.id = w.attempt_id
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
         coalesce(m.score, 0),
         round(extract(epoch from (f.finished_at - s.started_at)))::int
  from sat s
  join public.profiles p on p.id = s.profile_id
  left join marks m on m.attempt_id = s.id
  cross join lateral (
    select coalesce(s.submitted_at, case when now() >= s.deadline_at then s.deadline_at end) as finished_at
  ) f
$$;

-- rpc/exam_results(exam): the ranking. Highest score first, takers on the same score in the
-- alphabetical order of their names; `rank` is shared by equal scores.
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
    'now', now(),
    'attempts', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.score desc, lower(r.full_name), r.attempt_id)
      from (
        select x.*, (rank() over (order by x.score desc))::int as rank
        from app.exam_result_rows(p_exam) x
      ) r
    ), '[]'::jsonb)
  );
end
$$;

-- rpc/exam_sheet(attempt): one taker's paper for the officers: their details and marks, then
-- every question of the exam in the officers' order with the right option and the chosen one,
-- both as the officers' index. `chosen` is null where the taker gave no answer.
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
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select a.exam_id into v_exam from public.exam_attempts a where a.id = p_attempt;
  if not found then
    raise exception 'That paper is not there any more.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempt', (select to_jsonb(r) from app.exam_result_rows(v_exam, p_attempt) r),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'n', q.n,
          'question_id', q.id,
          'body', q.body,
          'options', q.options,
          'correct', k.correct_option,
          'chosen', w.chosen_option,
          'flagged', coalesce(w.flagged, false),
          'answered_at', w.answered_at
        )
        order by q.n
      )
      from (
        select x.id, x.body, x.options,
               (row_number() over (order by x.sort, x.created_at, x.id))::int as n
        from public.exam_questions x
        where x.exam_id = v_exam
      ) q
      left join public.exam_key k on k.question_id = q.id
      left join public.exam_answers w on w.attempt_id = p_attempt and w.question_id = q.id
    ), '[]'::jsonb)
  );
end
$$;

-- rpc/exam_question_stats(exam): for each question, in the officers' order, how many takers
-- answered it, how many got it right, and how many chose each option (counts[i] is option i).
-- Every attempt counts, finished or not.
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
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'question_id', q.id,
          'n', q.n,
          'body', q.body,
          'options', q.options,
          'correct', k.correct_option,
          'answered', s.answered,
          'right', s.right_ones,
          'counts', (
            select jsonb_agg(s.chosen -> g.i order by g.i)
            from generate_series(0, jsonb_array_length(q.options) - 1) as g(i)
          )
        )
        order by q.n
      )
      from (
        select x.id, x.body, x.options,
               (row_number() over (order by x.sort, x.created_at, x.id))::int as n
        from public.exam_questions x
        where x.exam_id = p_exam
      ) q
      left join public.exam_key k on k.question_id = q.id
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
        where w.question_id = q.id
      ) s
    ), '[]'::jsonb)
  );
end
$$;

-- rpc/exam_delete_attempt(attempt): removes a taker's attempt and its answers; the student may
-- then start again. The audit log gets one slim row: which exam, which account and when, no
-- student ID and no answers.
create or replace function public.exam_delete_attempt(p_attempt uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exam_attempts%rowtype;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select a.* into v_row from public.exam_attempts a where a.id = p_attempt for update;
  if not found then
    raise exception 'That paper is not there any more.' using errcode = '22023';
  end if;

  delete from public.exam_attempts a where a.id = p_attempt;
  insert into public.audit_log (actor, table_name, row_id, action, before, after)
  values (
    v_uid, 'exam_attempts', p_attempt::text, 'DELETE',
    jsonb_build_object(
      'exam_id', v_row.exam_id,
      'profile_id', v_row.profile_id,
      'started_at', v_row.started_at,
      'submitted_at', v_row.submitted_at
    ),
    null
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: the exam officers only. A taker's account matches no policy here and
-- reaches its own rows through the RPCs above; anon holds no grant on these tables at all.
-- ---------------------------------------------------------------------------------------------

alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_key enable row level security;
alter table public.exam_registrations enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;

drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using ((select app.is_exam_officer()));
drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams
  for insert to authenticated
  with check ((select app.is_exam_officer()));
drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams
  for update to authenticated
  using ((select app.is_exam_officer()))
  with check ((select app.is_exam_officer()));
drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams
  for delete to authenticated
  using ((select app.is_exam_officer()));

-- The officers reorder and remove questions directly; wording, options and the key change
-- through rpc/save_exam_question.
drop policy if exists exam_questions_select on public.exam_questions;
create policy exam_questions_select on public.exam_questions
  for select to authenticated
  using ((select app.is_exam_officer()));
drop policy if exists exam_questions_update on public.exam_questions;
create policy exam_questions_update on public.exam_questions
  for update to authenticated
  using ((select app.is_exam_officer()))
  with check ((select app.is_exam_officer()));
drop policy if exists exam_questions_delete on public.exam_questions;
create policy exam_questions_delete on public.exam_questions
  for delete to authenticated
  using ((select app.is_exam_officer()));

drop policy if exists exam_key_select on public.exam_key;
create policy exam_key_select on public.exam_key
  for select to authenticated
  using ((select app.is_exam_officer()));

drop policy if exists exam_registrations_select on public.exam_registrations;
create policy exam_registrations_select on public.exam_registrations
  for select to authenticated
  using ((select app.is_exam_officer()));
drop policy if exists exam_registrations_delete on public.exam_registrations;
create policy exam_registrations_delete on public.exam_registrations
  for delete to authenticated
  using ((select app.is_exam_officer()));

drop policy if exists exam_attempts_select on public.exam_attempts;
create policy exam_attempts_select on public.exam_attempts
  for select to authenticated
  using ((select app.is_exam_officer()));

drop policy if exists exam_answers_select on public.exam_answers;
create policy exam_answers_select on public.exam_answers
  for select to authenticated
  using ((select app.is_exam_officer()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter function app.tidy_student_id(text) owner to postgres;
alter function app.is_exam_officer() owner to postgres;
alter function app.exam_deadline(timestamptz, int) owner to postgres;
alter function app.normalize_exam() owner to postgres;
alter function app.normalize_exam_question() owner to postgres;
alter function app.guard_exam_key() owner to postgres;
alter function app.guard_exam_registration() owner to postgres;
alter function app.exam_by_word(text) owner to postgres;
alter function app.exam_result_rows(uuid, uuid) owner to postgres;
alter function public.exam_door(text) owner to postgres;
alter function public.exam_save_details(text, text, text, text, text) owner to postgres;
alter function public.exam_start(text, text) owner to postgres;
alter function public.exam_paper(text) owner to postgres;
alter function public.exam_save(text, jsonb, boolean) owner to postgres;
alter function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean) owner to postgres;
alter function public.import_exam_questions(uuid, jsonb) owner to postgres;
alter function public.exam_add_registrations(uuid, text[]) owner to postgres;
alter function public.exam_release_registration(uuid) owner to postgres;
alter function public.exam_registration_list(uuid) owner to postgres;
alter function public.exam_results(uuid) owner to postgres;
alter function public.exam_sheet(uuid) owner to postgres;
alter function public.exam_question_stats(uuid) owner to postgres;
alter function public.exam_delete_attempt(uuid) owner to postgres;

-- the generated column runs as whoever writes the row
revoke execute on function app.tidy_student_id(text) from public;
grant execute on function app.tidy_student_id(text) to authenticated, service_role;
-- the policies call it
revoke execute on function app.is_exam_officer() from public;
grant execute on function app.is_exam_officer() to authenticated;
-- called only inside the RPCs and the triggers: no grant
revoke execute on function app.exam_deadline(timestamptz, int) from public;
revoke execute on function app.normalize_exam() from public;
revoke execute on function app.normalize_exam_question() from public;
revoke execute on function app.guard_exam_key() from public;
revoke execute on function app.guard_exam_registration() from public;
revoke execute on function app.exam_by_word(text) from public;
revoke execute on function app.exam_result_rows(uuid, uuid) from public;

-- Signed-in accounts only: a taker has an account before they reach the exam's door.
revoke execute on function public.exam_door(text) from public, anon;
grant execute on function public.exam_door(text) to authenticated;
revoke execute on function public.exam_save_details(text, text, text, text, text) from public, anon;
grant execute on function public.exam_save_details(text, text, text, text, text) to authenticated;
revoke execute on function public.exam_start(text, text) from public, anon;
grant execute on function public.exam_start(text, text) to authenticated;
revoke execute on function public.exam_paper(text) from public, anon;
grant execute on function public.exam_paper(text) to authenticated;
revoke execute on function public.exam_save(text, jsonb, boolean) from public, anon;
grant execute on function public.exam_save(text, jsonb, boolean) to authenticated;
revoke execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean) from public, anon;
grant execute on function public.save_exam_question(uuid, uuid, text, jsonb, int, boolean) to authenticated;
revoke execute on function public.import_exam_questions(uuid, jsonb) from public, anon;
grant execute on function public.import_exam_questions(uuid, jsonb) to authenticated;
revoke execute on function public.exam_add_registrations(uuid, text[]) from public, anon;
grant execute on function public.exam_add_registrations(uuid, text[]) to authenticated;
revoke execute on function public.exam_release_registration(uuid) from public, anon;
grant execute on function public.exam_release_registration(uuid) to authenticated;
revoke execute on function public.exam_registration_list(uuid) from public, anon;
grant execute on function public.exam_registration_list(uuid) to authenticated;
revoke execute on function public.exam_results(uuid) from public, anon;
grant execute on function public.exam_results(uuid) to authenticated;
revoke execute on function public.exam_sheet(uuid) from public, anon;
grant execute on function public.exam_sheet(uuid) to authenticated;
revoke execute on function public.exam_question_stats(uuid) from public, anon;
grant execute on function public.exam_question_stats(uuid) to authenticated;
revoke execute on function public.exam_delete_attempt(uuid) from public, anon;
grant execute on function public.exam_delete_attempt(uuid) to authenticated;

-- The officers write an exam's own columns; its id, term, authorship and timestamps are the
-- database's. Of a question they write only its place in the order, and they remove one; the
-- key, the attempts and the answers are written by the RPCs alone.
revoke all on public.exams, public.exam_questions, public.exam_key, public.exam_registrations,
              public.exam_attempts, public.exam_answers
  from anon, authenticated;
grant select on public.exams, public.exam_questions, public.exam_key, public.exam_registrations,
                public.exam_attempts, public.exam_answers
  to authenticated;
grant insert (title, address_word, status, opens_at, closes_at, minutes, start_code)
  on public.exams to authenticated;
grant update (title, address_word, status, opens_at, closes_at, minutes, start_code)
  on public.exams to authenticated;
grant delete on public.exams to authenticated;
grant update (sort) on public.exam_questions to authenticated;
grant delete on public.exam_questions to authenticated;
grant delete on public.exam_registrations to authenticated;
grant all on public.exams, public.exam_questions, public.exam_key, public.exam_registrations,
             public.exam_attempts, public.exam_answers
  to service_role;
