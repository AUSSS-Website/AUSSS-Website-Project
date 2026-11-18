-- The exam's contracts: a list that names a contract the exam already has adds to it.
--
-- The officers' sheets have a line for every single contract, and they are often added in
-- parts. Until now each call of rpc/import_exam_contracts made new contracts, so "SCOPE, A,
-- Spain" added on Monday and again on Tuesday stood twice in the list, as two things for a
-- student to choose between. A row is now the same contract as one the exam has when its
-- programme, its class, its country and its note are the same (capitals do not matter, and two
-- with no note are the same): its number is then added to that contract's, and no contract is
-- made. That also holds inside one list, so a list with three lines of one contract makes one
-- contract with three of it, whatever page sent it.
--
-- Nothing else changes: 1 to 500 rows, all or nothing, a bad row named by its number, and no
-- adding once the exam has started. A contract that students have already chosen can be added
-- to: its number is no part of what they chose. The function now answers with how many new
-- contracts it made; the rows that added to a contract are the rest of the list.

-- rpc/import_exam_contracts(exam, rows): adds contracts in the order given:
-- [{ programme, class, country, places, note }, ...], 1 to 500 rows; `places` and `note` may be
-- left out. A row that is a contract the exam already has (the same programme, class, country
-- and note) adds its number to that one; any other is a new contract after the last one. All or
-- nothing: a bad row raises with its number ('Contract 7: ...') and nothing changes. Returns how
-- many new contracts were made.
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
  v_programme text;
  v_class text;
  v_country text;
  v_note text;
  v_places int;
  v_same uuid;
  v_made int := 0;
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
  -- two lists added at once take turns, so that neither misses the other's contracts
  perform 1 from public.exams e where e.id = p_exam for update;
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
      v_programme := case when jsonb_typeof(v_row -> 'programme') = 'string' then v_row ->> 'programme' end;
      v_class := case when jsonb_typeof(v_row -> 'class') = 'string' then v_row ->> 'class' end;
      v_country := case when jsonb_typeof(v_row -> 'country') = 'string' then v_row ->> 'country' end;
      v_note := case when jsonb_typeof(v_row -> 'note') = 'string' then v_row ->> 'note' else '' end;
      -- a number of places that is no whole number of at most four digits is out of range
      v_places := case
        when v_row -> 'places' is null or jsonb_typeof(v_row -> 'places') = 'null' then 1
        when jsonb_typeof(v_row -> 'places') = 'number' and (v_row ->> 'places') ~ '^[0-9]{1,4}$'
          then (v_row ->> 'places')::int
        else 0
      end;

      -- the contract this row is, if the exam has it: compared as the trigger keeps them
      select c.id into v_same
      from public.exam_contracts c
      where c.exam_id = p_exam
        and c.programme = lower(btrim(coalesce(v_programme, '')))
        and c.class = upper(btrim(coalesce(v_class, '')))
        and lower(c.country) = lower(regexp_replace(btrim(coalesce(v_country, '')), '\s+', ' ', 'g'))
        and lower(c.note) = lower(regexp_replace(btrim(coalesce(v_note, '')), '\s+', ' ', 'g'))
      order by c.sort, c.created_at, c.id
      limit 1;

      if found then
        -- the row's own number is checked here; the sum is the trigger's to refuse
        if v_places not between 1 and 999 then
          raise exception 'A contract has between 1 and 999 places.' using errcode = '22023';
        end if;
        update public.exam_contracts c set places = c.places + v_places where c.id = v_same;
      else
        insert into public.exam_contracts (exam_id, sort, programme, class, country, places, note)
        values (p_exam, v_last + v_n, v_programme, v_class, v_country, v_places, v_note);
        v_made := v_made + 1;
      end if;
    exception when sqlstate '22023' then
      raise exception 'Contract %: %', v_n, sqlerrm using errcode = '22023';
    end;
  end loop;
  return v_made;
end
$$;

alter function public.import_exam_contracts(uuid, jsonb) owner to postgres;
revoke execute on function public.import_exam_contracts(uuid, jsonb) from public, anon;
grant execute on function public.import_exam_contracts(uuid, jsonb) to authenticated;
