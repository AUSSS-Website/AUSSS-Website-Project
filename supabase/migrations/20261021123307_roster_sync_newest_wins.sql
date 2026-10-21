-- Two changes to the roster sync (2026-10-21). The user: "The roster excel sheet sync isn't
-- working", then "Also change the auto sync to only run once per day".
--
-- 1. A change in the sheet now reaches a row that was edited in the portal.
--
--    Until now a row edited on the Roster page belonged to the portal as a whole, and every later
--    import left all of it alone. On 2026-10-05 seven members were given their positions on the
--    Roster page, and the position text the sheet had for them ("LEO-IN", "President") was taken
--    out of "Other positions" so it would not show twice. That one tidy-up froze each whole row:
--    the sheet has since moved four of them on (a new status, more LGAs and NGAs), and the roster
--    never took it in. The hourly runs reported them as "kept", nothing more.
--
--    From here the newest change wins, field by field. The import remembers, for each member,
--    what the sheet said and what the row held when it last ran (app.roster_sheet_lines). On a
--    row edited in the portal, a field takes the sheet's value when the sheet has changed that
--    field since the last import and the portal has not; otherwise the portal's value stays. An
--    edit made in the portal holds until the Secretary General changes that same field in the
--    sheet, and the other fields go on following the sheet. When both changed the same field
--    between two imports, nobody can tell which came last, so the portal's value stays (as it
--    always did) and the sheet's next change to it wins. A row never edited in the portal
--    follows the sheet entirely, as before, and so does one handed back with "Follow the
--    spreadsheet again". Nothing else about the import changes: nobody is removed, dismissed
--    members are left alone, every run is logged.
--
--    The record is filled in below for the members already on the roster. What the row held is
--    what it holds now. What the sheet said is the same for a row that follows the sheet (the
--    last runs found every such row unchanged); for a row edited in the portal, it is what the
--    row held just before the edit that made it the portal's, from the audit log. A row with
--    nothing on record keeps all its portal values, as before.
--
-- 2. The scheduled pull runs once a day, at 02:07 UTC (4 or 5 in the morning in Cairo), instead
--    of every hour. "Sync now" on the Roster page still pulls at once.

-- ---------------------------------------------------------------------------------------------
-- What the sheet said, member by member
-- ---------------------------------------------------------------------------------------------

