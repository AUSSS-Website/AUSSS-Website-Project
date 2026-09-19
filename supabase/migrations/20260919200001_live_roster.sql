-- Live membership roster. Until now roster_entries was a one-way mirror of the Secretary
-- General's spreadsheet, loaded by a script that needed the secret key, and the public
-- "Check your membership" page answered from a hash table baked into the bundle. This migration
-- makes the table the working copy of the roster:
--
--   * the EB edits rows in the portal (RLS already allows it); a row edited there is stamped
--     portal_edited_at and is from then on OWNED BY THE PORTAL: spreadsheet imports skip it, so
--     the two editors never overwrite each other;
--   * the spreadsheet keeps flowing in while people still use it, through one merge routine
--     (app.apply_roster_rows) reached three ways: rpc/import_roster (EB uploads a file in the
--     portal), rpc/sync_roster_from_sheet (Apps Script bound to the sheet, authenticated by a
--     rotating token) and rpc/admin_import_roster (scripts/db/import-roster.mjs, secret key);
--   * a status change on a linked roster row follows through to the member's profile;
--   * the public page asks rpc/check_membership, which returns one person's membership facts
--     (never a name or an email) and is rate limited.

-- ---------------------------------------------------------------------------------------------
-- roster_entries: who owns the row
-- ---------------------------------------------------------------------------------------------

alter table public.roster_entries
  add column if not exists origin text not null default 'sheet'
    check (origin in ('sheet', 'portal')),
  add column if not exists portal_edited_at timestamptz null,
  add column if not exists portal_edited_by uuid null references public.profiles (id) on delete set null;

create index if not exists roster_entries_portal_edited_by_idx
  on public.roster_entries (portal_edited_by);

-- True while app.apply_roster_rows is writing, so its rows are not mistaken for portal edits.
create or replace function app.roster_importing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.roster_import', true), '') = 'on'
$$;

-- before insert/update: tidy the text, own name_normalized (so lookups never depend on which
-- client computed it), give portal-made rows a source_key, and stamp portal edits.
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
    and (new.full_name, new.email, new.status, new.joined_year, new.years_spent,
         new.lgas, new.ngas, new.current_position)
        is distinct from
        (old.full_name, old.email, old.status, old.joined_year, old.years_spent,
         old.lgas, old.ngas, old.current_position)
  then
    new.portal_edited_at := now();
    new.portal_edited_by := auth.uid();
  end if;
  return new;
end
$$;

-- after insert/update. Security definer: it writes profiles.membership_* (which no API role
-- may update) and calls app.claim_for_profile.
--   (1) the status or joining year of an already linked row changed: the profile follows.
--       Linking itself is left to app.claim_for_profile, which only upgrades an unverified
--       profile; here the roster edit IS the decision, so it applies whatever the old status.
--   (2) an unlinked row gained an email that a signed-in person already uses: link them now
--       rather than at their next sign-in. Imports skip this and claim once at the end.
create or replace function app.sync_roster_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text;
  v_profile uuid;
begin
  if tg_op = 'UPDATE'
    and new.profile_id is not null
    and new.profile_id is not distinct from old.profile_id
    and (new.status is distinct from old.status or new.joined_year is distinct from old.joined_year)
  then
    v_norm := app.normalize_text(new.status);
    update public.profiles p
      set membership_tier = coalesce(new.status, p.membership_tier),
          joined_year = coalesce(new.joined_year, p.joined_year),
          membership_status = case
            when v_norm like '%archiv%' or v_norm like '%suspend%' then p.membership_status
            when v_norm like '%full%' or v_norm like '%associate%' then 'active'
            when v_norm like '%candidate%' then 'candidate'
            when v_norm like '%alumni%' or v_norm like '%honor%' then 'alumni'
            else p.membership_status
          end
    where p.id = new.profile_id;
  end if;

  if new.profile_id is null
    and new.email_normalized is not null
    and not app.roster_importing()
    and (tg_op = 'INSERT' or new.email_normalized is distinct from old.email_normalized)
  then
    for v_profile in
      select p.id
      from public.profiles p
      where p.email_normalized = new.email_normalized
        and not exists (select 1 from public.roster_entries r where r.profile_id = p.id)
    loop
      perform app.claim_for_profile(v_profile);
    end loop;
  end if;
  return null;
end
$$;

drop trigger if exists normalize_roster_entry on public.roster_entries;
create trigger normalize_roster_entry before insert or update on public.roster_entries
  for each row execute function app.normalize_roster_entry();
drop trigger if exists sync_roster_entry on public.roster_entries;
create trigger sync_roster_entry after insert or update on public.roster_entries
  for each row execute function app.sync_roster_entry();

-- ---------------------------------------------------------------------------------------------
-- Import log (EB-readable) and the sheet-sync token (private)
-- ---------------------------------------------------------------------------------------------

