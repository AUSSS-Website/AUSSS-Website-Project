-- Phase 4 (everyone in), part 1: each committee's own roster.
--
-- Until now only `assignments` knew a committee, and most members have no account, so nothing
-- could answer "who are SCORA's members?". This migration gives every roster row a committee:
--
--   * roster_entries.committee_id: a member belongs to exactly ONE committee (or none yet). The
--     EB sets it on the Roster page, one row at a time or through a bulk update. When it is
--     empty, the database fills it from the spreadsheet's "Current Position" text when that
--     names exactly one committee ("SCORA Core Team Member", "LORA"); it never overrides a
--     choice, and it is not a spreadsheet column, so setting it does not make the portal own
--     the row.
--   * roster_entries.is_contact_person: Contact Person is an exchange position held ALONGSIDE
--     the main one, whatever the committee. A marker on the member, never a second committee.
--   * rpc/committee_roster: an officer reads the members linked to their committee, account or
--     not. Membership facts are read-only there: status, joining year and GA counts stay with
--     the EB and the Secretary General's sheet (roster_entries RLS is unchanged: EB only).
--   * rpc/assign_roster_member: an officer gives one of their members a position below officer
--     level in their committee. It is a standing invite on the member's roster email, so it
--     works before the member has ever signed in.
--   * member_notes: private officer notes on a member. Visible to that committee's officers and
--     the EB, never to the member, and they stay with the committee that wrote them if the
--     member moves.

-- ---------------------------------------------------------------------------------------------
-- roster_entries: committee link + Contact Person marker
-- ---------------------------------------------------------------------------------------------

alter table public.roster_entries
  add column if not exists committee_id uuid null references public.committees (id) on delete set null,
  add column if not exists is_contact_person boolean not null default false;

create index if not exists roster_entries_committee_id_idx on public.roster_entries (committee_id);

-- The committee a "Current Position" text names: a committee's abbreviation as a whole word
-- ("SCOPH MEDA", "PnSD Design Team Member") or an officer's short title ("LORA"). Null unless
-- exactly one committee is named.
create or replace function app.committee_from_position(p_position text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(m.id))[1] end
  from (
    select distinct c.id
    from public.committees c
    left join public.positions p
      on p.committee_id = c.id and p.level = 'officer' and coalesce(p.short_title, '') <> ''
    where coalesce(p_position, '') <> ''
      and (
        p_position ~* ('\m' || regexp_replace(c.abbr, '\W', '', 'g') || '\M')
        or p_position ~* ('\m' || regexp_replace(p.short_title, '\W', '', 'g') || '\M')
      )
  ) m
$$;

-- before insert/update on roster_entries (from 20260920110001), now also proposing the
-- committee and the Contact Person marker from the position text. Both only when the text is
-- new or has changed, so clearing a committee by hand sticks. Neither column is part of the
-- portal-edit comparison: they are not spreadsheet columns.
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

  if new.current_position is not null
    and (tg_op = 'INSERT' or new.current_position is distinct from old.current_position)
  then
    if new.committee_id is null then
      new.committee_id := app.committee_from_position(new.current_position);
    end if;
    if new.current_position ~* 'contact\s+person' then
      new.is_contact_person := true;
    end if;
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

-- The columns the Roster page shows for a row (from 20260920090001), plus the two new ones.
create or replace function app.roster_row_json(r public.roster_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'full_name', r.full_name, 'email', r.email, 'status', r.status,
    'joined_year', r.joined_year, 'years_spent', r.years_spent, 'lgas', r.lgas, 'ngas', r.ngas,
    'current_position', r.current_position, 'origin', r.origin,
    'portal_edited_at', r.portal_edited_at, 'profile_id', r.profile_id,
    'import_batch', r.import_batch, 'updated_at', r.updated_at,
    'committee_id', r.committee_id, 'is_contact_person', r.is_contact_person
  )
$$;

-- One-off: what the position text already says about the rows that are there today.
update public.roster_entries r
   set committee_id = app.committee_from_position(r.current_position)
 where r.committee_id is null
   and r.current_position is not null
   and app.committee_from_position(r.current_position) is not null;

update public.roster_entries r
   set is_contact_person = true
 where not r.is_contact_person
   and r.current_position ~* 'contact\s+person';

-- ---------------------------------------------------------------------------------------------
-- Bulk updates: a fourth action, "these people are in <committee>"
-- ---------------------------------------------------------------------------------------------

alter table public.roster_bulk_updates drop constraint if exists roster_bulk_updates_action_check;
alter table public.roster_bulk_updates
  add constraint roster_bulk_updates_action_check
  check (action in ('lga', 'nga', 'status', 'committee'));

