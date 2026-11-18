-- The exam: the exchange contracts, and each student's preferences among them.
--
-- A student who passes the exchange exam is matched to a contract: a place in another country,
-- under the professional exchange (SCOPE) or the research exchange (SCORE). The exchange team
-- sorts its contracts into three classes, A, B and C. Until now each student's wishes were
-- collected outside the site. They are now given at the exam's own address, after the student's
-- details and before the start code, and the officers read them beside the results.
--
--   exam_contracts                    one contract of an exam: its programme ('scope' or 'score'),
--                                     its class ('A', 'B' or 'C'), its country, how many
--                                     contracts there are of it (`places`, 1 unless the
--                                     officers say more) and a free note
--   exam_contract_picks               one row per contract a student chose, with its place in that
--                                     student's order; it hangs on the student's line of the
--                                     registered list, so it goes when that line goes
--   exam_registrations.chose_scope,   the sections the student said they will answer when they
--   exam_registrations.chose_score    saved their preferences; null in an exam with no choice
--   exam_registrations.preferences_at when they last saved them; null until they have
--
-- The rules of a student's preferences (the webmaster, 2026-11-18):
--   * in each programme, at most two contracts of Class A, at most two of Class B, and as many
--     of Class C as they like;
--   * they are in the student's order: a first and a second choice in A and in B, and Class C
--     from first to last. One list is stored (`place`); a contract's rank within its class is
--     its place among the student's picks of that programme and class;
--   * in an exam with two optional sections, the student first says which they will answer and
--     may choose only among the contracts of those programmes, at least one in each that has
--     any. The paper then sits exactly those sections at its start: rpc/exam_start takes them
--     from here and no longer from the page. In any other exam every contract is offered and at
--     least one must be chosen;
--   * they are given before the start code, and may change until the student starts. Once the
--     paper exists they are fixed. An exam with no contracts asks for nothing, as before.
--
-- A section can still be left out or added during the paper, as before (20261109120001). A
-- student who adds a section there has no preferences in it; the officers see that.
--
-- Who writes: the exam officers. They add contracts through rpc/import_exam_contracts (one or
-- many, all or nothing), and change or remove one directly. Until the first student starts,
-- anything may change; removing a contract takes it off the lists of the students who chose
-- it. A contract somebody has chosen keeps its programme and class, since the limits were
-- counted against them. Once the exam has started, contracts are neither added nor removed and
-- only a country's name, a note and the order may still change.
--
-- A taker reads the contracts through rpc/exam_preferences and writes their own through
-- rpc/exam_save_preferences, and only while they hold an ID on the exam's list. The officers
-- read everybody's through rpc/exam_preference_list.
--
-- The picks are a student's own data, like the list and the papers: they are deleted with the
-- registered list when the term ends (app.clear_exam_rows deletes the list, and the picks go
-- with their lines). The contracts stay with the exam, as its questions do. Releasing an ID
-- from an account clears that account's preferences.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table public.exam_registrations add column if not exists chose_scope boolean null;
alter table public.exam_registrations add column if not exists chose_score boolean null;
alter table public.exam_registrations add column if not exists preferences_at timestamptz null;

create table if not exists public.exam_contracts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  programme text not null,
  class text not null,
  country text not null,
  -- how many contracts there are of this one: how many students it can take
  places int not null default 1,
  -- anything else a student should know: the city, the months, a condition
  note text not null default '',
  -- the officers' order within a programme and a class
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_contracts_programme check (programme in ('scope', 'score')),
  constraint exam_contracts_class check (class in ('A', 'B', 'C')),
  constraint exam_contracts_country_len check (length(country) between 1 and 80),
  constraint exam_contracts_places check (places between 1 and 999),
  constraint exam_contracts_note_len check (length(note) <= 200)
);

create index if not exists exam_contracts_exam_idx
  on public.exam_contracts (exam_id, programme, class, sort);

create table if not exists public.exam_contract_picks (
  registration_id uuid not null references public.exam_registrations (id) on delete cascade,
  contract_id uuid not null references public.exam_contracts (id) on delete cascade,
  -- the pick's place in the student's whole list, from 1
  place int not null,
  primary key (registration_id, contract_id),
  constraint exam_contract_picks_place check (place between 1 and 500)
);

