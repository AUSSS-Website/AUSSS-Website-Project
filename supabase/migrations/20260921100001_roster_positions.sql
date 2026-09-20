-- Phase 4 (everyone in), part 2: a member's position in their committee, set from the roster.
--
-- A committee used to have three positions: its officer, "Assistant" and "Member". The
-- membership sheet knows many more (GA, CBDA, MEDA, RIA Coordinator, FGM Coordinator, Core Team
-- Member...). This migration:
--
--   * seeds each committee with the titles the sheet already uses, and lets the EB add, rename
--     or retire position types from the portal (positions.active; the key is made by the
--     database). Assistants and coordinators share the level 'assistant': they rank between the
--     officer and the members, and like members they receive tasks but do not assign them
--     (can_assign_tasks stays false; the EB can switch it on per position type);
--   * gives every roster row ONE position in its committee (roster_entries.position_id). The
--     moment a member gets a committee they are its "Local Member"; the EB (any position) or the
--     committee's officer (positions below their own) can pick another. When nothing was chosen
--     yet, the sheet's "Current Position" text is read first ("SCORA Core Team Member", "RSD GA");
--   * keeps the portal in step: the position becomes a standing invite on the member's roster
--     email, hence an assignment as soon as they have an account, and changing it ends the old
--     one. A member without an email on the roster still shows the title; it just cannot reach
--     an account yet.

-- ---------------------------------------------------------------------------------------------
-- positions: retire without deleting, keys made here
-- ---------------------------------------------------------------------------------------------

alter table public.positions add column if not exists active boolean not null default true;

-- before insert/update. A position added from the portal arrives without a key.
create or replace function app.normalize_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_key text;
  v_n int := 1;
begin
  new.title := left(btrim(regexp_replace(coalesce(new.title, ''), '\s+', ' ', 'g')), 120);
  if new.title = '' then
    raise exception 'A position needs a title.' using errcode = '22023';
  end if;
  new.short_title := left(nullif(btrim(new.short_title), ''), 40);

  if tg_op = 'UPDATE' then
    -- assignments, invites and roster rows hang off these
    new.key := old.key;
    new.committee_id := old.committee_id;
    return new;
  end if;

  if coalesce(btrim(new.key), '') = '' then
    v_base := coalesce((select c.slug from public.committees c where c.id = new.committee_id), 'society')
      || '.' || btrim(regexp_replace(lower(new.title), '[^a-z0-9]+', '-', 'g'), '-');
    v_key := v_base;
    while exists (select 1 from public.positions p where p.key = v_key) loop
      v_n := v_n + 1;
      v_key := v_base || '-' || v_n;
    end loop;
    new.key := v_key;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_position on public.positions;
create trigger normalize_position before insert or update on public.positions
  for each row execute function app.normalize_position();

-- ---------------------------------------------------------------------------------------------
-- Reference data: the titles the membership sheet uses
-- ---------------------------------------------------------------------------------------------

update public.positions set title = 'Local Member' where key like '%.member' and title = 'Member';
update public.positions set sort = 40 where key like '%.member';

