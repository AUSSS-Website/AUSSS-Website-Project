-- Two roster facts that went stale by themselves.
--
-- YEARS SPENT was a number copied from the spreadsheet, right on the day the Secretary General
-- typed it and wrong after every September. It is arithmetic: a term runs 1 September to 31
-- August, so it is the starting year of the running academic year minus the year joined (the
-- sheet's own numbers follow this: joined 2025 -> 0 during 2025-26, 1 from 1 September 2026).
-- The database now keeps it: on every insert/update of a roster row, and for the whole roster
-- by a daily job, so it rolls over on 1 September without anyone doing anything (it does not
-- depend on the EB switching the portal's current term). Rows with no joining year keep
-- whatever they had.
--
-- MEMBERSHIP STATUS. With GA attendance registered in the portal, the database can tell who has
-- reached the next tier (Bylaws 2.5.1, 2.6.1):
--     Candidate -> Associate : 1 Local GA or 2 National GAs
--     Associate -> Full      : 2 Local GAs and 3 National GAs
-- It does NOT change anyone's status. The Bylaws have the Executive Board grant a status after
-- an evaluation that also needs the minimum activity score, which the roster does not hold, and
-- a status carries proposing, voting and candidature rights. So rpc/roster_upgrade_candidates
-- lists who is eligible and why; the EB approves (through bulk_update_roster: logged, undoable)
-- or sets a member aside, which hides them from the list until the next term.

-- ---------------------------------------------------------------------------------------------
-- Years spent
-- ---------------------------------------------------------------------------------------------

-- The starting year of the academic year a day falls in: September onwards belongs to that
-- calendar year, January to August to the one before. Cairo days, like every other date here.
create or replace function app.academic_year_start(p_day date default null)
returns int
language sql
stable
parallel safe
set search_path = ''
as $$
  select extract(year from d.day)::int - case when extract(month from d.day) >= 9 then 0 else 1 end
  from (select coalesce(p_day, app.today_cairo()) as day) d
$$;

-- null for an unknown joining year (then callers keep the value they have); never negative.
create or replace function app.years_spent(p_joined_year int)
returns int
language sql
stable
parallel safe
set search_path = ''
as $$
  select greatest(0, app.academic_year_start() - p_joined_year)
$$;

-- before insert/update on roster_entries (from 20260919200001), now also keeping years_spent.
-- A computed column must not count as somebody's edit, so it leaves the portal-edit comparison
-- unless the row has no joining year (then it is still a typed value).
create or replace function app.normalize_roster_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := left(btrim(regexp_replace(coalesce(new.full_name, ''), '\s+', ' ', 'g')), 200);
  if new.full_name = '' then
    raise exception 'A member needs a name.' using errcode = '22023';
  end if;
  new.name_normalized := app.normalize_text(new.full_name);
  new.email := left(nullif(btrim(new.email), ''), 200);
  new.status := left(nullif(btrim(new.status), ''), 80);
  new.lgas := left(nullif(btrim(new.lgas), ''), 20);
  new.ngas := left(nullif(btrim(new.ngas), ''), 20);
  new.current_position := left(nullif(btrim(new.current_position), ''), 400);
  if new.joined_year is not null then
    new.years_spent := coalesce(app.years_spent(new.joined_year), new.years_spent);
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.source_key, '') = '' then
      new.source_key := 'portal:' || gen_random_uuid()::text;
    end if;
    if auth.uid() is not null and not app.roster_importing() then
      new.origin := 'portal';
      new.portal_edited_at := now();
      new.portal_edited_by := auth.uid();
    end if;
  elsif auth.uid() is not null
    and not app.roster_importing()
    and (new.full_name, new.email, new.status, new.joined_year,
         case when new.joined_year is null then new.years_spent end,
         new.lgas, new.ngas, new.current_position)
        is distinct from
        (old.full_name, old.email, old.status, old.joined_year,
         case when old.joined_year is null then old.years_spent end,
         old.lgas, old.ngas, old.current_position)
  then
    new.portal_edited_at := now();
    new.portal_edited_by := auth.uid();
  end if;
  return new;
end
$$;

-- The rollover: rewrites only rows whose number is out of date, so on 364 days of the year it
-- touches nothing. Runs daily rather than "on 1 September" so a missed run heals the next day.
-- Returns how many rows moved.
create or replace function app.refresh_years_spent()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.roster_entries r
    set years_spent = app.years_spent(r.joined_year)
  where r.joined_year is not null
    and r.years_spent is distinct from app.years_spent(r.joined_year);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- 22:15 UTC is 00:15 or 01:15 in Cairo: the first minutes of the new day either way.
select cron.unschedule(jobid) from cron.job where jobname = 'roster-years-spent';
select cron.schedule('roster-years-spent', '15 22 * * *', $cron$ select app.refresh_years_spent() $cron$);

-- The merge (from 20260919200001): the sheet's years-spent number no longer makes a row look
-- changed, or every hourly pull would "update" the whole roster back and forth.
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
  v_seen text[] := '{}';
  v_row public.roster_entries%rowtype;
  v_batch text := left(nullif(btrim(coalesce(p_batch, '')), ''), 80);
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_kept int := 0;
  v_invalid int := 0;
  v_duplicates int := 0;
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

    if v_row.id is null then
      insert into public.roster_entries (
        source_key, full_name, name_normalized, email, status, joined_year, years_spent,
        lgas, ngas, current_position, import_batch, imported_at, origin
      )
      values (
        v_key, v_name, v_name_norm, v_email, v_status, v_joined, v_years,
        v_lgas, v_ngas, v_position, v_batch, now(), 'sheet'
      );
      v_inserted := v_inserted + 1;
    elsif (v_name, v_email, v_status, v_joined, v_years, v_lgas, v_ngas, v_position)
          is not distinct from
          (v_row.full_name, v_row.email, v_row.status, v_row.joined_year, v_row.years_spent,
           v_row.lgas, v_row.ngas, v_row.current_position) then
      v_unchanged := v_unchanged + 1;
    elsif v_row.portal_edited_at is not null then
      v_kept := v_kept + 1;
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
    v_row := null;
  end loop;

  if v_inserted + v_updated + v_unchanged + v_kept = 0 then
    raise exception 'No member rows found in that file.' using errcode = '22023';
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(m.full_name order by m.full_name) filter (where m.rn <= 50), '[]'::jsonb)
    into v_missing, v_missing_names
  from (
    select r.full_name, row_number() over (order by r.full_name) as rn
    from public.roster_entries r
    where r.origin = 'sheet'
      and r.portal_edited_at is null
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

  insert into public.roster_sync_runs (source, actor, batch, result)
  values (p_source, auth.uid(), v_batch, v_result);

  perform set_config('app.roster_import', 'off', true);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Upgrade eligibility
-- ---------------------------------------------------------------------------------------------

-- GA counts are free text: "", "0", "3", ">2" (at least 3), "2+" (at least 2). The number of
-- attendances that text guarantees; text without a number guarantees none.
create or replace function app.count_floor(text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when $1 ~ '\d' then (substring($1 from '\d+'))::int + case when $1 ~ '>' then 1 else 0 end
    else 0
  end
$$;

-- The status a member has earned by attendance, or null. One step at a time, as the Bylaws read.
create or replace function app.next_status(p_status text, p_lgas text, p_ngas text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when app.normalize_text(p_status) like '%archiv%' or app.normalize_text(p_status) like '%suspend%' then null
    when app.normalize_text(p_status) like '%candidate%'
         and (app.count_floor(p_lgas) >= 1 or app.count_floor(p_ngas) >= 2) then 'Associate Member'
    when app.normalize_text(p_status) like '%associate%'
         and app.count_floor(p_lgas) >= 2 and app.count_floor(p_ngas) >= 3 then 'Full Member'
    else null
  end
$$;

-- "Not now": the EB looked and decided against this upgrade (activity score, discipline).
-- Remembered per target status and only for the term it was decided in.
alter table public.roster_entries
  add column if not exists upgrade_dismissed_for text null,
  add column if not exists upgrade_dismissed_at timestamptz null;

create or replace function public.roster_upgrade_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term_start date;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can review upgrades' using errcode = '42501';
  end if;
  -- "not now" lasts for the academic year it was said in
  v_term_start := make_date(app.academic_year_start(), 9, 1);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id, 'full_name', c.full_name, 'email', c.email, 'status', c.status,
        'next', c.next, 'lgas', coalesce(c.lgas, '0'), 'ngas', coalesce(c.ngas, '0')
      ) order by c.next, c.full_name
    )
    from (
      select r.*, app.next_status(r.status, r.lgas, r.ngas) as next
      from public.roster_entries r
    ) c
    where c.next is not null
      and not (
        c.upgrade_dismissed_for is not distinct from c.next
        and c.upgrade_dismissed_at >= (v_term_start::timestamp at time zone 'Africa/Cairo')
      )
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants, then bring today's rows up to date
-- ---------------------------------------------------------------------------------------------

alter function app.academic_year_start(date) owner to postgres;
alter function app.years_spent(int) owner to postgres;
alter function app.refresh_years_spent() owner to postgres;
alter function app.count_floor(text) owner to postgres;
alter function app.next_status(text, text, text) owner to postgres;
alter function public.roster_upgrade_candidates() owner to postgres;

-- years_spent runs inside the (security invoker) before trigger, as whoever writes the row
revoke execute on function app.years_spent(int) from public;
grant execute on function app.years_spent(int) to authenticated, service_role;
revoke execute on function app.academic_year_start(date) from public;
grant execute on function app.academic_year_start(date) to authenticated, service_role;
revoke execute on function app.refresh_years_spent() from public, anon, authenticated, service_role;
revoke execute on function app.count_floor(text) from public;
revoke execute on function app.next_status(text, text, text) from public;
revoke execute on function public.roster_upgrade_candidates() from public, anon;
grant execute on function public.roster_upgrade_candidates() to authenticated;

update public.roster_entries r
  set years_spent = app.years_spent(r.joined_year)
where r.joined_year is not null
  and r.years_spent is distinct from app.years_spent(r.joined_year);
