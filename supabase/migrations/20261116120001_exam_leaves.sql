-- The exam: how many times a taker left the page while their paper was running.
--
-- A page cannot stop a screenshot or see what else is open on a phone. It does know when it stops
-- being the page in front (another app, another tab, another window), and that is what a taker
-- does to look something up or to send a question to a friend. The paper now counts those times.
-- The first time, the taker is warned when they come back that it was recorded; from the second
-- time on they are told it will be reported, and the officers see the count beside the paper in
-- the portal's results.
--
--   exam_attempts.times_left    how many times the taker left the page; 0 for a paper that never did
--   exam_attempts.last_left_at  when the count last went up
--
-- rpc/exam_left(word, count): the phone keeps the count and sends the whole of it, not "one more",
-- so a request that is sent twice, or sent again after a dead connection, counts once. The
-- database keeps the larger of what it has and what it is sent: a phone that lost its own count
-- cannot bring the number down. It answers { "left": n } with what the database now holds, which
-- the phone takes as its own count if it is larger. Only a running paper counts: after the hand-in
-- or the deadline the number stays as it was.
--
-- The officers read the two columns straight off exam_attempts, which only they can select
-- (exam_attempts_select in 20261010120001). A taker cannot read or write the table at all.

alter table public.exam_attempts add column if not exists times_left int not null default 0;
alter table public.exam_attempts add column if not exists last_left_at timestamptz null;
alter table public.exam_attempts drop constraint if exists exam_attempts_times_left;
alter table public.exam_attempts add constraint exam_attempts_times_left
  check (times_left between 0 and 999);

create or replace function public.exam_left(p_word text, p_count int)
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
     and v_count > v_attempt.times_left then
    update public.exam_attempts a
       set times_left = v_count, last_left_at = v_now
     where a.id = v_attempt.id;
    v_attempt.times_left := v_count;
  end if;

  return jsonb_build_object('left', v_attempt.times_left);
end
$$;

alter function public.exam_left(text, int) owner to postgres;
revoke execute on function public.exam_left(text, int) from public, anon;
grant execute on function public.exam_left(text, int) to authenticated;
