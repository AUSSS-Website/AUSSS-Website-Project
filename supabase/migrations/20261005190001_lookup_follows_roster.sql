-- The member lookup follows the roster.
--
-- The public status check (rpc/check_membership, the /members page) has always read the roster
-- live: the status, the year joined, the GA counts. Its "current position", though, was the
-- roster's free-text field alone, the one the sheet fills and the portal now labels "Other
-- positions". Since 20260921100001 the roster also holds a member's committee and their
-- position in it, and since 20261005160001 a board position; none of that reached the lookup.
-- A member whose position was set on the roster and whose text is empty looked up as
-- "General Member".
--
-- From here the lookup answers with what the roster says, in this order:
--   1. the position on the roster: an officer by the short name the society uses ("LORE",
--      "LEO-In"), a board position or a board assistant's by its title, anything else as
--      "<committee> <title>" ("SCORA Core Team Member"; "SCOPE/SCORE Incomings Assistant" for
--      the two committees that share a roster);
--   2. the lines of the "other positions" text that do not say the same thing again;
--   3. "Exchange Contact Person", when the row is marked as one.
-- One line each, in `currentPosition`, which the page already splits on line breaks. Nothing
-- else about the lookup changes: the matching, the limits and the suggestions are as before.

-- ---------------------------------------------------------------------------------------------
-- Comparing a line of text with a position
-- ---------------------------------------------------------------------------------------------

-- A position line reduced to what it says: lower case, punctuation gone, the words in p_drop
-- (the committee's own names) and the filler around them removed, plural endings off. So
-- "SCOME Core Team", "Exchange Incomings Assistant", "CBDA of Exchange Committee" and "PnSDD"
-- compare equal to the positions they name.
create or replace function app.position_text_key(p_text text, p_drop text[] default '{}')
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(regexp_replace(w, '^(.{3,})s$', '\1'), ' ' order by n), '')
  from regexp_split_to_table(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'), ' ')
       with ordinality as t (w, n)
  where w <> ''
    and w <> all (coalesce(p_drop, '{}'::text[]) || array['of', 'the', 'committee'])
$$;

-- ---------------------------------------------------------------------------------------------
-- What the roster says a member holds, one line each
-- ---------------------------------------------------------------------------------------------

create or replace function app.roster_positions_text(p_entry public.roster_entries)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_short text;
  v_level text;
  v_committee uuid;
  v_unit text;
  v_drop text[] := '{}';
  v_label text;
  v_same text[] := '{}';
  v_lines text[] := '{}';
  v_seen text[] := '{}';
  v_line text;
  v_key text;
begin
  if p_entry.position_id is not null then
    select p.title, nullif(btrim(p.short_title), ''), p.level, p.committee_id
      into v_title, v_short, v_level, v_committee
    from public.positions p where p.id = p_entry.position_id;
  end if;

  if v_title is not null then
    if v_committee is null then
      v_label := v_title;
    else
      -- the committee, or the committees that share its roster, under one name
      select string_agg(c.abbr, '/' order by c.sort, c.abbr),
             array_agg(lower(regexp_replace(c.abbr, '[^A-Za-z0-9]', '', 'g')))
               || case when bool_or(c.roster_group = 'exchange') then array['exchange'] else '{}'::text[] end
        into v_unit, v_drop
      from public.committees c where c.id = any (app.roster_group_ids(v_committee));
      v_label := case when v_level = 'officer' then coalesce(v_short, v_title) else v_unit || ' ' || v_title end;
    end if;
    v_lines := array[v_label];
    v_seen := array[app.position_text_key(v_label)];
    -- what a line of text would look like if it named this same position
    v_same := array[
      app.position_text_key(v_title, v_drop),
      app.position_text_key(regexp_replace(v_title, '\s+member$', '', 'i'), v_drop),
      app.position_text_key(v_label, v_drop)
    ] || case when v_short is null then '{}'::text[] else array[app.position_text_key(v_short, v_drop)] end;
  end if;

  foreach v_line in array regexp_split_to_array(coalesce(p_entry.current_position, ''), E'[\r\n]+') loop
    v_line := btrim(v_line);
    continue when v_line = '';
    -- the contact-person line is written once, at the end, from the row's own marker
    continue when p_entry.is_contact_person and v_line ~* 'contact\s+person';
    continue when app.position_text_key(v_line, v_drop) = any (v_same);
    v_key := app.position_text_key(v_line);
    continue when v_key = any (v_seen);
    v_lines := v_lines || v_line;
    v_seen := v_seen || v_key;
  end loop;

  if p_entry.is_contact_person and not coalesce(v_label ~* 'contact\s+person', false) then
    v_lines := v_lines || 'Exchange Contact Person'::text;
  end if;

  return array_to_string(v_lines, E'\n');
end
$$;

alter function app.position_text_key(text, text[]) owner to postgres;
alter function app.roster_positions_text(public.roster_entries) owner to postgres;
revoke execute on function app.position_text_key(text, text[]) from public;
revoke execute on function app.roster_positions_text(public.roster_entries) from public;

-- ---------------------------------------------------------------------------------------------
-- rpc/check_membership: as 20260920090002, answering with those lines
-- ---------------------------------------------------------------------------------------------

create or replace function public.check_membership(
  name text default '',
  email text default '',
  role text default null,
  accept_near boolean default false
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
  v_near_id uuid;
  v_near_email text;
  v_names text[];
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

  -- near-miss email: only a unique neighbour counts, and only for something shaped like an email
  if v_row.id is null and v_email ~ '^[^@\s]{2,}@[^@\s]+\.[^@\s]+$' then
    select count(*), (array_agg(r.id))[1], (array_agg(r.email_normalized))[1]
      into v_count, v_near_id, v_near_email
    from public.roster_entries r
    where r.email_normalized is not null
      and extensions.levenshtein_less_equal(r.email_normalized, v_email, 2) <= 2;
    if v_count = 1 and coalesce(accept_near, false) then
      select r.* into v_row from public.roster_entries r where r.id = v_near_id;
    elsif v_count <> 1 then
      v_near_email := null;
    end if;
  end if;

  if v_row.id is null then
    if v_near_email is not null then
      return jsonb_build_object(
        'state', 'not-found',
        'suggestions', jsonb_build_object('email', app.mask_email(v_near_email)));
    end if;
    if v_name <> '' then
      v_names := app.roster_name_suggestions(v_name);
      if v_names is not null then
        return jsonb_build_object(
          'state', 'not-found',
          'suggestions', jsonb_build_object('names', to_jsonb(v_names)));
      end if;
    end if;
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
      'currentPosition', app.roster_positions_text(v_row)
    )
  );
end
$$;