create index if not exists exam_contract_picks_contract_id_idx on public.exam_contract_picks (contract_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- How many contracts an exam has in each programme: { scope, score }.
create or replace function app.exam_contract_counts(p_exam uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'scope', (count(*) filter (where c.programme = 'scope'))::int,
    'score', (count(*) filter (where c.programme = 'score'))::int
  )
  from public.exam_contracts c
  where c.exam_id = p_exam
$$;

-- Whether the holder of a line of the list has given the preferences the exam asks for.
-- `p_scope` and `p_score` are the sections the paper sits in an exam with the choice, and both
-- null in an exam without it.
--   * an exam with no contracts asks for nothing;
--   * otherwise the preferences must have been saved, and
--   * with the choice: at least one section, and a pick in each chosen programme that has
--     contracts; without it: at least one pick.
-- Read at the door and again at the start, so a contract added or removed since the student
-- saved is counted as it stands now.
create or replace function app.exam_preferences_ok(
  p_exam uuid,
  p_registration uuid,
  p_scope boolean,
  p_score boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.exam_contracts c where c.exam_id = p_exam) then true
    when not exists (
      select 1 from public.exam_registrations r
      where r.id = p_registration and r.preferences_at is not null
    ) then false
    when p_scope is null and p_score is null then exists (
      select 1 from public.exam_contract_picks k where k.registration_id = p_registration
    )
    else
      (coalesce(p_scope, false) or coalesce(p_score, false))
      and (
        not coalesce(p_scope, false)
        or not exists (select 1 from public.exam_contracts c where c.exam_id = p_exam and c.programme = 'scope')
        or exists (
          select 1
          from public.exam_contract_picks k
          join public.exam_contracts c on c.id = k.contract_id
          where k.registration_id = p_registration and c.programme = 'scope'
        )
      )
      and (
        not coalesce(p_score, false)
        or not exists (select 1 from public.exam_contracts c where c.exam_id = p_exam and c.programme = 'score')
        or exists (
          select 1
          from public.exam_contract_picks k
          join public.exam_contracts c on c.id = k.contract_id
          where k.registration_id = p_registration and c.programme = 'score'
        )
      )
  end
$$;

-- What the door and rpc/exam_save_preferences say of a student's preferences:
--   saved     they have saved them at least once
--   complete  they are what the exam asks for as it stands now (app.exam_preferences_ok)
--   scope,    the sections they chose with them; null in an exam with no choice, and until
--   score     they have saved
--   picks     how many contracts they chose
create or replace function app.exam_preferences_state(p_exam uuid, p_registration uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'saved', r.preferences_at is not null,
    'complete', app.exam_preferences_ok(
      p_exam, r.id,
      case when s.choice then coalesce(r.chose_scope, false) end,
      case when s.choice then coalesce(r.chose_score, false) end
    ),
    'scope', r.chose_scope,
    'score', r.chose_score,
    'picks', (select count(*)::int from public.exam_contract_picks k where k.registration_id = r.id)
  )
  from public.exam_registrations r
  cross join lateral (
    select coalesce((app.exam_sections(p_exam) ->> 'choice')::boolean, false) as choice
  ) s
  where r.id = p_registration
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- Tidies a contract and guards it.
--   * The programme is 'scope' or 'score', the class 'A', 'B' or 'C', however they were typed;
--     the country and the note lose the space around them and any run of it inside. A contract
--     with no number of places has one. The number can change at any time, as a note can.
--   * Once the exam has started, contracts are neither added nor removed, and a contract's
--     programme and class stay: every paper's preferences were chosen from the list as it was.
--   * Before that, a contract that students have chosen keeps its programme and class, because
--     their two of Class A and two of Class B were counted against them. It can still be
--     removed, which takes it off their lists.
-- A change of that kind first takes the exam's row for itself, as a change to a question does.
-- rpc/exam_start and rpc/exam_save_preferences hold that row while they work, so the change
-- either lands before them or finds what they wrote.
-- A delete that comes from the exam itself being deleted passes: the exam's row is gone by then.
create or replace function app.normalize_exam_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.exams e where e.id = old.exam_id) then
      return old;
    end if;
    perform 1 from public.exams e where e.id = old.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = old.exam_id) then
      raise exception 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    new.exam_id := old.exam_id;
    new.created_at := old.created_at;
  end if;

  new.programme := lower(btrim(coalesce(new.programme, '')));
  if new.programme not in ('scope', 'score') then
    raise exception 'Choose the contract''s programme: SCOPE or SCORE.' using errcode = '22023';
  end if;
  new.class := upper(btrim(coalesce(new.class, '')));
  if new.class not in ('A', 'B', 'C') then
    raise exception 'Choose the contract''s class: A, B or C.' using errcode = '22023';
  end if;
  new.country := regexp_replace(btrim(coalesce(new.country, '')), '\s+', ' ', 'g');
  if new.country = '' or length(new.country) > 80 then
    raise exception 'A contract needs its country, in at most 80 characters.' using errcode = '22023';
  end if;
  new.places := coalesce(new.places, 1);
  if new.places not between 1 and 999 then
    raise exception 'A contract has between 1 and 999 places.' using errcode = '22023';
  end if;
  new.note := regexp_replace(btrim(coalesce(new.note, '')), '\s+', ' ', 'g');
  if length(new.note) > 200 then
    raise exception 'A contract''s note can have at most 200 characters.' using errcode = '22023';
  end if;
  new.sort := coalesce(new.sort, 0);

  if tg_op = 'INSERT' then
    perform 1 from public.exams e where e.id = new.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = new.exam_id) then
      raise exception 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.'
        using errcode = '22023';
    end if;
  elsif new.programme is distinct from old.programme or new.class is distinct from old.class then
    perform 1 from public.exams e where e.id = new.exam_id for update;
    if exists (select 1 from public.exam_attempts a where a.exam_id = new.exam_id) then
      raise exception 'The exam has started: a contract''s programme and class can no longer change.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.exam_contract_picks k where k.contract_id = old.id) then
      raise exception 'Students have already chosen this contract, so its programme and class stay. To change them, remove the contract and add it again: it then comes off those students'' lists.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- An ID that leaves its account (released by an officer, or the account was deleted) or is taken