-- action 'lga' / 'nga': +1 on that count, label = the event ("LGA October 2026").
-- action 'status': value = the new status, label = why.
-- action 'committee': value = the committee's slug ('' or null takes people out of theirs).
-- The same action + label cannot be applied twice while the first still stands: that is the
-- attendance list being uploaded again.
create or replace function public.bulk_update_roster(
  ids uuid[],
  action text,
  label text,
  value text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_label text := left(btrim(regexp_replace(coalesce(label, ''), '\s+', ' ', 'g')), 120);
  v_value text := left(nullif(btrim(coalesce(value, '')), ''), 80);
  v_row public.roster_entries%rowtype;
  v_field text;
  v_before text;
  v_after text;
  v_committee uuid;
  v_changes jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_log bigint;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can update the roster in bulk' using errcode = '42501';
  end if;
  if action is null or action not in ('lga', 'nga', 'status', 'committee') then
    raise exception 'action must be lga, nga, status or committee' using errcode = '22023';
  end if;
  if v_label = '' then
    raise exception 'Name the event or the reason, so this update can be found again.' using errcode = '22023';
  end if;
  if action = 'status' and v_value is null then
    raise exception 'Choose the status to set.' using errcode = '22023';
  end if;
  if action = 'committee' and v_value is not null then
    select c.id into v_committee from public.committees c where c.slug = lower(v_value);
    if v_committee is null then
      raise exception 'Unknown committee "%".', v_value using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'Nobody is selected.' using errcode = '22023';
  end if;
  if array_length(ids, 1) > 1000 then
    raise exception 'Too many members at once (limit 1000).' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.roster_bulk_updates b
    where b.action = bulk_update_roster.action
      and lower(b.label) = lower(v_label)
      and b.undone_at is null
  ) then
    raise exception '"%" has already been applied. Undo it first, or give this one another name.', v_label
      using errcode = '22023';
  end if;

  v_field := case action
    when 'lga' then 'lgas' when 'nga' then 'ngas' when 'committee' then 'committee_id' else 'status' end;

  for v_row in
    select r.* from public.roster_entries r
    where r.id = any (select distinct unnest(ids))
    order by r.full_name
    for update
  loop
    v_before := case v_field
      when 'lgas' then v_row.lgas when 'ngas' then v_row.ngas
      when 'committee_id' then v_row.committee_id::text else v_row.status end;
    v_after := case action
      when 'status' then v_value
      when 'committee' then v_committee::text
      else app.bump_count(v_before) end;

    if v_after is null and action <> 'committee' then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name,
        'reason', format('"%s" is not a number', v_before));
      continue;
    end if;
    if v_after is not distinct from v_before then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name,
        'reason', case when action = 'committee' then 'already there' else 'already ' || v_after end);
      continue;
    end if;

    if v_field = 'lgas' then
      update public.roster_entries set lgas = v_after where id = v_row.id;
    elsif v_field = 'ngas' then
      update public.roster_entries set ngas = v_after where id = v_row.id;
    elsif v_field = 'committee_id' then
      update public.roster_entries set committee_id = v_committee where id = v_row.id;
    else
      update public.roster_entries set status = v_after where id = v_row.id;
    end if;

    v_changes := v_changes || jsonb_build_object(
      'id', v_row.id, 'full_name', v_row.full_name,
      'field', v_field, 'before', v_before, 'after', v_after);
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    return jsonb_build_object('updated', 0, 'skipped', v_skipped, 'log_id', null);
  end if;

  insert into public.roster_bulk_updates (actor, action, value, label, changes)
  values (auth.uid(), action, v_value, v_label, v_changes)
  returning id into v_log;

  return jsonb_build_object(
    'updated', jsonb_array_length(v_changes), 'skipped', v_skipped, 'log_id', v_log);
end
$$;

