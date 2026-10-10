-- Phase 8: the exam and the term rollover.
--
-- An exam's registered list, its papers and their answers are kept for one term (the webmaster,
-- 2026-10-10). They hold student IDs and what each student answered, so they are not kept
-- longer than that. The rollover (rpc/roll_over_term, New term in the portal) gains a step for
-- it: after the albums and before the term switches, those rows go.
--
--   deleted   exam_attempts and, with each of them, its exam_answers; exam_registrations;
--             app.exam_tries (the wrong student IDs and wrong start codes)
--   stays     the exam itself, its questions and its key, because the officers may want the
--             questions again; and the takers' accounts and profiles, student_id included
--
-- A cleared exam has no attempt, so it has not "started" any more: its times, its questions and
-- the word in its address can be changed again, and the officers can set it for the next year's
-- students. Such an exam still names the term it was made in (exams.term_id never changes). So
-- the step clears the exams of the term that is ending and any exam of an earlier term as well:
-- whichever term an exam's row names, what was collected in a term goes when that term ends.
--
-- rpc/rollover_preview() names those exams with how many registered IDs and papers each would
-- lose ('exams'), so that the board can download the results first. rpc/roll_over_term() says
-- how many went ('exam_attempts_deleted', 'exam_registrations_deleted'). Both functions are
-- those of 20261008120001, whole, with these parts added; nothing else about them changes.
--
-- Nothing is written to the audit log for these rows, as for every other change to them: the
-- log would keep the student IDs and the answers past the term. The nightly backups hold their
-- copies for 90 days more.

-- ---------------------------------------------------------------------------------------------
-- What the rollover deletes of the exams
-- ---------------------------------------------------------------------------------------------

-- Deletes the registered lists, the papers (and with them the answers) and the wrong tries of
-- the exams of that term and of any term that started before it. Returns how many papers and
-- registered IDs went: { attempts, registrations }. The papers go first: an ID stays on the
-- list while the account that holds it has a paper (app.guard_exam_registration). Called only
-- by rpc/roll_over_term.
-- It holds those exams' rows to the end of the rollover. rpc/exam_start holds the exam's row
-- while it builds a paper, so a student who presses Start at that moment waits and then finds
-- no ID on the list, and a start that was already under way is waited for and its paper goes
-- with the rest. So no paper lands between the two deletes, where the list's guard would refuse
-- the whole rollover, or just after them, where it would be kept for a term more.
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

  return jsonb_build_object('attempts', v_attempts, 'registrations', v_registrations);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/rollover_preview(): what the rollover would do, for the board
-- ---------------------------------------------------------------------------------------------

