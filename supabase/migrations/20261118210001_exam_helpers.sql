-- The exchange exam: helpers for the registered list.
--
-- Registration is done at a desk by several people at once, and until now only the exam officers
-- (the SCOPE and SCORE officers and the Executive Board) could put a student ID on an exam's
-- list. The officers can now name helpers for one exam: any account on the website, chosen by
-- the address it signs in with. A helper works on that exam's registered list exactly as an
-- officer does (adds IDs, reads the list with who holds each ID, releases one, removes one) and
-- reaches nothing else of the exam: not its questions, its key, its contracts, its results, the
-- word in its address or its start code. A helper reads no exam table at all; like a taker,
-- they go through functions.
--
--   exam_helpers                  who helps with which exam's list, and who named them
--   app.is_exam_helper            whether the caller helps with that exam
--   app.can_edit_exam_list        an exam officer, or a helper of that exam
--   rpc/exam_add_helper           the officers name a helper by email
--   rpc/exam_remove_helper        and take one off
--   rpc/exam_helper_list          the helpers of an exam, for the officers
--   rpc/exam_helper_exams         the exams the caller helps with, as much of each as the
--                                 Registered list page shows
--   rpc/exam_remove_registration  takes an ID off the list; the officers could already delete
--                                 the row directly, a helper cannot, so the portal now asks here
--
-- rpc/exam_add_registrations, rpc/exam_release_registration and rpc/exam_registration_list are
-- those of 20261010120001, whole, with the question "is this an exam officer" widened to "or a
-- helper of this exam"; nothing else about them changes.
--
-- Helpers are named for one sitting. They go with the registered list when the exam's term
-- ends (app.clear_exam_rows, as 20261010120002 with one delete added), so nobody keeps a way
-- into next year's list without being named again.

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------

create table if not exists public.exam_helpers (
  exam_id uuid not null references public.exams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (exam_id, profile_id)
);

create index if not exists exam_helpers_profile_id_idx on public.exam_helpers (profile_id);
create index if not exists exam_helpers_added_by_idx on public.exam_helpers (added_by);

-- Who was given a way into a list, and by whom, is worth keeping: the rows hold two account ids
-- and no student ID. The table has no `id`, so the entry's row_id is empty, as for exam_key.
drop trigger if exists audit on public.exam_helpers;
create trigger audit after insert or update or delete on public.exam_helpers
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Who may work on an exam's list
-- ---------------------------------------------------------------------------------------------

create or replace function app.is_exam_helper(p_exam uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exam_helpers h
    where h.exam_id = p_exam and h.profile_id = (select auth.uid())
  )
$$;

create or replace function app.can_edit_exam_list(p_exam uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.is_exam_officer() or app.is_exam_helper(p_exam), false)
$$;

-- ---------------------------------------------------------------------------------------------
-- The officers name the helpers
-- ---------------------------------------------------------------------------------------------

-- rpc/exam_add_helper(exam, email): names the account that signs in with that address a helper
-- of the exam. The address is compared trimmed and in lower case. Refused, in a sentence, when
-- no account has it. Naming someone twice changes nothing. Returns
-- { profile_id, full_name, email, added } with added false for someone already named.
create or replace function public.exam_add_helper(p_exam uuid, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_added int;
begin
  if v_uid is null or not app.is_exam_officer() then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  -- two officers naming helpers at once take turns, so the count below holds
  perform 1 from public.exams e where e.id = p_exam for update;
  if not found then
    raise exception 'That exam is not there any more.' using errcode = '22023';
  end if;
  if app.norm_email(p_email) is null then
    raise exception 'Type the address the helper signs in with.' using errcode = '22023';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.email_normalized = app.norm_email(p_email)
  order by p.created_at, p.id
  limit 1;
  if v_profile.id is null then
    raise exception 'No account on the website uses that address. Ask them to sign in to the portal once, then add them.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.exam_helpers h where h.exam_id = p_exam and h.profile_id = v_profile.id
  ) and (select count(*) from public.exam_helpers h where h.exam_id = p_exam) >= 50 then
    raise exception 'An exam has at most 50 helpers.' using errcode = '22023';
  end if;

  insert into public.exam_helpers (exam_id, profile_id, added_by)
  values (p_exam, v_profile.id, v_uid)
  on conflict (exam_id, profile_id) do nothing;
  get diagnostics v_added = row_count;

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'full_name', left(btrim(v_profile.full_name), 120),
    'email', v_profile.email,
    'added', v_added > 0
  );
