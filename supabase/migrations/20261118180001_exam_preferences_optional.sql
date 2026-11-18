-- The exam's contracts: a student may sit without preferences.
--
-- Until now a student had to choose at least one contract before the exam would start: one in
-- each programme whose section they ticked, or one of any programme in an exam with no choice
-- of sections (20261118120001). The exchange team decided on 2026-11-18 that a student can sit
-- with no preferences at all.
--
-- What stays: in an exam that has contracts a student still passes the preferences step once
-- before the start code, because in an exam with two optional sections that is where they say
-- which sections their paper sits, and because a student who never opened the step has not
-- seen the contracts. Saving with nothing chosen is enough. The limits are as they were: at
-- most two of Class A and two of Class B in each programme, any number of Class C, and only
-- from the sections ticked.

-- Whether the holder of a line of the list has given the preferences the exam asks for.
-- `p_scope` and `p_score` are the sections the paper sits in an exam with the choice, and both
-- null in an exam without it.
--   * an exam with no contracts asks for nothing;
--   * otherwise the preferences must have been saved, with or without a contract among them;
--   * with the choice, at least one section must have been chosen with them.
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
    when p_scope is null and p_score is null then true
    else coalesce(p_scope, false) or coalesce(p_score, false)
  end
$$;

-- rpc/exam_save_preferences(word, picks, scope, score): as in 20261118120001, but a list with
-- no contract in it is saved like any other: nothing is asked for in a chosen programme, nor in
-- an exam without the choice.
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
  -- No contract at all is a choice too: the student sits the exam with no preferences.

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

alter function app.exam_preferences_ok(uuid, uuid, boolean, boolean) owner to postgres;
alter function public.exam_save_preferences(text, jsonb, boolean, boolean) owner to postgres;

revoke execute on function app.exam_preferences_ok(uuid, uuid, boolean, boolean) from public;
revoke execute on function public.exam_save_preferences(text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.exam_save_preferences(text, jsonb, boolean, boolean) to authenticated;