-- As 20261008120001, plus 'exams': the exams whose rows the switch would delete.
create or replace function public.rollover_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current public.terms%rowtype;
  v_label text;
  v_starts date;
  v_ends date;
  v_next public.terms%rowtype;
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can roll the society over to a new term.'
      using errcode = '42501';
  end if;

  select t.* into v_current from public.terms t where t.is_current;
  if not found then
    raise exception 'There is no current term to roll over from.' using errcode = '22023';
  end if;
  select d.label, d.starts_on, d.ends_on into v_label, v_starts, v_ends from app.next_term_defaults() d;
  select t.* into v_next from public.terms t where t.label = v_label;

  return jsonb_build_object(
    'current', jsonb_build_object(
      'id', v_current.id, 'label', v_current.label,
      'starts_on', v_current.starts_on, 'ends_on', v_current.ends_on),
    'next', jsonb_build_object(
      'id', v_next.id,
      'label', coalesce(v_next.label, v_label),
      'starts_on', coalesce(v_next.starts_on, v_starts),
      'ends_on', coalesce(v_next.ends_on, v_ends)),

    -- Every officer's, board and webmaster position, with its work email when it has one and
    -- whether an account of that address exists (it then holds the position from the switch;
    -- otherwise from its first sign-in).
    'work_accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position_id', p.id,
          'title', p.title,
          'level', p.level,
          'committee', c.abbr,
          'email', w.email,
          'has_account', exists (
            select 1 from public.profiles pr where pr.email_normalized = w.email_normalized),
          'holds_now', exists (
            select 1
            from public.assignments a
            join public.profiles pr on pr.id = a.profile_id
            where a.position_id = p.id and a.term_id = v_current.id and a.status = 'active'
              and pr.email_normalized = w.email_normalized)
        )
        order by case p.level when 'webmaster' then 0 when 'eb' then 1 else 2 end,
                 c.abbr nulls first, p.sort, p.title
      )
      from public.positions p
      left join public.committees c on c.id = p.committee_id
      left join public.position_work_emails w on w.position_id = p.id
      where p.active and p.level in ('officer', 'eb', 'webmaster')
    ), '[]'::jsonb),

    -- Positions below officer that the roster lists, offered again for the next term.
    'roster_positions', (
      select count(*)::int
      from public.roster_entries r
      where r.position_id is not null and r.email_normalized is not null
        and not app.position_is_privileged(r.position_id)
    ),

    -- Positions below officer held this term that the roster does not list: they end.
    'ending', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title', p.title,
          'committee', c.abbr,
          'name', coalesce(nullif(btrim(pr.full_name), ''), pr.email)
        )
        order by c.abbr nulls first, p.title, pr.full_name
      )
      from public.assignments a
      join public.positions p on p.id = a.position_id
      join public.profiles pr on pr.id = a.profile_id
      left join public.committees c on c.id = p.committee_id
      where a.term_id = v_current.id and a.status = 'active'
        and not app.position_is_privileged(a.position_id)
        and not app.position_from_roster(a.position_id, pr.email_normalized, pr.id)
    ), '[]'::jsonb),

    'open_tasks', (
      select count(*)::int from public.tasks t where t.status <> 'done'
    ),

    -- The albums still in the gallery (the board ticks the ones to archive).
    'albums', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'slug', a.slug,
          'published', a.published,
          'photos', (
            select count(*)::int from public.gallery_photos g
            where g.album_id = a.id and g.deleted_at is null)
        )
        order by a.sort_order, a.created_at, a.id
      )
      from public.albums a
      where a.archived_term_id is null
    ), '[]'::jsonb),

    -- The exams whose registered list and papers the switch deletes (app.clear_exam_rows):
    -- every exam of the current term, and an exam of an earlier term when it holds any.
    'exams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'title', x.title,
          'registrations', x.registrations,
          'attempts', x.attempts
        )
        order by x.starts_on, x.created_at, x.id
      )
      from (
        select e.id, e.title, e.term_id, e.created_at, t.starts_on,
               (select count(*)::int from public.exam_registrations r where r.exam_id = e.id) as registrations,
               (select count(*)::int from public.exam_attempts a where a.exam_id = e.id) as attempts
        from public.exams e
        join public.terms t on t.id = e.term_id
        where t.starts_on <= v_current.starts_on
      ) x
      where x.term_id = v_current.id or x.registrations > 0 or x.attempts > 0
    ), '[]'::jsonb),

    -- Every file in Storage, against the free plan's 1 GB.
    'storage_bytes', (
      select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
      from storage.objects o
    )
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/roll_over_term(): the rollover itself
-- ---------------------------------------------------------------------------------------------