end
$$;

-- rpc/exam_remove_helper(exam, profile): that account no longer helps with the exam. Someone
-- who was not a helper is no error.
create or replace function public.exam_remove_helper(p_exam uuid, p_profile uuid)
returns void
language plpgsql
volatile
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
  delete from public.exam_helpers h where h.exam_id = p_exam and h.profile_id = p_profile;
end
$$;

-- rpc/exam_helper_list(exam): the exam's helpers by name, for the officers:
-- [{ profile_id, full_name, email, created_at }].
create or replace function public.exam_helper_list(p_exam uuid)
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
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'profile_id', h.profile_id,
        'full_name', left(btrim(p.full_name), 120),
        'email', p.email,
        'created_at', h.created_at
      )
      order by lower(btrim(coalesce(p.full_name, ''))), p.email, h.profile_id
    )
    from public.exam_helpers h
    join public.profiles p on p.id = h.profile_id
    where h.exam_id = p_exam
  ), '[]'::jsonb);
end
$$;

-- rpc/exam_helper_exams(): the exams the caller helps with, newest first, each with what the
-- Registered list page shows of an exam and no more: its title, its term, whether and when
-- students may start (the page reads the list again by itself while they can), how many IDs are
-- on the list and whether anyone has started. Never the word in its address or its start code.
-- [] for someone who helps with none.
create or replace function public.exam_helper_exams()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'status', e.status,
        'opens_at', e.opens_at,
        'closes_at', e.closes_at,
        'minutes', e.minutes,
        'term', jsonb_build_object('label', t.label, 'is_current', t.is_current),
        'registrations', (select count(*) from public.exam_registrations r where r.exam_id = e.id),
        'started', exists (select 1 from public.exam_attempts a where a.exam_id = e.id)
      )
      order by e.created_at desc, e.id
    )
    from public.exam_helpers h
    join public.exams e on e.id = h.exam_id
    join public.terms t on t.id = e.term_id
    where h.profile_id = v_uid
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The list's functions, for the officers and the exam's helpers
-- ---------------------------------------------------------------------------------------------

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
  if v_uid is null or not app.can_edit_exam_list(p_exam) then
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
  if v_uid is null then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select r.* into v_row from public.exam_registrations r where r.id = p_registration for update;
  -- With no row there is no exam to be a helper of. Someone who helps with an exam is then
  -- told what an officer is told: at a desk, the ID was most likely removed a moment ago.
  if v_row.id is null then
    if app.is_exam_officer()
       or exists (select 1 from public.exam_helpers h where h.profile_id = v_uid) then
      raise exception 'That ID is not there any more.' using errcode = '22023';
    end if;
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  if not app.can_edit_exam_list(v_row.exam_id) then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
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