-- Puts back the values a bulk update replaced. A row somebody changed again since then is left
-- alone and reported: undo must not destroy a later correction.
create or replace function public.undo_roster_bulk_update(log_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_log public.roster_bulk_updates%rowtype;
  v_change jsonb;
  v_current text;
  v_restored int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can undo a bulk update' using errcode = '42501';
  end if;
  select * into v_log from public.roster_bulk_updates b
  where b.id = undo_roster_bulk_update.log_id for update;
  if not found then
    raise exception 'bulk update % not found', log_id using errcode = 'P0002';
  end if;
  if v_log.undone_at is not null then
    raise exception 'That update was already undone.' using errcode = '22023';
  end if;

  for v_change in select e from jsonb_array_elements(v_log.changes) as t(e) loop
    select case v_change ->> 'field'
             when 'lgas' then r.lgas when 'ngas' then r.ngas
             when 'committee_id' then r.committee_id::text else r.status end
      into v_current
    from public.roster_entries r where r.id = (v_change ->> 'id')::uuid for update;

    if not found then
      v_skipped := v_skipped || jsonb_build_object(
        'full_name', v_change ->> 'full_name', 'reason', 'no longer on the roster');
    elsif v_current is distinct from (v_change ->> 'after') then
      v_skipped := v_skipped || jsonb_build_object(
        'full_name', v_change ->> 'full_name', 'reason', 'changed again since');
    else
      if v_change ->> 'field' = 'lgas' then
        update public.roster_entries set lgas = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      elsif v_change ->> 'field' = 'ngas' then
        update public.roster_entries set ngas = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      elsif v_change ->> 'field' = 'committee_id' then
        -- a committee deleted since then simply leaves the member without one
        update public.roster_entries
           set committee_id = (select c.id from public.committees c where c.id = (v_change ->> 'before')::uuid)
         where id = (v_change ->> 'id')::uuid;
      else
        update public.roster_entries set status = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      end if;
      v_restored := v_restored + 1;
    end if;
  end loop;

  update public.roster_bulk_updates
    set undone_at = now(), undone_by = auth.uid()
  where id = v_log.id;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- member_notes
-- ---------------------------------------------------------------------------------------------

create table if not exists public.member_notes (
  id uuid primary key default gen_random_uuid(),
  roster_entry_id uuid not null references public.roster_entries (id) on delete cascade,
  committee_id uuid not null references public.committees (id) on delete cascade,
  author_id uuid null references public.profiles (id) on delete set null,
  body text not null check (btrim(body) <> '' and length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_notes_roster_entry_id_idx on public.member_notes (roster_entry_id);
create index if not exists member_notes_committee_id_idx on public.member_notes (committee_id);
create index if not exists member_notes_author_id_idx on public.member_notes (author_id);

-- True when the roster row is the caller's own: nobody reads what officers wrote about them,
-- not even an officer of that committee or an EB member.
create or replace function app.is_own_roster_entry(p_entry uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roster_entries r
    where r.id = p_entry and r.profile_id = (select auth.uid())
  )
$$;

-- before insert/update. Security definer: officers cannot read roster_entries themselves.
create or replace function app.guard_member_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := left(btrim(coalesce(new.body, '')), 4000);
  if tg_op = 'UPDATE' then
    new.roster_entry_id := old.roster_entry_id;
    new.committee_id := old.committee_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    return new;
  end if;

  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  if not exists (
    select 1 from public.roster_entries r
    where r.id = new.roster_entry_id and r.committee_id = new.committee_id
  ) then
    raise exception 'That member is not on this committee''s roster.' using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists guard_member_note on public.member_notes;
create trigger guard_member_note before insert or update on public.member_notes
  for each row execute function app.guard_member_note();
drop trigger if exists set_updated_at on public.member_notes;
create trigger set_updated_at before update on public.member_notes
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.member_notes;
create trigger audit after insert or update or delete on public.member_notes
  for each row execute function app.audit();

alter table public.member_notes enable row level security;
revoke all on public.member_notes from anon, authenticated;
grant select, delete on public.member_notes to authenticated;
grant insert (roster_entry_id, committee_id, body) on public.member_notes to authenticated;
grant update (body) on public.member_notes to authenticated;
grant all on public.member_notes to service_role;

drop policy if exists member_notes_select on public.member_notes;
create policy member_notes_select on public.member_notes
  for select to authenticated
  using ((select app.is_officer_of(committee_id)) and not (select app.is_own_roster_entry(roster_entry_id)));

drop policy if exists member_notes_insert on public.member_notes;
create policy member_notes_insert on public.member_notes
  for insert to authenticated
  with check ((select app.is_officer_of(committee_id)) and not (select app.is_own_roster_entry(roster_entry_id)));

drop policy if exists member_notes_update on public.member_notes;
create policy member_notes_update on public.member_notes
  for update to authenticated
  using (author_id = (select auth.uid()) and (select app.is_officer_of(committee_id)))
  with check (author_id = (select auth.uid()) and (select app.is_officer_of(committee_id)));

drop policy if exists member_notes_delete on public.member_notes;
create policy member_notes_delete on public.member_notes
  for delete to authenticated
  using (
    (author_id = (select auth.uid()) and (select app.is_officer_of(committee_id)))
    or (select app.is_eb())
  );

-- ---------------------------------------------------------------------------------------------
-- rpc/committee_roster: an officer's view of their committee's members
-- ---------------------------------------------------------------------------------------------

-- [{ id, full_name, email, status, joined_year, years_spent, lgas, ngas, current_position,
--    is_contact_person, profile_id, positions: [{ id, title, level }], invited: [{ id, title }],
--    notes }]
-- positions = what the member holds in THIS committee this term (so they can be given tasks);
-- invited = positions waiting for their first sign-in; notes = how many the caller may read.
create or replace function public.committee_roster(committee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if committee is null or not app.is_officer_of(committee) then
    raise exception 'only that committee''s officers and the executive board can see its roster'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id, 'full_name', r.full_name, 'email', r.email, 'status', r.status,
        'joined_year', r.joined_year, 'years_spent', r.years_spent, 'lgas', r.lgas, 'ngas', r.ngas,
        'current_position', r.current_position, 'is_contact_person', r.is_contact_person,
        'profile_id', r.profile_id,
        'positions', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'level', p.level) order by p.sort)
          from public.assignments a
          join public.positions p on p.id = a.position_id
          where a.profile_id = r.profile_id
            and a.status = 'active'
            and a.term_id = app.current_term_id()
            and p.committee_id = committee_roster.committee
        ), '[]'::jsonb),
        'invited', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.sort)
          from public.invites i
          join public.positions p on p.id = i.position_id
          where i.email_normalized = r.email_normalized
            and i.accepted_at is null
            and i.term_id = app.current_term_id()
            and p.committee_id = committee_roster.committee
        ), '[]'::jsonb),
        'notes', case when r.profile_id is not distinct from auth.uid() then 0 else (
          select count(*) from public.member_notes n
          where n.roster_entry_id = r.id and n.committee_id = committee_roster.committee
        ) end
      )
      order by r.full_name, r.id
    )
    from public.roster_entries r
    where r.committee_id = committee_roster.committee
      and not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%')
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/assign_roster_member: give one of your members a position in your committee
-- ---------------------------------------------------------------------------------------------