insert into public.positions (key, committee_id, title, short_title, level, sort)
select c.slug || '.' || v.suffix, c.id, v.title, v.short_title, v.level, v.sort
from (values
  -- every committee
  ('*',     'core-team',                'Core Team Member',                        null,   'member',    30),
  ('*',     'ga',                       'General Assistant',                       'GA',   'assistant', 11),
  -- the officer's development assistants, as the sheet names them
  ('scome', 'cbda',                     'Capacity Building Development Assistant', 'CBDA', 'assistant', 12),
  ('scome', 'mea',                      'MEA',                                     'MEA',  'assistant', 13),
  ('scoph', 'cbda',                     'Capacity Building Development Assistant', 'CBDA', 'assistant', 12),
  ('scoph', 'meda',                     'MEDA',                                    'MEDA', 'assistant', 13),
  ('scoph', 'rsda',                     'RSDA',                                    'RSDA', 'assistant', 14),
  ('scoph', 'pnsda',                    'PNSDA',                                   'PNSDA','assistant', 15),
  ('scora', 'cbda',                     'Capacity Building Development Assistant', 'CBDA', 'assistant', 12),
  ('scorp', 'pr',                       'PR',                                      'PR',   'assistant', 12),
  ('scorp', 'me',                       'ME',                                      'ME',   'assistant', 13),
  ('rsd',   'cba',                      'CBA',                                     'CBA',  'assistant', 12),
  ('cbsd',  'da',                       'DA',                                      'DA',   'assistant', 12),
  ('cbsd',  'tda',                      'TDA',                                     'TDA',  'assistant', 13),
  ('scope', 'incomings-assistant',      'Incomings Assistant',                     null,   'assistant', 12),
  ('scope', 'outgoings-assistant',      'Outgoings Assistant',                     null,   'assistant', 13),
  ('scope', 'cbda',                     'Capacity Building Development Assistant', 'CBDA', 'assistant', 14),
  ('score', 'incomings-assistant',      'Incomings Assistant',                     null,   'assistant', 12),
  ('score', 'outgoings-assistant',      'Outgoings Assistant',                     null,   'assistant', 13),
  ('score', 'cbda',                     'Capacity Building Development Assistant', 'CBDA', 'assistant', 14),
  -- coordinators
  ('scome', 'smp-coordinator',          'SMP Coordinator',                         null,   'assistant', 20),
  ('scoph', 'ncd-coordinator',          'NCD Coordinator',                         null,   'assistant', 20),
  ('scoph', 'mh-coordinator',           'MH Coordinator',                          null,   'assistant', 21),
  ('scoph', 'health-equity-coordinator','Health Equity Coordinator',               null,   'assistant', 22),
  ('scora', 'fgm-coordinator',          'FGM Coordinator',                         null,   'assistant', 20),
  ('scora', 'gbv-coordinator',          'GBV Coordinator',                         null,   'assistant', 21),
  ('scora', 'hiv-sti-coordinator',      'HIV/STI Coordinator',                     null,   'assistant', 22),
  ('scora', 'reproductive-health-coordinator', 'Reproductive Health Coordinator', null,   'assistant', 23),
  ('scora', 'family-planning-coordinator', 'Family Planning Coordinator',          null,   'assistant', 24),
  ('scorp', 'ria-coordinator',          'RIA Coordinator',                         null,   'assistant', 20),
  ('scorp', 'flagship-coordinator',     'Flagship Coordinator',                    null,   'assistant', 21),
  ('cbsd',  'magazine-coordinator',     'Magazine Coordinator',                    null,   'assistant', 20),
  ('pnsd',  'head-of-coverage',         'Head of Coverage',                        null,   'assistant', 20),
  ('pnsd',  'design-team',              'Design Team Member',                      null,   'member',    31)
) as v(slug, suffix, title, short_title, level, sort)
join public.committees c on v.slug = '*' or c.slug = v.slug
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- roster_entries.position_id
-- ---------------------------------------------------------------------------------------------

alter table public.roster_entries
  add column if not exists position_id uuid null references public.positions (id) on delete set null;

create index if not exists roster_entries_position_id_idx on public.roster_entries (position_id);

-- The position in p_committee that a "Current Position" text names, line by line, with the
-- committee's abbreviation in front or not: "SCORA Core Team Member", "RSD GA", "LORA",
-- "SCOPH Core Team". The most senior match wins. Null when nothing matches.
create or replace function app.position_from_text(p_committee uuid, p_position text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.committees c
  join public.positions p on p.committee_id = c.id and p.active
  join lateral (
    select btrim(regexp_replace(lower(btrim(l)), '^' || lower(regexp_replace(c.abbr, '\W', '', 'g')) || '\s+', '')) as line
    from regexp_split_to_table(coalesce(p_position, ''), E'\n') l
  ) t on t.line <> ''
     and (lower(p.title) = t.line or lower(p.short_title) = t.line or lower(p.title) = t.line || ' member')
  where c.id = p_committee
  order by app.level_rank(p.level) desc, p.sort
  limit 1
$$;

-- before insert/update on roster_entries (from 20260921090001), now also keeping the position:
-- none without a committee, always one of the committee's own, read from the position text when
-- nothing was chosen, else Local Member.
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

  if new.committee_id is null then
    new.position_id := null;
  else
    if new.position_id is not null and not exists (
      select 1 from public.positions p
      where p.id = new.position_id and p.committee_id = new.committee_id
    ) then
      new.position_id := null;
    end if;
    if new.position_id is null then
      new.position_id := coalesce(
        app.position_from_text(new.committee_id, new.current_position),
        (select p.id from public.positions p
         join public.committees c on c.id = p.committee_id
         where c.id = new.committee_id and p.key = c.slug || '.member')
      );
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

-- after insert/update: the roster position reaches the member's account. The old position's
-- unaccepted invite goes and its assignment ends; the new one becomes a standing invite (the
-- invite trigger turns it into an assignment when the account exists) and an assignment ended
-- earlier comes back. Security definer: invites and assignments are not the caller's to write.
create or replace function app.sync_roster_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term uuid := app.current_term_id();
begin
  if v_term is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
    and new.position_id is not distinct from old.position_id
    and new.email_normalized is not distinct from old.email_normalized
    and new.profile_id is not distinct from old.profile_id
  then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.position_id is not null
    and (old.position_id is distinct from new.position_id
         or old.email_normalized is distinct from new.email_normalized)
  then
    delete from public.invites i
    where i.position_id = old.position_id and i.term_id = v_term
      and i.email_normalized = old.email_normalized and i.accepted_at is null;
    update public.assignments a
       set status = 'ended', ended_on = current_date
     where a.position_id = old.position_id and a.term_id = v_term and a.status = 'active'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = old.profile_id or p.email_normalized = old.email_normalized);
  end if;

  if new.position_id is not null and new.email_normalized is not null then
    insert into public.invites (email, position_id, term_id, invited_by)
    values (new.email, new.position_id, v_term, auth.uid())
    on conflict (email_normalized, position_id, term_id) do nothing;
    update public.assignments a
       set status = 'active', ended_on = null
     where a.position_id = new.position_id and a.term_id = v_term and a.status = 'ended'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = new.profile_id or p.email_normalized = new.email_normalized);
  end if;
  return null;