-- rpc/exam_remove_registration(registration): takes an ID off the list. Refused once the
-- account that holds it has started (app.guard_exam_registration says so). An ID that is
-- already gone is no error: two people at one desk may both remove it.
create or replace function public.exam_remove_registration(p_registration uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_exam uuid;
begin
  if v_uid is null then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  select r.exam_id into v_exam from public.exam_registrations r where r.id = p_registration;
  -- already gone: nothing to do, for anyone who works on a list
  if v_exam is null and (
    app.is_exam_officer()
    or exists (select 1 from public.exam_helpers h where h.profile_id = v_uid)
  ) then
    return;
  end if;
  if not app.can_edit_exam_list(v_exam) then
    raise exception 'Only the exchange officers and the Executive Board can do this.'
      using errcode = '42501';
  end if;
  delete from public.exam_registrations r where r.id = p_registration;
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
  if v_uid is null or not app.can_edit_exam_list(p_exam) then
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

-- ---------------------------------------------------------------------------------------------
-- The term's end takes the helpers with the list
-- ---------------------------------------------------------------------------------------------

-- As 20261010120002, plus the helpers of those exams. Returns what it did before:
-- { attempts, registrations }.
create or replace function app.clear_exam_rows(p_term uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exams uuid[];
  v_attempts int;
  v_registrations int;
begin
  select coalesce(array_agg(e.id), '{}') into v_exams
  from public.exams e
  join public.terms t on t.id = e.term_id
  where t.starts_on <= (select x.starts_on from public.terms x where x.id = p_term);

  perform 1 from public.exams e where e.id = any (v_exams) order by e.id for update;

  delete from public.exam_attempts a where a.exam_id = any (v_exams);
  get diagnostics v_attempts = row_count;

  delete from public.exam_registrations r where r.exam_id = any (v_exams);
  get diagnostics v_registrations = row_count;

  delete from app.exam_tries t where t.exam_id = any (v_exams);

  delete from public.exam_helpers h where h.exam_id = any (v_exams);

  return jsonb_build_object('attempts', v_attempts, 'registrations', v_registrations);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: the officers read who helps; every write goes through the functions
-- ---------------------------------------------------------------------------------------------

alter table public.exam_helpers enable row level security;

drop policy if exists exam_helpers_select on public.exam_helpers;
create policy exam_helpers_select on public.exam_helpers
  for select to authenticated
  using ((select app.is_exam_officer()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter function app.is_exam_helper(uuid) owner to postgres;
alter function app.can_edit_exam_list(uuid) owner to postgres;
alter function public.exam_add_helper(uuid, text) owner to postgres;
alter function public.exam_remove_helper(uuid, uuid) owner to postgres;
alter function public.exam_helper_list(uuid) owner to postgres;
alter function public.exam_helper_exams() owner to postgres;
alter function public.exam_add_registrations(uuid, text[]) owner to postgres;
alter function public.exam_release_registration(uuid) owner to postgres;
alter function public.exam_remove_registration(uuid) owner to postgres;
alter function public.exam_registration_list(uuid) owner to postgres;
alter function app.clear_exam_rows(uuid) owner to postgres;

-- called only inside the RPCs: no grant
revoke execute on function app.is_exam_helper(uuid) from public;
revoke execute on function app.can_edit_exam_list(uuid) from public;
revoke execute on function app.clear_exam_rows(uuid) from public, anon, authenticated;

revoke execute on function public.exam_add_helper(uuid, text) from public, anon;
grant execute on function public.exam_add_helper(uuid, text) to authenticated;
revoke execute on function public.exam_remove_helper(uuid, uuid) from public, anon;
grant execute on function public.exam_remove_helper(uuid, uuid) to authenticated;
revoke execute on function public.exam_helper_list(uuid) from public, anon;
grant execute on function public.exam_helper_list(uuid) to authenticated;
revoke execute on function public.exam_helper_exams() from public, anon;
grant execute on function public.exam_helper_exams() to authenticated;
revoke execute on function public.exam_add_registrations(uuid, text[]) from public, anon;
grant execute on function public.exam_add_registrations(uuid, text[]) to authenticated;
revoke execute on function public.exam_release_registration(uuid) from public, anon;
grant execute on function public.exam_release_registration(uuid) to authenticated;
revoke execute on function public.exam_remove_registration(uuid) from public, anon;
grant execute on function public.exam_remove_registration(uuid) to authenticated;
revoke execute on function public.exam_registration_list(uuid) from public, anon;
grant execute on function public.exam_registration_list(uuid) to authenticated;

revoke all on public.exam_helpers from anon, authenticated;
grant select on public.exam_helpers to authenticated;
grant all on public.exam_helpers to service_role;
