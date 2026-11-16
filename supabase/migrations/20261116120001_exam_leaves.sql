-- The exam: how many times a taker left the page while their paper was running.
--
-- A page cannot stop a screenshot or see what else is open on a phone. It does know when it stops
-- being the page in front (another app, another tab, another window), and that is what a taker
-- does to look something up or to send a question to a friend. The paper now counts those times.
-- The first time, the taker is warned when they come back that it was recorded; from the second
-- time on they are told it will be reported, and the officers see the count beside the paper in
-- the portal's results.
--
--   exam_attempts.times_left     how many times the taker left the page; 0 for a paper that never did
--   exam_attempts.last_left_at   when that count last went up
--   exam_attempts.times_printed  how many times the taker pressed the Print Screen key
--
-- Print Screen is the one way of taking a screenshot that a page is told of, and only on a
-- computer's keyboard: a phone's buttons, a snipping shortcut and a Mac's keys say nothing to the
-- page. It is counted for what it is worth, and reported from the first press.
--
-- rpc/exam_left(word, count, prints): the phone keeps both counts and sends the whole of each, not
-- "one more", so a request that is sent twice, or sent again after a dead connection, counts
-- once. The database keeps the larger of what it has and what it is sent: a phone that lost its
-- own counts cannot bring a number down. It answers { "left": n, "printed": m } with what the
-- database now holds, which the phone takes as its own if it is larger. Only a running paper
-- counts: after the hand-in or the deadline the numbers stay as they were.
--
-- The officers read the three columns straight off exam_attempts, which only they can select
-- (exam_attempts_select in 20261010120001). A taker cannot read or write the table at all.

alter table public.exam_attempts add column if not exists times_left int not null default 0;
alter table public.exam_attempts add column if not exists last_left_at timestamptz null;
alter table public.exam_attempts drop constraint if exists exam_attempts_times_left;
alter table public.exam_attempts add constraint exam_attempts_times_left
  check (times_left between 0 and 999);
alter table public.exam_attempts add column if not exists times_printed int not null default 0;
alter table public.exam_attempts drop constraint if exists exam_attempts_times_printed;
alter table public.exam_attempts add constraint exam_attempts_times_printed
  check (times_printed between 0 and 999);

create or replace function public.exam_left(p_word text, p_count int, p_prints int default 0)
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
  v_count int := least(greatest(coalesce(p_count, 0), 0), 999);
  v_prints int := least(greatest(coalesce(p_prints, 0), 0), 999);
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
  where a.exam_id = v_exam.id and a.profile_id = v_uid
  for no key update;
  if not found then
    raise exception 'You have not started this exam.' using errcode = '22023';
  end if;

  -- the same end as rpc/exam_save: handed in, or the deadline and its 30 seconds of grace
  if v_attempt.submitted_at is null
     and v_now <= app.exam_deadline(v_attempt.started_at, v_exam.minutes) + interval '30 seconds'
     and (v_count > v_attempt.times_left or v_prints > v_attempt.times_printed) then
    update public.exam_attempts a
       set times_left = greatest(a.times_left, v_count),
           last_left_at = case when v_count > a.times_left then v_now else a.last_left_at end,
           times_printed = greatest(a.times_printed, v_prints)
     where a.id = v_attempt.id
    returning a.times_left, a.times_printed into v_attempt.times_left, v_attempt.times_printed;
  end if;

  return jsonb_build_object('left', v_attempt.times_left, 'printed', v_attempt.times_printed);
end
$$;

alter function public.exam_left(text, int, int) owner to postgres;
revoke execute on function public.exam_left(text, int, int) from public, anon;
grant execute on function public.exam_left(text, int, int) to authenticated;