end
$$;

drop trigger if exists sync_roster_position on public.roster_entries;
create trigger sync_roster_position after insert or update on public.roster_entries
  for each row execute function app.sync_roster_position();

-- The columns the Roster page shows for a row, plus the position.
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
    'committee_id', r.committee_id, 'is_contact_person', r.is_contact_person,
    'position_id', r.position_id
  )
$$;

-- One-off: everyone already in a committee gets their position (touching the row runs the
-- trigger above: the sheet's text first, else Local Member).
update public.roster_entries set position_id = null where committee_id is not null and position_id is null;

-- ---------------------------------------------------------------------------------------------
-- Officers: the Members tab sets the same one position
-- ---------------------------------------------------------------------------------------------

-- 'assigned' (the member has an account), 'invited' (it waits for their first sign-in) or
-- 'noted' (no email on the roster: the title shows, but cannot reach an account yet).
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
  select p.committee_id into v_committee from public.positions p where p.id = "position" and p.active;
  if v_committee is null or not app.can_manage_position("position") then
    raise exception 'You cannot hand out that position.' using errcode = '42501';
  end if;
  select r.* into v_row from public.roster_entries r where r.id = entry for update;
  if not found or v_row.committee_id is distinct from v_committee then
    raise exception 'That member is not on this committee''s roster.' using errcode = '22023';
  end if;
  -- an officer moves members between the positions below their own, never out of a senior one
  if v_row.position_id is not null and not app.can_manage_position(v_row.position_id) then
    raise exception 'Only the Executive Board can change that member''s position.' using errcode = '42501';
  end if;

  update public.roster_entries set position_id = "position" where id = entry;

  return case
    when v_row.email_normalized is null then 'noted'
    when exists (
      select 1 from public.assignments a
      join public.profiles pr on pr.id = a.profile_id
      where pr.email_normalized = v_row.email_normalized
        and a.position_id = "position" and a.term_id = v_term and a.status = 'active'
    ) then 'assigned'
    else 'invited' end;
end
$$;

-- As 20260921090001, plus `position`: { id, title, level } from the roster row.
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
        'position', (
          select jsonb_build_object('id', p.id, 'title', p.title, 'level', p.level)
          from public.positions p where p.id = r.position_id
        ),
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
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.normalize_position() owner to postgres;
alter function app.position_from_text(uuid, text) owner to postgres;
alter function app.normalize_roster_entry() owner to postgres;
alter function app.sync_roster_position() owner to postgres;
alter function app.roster_row_json(public.roster_entries) owner to postgres;
alter function public.assign_roster_member(uuid, uuid) owner to postgres;
alter function public.committee_roster(uuid) owner to postgres;

revoke execute on function app.normalize_position() from public;
revoke execute on function app.sync_roster_position() from public;
revoke execute on function app.normalize_roster_entry() from public;
revoke execute on function app.roster_row_json(public.roster_entries) from public;
-- runs inside the (security invoker) roster trigger, as whoever writes the row
revoke execute on function app.position_from_text(uuid, text) from public;
grant execute on function app.position_from_text(uuid, text) to authenticated, service_role;

revoke execute on function public.assign_roster_member(uuid, uuid) from public, anon;
grant execute on function public.assign_roster_member(uuid, uuid) to authenticated;
revoke execute on function public.committee_roster(uuid) from public, anon;
grant execute on function public.committee_roster(uuid) to authenticated;