-- One row per roster row the sheet (or an uploaded copy of it) has listed: the eight fields as
-- the last import read them in the sheet (`line`) and as the row held them once that import was
-- done (`held`). Only the import reads or writes it.
create table if not exists app.roster_sheet_lines (
  entry_id uuid primary key references public.roster_entries (id) on delete cascade,
  line jsonb not null,
  held jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table app.roster_sheet_lines enable row level security;
revoke all on app.roster_sheet_lines from public, anon, authenticated;

-- The eight fields as one document, in the same shape whether they come from the sheet or from a
-- row, so two can be compared field by field. The email is compared as the member's key compares
-- it (app.norm_email), so a change of capitals is no change. Years spent counts only when there
-- is no joining year: with one, it is worked out from the year (app.years_spent) and the sheet's
-- number is not used.
create or replace function app.roster_sheet_line(
  p_name text,
  p_email text,
  p_status text,
  p_joined int,
  p_years int,
  p_lgas text,
  p_ngas text,
  p_position text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p_name,
    'email', app.norm_email(p_email),
    'status', p_status,
    'joined_year', p_joined::text,
    'years_spent', case when p_joined is null then p_years::text end,
    'lgas', p_lgas,
    'ngas', p_ngas,
    'current_position', p_position
  )
$$;
alter function app.roster_sheet_line(text, text, text, int, int, text, text, text) owner to postgres;
revoke execute on function app.roster_sheet_line(text, text, text, int, int, text, text, text)
  from public, anon, authenticated, service_role;

-- Rows that follow the sheet hold what it said at the last import.
insert into app.roster_sheet_lines (entry_id, line, held)
select r.id, s.line, s.line
from public.roster_entries r
cross join lateral (
  select app.roster_sheet_line(r.full_name, r.email, r.status, r.joined_year, r.years_spent,
                               r.lgas, r.ngas, r.current_position) as line
) s
where r.origin = 'sheet' and r.portal_edited_at is null
on conflict (entry_id) do nothing;

-- A row edited in the portal held what the sheet said until the edit that made it the portal's
-- (the latest one, in case it was handed back and edited again); what it holds now is the
-- portal's.
insert into app.roster_sheet_lines (entry_id, line, held)
select distinct on (r.id)
       r.id,
       app.roster_sheet_line(a.before ->> 'full_name', a.before ->> 'email', a.before ->> 'status',
                             (a.before ->> 'joined_year')::int, (a.before ->> 'years_spent')::int,
                             a.before ->> 'lgas', a.before ->> 'ngas', a.before ->> 'current_position'),
       app.roster_sheet_line(r.full_name, r.email, r.status, r.joined_year, r.years_spent,
                             r.lgas, r.ngas, r.current_position)
from public.roster_entries r
join public.audit_log a
  on a.table_name = 'roster_entries'
 and a.row_id = r.id::text
 and a.action = 'UPDATE'
 and (a.before ->> 'portal_edited_at') is null
 and (a.after ->> 'portal_edited_at') is not null
where r.origin = 'sheet' and r.portal_edited_at is not null
order by r.id, a.at desc, a.id desc
on conflict (entry_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- The merge: the newest change wins, field by field
-- ---------------------------------------------------------------------------------------------

-- As 20261011130001, with the change in the header: on a row edited in the portal, each field
-- takes the sheet's value only when the sheet changed it since the last import and the portal
-- did not, and every row the sheet lists has its record brought up to date. "kept_portal_edits"
-- still counts the rows where a portal value was kept against the sheet and nothing else
-- changed.
create or replace function app.apply_roster_rows(p_rows jsonb, p_batch text, p_source text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_name_norm text;
  v_email text;
  v_status text;
  v_joined int;
  v_years int;
  v_lgas text;
  v_ngas text;
  v_position text;
  v_key text;
  v_line jsonb;
  v_last jsonb;
  v_held jsonb;
  v_now jsonb;
  v_id uuid;
  v_seen text[] := '{}';
  v_row public.roster_entries%rowtype;
  v_batch text := left(nullif(btrim(coalesce(p_batch, '')), ''), 80);
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_kept int := 0;
  v_invalid int := 0;
  v_duplicates int := 0;
  v_dismissed int := 0;
  v_missing int;
  v_missing_names jsonb;
  v_claimed int;
  v_result jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'No member rows found in that file.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Too many rows (limit 5000).' using errcode = '22023';
  end if;
  if v_batch is null then
    v_batch := to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD');
  end if;

  perform set_config('app.roster_import', 'on', true);

  for v_item in select e from jsonb_array_elements(p_rows) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_name := left(btrim(regexp_replace(coalesce(v_item ->> 'full_name', ''), '\s+', ' ', 'g')), 200);
    if v_name = '' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_name_norm := app.normalize_text(v_name);
    v_email := left(nullif(btrim(v_item ->> 'email'), ''), 200);
    v_status := left(nullif(btrim(v_item ->> 'status'), ''), 80);
    v_lgas := left(nullif(btrim(v_item ->> 'lgas'), ''), 20);
    v_ngas := left(nullif(btrim(v_item ->> 'ngas'), ''), 20);
    v_position := left(nullif(btrim(v_item ->> 'current_position'), ''), 400);
    v_joined := case when (v_item ->> 'joined_year') ~ '^\s*\d{1,4}\s*$'
                     then btrim(v_item ->> 'joined_year')::int end;
    v_years := case when (v_item ->> 'years_spent') ~ '^\s*\d{1,3}\s*$'
                    then btrim(v_item ->> 'years_spent')::int end;
    -- years spent is counted from the joining year (app.years_spent); the sheet's own number only
    -- matters for the few rows with no joining year, so it never makes a row look changed
    if v_joined is not null then
      v_years := coalesce(app.years_spent(v_joined), v_years);
    end if;

    v_key := encode(
      sha256(convert_to(v_name_norm || '|' || coalesce(app.norm_email(v_email), ''), 'UTF8')),
      'hex'
    );
    if v_key = any (v_seen) then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;
    v_seen := v_seen || v_key;

    -- a dismissed member's line changes nothing and adds nobody; neither does a line that
    -- would dismiss somebody. The name alone is enough, except for a namesake the roster
    -- already has: an ordinary row with this line's own key (the same name and email) is
    -- another person, and their line goes on as it always did
    if app.normalize_text(v_status) like '%dismiss%'
      or app.is_dismissed_email(v_email)
      or exists (
        select 1 from public.roster_entries d
        where d.dismissed_at is not null and d.source_key = v_key)
      or (exists (
            select 1 from public.roster_entries d
            where d.dismissed_at is not null and d.name_normalized = v_name_norm)
          and not exists (
            select 1 from public.roster_entries o
            where o.dismissed_at is null and o.source_key = v_key))
    then
      v_dismissed := v_dismissed + 1;
      continue;
    end if;

    select r.* into v_row from public.roster_entries r where r.source_key = v_key;
    if not found and v_email is not null then
      -- the sheet gained an email for someone it already listed without one
      if (select count(*) from public.roster_entries r
          where r.name_normalized = v_name_norm and r.email_normalized is null
            and r.origin = 'sheet' and r.source_key <> all (v_seen)) = 1 then
        select r.* into v_row
        from public.roster_entries r
        where r.name_normalized = v_name_norm and r.email_normalized is null
          and r.origin = 'sheet' and r.source_key <> all (v_seen);
      end if;
    end if;

    -- what the sheet says for this member, before any portal value is weighed against it
    v_line := app.roster_sheet_line(v_name, v_email, v_status, v_joined, v_years,
                                    v_lgas, v_ngas, v_position);

    if v_row.id is null then
      insert into public.roster_entries (
        source_key, full_name, name_normalized, email, status, joined_year, years_spent,
        lgas, ngas, current_position, import_batch, imported_at, origin
      )
      values (
        v_key, v_name, v_name_norm, v_email, v_status, v_joined, v_years,
        v_lgas, v_ngas, v_position, v_batch, now(), 'sheet'
      )
      returning id into v_id;
      v_inserted := v_inserted + 1;
    else
      v_id := v_row.id;
      -- the row as it stands, in the record's shape
      v_now := app.roster_sheet_line(v_row.full_name, v_row.email, v_row.status, v_row.joined_year,
                                     v_row.years_spent, v_row.lgas, v_row.ngas, v_row.current_position);
      if v_row.portal_edited_at is not null then
        -- edited in the portal: a field takes the sheet's value only when the sheet changed it
        -- since the last import (`line`) and the portal did not (`held`). With no record (a row
        -- edited before records were kept), every portal value stays
        select l.line, l.held into v_last, v_held from app.roster_sheet_lines l where l.entry_id = v_row.id;
        if v_last is null
          or (v_last ->> 'full_name') is not distinct from (v_line ->> 'full_name')
          or (v_held ->> 'full_name') is distinct from (v_now ->> 'full_name') then
          v_name := v_row.full_name;
        end if;
        if v_last is null
          or (v_last ->> 'email') is not distinct from (v_line ->> 'email')
          or (v_held ->> 'email') is distinct from (v_now ->> 'email') then
          v_email := v_row.email;
        end if;
        if v_last is null
          or (v_last ->> 'status') is not distinct from (v_line ->> 'status')
          or (v_held ->> 'status') is distinct from (v_now ->> 'status') then
          v_status := v_row.status;
        end if;
        if v_last is null
          or (v_last ->> 'joined_year') is not distinct from (v_line ->> 'joined_year')
          or (v_held ->> 'joined_year') is distinct from (v_now ->> 'joined_year') then
          v_joined := v_row.joined_year;
        end if;
        if v_last is null
          or (v_last ->> 'years_spent') is not distinct from (v_line ->> 'years_spent')
          or (v_held ->> 'years_spent') is distinct from (v_now ->> 'years_spent') then
          v_years := v_row.years_spent;
        end if;
        if v_joined is not null then
          v_years := coalesce(app.years_spent(v_joined), v_years);
        end if;
        if v_last is null
          or (v_last ->> 'lgas') is not distinct from (v_line ->> 'lgas')
          or (v_held ->> 'lgas') is distinct from (v_now ->> 'lgas') then
          v_lgas := v_row.lgas;
        end if;
        if v_last is null
          or (v_last ->> 'ngas') is not distinct from (v_line ->> 'ngas')
          or (v_held ->> 'ngas') is distinct from (v_now ->> 'ngas') then
          v_ngas := v_row.ngas;
        end if;
        if v_last is null
          or (v_last ->> 'current_position') is not distinct from (v_line ->> 'current_position')
          or (v_held ->> 'current_position') is distinct from (v_now ->> 'current_position') then
          v_position := v_row.current_position;
        end if;
        v_last := null;
        v_held := null;
      end if;

      if (v_name, v_email, v_status, v_joined, v_years, v_lgas, v_ngas, v_position)
         is not distinct from
         (v_row.full_name, v_row.email, v_row.status, v_row.joined_year, v_row.years_spent,
          v_row.lgas, v_row.ngas, v_row.current_position) then
        -- nothing to write: the row already says what the sheet says, or it keeps a portal
        -- value the sheet has not changed since
        if v_line is distinct from v_now then
          v_kept := v_kept + 1;
        else
          v_unchanged := v_unchanged + 1;
        end if;
      else
        update public.roster_entries r
          set source_key = v_key,
              full_name = v_name,
              email = v_email,
              status = v_status,
              joined_year = v_joined,
              years_spent = v_years,
              lgas = v_lgas,
              ngas = v_ngas,
              current_position = v_position,
              import_batch = v_batch,
              imported_at = now()
        where r.id = v_row.id;
        v_updated := v_updated + 1;
      end if;
    end if;

    -- what the sheet said and what the row now holds, so the next import can tell which side
    -- changed a field
    v_now := app.roster_sheet_line(v_name, v_email, v_status, v_joined, v_years,
                                   v_lgas, v_ngas, v_position);
    insert into app.roster_sheet_lines as l (entry_id, line, held)
    values (v_id, v_line, v_now)
    on conflict (entry_id) do update
      set line = excluded.line, held = excluded.held, recorded_at = now()
      where l.line is distinct from excluded.line or l.held is distinct from excluded.held;

    v_row := null;
    v_id := null;
    v_now := null;
  end loop;

  if v_inserted + v_updated + v_unchanged + v_kept + v_dismissed = 0 then
    raise exception 'No member rows found in that file.' using errcode = '22023';
  end if;

  -- a dismissed member taken off the sheet is what one would expect, so is not reported
  select count(*)::int,
         coalesce(jsonb_agg(m.full_name order by m.full_name) filter (where m.rn <= 50), '[]'::jsonb)
    into v_missing, v_missing_names
  from (
    select r.full_name, row_number() over (order by r.full_name) as rn
    from public.roster_entries r
    where r.origin = 'sheet'
      and r.portal_edited_at is null
      and r.dismissed_at is null
      and r.source_key <> all (v_seen)
  ) m;

  v_claimed := app.claim_unlinked();

  v_result := jsonb_build_object(
    'received', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'kept_portal_edits', v_kept,
    'skipped_invalid', v_invalid,
    'skipped_duplicates', v_duplicates,
    'missing_from_sheet', v_missing,
    'missing_names', v_missing_names,
    'profiles_checked', v_claimed
  );
  -- Only when a line was left alone for it, so a run with none answers in the shape it
  -- always had.
  if v_dismissed > 0 then
    v_result := v_result || jsonb_build_object('skipped_dismissed', v_dismissed);
  end if;

  insert into public.roster_sync_runs (source, actor, batch, result)
  values (p_source, auth.uid(), v_batch, v_result);

  perform set_config('app.roster_import', 'off', true);
  return v_result;
end
$$;
alter function app.apply_roster_rows(jsonb, text, text) owner to postgres;
revoke execute on function app.apply_roster_rows(jsonb, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The scheduled pull: once a day
-- ---------------------------------------------------------------------------------------------

-- Only the schedule changes; what the job runs is as 20260919210001 set it.
select cron.alter_job(j.jobid, schedule := '7 2 * * *')
from cron.job j
where j.jobname = 'roster-sheet-sync';