-- by one starts with no preferences: they were the last holder's.
create or replace function app.clear_exam_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is distinct from old.profile_id then
    delete from public.exam_contract_picks k where k.registration_id = old.id;
    new.chose_scope := null;
    new.chose_score := null;
    new.preferences_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_exam_contract on public.exam_contracts;
create trigger normalize_exam_contract before insert or update or delete on public.exam_contracts
  for each row execute function app.normalize_exam_contract();
drop trigger if exists set_updated_at on public.exam_contracts;
create trigger set_updated_at before update on public.exam_contracts
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.exam_contracts;
create trigger audit after insert or update or delete on public.exam_contracts
  for each row execute function app.audit();

drop trigger if exists clear_exam_preferences on public.exam_registrations;
create trigger clear_exam_preferences before update of profile_id on public.exam_registrations
  for each row execute function app.clear_exam_preferences();

-- No audit trigger on exam_contract_picks, as for the list and the papers: the picks go when
-- the term ends, and the audit log would keep them after that.

-- ---------------------------------------------------------------------------------------------
-- The takers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/exam_door(word): as in 20261109120001, and
--   * the exam says how many contracts each programme has (`contracts`: { scope, score });
--   * `preferences` says where the caller's preferences stand (app.exam_preferences_state);
--     null for an account that holds no ID on the list.
-- The contracts themselves are not here: the door is asked every 30 seconds by every phone that
-- waits for the exam to open, and rpc/exam_preferences hands them to the one screen that shows
-- them.
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
  v_registration uuid;
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

  select r.id into v_registration
  from public.exam_registrations r
  where r.exam_id = v_exam.id and r.profile_id = v_uid;

  return jsonb_build_object(
    'exam', jsonb_build_object(
      'title', v_exam.title,
      'opens_at', v_exam.opens_at,
      'closes_at', v_exam.closes_at,
      'minutes', v_exam.minutes,
      'questions', (select count(*)::int from public.exam_questions q where q.exam_id = v_exam.id),
      'sections', app.exam_sections(v_exam.id),
      'contracts', app.exam_contract_counts(v_exam.id),
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
    'registration', case when v_registration is not null then 'held' else 'none' end,
    'preferences', case
      when v_registration is null then null
      else app.exam_preferences_state(v_exam.id, v_registration)
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

-- rpc/exam_preferences(word): the exam's contracts and the caller's own preferences, for the
-- screen where they are chosen. Only for an account that holds an ID on the exam's list.
--   contracts  every contract: { id, programme, class, country, places, note }, by programme,
--              class and the officers' order
--   picks      the ids of the contracts the caller chose, in their order
--   scope,     the sections they chose with them (null in an exam with no choice, and until
--   score      they have saved)
--   saved      they have saved at least once
--   started    their paper exists, so nothing here can change any more
create or replace function public.exam_preferences(p_word text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_reg public.exam_registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;
  select r.* into v_reg
  from public.exam_registrations r
  where r.exam_id = v_exam.id and r.profile_id = v_uid;
  if not found then
    raise exception 'Your student ID is not on the list for this exam.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'contracts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'programme', c.programme,
          'class', c.class,
          'country', c.country,
          'places', c.places,
          'note', c.note
        )
        order by c.programme, c.class, c.sort, c.created_at, c.id
      )
      from public.exam_contracts c
      where c.exam_id = v_exam.id
    ), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(k.contract_id order by k.place)
      from public.exam_contract_picks k
      where k.registration_id = v_reg.id
    ), '[]'::jsonb),
    'scope', v_reg.chose_scope,
    'score', v_reg.chose_score,
    'saved', v_reg.preferences_at is not null,
    'started', exists (
      select 1 from public.exam_attempts a
      where a.exam_id = v_exam.id and a.profile_id = v_uid
    )
  );