-- A standing invite on the member's roster email for the current term. If they already have an
-- account the invite trigger turns it into the assignment at once; otherwise it waits for their
-- first sign-in. Returns 'assigned' or 'invited'.
create or replace function public.assign_roster_member(entry uuid, "position" uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.roster_entries%rowtype;
  v_committee uuid;
  v_term uuid := app.current_term_id();
begin
  select p.committee_id into v_committee from public.positions p where p.id = "position";
  if v_committee is null or not app.can_manage_position("position") then
    raise exception 'You cannot hand out that position.' using errcode = '42501';
  end if;
  select r.* into v_row from public.roster_entries r where r.id = entry;
  if not found or v_row.committee_id is distinct from v_committee then
    raise exception 'That member is not on this committee''s roster.' using errcode = '22023';
  end if;
  if v_row.email_normalized is null then
    raise exception 'The roster has no email for %, so they cannot be invited yet. Ask the Secretary General to add one.', v_row.full_name
      using errcode = '22023';
  end if;
  if v_term is null then
    raise exception 'No current term is set.' using errcode = '22023';
  end if;

  insert into public.invites (email, position_id, term_id, invited_by)
  values (v_row.email, "position", v_term, auth.uid())
  on conflict (email_normalized, position_id, term_id) do nothing;

  return case when exists (
    select 1 from public.assignments a
    join public.profiles pr on pr.id = a.profile_id
    where pr.email_normalized = v_row.email_normalized
      and a.position_id = "position" and a.term_id = v_term and a.status = 'active'
  ) then 'assigned' else 'invited' end;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.committee_from_position(text) owner to postgres;
alter function app.normalize_roster_entry() owner to postgres;
alter function app.roster_row_json(public.roster_entries) owner to postgres;
alter function app.is_own_roster_entry(uuid) owner to postgres;
alter function app.guard_member_note() owner to postgres;
alter function public.bulk_update_roster(uuid[], text, text, text) owner to postgres;
alter function public.undo_roster_bulk_update(bigint) owner to postgres;
alter function public.committee_roster(uuid) owner to postgres;
alter function public.assign_roster_member(uuid, uuid) owner to postgres;

-- committee_from_position runs inside the (security invoker) roster trigger, as whoever writes
-- the row; is_own_roster_entry runs inside the member_notes policies.
revoke execute on function app.committee_from_position(text) from public;
grant execute on function app.committee_from_position(text) to authenticated, service_role;
revoke execute on function app.is_own_roster_entry(uuid) from public;
grant execute on function app.is_own_roster_entry(uuid) to authenticated;
revoke execute on function app.guard_member_note() from public;
revoke execute on function app.normalize_roster_entry() from public;
revoke execute on function app.roster_row_json(public.roster_entries) from public;

revoke execute on function public.bulk_update_roster(uuid[], text, text, text) from public, anon;
grant execute on function public.bulk_update_roster(uuid[], text, text, text) to authenticated;
revoke execute on function public.undo_roster_bulk_update(bigint) from public, anon;
grant execute on function public.undo_roster_bulk_update(bigint) to authenticated;
revoke execute on function public.committee_roster(uuid) from public, anon;
grant execute on function public.committee_roster(uuid) to authenticated;
revoke execute on function public.assign_roster_member(uuid, uuid) from public, anon;
grant execute on function public.assign_roster_member(uuid, uuid) to authenticated;
