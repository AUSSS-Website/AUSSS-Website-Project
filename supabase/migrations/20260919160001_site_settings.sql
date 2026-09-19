-- Phase 2 (migration step 1): site settings move off the SITE_SETTINGS Script Property in
-- apps-script/officers.gs. One row per key, jsonb value. The public site reads every row
-- anonymously (the Navbar needs magazineInHeader before anyone signs in), so nothing private
-- ever goes in here: private configuration belongs in Vercel env vars or Supabase secrets.
-- Writes are EB only, through the normal table grants + RLS (no RPC needed: a key/value upsert
-- has nothing to validate beyond "is this person EB").

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- keys are dotted camelCase identifiers, like the Script Property they replace
  constraint site_settings_key_check check (key ~ '^[a-z][A-Za-z0-9_.-]{0,79}$')
);

create index if not exists site_settings_updated_by_idx on public.site_settings (updated_by);

drop trigger if exists set_updated_at on public.site_settings;
create trigger set_updated_at before update on public.site_settings
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.site_settings;
create trigger audit after insert or update or delete on public.site_settings
  for each row execute function app.audit();

-- updated_by always reflects the signed-in writer, whatever the client sent (null for
-- service_role / migrations).
create or replace function app.stamp_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end
$$;
alter function app.stamp_updated_by() owner to postgres;
revoke execute on function app.stamp_updated_by() from public;

drop trigger if exists stamp_updated_by on public.site_settings;
create trigger stamp_updated_by before insert or update on public.site_settings
  for each row execute function app.stamp_updated_by();

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS: world-readable, EB-writable
-- ---------------------------------------------------------------------------------------------

alter table public.site_settings enable row level security;

grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

drop policy if exists site_settings_select on public.site_settings;
create policy site_settings_select on public.site_settings
  for select to anon, authenticated
  using (true);
drop policy if exists site_settings_insert on public.site_settings;
create policy site_settings_insert on public.site_settings
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists site_settings_update on public.site_settings;
create policy site_settings_update on public.site_settings
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));
drop policy if exists site_settings_delete on public.site_settings;
create policy site_settings_delete on public.site_settings
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- Seed: the one setting officers.gs held on 2026-09-19 (GET ?action=settings -> {magazineInHeader: true})
-- ---------------------------------------------------------------------------------------------

insert into public.site_settings (key, value)
values ('magazineInHeader', 'true'::jsonb)
on conflict (key) do nothing;