end
$$;

-- rpc/exam_save_preferences(word, picks, scope, score): saves the caller's preferences, whole:
-- `p_picks` is a JSON list of contract ids in the student's order, and takes the place of
-- whatever was saved before. `p_scope` and `p_score` are the sections they will answer, in an
-- exam with the choice; in any other exam they are not looked at.
-- It answers as the door's `preferences` does. A list the rules do not allow is refused whole,
-- in a sentence fit to show, and nothing changes:
--   * no ID on the list, or the paper has started;
--   * an id that is not one of the exam's contracts (the list changed since the page read it);
--   * with the choice: no section, or a contract of a programme whose section is not chosen;
--   * more than two of Class A, or of Class B, in one programme;
--   * with the choice: no contract in a chosen programme that has some; without it: none at all.
-- An id given twice counts once, at its first place. Ids are matched as text against the exam's
-- own contracts, so one that is no id at all never reaches a cast.
-- The call holds the exam's row (a key-share lock, as rpc/exam_start does) and the caller's line
-- of the list to its end: an officer's change to a contract's class waits for it or is waited
-- for, a start and a save from one account take turns, and so do two saves.
create or replace function public.exam_save_preferences(
  p_word text,
  p_picks jsonb,
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
  v_exam public.exams%rowtype;
  v_reg uuid;
  v_choice boolean;
  v_scope boolean := true;
  v_score boolean := true;
  v_ids uuid[];
  v_unknown int;
  v_scope_a int;
  v_scope_b int;
  v_scope_all int;
  v_score_a int;
  v_score_b int;
  v_score_all int;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then
    raise exception 'That is not a list of contracts.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_picks) > 500 then
    raise exception 'That is not a list of contracts.' using errcode = '22023';
  end if;
  v_exam := app.exam_by_word(p_word);
  if v_exam.id is null then
    raise exception 'There is no exam at this address.' using errcode = '22023';
  end if;

  perform 1 from public.exams e where e.id = v_exam.id for key share;

  select r.id into v_reg
  from public.exam_registrations r
  where r.exam_id = v_exam.id and r.profile_id = v_uid
  for update;
  if not found then
    raise exception 'Your student ID is not on the list for this exam.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.exam_attempts a
    where a.exam_id = v_exam.id and a.profile_id = v_uid
  ) then
    raise exception 'Your exam has started, so your contract preferences can no longer change.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.exam_contracts c where c.exam_id = v_exam.id) then
    raise exception 'This exam has no contracts to choose from.' using errcode = '22023';
  end if;

  v_choice := coalesce((app.exam_sections(v_exam.id) ->> 'choice')::boolean, false);
  if v_choice then
    v_scope := coalesce(p_scope, false);
    v_score := coalesce(p_score, false);
    if not (v_scope or v_score) then
      raise exception 'Choose at least one section.' using errcode = '22023';
    end if;
  end if;

  with given as (
    select x.pos,
           case when jsonb_typeof(x.item) = 'string' then lower(btrim(x.item #>> '{}')) end as id_text
    from jsonb_array_elements(p_picks) with ordinality as x(item, pos)
  ),
  matched as (
    select g.pos, c.id
    from given g
    left join public.exam_contracts c on c.exam_id = v_exam.id and c.id::text = g.id_text
  ),
  firsts as (
    select m.id, min(m.pos) as pos
    from matched m
    where m.id is not null
    group by m.id
  )
  select coalesce((select array_agg(f.id order by f.pos) from firsts f), '{}'::uuid[]),
         (select count(*)::int from matched m where m.id is null)
    into v_ids, v_unknown;
  if v_unknown > 0 then
    raise exception 'The list of contracts has changed. Reload the page and choose again.'
      using errcode = '22023';
  end if;

  select (count(*) filter (where c.programme = 'scope' and c.class = 'A'))::int,
         (count(*) filter (where c.programme = 'scope' and c.class = 'B'))::int,
         (count(*) filter (where c.programme = 'scope'))::int,
         (count(*) filter (where c.programme = 'score' and c.class = 'A'))::int,
         (count(*) filter (where c.programme = 'score' and c.class = 'B'))::int,
         (count(*) filter (where c.programme = 'score'))::int
    into v_scope_a, v_scope_b, v_scope_all, v_score_a, v_score_b, v_score_all
  from public.exam_contracts c
  where c.id = any (v_ids);

  if (v_scope_all > 0 and not v_scope) or (v_score_all > 0 and not v_score) then
    raise exception 'Choose contracts only from the sections you will answer.' using errcode = '22023';
  end if;
  if v_scope_a > 2 or v_score_a > 2 then
    raise exception 'Choose at most two Class A contracts in each programme.' using errcode = '22023';
  end if;
  if v_scope_b > 2 or v_score_b > 2 then
    raise exception 'Choose at most two Class B contracts in each programme.' using errcode = '22023';
  end if;
  if v_choice then
    if v_scope and v_scope_all = 0
       and exists (select 1 from public.exam_contracts c where c.exam_id = v_exam.id and c.programme = 'scope') then
      raise exception 'Choose at least one contract for the professional exchange (SCOPE).' using errcode = '22023';
    end if;
    if v_score and v_score_all = 0
       and exists (select 1 from public.exam_contracts c where c.exam_id = v_exam.id and c.programme = 'score') then
      raise exception 'Choose at least one contract for the research exchange (SCORE).' using errcode = '22023';
    end if;
  elsif coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'Choose at least one contract.' using errcode = '22023';
  end if;

  delete from public.exam_contract_picks k where k.registration_id = v_reg;
  insert into public.exam_contract_picks (registration_id, contract_id, place)
  select v_reg, u.id, u.pos::int
  from unnest(v_ids) with ordinality as u(id, pos);

  update public.exam_registrations r
     set chose_scope = case when v_choice then v_scope end,
         chose_score = case when v_choice then v_score end,
         preferences_at = now()
   where r.id = v_reg;

  return app.exam_preferences_state(v_exam.id, v_reg);
end
$$;

-- rpc/exam_start(word, code, scope, score): as in 20261109120001, and in an exam that has
-- contracts the student's preferences come first:
--   * the answer is { ok: false, reason: 'preferences' } until they are what the exam asks for
--     (app.exam_preferences_ok). It is said before the code is looked at, so it costs no try;
--   * in an exam with the choice, the paper sits the sections the student chose with their
--     preferences. `p_scope` and `p_score` are not looked at: what the student may choose
--     contracts from and what their paper sits are one choice, made once.
-- An exam with no contracts starts exactly as before.
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
  values (v_exam.id, v_uid, v_reg.student_id, v_now, v_order, v_options, v_scope, v_score)
  on conflict (exam_id, profile_id) do nothing;

  select a.id into v_attempt
  from public.exam_attempts a
  where a.exam_id = v_exam.id and a.profile_id = v_uid;
  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The officers' RPCs
-- ---------------------------------------------------------------------------------------------

-- rpc/import_exam_contracts(exam, rows): adds contracts after the last one, in the order given:
-- [{ programme, class, country, places, note }, ...], 1 to 500 rows; `places` and `note` may be
-- left out. All or nothing: a bad row raises with its number ('Contract 7: ...') and nothing is
-- added. Returns how many were added.
create or replace function public.import_exam_contracts(p_exam uuid, p_rows jsonb)
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
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam) then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Add between 1 and 500 contracts at a time.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Add between 1 and 500 contracts at a time.' using errcode = '22023';
  end if;
  -- said once here, and not as 'Contract 1: ...'
  if exists (select 1 from public.exam_attempts a where a.exam_id = p_exam) then
    raise exception 'The exam has started: contracts can no longer be added or removed. You can still correct a country or a note.'
      using errcode = '22023';
  end if;

  select coalesce(max(c.sort), 0) into v_last from public.exam_contracts c where c.exam_id = p_exam;

  for v_row, v_n in
    select x.item, x.pos::int
    from jsonb_array_elements(p_rows) with ordinality as x(item, pos)
    order by x.pos
  loop
    begin
      -- a value of the wrong kind reads as missing, and the trigger refuses it
      -- a number of places that is no whole number of at most four digits is out of range
      insert into public.exam_contracts (exam_id, sort, programme, class, country, places, note)
      values (
        p_exam,
        v_last + v_n,
        case when jsonb_typeof(v_row -> 'programme') = 'string' then v_row ->> 'programme' end,
        case when jsonb_typeof(v_row -> 'class') = 'string' then v_row ->> 'class' end,
        case when jsonb_typeof(v_row -> 'country') = 'string' then v_row ->> 'country' end,
        case
          when v_row -> 'places' is null or jsonb_typeof(v_row -> 'places') = 'null' then 1
          when jsonb_typeof(v_row -> 'places') = 'number' and (v_row ->> 'places') ~ '^[0-9]{1,4}$'
            then (v_row ->> 'places')::int
          else 0
        end,
        case when jsonb_typeof(v_row -> 'note') = 'string' then v_row ->> 'note' else '' end
      );
    exception when sqlstate '22023' then
      raise exception 'Contract %: %', v_n, sqlerrm using errcode = '22023';
    end;
  end loop;
  return jsonb_array_length(p_rows);
end
$$;

-- rpc/exam_preference_list(exam): every student who has saved preferences or has a paper, in
-- the order of the registered list, each with
--   registration_id, student_id, profile_id, full_name, email, phone, faculty_year
--   saved_at                  when they last saved their preferences; null if never
--   chose_scope, chose_score  the sections they chose with them; null in an exam with no choice
--   attempt_id                their paper, or null before they start
--   sits_scope, sits_score    the sections the paper sits now; null before they start
--   picks                     the ids of the contracts they chose, in their order
-- The name, year and phone are cut as in rpc/exam_results.
create or replace function public.exam_preference_list(p_exam uuid)
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
        'registration_id', r.id,
        'student_id', r.student_id,
        'profile_id', r.profile_id,
        'full_name', left(btrim(p.full_name), 120),
        'email', p.email,
        'phone', left(btrim(p.phone), 30),
        'faculty_year', left(btrim(p.faculty_year), 40),
        'saved_at', r.preferences_at,
        'chose_scope', r.chose_scope,
        'chose_score', r.chose_score,
        'attempt_id', a.id,
        'sits_scope', a.sits_scope,
        'sits_score', a.sits_score,
        'picks', coalesce((
          select jsonb_agg(k.contract_id order by k.place)
          from public.exam_contract_picks k
          where k.registration_id = r.id
        ), '[]'::jsonb)
      )
      order by r.student_key, r.id
    )
    from public.exam_registrations r
    join public.profiles p on p.id = r.profile_id
    left join public.exam_attempts a on a.exam_id = r.exam_id and a.profile_id = r.profile_id
    where r.exam_id = p_exam
      and (r.preferences_at is not null or a.id is not null)
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------

