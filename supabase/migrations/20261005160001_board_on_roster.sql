-- The Executive Board on the roster.
--
-- A roster row carries one position, and until now only a committee's: without a committee the
-- position was always cleared. The board's own positions (President, the two Vice Presidents,
-- the Secretary General) belong to no committee, so the board could be given its positions by
-- invite only and never showed on the roster as what it is.
--
-- From here a row with no committee may carry one of the board's positions, or the position of
-- an assistant to one of them (four new positions below). The Roster page offers this as the
-- choice "Executive Board". Like every roster position it reaches the member's account by
-- itself: giving a row the position of President gives that account the Executive Board's
-- access to the portal at its next sign-in. Only the Executive Board can write the roster.
--
-- Two guards keep that from happening by accident:
--   * the position is only ever chosen by hand. The sheet sync and the position text never set
--     it, and the webmaster's position is not one a roster row can carry;
--   * a row that holds one of these positions is no longer moved into a committee because its
--     "other positions" text happens to name one (that would silently end the board position).

-- ---------------------------------------------------------------------------------------------
-- An assistant to each member of the board
-- ---------------------------------------------------------------------------------------------

insert into public.positions (key, committee_id, title, short_title, level, sort)
values ('eb.president-assistant', null, 'Assistant to the President', null, 'assistant', 10),
       ('eb.vp-internal-assistant', null, 'Assistant to the Vice President, Internal Affairs', 'VPI Assistant', 'assistant', 11),
       ('eb.vp-external-assistant', null, 'Assistant to the Vice President, External Affairs', 'VPE Assistant', 'assistant', 12),
       ('eb.secretary-general-assistant', null, 'Assistant to the Secretary General', 'SecGen Assistant', 'assistant', 13)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- The roster row keeps a board position when it has no committee
-- ---------------------------------------------------------------------------------------------

-- As 20260921100001, with the two changes described in the header.
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
    -- a row that already holds a position (a board one, here) is not re-homed by its text
    if new.committee_id is null and new.position_id is null then
      new.committee_id := app.committee_from_position(new.current_position);
    end if;
    if new.current_position ~* 'contact\s+person' then
      new.is_contact_person := true;
    end if;
  end if;

  if new.committee_id is null then
    -- no committee: the one position a row can carry is the board's or a board assistant's
    if new.position_id is not null and not exists (
      select 1 from public.positions p
      where p.id = new.position_id and p.committee_id is null and p.level in ('eb', 'assistant')
    ) then
      new.position_id := null;
    end if;
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

-- ---------------------------------------------------------------------------------------------
-- "Change it on the roster": the refusals now cover a board position too
-- ---------------------------------------------------------------------------------------------

-- As 20261005103632; only the wording changes. A position the roster gave is changed where the
-- roster is edited: the Roster page for the board, a committee's Members tab for its members.
create or replace function app.guard_invite_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- no session = the roster trigger, the importer or a script; they know what they are doing
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.accepted_at is null
    and old.term_id = app.current_term_id()
    and app.position_from_roster(old.position_id, old.email_normalized, null)
  then
    raise exception 'This position comes from the membership roster. Change it there: on the Roster page, or on the committee''s Members tab.'
      using errcode = '22023';
  end if;
  return old;
end
$$;

create or replace function public.remove_position(assignment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.assignments%rowtype;
  v_norm text;
begin
  select a.* into v_row from public.assignments a where a.id = assignment for update;
  if not found or not app.can_manage_position(v_row.position_id) then
    raise exception 'You cannot remove that position.' using errcode = '42501';
  end if;
  if v_row.profile_id = auth.uid() then
    raise exception 'You cannot remove your own position. Ask another member of the Executive Board.'
      using errcode = '22023';
  end if;
  select p.email_normalized into v_norm from public.profiles p where p.id = v_row.profile_id;
  if app.position_from_roster(v_row.position_id, v_norm, v_row.profile_id) then
    raise exception 'This position comes from the membership roster. Change it there: on the Roster page, or on the committee''s Members tab.'
      using errcode = '22023';
  end if;

  update public.assignments
     set status = 'ended', ended_on = current_date
   where id = v_row.id and status = 'active';
  -- the offer goes too, so offering it again later starts clean
  delete from public.invites i
   where i.position_id = v_row.position_id and i.term_id = v_row.term_id
     and (i.accepted_profile_id = v_row.profile_id or i.email_normalized = v_norm);
end
$$;