-- One row per import, whatever the route. result is what app.apply_roster_rows returned,
-- including the names of roster rows the spreadsheet no longer lists, hence EB only.
create table if not exists public.roster_sync_runs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (source in ('upload', 'sheet', 'script')),
  actor uuid null references public.profiles (id) on delete set null,
  batch text,
  result jsonb not null default '{}'::jsonb
);

create index if not exists roster_sync_runs_at_idx on public.roster_sync_runs (at);
create index if not exists roster_sync_runs_actor_idx on public.roster_sync_runs (actor);

alter table public.roster_sync_runs enable row level security;
grant select on public.roster_sync_runs to authenticated;
grant all on public.roster_sync_runs to service_role;

drop policy if exists roster_sync_runs_select on public.roster_sync_runs;
create policy roster_sync_runs_select on public.roster_sync_runs
  for select to authenticated
  using ((select app.is_eb()));

-- The Apps Script bound to the spreadsheet proves itself with a token; only its sha256 is kept.
-- Single row. `app` is not exposed through the Data API; the revoke is belt and braces.
create table if not exists app.roster_sync_token (
  id boolean primary key default true check (id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid null
);
alter table app.roster_sync_token enable row level security;
revoke all on app.roster_sync_token from public, anon, authenticated;

-- Anonymous lookups, for rate limiting only: a timestamp and a hash of the caller's address,
-- deleted after an hour. What was searched for is never stored.
create table if not exists app.membership_lookup_hits (
  at timestamptz not null default now(),
  ip_hash text
);
create index if not exists membership_lookup_hits_at_idx on app.membership_lookup_hits (at);
alter table app.membership_lookup_hits enable row level security;
revoke all on app.membership_lookup_hits from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- app.apply_roster_rows: the one merge routine
-- ---------------------------------------------------------------------------------------------

-- p_rows: [{ full_name, email, status, joined_year, years_spent, lgas, ngas, current_position }]
-- (every value a string or null; years that are not plain integers become null).
--
-- A spreadsheet row is matched to a roster row by source_key = sha256(name|email), or, when the
-- sheet has just gained an email for someone, by the single email-less sheet row of that name.
-- Rows the portal owns (portal_edited_at set) are never overwritten; rows that vanished from
-- the sheet are never deleted, only reported, because a bad export must not erase members.
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
-- Import RPCs
-- ---------------------------------------------------------------------------------------------

-- EB uploads the spreadsheet (xlsx or csv) in the portal; the browser parses it.
create or replace function public.import_roster(rows jsonb, batch text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can import the roster' using errcode = '42501';
  end if;
  return app.apply_roster_rows(rows, batch, 'upload');
end
$$;

-- scripts/db/import-roster.mjs (secret key only).
create or replace function public.admin_import_roster(rows jsonb, batch text default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.apply_roster_rows(rows, batch, 'script')
$$;

-- EB issues (or replaces) the token the spreadsheet's Apps Script sends. Returned once; only
-- the hash is stored, so a lost token is replaced, not recovered.
create or replace function public.rotate_roster_sync_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can issue the sync token' using errcode = '42501';
  end if;
  v_token := 'rst_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into app.roster_sync_token (id, token_hash, created_at, created_by)
  values (true, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now(), auth.uid())
  on conflict (id) do update
    set token_hash = excluded.token_hash,
        created_at = excluded.created_at,
        created_by = excluded.created_by;
  return v_token;
end
$$;

-- EB turns the spreadsheet sync off (the moment the portal becomes the only editor).
create or replace function public.revoke_roster_sync_token()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can revoke the sync token' using errcode = '42501';
  end if;
  delete from app.roster_sync_token;
end
$$;

-- What the portal shows about the sync: is a token active, and since when.
create or replace function public.roster_sync_token_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can see the sync token state' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_build_object('active', true, 'created_at', t.created_at) from app.roster_sync_token t),
    jsonb_build_object('active', false)
  );
end
$$;

-- Called by apps-script/roster-sync.gs with the token. Anonymous on purpose (Apps Script has no
-- Supabase session); the token is 244 random bits, compared by hash.
create or replace function public.sync_roster_from_sheet(token text, rows jsonb, batch text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(token, '') = '' or not exists (
    select 1 from app.roster_sync_token t
    where t.token_hash = encode(sha256(convert_to(sync_roster_from_sheet.token, 'UTF8')), 'hex')
  ) then
    raise exception 'Invalid or revoked sync token.' using errcode = '42501';
  end if;
  return app.apply_roster_rows(rows, batch, 'sheet');
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Public RPCs: rpc/check_membership and rpc/roster_stats
-- ---------------------------------------------------------------------------------------------

-- The "Check your membership" page. Email is tried first (the best row wins when the roster has
-- the address twice, same order as claiming); a name must identify exactly one person. `role`
-- takes one fixed value, for the Supervising Council card whose holder's name is spelt several
-- ways. The answer holds membership facts only: no name, no email, no id.
-- Limits: 30 lookups per 10 minutes per address, 300 per minute overall.
create or replace function public.check_membership(
  name text default '',
  email text default '',
  role text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := app.normalize_text(left(coalesce(check_membership.name, ''), 200));
  v_email text := app.norm_email(left(coalesce(check_membership.email, ''), 200));
  v_headers jsonb;
  v_ip text;
  v_ip_hash text;
  v_row public.roster_entries%rowtype;
  v_count int;
begin
  if v_name = '' and v_email is null and role is null then
    return jsonb_build_object('state', 'not-found');
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
  if v_ip <> '' then
    v_ip_hash := encode(sha256(convert_to(v_ip, 'UTF8')), 'hex');
  end if;

  delete from app.membership_lookup_hits h where h.at < now() - interval '1 hour';
  if (select count(*) from app.membership_lookup_hits h where h.at > now() - interval '1 minute') >= 300
    or (v_ip_hash is not null and (
      select count(*) from app.membership_lookup_hits h
      where h.ip_hash = v_ip_hash and h.at > now() - interval '10 minutes') >= 30)
  then
    raise exception 'Too many lookups right now, please retry in a few minutes.' using errcode = '22023';
  end if;
  insert into app.membership_lookup_hits (ip_hash) values (v_ip_hash);

  if role = 'supervising-council' then
    select count(*) into v_count
    from public.roster_entries r where r.current_position ilike '%supervising council%';
    if v_count = 1 then
      select r.* into v_row
      from public.roster_entries r where r.current_position ilike '%supervising council%';
    end if;
  end if;

  if v_row.id is null and v_email is not null then
    select r.* into v_row
    from public.roster_entries r
    where r.email_normalized = v_email
    order by
      (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%') asc,
      case
        when r.status ilike '%full%' then 3
        when r.status ilike '%associate%' then 2
        when r.status ilike '%candidate%' then 1
        else 0
      end desc,
      r.joined_year desc nulls last,
      r.updated_at desc
    limit 1;
  end if;

  if v_row.id is null and v_name <> '' then
    select count(*) into v_count from public.roster_entries r where r.name_normalized = v_name;
    if v_count > 1 then
      return jsonb_build_object('state', 'ambiguous');
    elsif v_count = 1 then
      select r.* into v_row from public.roster_entries r where r.name_normalized = v_name;
    end if;
  end if;

  if v_row.id is null then
    return jsonb_build_object('state', 'not-found');
  end if;

  return jsonb_build_object(
    'state', 'found',
    'record', jsonb_build_object(
      'status', coalesce(v_row.status, ''),
      'yearJoined', coalesce(v_row.joined_year::text, ''),
      'yearsSpent', coalesce(v_row.years_spent::text, ''),
      'lgas', coalesce(v_row.lgas, ''),
      'ngas', coalesce(v_row.ngas, ''),
      'currentPosition', coalesce(v_row.current_position, '')
    )
  );
end
$$;

-- The member count on the home page.
create or replace function public.roster_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*) filter (
      where not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%')),
    'updated_at', max(r.updated_at)
  )
  from public.roster_entries r
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.roster_importing() owner to postgres;
alter function app.normalize_roster_entry() owner to postgres;
alter function app.sync_roster_entry() owner to postgres;
alter function app.apply_roster_rows(jsonb, text, text) owner to postgres;
alter function public.import_roster(jsonb, text) owner to postgres;
alter function public.admin_import_roster(jsonb, text) owner to postgres;
alter function public.rotate_roster_sync_token() owner to postgres;
alter function public.revoke_roster_sync_token() owner to postgres;
alter function public.roster_sync_token_info() owner to postgres;
alter function public.sync_roster_from_sheet(text, jsonb, text) owner to postgres;
alter function public.check_membership(text, text, text) owner to postgres;
alter function public.roster_stats() owner to postgres;

-- roster_importing runs inside the (security invoker) before trigger, as whoever writes the row.
revoke execute on function app.roster_importing() from public;
grant execute on function app.roster_importing() to authenticated, service_role;
revoke execute on function app.normalize_roster_entry() from public;
revoke execute on function app.sync_roster_entry() from public;
revoke execute on function app.apply_roster_rows(jsonb, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.import_roster(jsonb, text) from public, anon;
grant execute on function public.import_roster(jsonb, text) to authenticated;

revoke execute on function public.admin_import_roster(jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_import_roster(jsonb, text) to service_role;

revoke execute on function public.rotate_roster_sync_token() from public, anon;
grant execute on function public.rotate_roster_sync_token() to authenticated;
revoke execute on function public.revoke_roster_sync_token() from public, anon;
grant execute on function public.revoke_roster_sync_token() to authenticated;
revoke execute on function public.roster_sync_token_info() from public, anon;
grant execute on function public.roster_sync_token_info() to authenticated;

revoke execute on function public.sync_roster_from_sheet(text, jsonb, text) from public;
grant execute on function public.sync_roster_from_sheet(text, jsonb, text) to anon, authenticated;

revoke execute on function public.check_membership(text, text, text) from public;
grant execute on function public.check_membership(text, text, text) to anon, authenticated;

revoke execute on function public.roster_stats() from public;
grant execute on function public.roster_stats() to anon, authenticated;