alter table public.exam_contracts enable row level security;
alter table public.exam_contract_picks enable row level security;

-- The officers read, change and remove a contract directly (the trigger tidies and refuses); a
-- contract is added through rpc/import_exam_contracts.
drop policy if exists exam_contracts_select on public.exam_contracts;
create policy exam_contracts_select on public.exam_contracts
  for select to authenticated
  using ((select app.is_exam_officer()));
drop policy if exists exam_contracts_update on public.exam_contracts;
create policy exam_contracts_update on public.exam_contracts
  for update to authenticated
  using ((select app.is_exam_officer()))
  with check ((select app.is_exam_officer()));
drop policy if exists exam_contracts_delete on public.exam_contracts;
create policy exam_contracts_delete on public.exam_contracts
  for delete to authenticated
  using ((select app.is_exam_officer()));

drop policy if exists exam_contract_picks_select on public.exam_contract_picks;
create policy exam_contract_picks_select on public.exam_contract_picks
  for select to authenticated
  using ((select app.is_exam_officer()));

alter function app.exam_contract_counts(uuid) owner to postgres;
alter function app.exam_preferences_ok(uuid, uuid, boolean, boolean) owner to postgres;
alter function app.exam_preferences_state(uuid, uuid) owner to postgres;
alter function app.normalize_exam_contract() owner to postgres;
alter function app.clear_exam_preferences() owner to postgres;
alter function public.exam_door(text) owner to postgres;
alter function public.exam_preferences(text) owner to postgres;
alter function public.exam_save_preferences(text, jsonb, boolean, boolean) owner to postgres;
alter function public.exam_start(text, text, boolean, boolean) owner to postgres;
alter function public.import_exam_contracts(uuid, jsonb) owner to postgres;
alter function public.exam_preference_list(uuid) owner to postgres;