-- As 20261008120001, with one step more: 6, the exams' rows, before the switch (now 7).
create or replace function public.roll_over_term(
  label text,
  starts_on date,
  ends_on date,
  archive_albums uuid[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
-- The parameters share their names with the terms' columns: in a query a bare name is the
-- column, and a parameter is always written roll_over_term.<name>.
declare
  v_label text := btrim(coalesce(roll_over_term.label, ''));
  v_current public.terms%rowtype;
  v_next public.terms%rowtype;
  v_offered int;
  v_roster int;
  v_tasks int;
  v_albums int;
  v_exam_rows jsonb;
  v_ended int;
  v_held int;
  v_waiting int;
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can roll the society over to a new term.'
      using errcode = '42501';
  end if;

  -- One rollover at a time: the current term's row is the lock. A second one that waited on it
  -- finds no current row when it wakes (the first moved the flag).
  select t.* into v_current from public.terms t where t.is_current for update;
  if not found then
    raise exception 'There is no current term to roll over from. If someone has just started a new term, reload the page.'
      using errcode = '22023';
  end if;

  if v_label !~ '^\d{4}-\d{2}$' then
    raise exception 'A term is named like 2027-28.' using errcode = '22023';
  end if;
  if roll_over_term.starts_on is null or roll_over_term.ends_on is null
     or roll_over_term.ends_on <= roll_over_term.starts_on then
    raise exception 'The new term needs a first and a last day, the last after the first.'
      using errcode = '22023';
  end if;
  if roll_over_term.starts_on <= v_current.starts_on then
    raise exception 'The new term must start after % started.', v_current.label
      using errcode = '22023';
  end if;
  if v_label = v_current.label then
    raise exception '% is already the current term.', v_label using errcode = '22023';
  end if;
  if exists (select 1 from public.terms t where t.label = v_label and t.starts_on <= v_current.starts_on) then
    raise exception 'The term % is over. The new term needs a name of its own.', v_label
      using errcode = '22023';
  end if;

  -- 1. The next term.
  insert into public.terms (label, starts_on, ends_on, is_current)
  values (v_label, roll_over_term.starts_on, roll_over_term.ends_on, false)
  on conflict (label) do update
    set starts_on = excluded.starts_on, ends_on = excluded.ends_on
  returning * into v_next;

  -- 2. The work accounts carry over. app.handle_new_invite assigns an existing account at once.
  insert into public.invites (email, position_id, term_id, invited_by)
  select w.email, w.position_id, v_next.id, auth.uid()
  from public.position_work_emails w
  join public.positions p on p.id = w.position_id
  where p.active
  on conflict (email_normalized, position_id, term_id) do nothing;
  get diagnostics v_offered = row_count;

  -- A society with no board after the switch could not be put right from the portal again.
  if not exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.term_id = v_next.id and a.status = 'active' and p.level in ('eb', 'webmaster')
  ) then
    raise exception 'Nobody would keep the Executive Board''s access in %. Set the board''s work emails, and sign in once with one of those accounts, first.', v_label
      using errcode = '22023';
  end if;

  -- 3. The roster's positions below officer, for the next term, on the address of the account
  --    the row is linked to (else the row's own), so a linked member keeps the position.
  insert into public.invites (email, position_id, term_id, invited_by)
  select coalesce(pr.email, r.email), r.position_id, v_next.id, auth.uid()
  from public.roster_entries r
  join public.positions p on p.id = r.position_id and p.active
  left join public.profiles pr on pr.id = r.profile_id and pr.email_normalized is not null
  where coalesce(pr.email_normalized, r.email_normalized) is not null
    and not app.position_is_privileged(r.position_id)
  on conflict (email_normalized, position_id, term_id) do nothing;
  get diagnostics v_roster = row_count;

  -- 4. Open tasks move into the next term (app.guard_task lets the term change for this call).
  perform set_config('app.rolling_over', 'on', true);
  update public.tasks t
     set term_id = v_next.id
   where t.status <> 'done' and t.term_id <> v_next.id;
  get diagnostics v_tasks = row_count;
  perform set_config('app.rolling_over', '', true);

  -- 5. The ticked albums go to the archive, under the term that is ending.
  update public.albums a
     set archived_term_id = v_current.id
   where a.id = any (coalesce(roll_over_term.archive_albums, '{}'))
     and a.archived_term_id is null;
  get diagnostics v_albums = row_count;

  -- 6. The exams' registered lists, papers and answers are kept for one term: they go. The
  --    exams, their questions and their keys stay.
  v_exam_rows := app.clear_exam_rows(v_current.id);

  -- 7. The switch, then the old term's assignments end.
  update public.terms t set is_current = false where t.is_current;
  update public.terms t set is_current = true where t.id = v_next.id;

  update public.assignments a
     set status = 'ended', ended_on = (now() at time zone 'Africa/Cairo')::date
   where a.term_id = v_current.id and a.status = 'active';
  get diagnostics v_ended = row_count;

  -- The old term's offers nobody took up: a first sign-in would otherwise still turn them into
  -- assignments of a term that is over.
  delete from public.invites i
   where i.term_id = v_current.id and i.accepted_at is null;

  perform app.request_site_rebuild('rollover');

  select count(*)::int,
         count(*) filter (where i.accepted_at is null)::int
    into v_held, v_waiting
  from public.position_work_emails w
  join public.positions p on p.id = w.position_id and p.active
  left join public.invites i
    on i.position_id = w.position_id and i.term_id = v_next.id
   and i.email_normalized = w.email_normalized;

  return jsonb_build_object(
    'from', v_current.label,
    'to', v_next.label,
    'work_accounts', v_held - v_waiting,
    'work_accounts_waiting', v_waiting,
    'work_offers_made', v_offered,
    'roster_offers_made', v_roster,
    'tasks_moved', v_tasks,
    'albums_archived', v_albums,
    'exam_attempts_deleted', (v_exam_rows ->> 'attempts')::int,
    'exam_registrations_deleted', (v_exam_rows ->> 'registrations')::int,
    'assignments_ended', v_ended
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.clear_exam_rows(uuid) owner to postgres;
alter function public.rollover_preview() owner to postgres;
alter function public.roll_over_term(text, date, date, uuid[]) owner to postgres;

-- called only inside rpc/roll_over_term: no grant, and said for each API role because it deletes
revoke execute on function app.clear_exam_rows(uuid) from public, anon, authenticated;
revoke execute on function public.rollover_preview() from public, anon;
grant execute on function public.rollover_preview() to authenticated;
revoke execute on function public.roll_over_term(text, date, date, uuid[]) from public, anon;
grant execute on function public.roll_over_term(text, date, date, uuid[]) to authenticated;
