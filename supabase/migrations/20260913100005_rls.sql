-- Row Level Security and table grants. The project does not auto-expose tables to the Data API,
-- so every privilege anon/authenticated need is granted here explicitly; RLS then narrows rows.
-- Rules: every policy names its role (`to anon`/`to authenticated`), uses only auth.uid() and the
-- security-definer app.* helpers (never an inline subselect on an RLS table, which would recurse),
-- and wraps calls in (select ...) so the planner evaluates them once per statement.

-- ---------------------------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------------------------

alter table public.terms enable row level security;
alter table public.committees enable row level security;
alter table public.positions enable row level security;
alter table public.profiles enable row level security;
alter table public.roster_entries enable row level security;
alter table public.invites enable row level security;
alter table public.assignments enable row level security;
alter table public.verification_requests enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- Public reference data: readable by the website, editable by EB (via RLS).
grant select on public.terms, public.committees, public.positions to anon, authenticated;
grant insert, update, delete on public.terms, public.committees, public.positions to authenticated;

-- Member data: signed-in only.
grant select on
  public.profiles,
  public.assignments,
  public.invites,
  public.roster_entries,
  public.audit_log,
  public.verification_requests
to authenticated;
grant insert, update, delete on public.assignments, public.invites, public.roster_entries to authenticated;
grant insert, update on public.verification_requests to authenticated;

-- Members edit only their contact/preference columns; membership_status, membership_tier,
-- joined_year and email are changed by EB RPCs and auth triggers, never by the row owner.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, faculty_year, photo_path, avatar_url, directory_opt_in)
  on public.profiles to authenticated;

-- service_role bypasses RLS; keep its privileges explicit for the importer and admin scripts.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- terms / committees / positions: world-readable, EB-writable
-- ---------------------------------------------------------------------------------------------

drop policy if exists terms_select on public.terms;
create policy terms_select on public.terms
  for select to anon, authenticated
  using (true);
drop policy if exists terms_insert on public.terms;
create policy terms_insert on public.terms
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists terms_update on public.terms;
create policy terms_update on public.terms
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));
drop policy if exists terms_delete on public.terms;
create policy terms_delete on public.terms
  for delete to authenticated
  using ((select app.is_eb()));

drop policy if exists committees_select on public.committees;
create policy committees_select on public.committees
  for select to anon, authenticated
  using (true);
drop policy if exists committees_insert on public.committees;
create policy committees_insert on public.committees
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists committees_update on public.committees;
create policy committees_update on public.committees
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));
drop policy if exists committees_delete on public.committees;
create policy committees_delete on public.committees
  for delete to authenticated
  using ((select app.is_eb()));

drop policy if exists positions_select on public.positions;
create policy positions_select on public.positions
  for select to anon, authenticated
  using (true);
drop policy if exists positions_insert on public.positions;
create policy positions_insert on public.positions
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists positions_update on public.positions;
create policy positions_update on public.positions
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));
drop policy if exists positions_delete on public.positions;
create policy positions_delete on public.positions
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- profiles: self, EB, or an officer of one of the person's committees; self/EB update.
-- No insert/delete policies: rows come from app.handle_new_user and auth.users cascade.
-- ---------------------------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select app.can_view_profile(id)));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select app.is_eb()))
  with check (id = (select auth.uid()) or (select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- assignments: own rows, EB, or officer of the position's committee; officers may add/edit
-- assistants and members in their committee; only EB deletes.
-- ---------------------------------------------------------------------------------------------

drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select app.is_eb())
    or (select app.is_officer_of(app.position_committee(position_id)))
  );
drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check ((select app.can_manage_position(position_id)));
drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update to authenticated
  using ((select app.can_manage_position(position_id)))
  with check ((select app.can_manage_position(position_id)));
drop policy if exists assignments_delete on public.assignments;
create policy assignments_delete on public.assignments
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- invites: same rule as assignments (invitee emails are only visible to EB / committee officers)
-- ---------------------------------------------------------------------------------------------

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
  for select to authenticated
  using (
    (select app.is_eb())
    or (select app.is_officer_of(app.position_committee(position_id)))
  );
drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check ((select app.can_manage_position(position_id)));
drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites
  for update to authenticated
  using ((select app.can_manage_position(position_id)))
  with check ((select app.can_manage_position(position_id)));
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- roster_entries: EB only (the importer uses service_role and bypasses RLS)
-- ---------------------------------------------------------------------------------------------

drop policy if exists roster_entries_select on public.roster_entries;
create policy roster_entries_select on public.roster_entries
  for select to authenticated
  using ((select app.is_eb()));
drop policy if exists roster_entries_insert on public.roster_entries;
create policy roster_entries_insert on public.roster_entries
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists roster_entries_update on public.roster_entries;
create policy roster_entries_update on public.roster_entries
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));
drop policy if exists roster_entries_delete on public.roster_entries;
create policy roster_entries_delete on public.roster_entries
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- verification_requests: members file their own and see their own; EB sees all and decides
-- (normally through public.decide_verification). No delete.
-- ---------------------------------------------------------------------------------------------

drop policy if exists verification_requests_select on public.verification_requests;
create policy verification_requests_select on public.verification_requests
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select app.is_eb()));
drop policy if exists verification_requests_insert on public.verification_requests;
create policy verification_requests_insert on public.verification_requests
  for insert to authenticated
  -- a member may only file a fresh pending request for themselves; the decision columns are
  -- written by public.decide_verification, never by the requester
  with check (
    profile_id = (select auth.uid())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );
drop policy if exists verification_requests_update on public.verification_requests;
create policy verification_requests_update on public.verification_requests
  for update to authenticated
  using ((select app.is_eb()))
  with check ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- audit_log: webmaster read-only; writes happen only inside app.audit() (security definer)
-- ---------------------------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select app.is_webmaster()));