-- called only inside the RPCs and the triggers: no grant
revoke execute on function app.exam_contract_counts(uuid) from public;
revoke execute on function app.exam_preferences_ok(uuid, uuid, boolean, boolean) from public;
revoke execute on function app.exam_preferences_state(uuid, uuid) from public;
revoke execute on function app.normalize_exam_contract() from public;
revoke execute on function app.clear_exam_preferences() from public;

revoke execute on function public.exam_door(text) from public, anon;
grant execute on function public.exam_door(text) to authenticated;
revoke execute on function public.exam_preferences(text) from public, anon;
grant execute on function public.exam_preferences(text) to authenticated;
revoke execute on function public.exam_save_preferences(text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.exam_save_preferences(text, jsonb, boolean, boolean) to authenticated;
revoke execute on function public.exam_start(text, text, boolean, boolean) from public, anon;
grant execute on function public.exam_start(text, text, boolean, boolean) to authenticated;
revoke execute on function public.import_exam_contracts(uuid, jsonb) from public, anon;
grant execute on function public.import_exam_contracts(uuid, jsonb) to authenticated;
revoke execute on function public.exam_preference_list(uuid) from public, anon;
grant execute on function public.exam_preference_list(uuid) to authenticated;

-- Of a contract the officers write its programme, class, country, places, note and place in the order,
-- and they remove one; a pick is written by rpc/exam_save_preferences alone.
revoke all on public.exam_contracts, public.exam_contract_picks from anon, authenticated;
grant select on public.exam_contracts, public.exam_contract_picks to authenticated;
grant update (programme, class, country, places, note, sort) on public.exam_contracts to authenticated;
grant delete on public.exam_contracts to authenticated;
grant all on public.exam_contracts, public.exam_contract_picks to service_role;
