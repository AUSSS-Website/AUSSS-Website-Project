-- Phase 0/1 core tables. No Postgres enums anywhere: `text` + check constraints, because a new
-- enum value cannot be used in the same transaction and every migration is one transaction.
-- Every table gets updated_at + audit triggers; audit_log itself is append-only and untriggered.

-- ---------------------------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------------------------

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint terms_dates_check check (ends_on > starts_on)
);

-- Exactly one current term. Non-deferrable, hence the two-step public.set_current_term().
create unique index if not exists terms_one_current on public.terms (is_current) where is_current;

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  abbr text not null,
  kind text not null check (kind in ('standing', 'division', 'exchange', 'eb')),
  color text,
  logo text,
  sort int not null default 0,
  active boolean not null default true,
  page jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  committee_id uuid null references public.committees (id) on delete restrict,
  title text not null,
  short_title text,
  level text not null check (level in ('webmaster', 'eb', 'officer', 'assistant', 'member')),
  sort int not null default 0,
  can_assign_tasks boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- society-wide positions have committee_id null; nulls not distinct keeps their titles unique too
  constraint positions_committee_id_title_key unique nulls not distinct (committee_id, title)
);

create index if not exists positions_committee_id_idx on public.positions (committee_id);

-- ---------------------------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------------------------

-- One row per auth user, created by app.handle_new_user(). Members may only update the columns
-- listed in the column-level grant (migration 5); membership fields change via EB RPCs.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  email_normalized text generated always as (app.norm_email(email)) stored,
  phone text,
  faculty_year text,
  photo_path text,
  avatar_url text,
  membership_status text not null default 'unverified'
    check (membership_status in ('unverified', 'candidate', 'active', 'alumni')),
  membership_tier text,
  joined_year int,
  directory_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_normalized_idx on public.profiles (email_normalized);

-- Imported membership spreadsheet. source_key = sha256(name_norm|email_norm) from the importer;
-- profile_id is set by claiming once a signed-in user matches by email.
create table if not exists public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  full_name text not null,
  name_normalized text not null,
  email text,
  email_normalized text generated always as (app.norm_email(email)) stored,
  status text,
  joined_year int,
  years_spent int,
  lgas text,
  ngas text,
  current_position text,
  import_batch text,
  imported_at timestamptz not null default now(),
  profile_id uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roster_entries_email_normalized_idx on public.roster_entries (email_normalized);
create index if not exists roster_entries_name_normalized_idx on public.roster_entries (name_normalized);
create index if not exists roster_entries_profile_id_idx on public.roster_entries (profile_id);

-- ---------------------------------------------------------------------------------------------
-- Positions held
-- ---------------------------------------------------------------------------------------------

-- A standing offer of a position for a term, keyed by email. Becomes an assignment the moment a
-- profile with that email exists (trigger) or signs up (claiming).
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (app.norm_email(email)) stored,
  position_id uuid not null references public.positions (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete cascade,
  invited_by uuid null references public.profiles (id) on delete set null,
  accepted_at timestamptz null,
  accepted_profile_id uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_email_position_term_key unique (email_normalized, position_id, term_id)
);

create index if not exists invites_email_normalized_idx on public.invites (email_normalized);
create index if not exists invites_position_id_idx on public.invites (position_id);
create index if not exists invites_term_id_idx on public.invites (term_id);
create index if not exists invites_invited_by_idx on public.invites (invited_by);
create index if not exists invites_accepted_profile_id_idx on public.invites (accepted_profile_id);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_on date not null default current_date,
  ended_on date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_profile_position_term_key unique (profile_id, position_id, term_id)
);

create index if not exists assignments_profile_id_idx on public.assignments (profile_id);
create index if not exists assignments_position_id_idx on public.assignments (position_id);
create index if not exists assignments_term_id_idx on public.assignments (term_id);

-- ---------------------------------------------------------------------------------------------
-- Verification + audit
-- ---------------------------------------------------------------------------------------------

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid null references public.profiles (id) on delete set null,
  decided_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists verification_requests_status_created_at_idx
  on public.verification_requests (status, created_at);
create index if not exists verification_requests_profile_id_idx on public.verification_requests (profile_id);
create index if not exists verification_requests_decided_by_idx on public.verification_requests (decided_by);

-- Written only by app.audit(); actor is auth.uid() (null for service_role / auth triggers).
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid null,
  table_name text not null,
  row_id text,
  action text not null,
  before jsonb,
  after jsonb
);

create index if not exists audit_log_table_row_idx on public.audit_log (table_name, row_id);
create index if not exists audit_log_at_idx on public.audit_log (at);

-- ---------------------------------------------------------------------------------------------
-- Triggers (same pair on every table except audit_log)
-- ---------------------------------------------------------------------------------------------

drop trigger if exists set_updated_at on public.terms;
create trigger set_updated_at before update on public.terms
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.terms;
create trigger audit after insert or update or delete on public.terms
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.committees;
create trigger set_updated_at before update on public.committees
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.committees;
create trigger audit after insert or update or delete on public.committees
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.positions;
create trigger set_updated_at before update on public.positions
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.positions;
create trigger audit after insert or update or delete on public.positions
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.profiles;
create trigger audit after insert or update or delete on public.profiles
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.roster_entries;
create trigger set_updated_at before update on public.roster_entries
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.roster_entries;
create trigger audit after insert or update or delete on public.roster_entries
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.invites;
create trigger set_updated_at before update on public.invites
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.invites;
create trigger audit after insert or update or delete on public.invites
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.assignments;
create trigger set_updated_at before update on public.assignments
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.assignments;
create trigger audit after insert or update or delete on public.assignments
  for each row execute function app.audit();

drop trigger if exists set_updated_at on public.verification_requests;
create trigger set_updated_at before update on public.verification_requests
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.verification_requests;
create trigger audit after insert or update or delete on public.verification_requests
  for each row execute function app.audit();
