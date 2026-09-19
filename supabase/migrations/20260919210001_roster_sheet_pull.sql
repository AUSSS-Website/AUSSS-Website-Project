-- Pulling the membership spreadsheet instead of waiting for it to push. The Apps Script route
-- (apps-script/roster-sync.gs) has to be installed by the sheet's owner; until that is possible
-- the Edge Function `roster-sheet-sync` downloads the sheet itself, every hour (pg_cron) and on
-- demand from the portal, and hands the rows to the same merge, app.apply_roster_rows.
--
-- Which sheet to pull is data, not code: this repository is public and the sheet holds personal
-- data, so its id lives in a private table and is set from the portal (rpc/set_roster_sheet).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Single row. sheet_id null = pulling is off.
create table if not exists app.roster_sheet_source (
  id boolean primary key default true check (id),
  sheet_id text,
  tab text not null default 'Database',
  updated_at timestamptz not null default now(),
  updated_by uuid null
);
alter table app.roster_sheet_source enable row level security;
revoke all on app.roster_sheet_source from public, anon, authenticated;

-- EB points the sync at a sheet (a Google Sheets link or a bare id) or, with null, turns it off.
create or replace function public.set_roster_sheet(sheet text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id text := nullif(btrim(coalesce(sheet, '')), '');
begin
  if not app.is_eb() then
    raise exception 'only the executive board can choose the roster spreadsheet' using errcode = '42501';
  end if;
  if v_id is not null then
    v_id := coalesce(substring(v_id from '/spreadsheets/d/([A-Za-z0-9_-]{20,})'), v_id);
    if v_id !~ '^[A-Za-z0-9_-]{20,}$' then
      raise exception 'That does not look like a Google Sheets link.' using errcode = '22023';
    end if;
  end if;
  insert into app.roster_sheet_source (id, sheet_id, updated_at, updated_by)
  values (true, v_id, now(), auth.uid())
  on conflict (id) do update
    set sheet_id = excluded.sheet_id,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
  return jsonb_build_object('active', v_id is not null);
end
$$;

-- What the portal shows. The id itself is only hinted at: the page needs "which sheet", not a
-- copyable link to it.
create or replace function public.roster_sheet_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_eb() then
    raise exception 'only the executive board can see the roster spreadsheet' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_build_object(
       'active', s.sheet_id is not null,
       'hint', case when s.sheet_id is not null then left(s.sheet_id, 4) || '…' || right(s.sheet_id, 4) end,
       'updated_at', s.updated_at)
     from app.roster_sheet_source s),
    jsonb_build_object('active', false)
  );
end
$$;

-- For the Edge Function (secret key only): where to pull from.
create or replace function public.admin_roster_sheet_source()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('sheet_id', s.sheet_id, 'tab', s.tab) from app.roster_sheet_source s),
    jsonb_build_object('sheet_id', null)
  )
$$;

-- The hourly job proves itself to the Edge Function with a secret that exists only in Vault:
-- generated here, never printed, read by the cron command at run time and checked through this
-- secret-key-only RPC.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'roster_cron_secret',
  'Sent by the roster-sheet-sync cron job to the Edge Function of the same name'
)
where not exists (select 1 from vault.secrets where name = 'roster_cron_secret');

create or replace function public.admin_roster_cron_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets d
    where d.name = 'roster_cron_secret' and d.decrypted_secret = admin_roster_cron_secret_ok.secret
  )
$$;

-- The script import grows a `source` so a pull is logged as what it is. Sheet pulls are spaced at
-- least a minute apart, so an impatient "Sync now" cannot pile up.
drop function if exists public.admin_import_roster(jsonb, text);
create or replace function public.admin_import_roster(
  rows jsonb,
  batch text default null,
  source text default 'script'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if source is null or source not in ('script', 'sheet') then
    raise exception 'source must be script or sheet' using errcode = '22023';
  end if;
  if source = 'sheet' and exists (
    select 1 from public.roster_sync_runs r
    where r.source = 'sheet' and r.at > now() - interval '1 minute'
  ) then
    raise exception 'The sheet was synced less than a minute ago.' using errcode = '22023';
  end if;
  return app.apply_roster_rows(rows, batch, source);
end
$$;

alter function public.set_roster_sheet(text) owner to postgres;
alter function public.roster_sheet_info() owner to postgres;
alter function public.admin_roster_sheet_source() owner to postgres;
alter function public.admin_import_roster(jsonb, text, text) owner to postgres;
alter function public.admin_roster_cron_secret_ok(text) owner to postgres;

revoke execute on function public.set_roster_sheet(text) from public, anon;
grant execute on function public.set_roster_sheet(text) to authenticated;
revoke execute on function public.roster_sheet_info() from public, anon;
grant execute on function public.roster_sheet_info() to authenticated;
revoke execute on function public.admin_roster_sheet_source() from public, anon, authenticated;
grant execute on function public.admin_roster_sheet_source() to service_role;
revoke execute on function public.admin_import_roster(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.admin_import_roster(jsonb, text, text) to service_role;

revoke execute on function public.admin_roster_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.admin_roster_cron_secret_ok(text) to service_role;

-- Hourly, at seven past. The function does its own authentication (this secret, or a signed-in
-- EB member pressing "Sync now"), hence verify_jwt = false in config.toml. pg_cron keeps its own
-- run history in cron.job_run_details; the merge result lands in public.roster_sync_runs.
select cron.unschedule(jobid) from cron.job where jobname = 'roster-sheet-sync';
select cron.schedule(
  'roster-sheet-sync',
  '7 * * * *',
  $cron$
    select net.http_post(
      url := 'https://wjijkqrdaakiwbtdssio.supabase.co/functions/v1/roster-sheet-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'roster_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    )
  $cron$
);
