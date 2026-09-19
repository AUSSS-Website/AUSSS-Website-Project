-- Roster search and bulk updates for /portal/admin/roster.
--
-- SEARCH. The page used one `ilike '%phrase%'`, which fails on exactly what this roster is made
-- of: long Arabic names typed in Latin letters. The EB types two of a member's four names, or
-- "Mohammed" for a row spelt "Mohamed", or "Abd El Rahman" for "Abdelrahman", and got nothing.
-- app.roster_match instead:
--   * splits the query into words and requires EVERY word to match somewhere (any order, not
--     adjacent): in the name, the email or the current position;
--   * matches a word, best first, as a whole name-word, the start of one, anywhere in the name /
--     email / position, by consonant skeleton (transliteration variants), or by trigram
--     similarity (typos);
--   * ranks by how well the words matched, so the exact person is first and spelling
--     neighbours follow, flagged `close` so the page can say so.
--
-- BULK UPDATES. After a General Assembly the Secretary General has an attendance list and ~100
-- rows to bump by hand. rpc/match_roster_lines resolves a pasted list to roster rows with the
-- same matcher (certain, likely, ambiguous, not found) for the EB to review, and
-- rpc/bulk_update_roster applies one change to the confirmed rows: +1 Local GA, +1 National GA,
-- or a new status. Every run is kept in roster_bulk_updates with before/after values, so it can
-- be undone, and the same event cannot be counted twice.
--
-- ~600 rows: a sequential scan with these expressions takes a few milliseconds, so there are
-- deliberately no trigram or expression indexes to maintain.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Literal text inside a LIKE pattern.
create or replace function app.like_escape(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select replace(replace(replace($1, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- What survives the many ways one Arabic name is written in Latin letters. Per word: collapse
-- doubled letters, keep the first letter (any vowel becomes "a"), then drop vowels, y, h, w and
-- punctuation from the rest, folding j->g, q/c->k, z->s, ph->f. Before that the particles are
-- evened out: "abdel/abdul" = "abd", and a leading "el"/"al" (own word, hyphenated, or glued to a
-- word of 6+ letters) is dropped.
--   mohamed / mohammed / muhammad -> mmd        youssef / yousef / yusuf     -> ysf
--   abdelrahman / abd el-rahman   -> abd rmn    elsayed / el sayed / alsayed -> sd
--   ahmed / ahmad -> amd    omar / umar -> amr   gamal / jamal -> gml
-- It is a net for spelling, not identity: mahmoud and mohamed share "mmd". Matches that needed
-- it are flagged close and never chosen automatically. Arabic-script names come out empty.
create or replace function app.name_skeleton(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(string_agg(k.skel, ' ' order by k.ord), '')
  from (
    select w.ord,
      case when left(w.word, 1) ~ '[aeiou]' then 'a'
           else translate(left(w.word, 1), 'jqcz', 'gkks') end
      || translate(regexp_replace(substr(w.word, 2), '[^a-z0-9]|[aeiouyhw]', '', 'g'), 'jqcz', 'gkks')
      as skel
    from regexp_split_to_table(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            replace(replace(app.normalize_text($1), '-', ' '), 'ph', 'f'),
            '(.)\1+', '\1', 'g'),
          '\mabd ?(el|ul|al|ol)', 'abd ', 'g'),
        '\m(el|al)( |(?=[a-z]{4}))', '', 'g'),
      '\s+'
    ) with ordinality as w(word, ord)
    where w.word ~ '^[a-z0-9]'
  ) k
$$;

-- The matcher. Every roster row in which every word of p_q matches, with
--   rank    : sum of the per-word tiers (6 whole word, 5 word start, 4 inside the name or email,
--             3 inside the position, 2 skeleton, 1 trigram) plus a bonus for the full name;
--   weakest : the lowest tier any word needed (<= 2 means "only by spelling neighbourhood").
-- An empty query matches every row with rank 0.
create or replace function app.roster_match(p_q text)
returns table (id uuid, rank numeric, weakest int)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select app.normalize_text(left(coalesce(p_q, ''), 200)) as text
  ),
  toks as (
    -- at most 8 words; more adds nothing but work
    select tok, app.like_escape(tok) as esc, app.name_skeleton(tok) as skel
    from q, unnest((array_remove(regexp_split_to_array(q.text, '\s+'), ''))[1:8]) as u(tok)
  )
  select r.id,
         (m.score
           + case when r.name_normalized = q.text then 20 else 0 end
           + case when q.text <> '' and r.name_normalized like app.like_escape(q.text) || '%' then 8 else 0 end
         )::numeric,
         m.weakest
  from public.roster_entries r
  cross join q
  cross join lateral (select app.name_skeleton(r.name_normalized) as skel) s
  cross join lateral (
    -- the trigram similarity (0..1) only breaks ties inside a tier: "muhammad" shares a skeleton
    -- with both mohamed and mahmoud, and looks more like the first
    select coalesce(bool_and(t.best > 0), true) as ok,
           coalesce(sum(t.best + t.sim), 0) as score,
           coalesce(min(t.best), 9)::int as weakest
    from (
      select greatest(
        case when ' ' || r.name_normalized || ' ' like '% ' || toks.esc || ' %' then 6 else 0 end,
        case when ' ' || r.name_normalized like '% ' || toks.esc || '%' then 5 else 0 end,
        case when r.name_normalized like '%' || toks.esc || '%' then 4 else 0 end,
        case when r.email_normalized like '%' || toks.esc || '%' then 4 else 0 end,
        case when lower(coalesce(r.current_position, '')) like '%' || toks.esc || '%' then 3 else 0 end,
        -- skeletons compare word by word: the query's must start a run of the name's words
        case when length(replace(toks.skel, ' ', '')) >= 3
              and ' ' || s.skel like '% ' || toks.skel || '%' then 2 else 0 end,
        case when length(toks.tok) >= 4
              and extensions.word_similarity(toks.tok, r.name_normalized) >= 0.5 then 1 else 0 end
      ) as best,
      extensions.word_similarity(toks.tok, r.name_normalized) as sim
      from toks
    ) t
  ) m
  where m.ok
$$;

-- The columns the Roster page shows for a row.
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
    'import_batch', r.import_batch, 'updated_at', r.updated_at
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/search_roster
-- ---------------------------------------------------------------------------------------------

-- status: '' (all), 'none' (no status), 'portal' (rows the portal owns), else a substring of the
-- status text, as the page's filter sends them. Returns { total, rows: [...] }.
create or replace function public.search_roster(
  q text default '',
  status text default '',
  page int default 0,
  page_size int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(status, '')));
  v_size int := least(greatest(coalesce(page_size, 50), 1), 200);
  v_offset int := greatest(coalesce(page, 0), 0) * least(greatest(coalesce(page_size, 50), 1), 200);
  v_result jsonb;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can search the roster' using errcode = '42501';
  end if;

  with hits as (
    select r, m.rank, m.weakest, count(*) over () as total
    from app.roster_match(q) m
    join public.roster_entries r on r.id = m.id
    where case
      when v_status = '' then true
      when v_status = 'none' then r.status is null
      when v_status = 'portal' then r.portal_edited_at is not null
      else r.status ilike '%' || app.like_escape(v_status) || '%'
    end
  ),
  page_rows as (
    select * from hits h
    order by h.rank desc, (h.r).full_name, (h.r).id
    limit v_size offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce((select max(h.total) from hits h), 0),
    'rows', coalesce((
      select jsonb_agg(
        -- close: matched only through the skeleton or trigram tier, a spelling neighbour
        app.roster_row_json(p.r) || jsonb_build_object('close', p.weakest <= 2)
        order by p.rank desc, (p.r).full_name, (p.r).id
      )
      from page_rows p
    ), '[]'::jsonb)
  )
  into v_result;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/match_roster_lines: a pasted list -> roster rows, for review
-- ---------------------------------------------------------------------------------------------

-- lines: ["Sara Ali", "omar@example.com", "Mona Adel <mona@example.com>", ...]. For each line:
--   matched   : the email is on the roster, or the name is exactly one member's name
--   likely    : one clear winner, every word found as a name-word or the start of one
--               (at least two words); the page pre-selects it but says so
--   ambiguous : several candidates; the EB picks one or skips
--   none      : nobody close
-- Nothing is written.
create or replace function public.match_roster_lines(lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line text;
  v_email text;
  v_name text;
  v_words int;
  v_out jsonb := '[]'::jsonb;
  v_state text;
  v_match jsonb;
  v_candidates jsonb;
  v_top record;
  v_second numeric;
  v_count int;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can match a list against the roster' using errcode = '42501';
  end if;
  if lines is null or jsonb_typeof(lines) <> 'array' then
    raise exception 'lines must be a JSON array of text' using errcode = '22023';
  end if;
  if jsonb_array_length(lines) > 1000 then
    raise exception 'Too many lines (limit 1000).' using errcode = '22023';
  end if;

  for v_line in select btrim(e) from jsonb_array_elements_text(lines) as t(e) loop
    continue when v_line is null or v_line = '';
    v_line := left(v_line, 300);
    v_email := app.norm_email(substring(v_line from '[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+'));
    v_name := btrim(regexp_replace(
      regexp_replace(v_line, '[^\s<>(),;]+@[^\s<>(),;]+', ' ', 'g'), '[<>(),;\t]+', ' ', 'g'));
    v_words := coalesce(array_length(
      array_remove(regexp_split_to_array(app.normalize_text(v_name), '\s+'), ''), 1), 0);
    v_state := 'none';
    v_match := null;
    v_candidates := '[]'::jsonb;

    -- 1. email: certain (best row first when the roster has the address twice, as in claiming)
    if v_email is not null then
      select app.roster_row_json(r) into v_match
      from public.roster_entries r
      where r.email_normalized = v_email
      order by
        (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%') asc,
        case when r.status ilike '%full%' then 3 when r.status ilike '%associate%' then 2
             when r.status ilike '%candidate%' then 1 else 0 end desc,
        r.joined_year desc nulls last
      limit 1;
      if v_match is not null then
        v_state := 'matched';
      end if;
    end if;

    -- 2. exact name
    if v_match is null and v_words > 0 then
      select count(*) into v_count
      from public.roster_entries r where r.name_normalized = app.normalize_text(v_name);
      if v_count = 1 then
        select app.roster_row_json(r) into v_match
        from public.roster_entries r where r.name_normalized = app.normalize_text(v_name);
        v_state := 'matched';
      end if;
    end if;

    -- 3. the matcher: candidates, and "likely" when one stands clear
    if v_match is null and v_words > 0 then
      select coalesce(jsonb_agg(c.j order by c.rank desc, c.name), '[]'::jsonb), count(*)
        into v_candidates, v_count
      from (
        select app.roster_row_json(r) || jsonb_build_object('close', m.weakest <= 2) as j,
               m.rank, r.full_name as name
        from app.roster_match(v_name) m
        join public.roster_entries r on r.id = m.id
        order by m.rank desc, r.full_name
        limit 6
      ) c;

      if v_count > 0 then
        select m.id, m.rank, m.weakest into v_top
        from app.roster_match(v_name) m order by m.rank desc limit 1;
        select m.rank into v_second
        from app.roster_match(v_name) m order by m.rank desc offset 1 limit 1;
        if v_words >= 2 and v_top.weakest >= 5 and (v_second is null or v_top.rank - v_second >= 2) then
          v_state := 'likely';
          select app.roster_row_json(r) into v_match
          from public.roster_entries r where r.id = v_top.id;
        else
          v_state := 'ambiguous';
        end if;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'line', v_line, 'state', v_state, 'match', v_match, 'candidates', v_candidates
    );
  end loop;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Bulk updates
-- ---------------------------------------------------------------------------------------------

-- One row per bulk update. changes: [{ id, full_name, field, before, after }], enough to undo.
create table if not exists public.roster_bulk_updates (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid null references public.profiles (id) on delete set null,
  action text not null check (action in ('lga', 'nga', 'status')),
  value text,
  label text not null check (label <> '' and length(label) <= 120),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  undone_at timestamptz null,
  undone_by uuid null references public.profiles (id) on delete set null
);

create index if not exists roster_bulk_updates_at_idx on public.roster_bulk_updates (at);
create index if not exists roster_bulk_updates_actor_idx on public.roster_bulk_updates (actor);
create index if not exists roster_bulk_updates_undone_by_idx on public.roster_bulk_updates (undone_by);

alter table public.roster_bulk_updates enable row level security;
grant select on public.roster_bulk_updates to authenticated;
grant all on public.roster_bulk_updates to service_role;

drop policy if exists roster_bulk_updates_select on public.roster_bulk_updates;
create policy roster_bulk_updates_select on public.roster_bulk_updates
  for select to authenticated
  using ((select app.is_eb()));

-- GA counts are free text in the sheet: "", "0", "3", ">2", "2+". One more attendance keeps the
-- notation and bumps the number (">2" means at least 3, so it becomes ">3"). Text with no number
-- in it cannot be bumped: null, and the caller reports the row instead of guessing.
create or replace function app.bump_count(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(btrim($1), '') = '' then '1'
    when $1 ~ '\d' then
      regexp_replace($1, '\d+', ((substring($1 from '\d+'))::int + 1)::text)
    else null
  end
$$;

-- action 'lga' / 'nga': +1 on that count, label = the event ("LGA October 2026").
-- action 'status': value = the new status, label = why.
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
  v_changes jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_log bigint;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can update the roster in bulk' using errcode = '42501';
  end if;
  if action is null or action not in ('lga', 'nga', 'status') then
    raise exception 'action must be lga, nga or status' using errcode = '22023';
  end if;
  if v_label = '' then
    raise exception 'Name the event or the reason, so this update can be found again.' using errcode = '22023';
  end if;
  if action = 'status' and v_value is null then
    raise exception 'Choose the status to set.' using errcode = '22023';
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

  v_field := case action when 'lga' then 'lgas' when 'nga' then 'ngas' else 'status' end;

  for v_row in
    select r.* from public.roster_entries r
    where r.id = any (select distinct unnest(ids))
    order by r.full_name
    for update
  loop
    v_before := case v_field when 'lgas' then v_row.lgas when 'ngas' then v_row.ngas else v_row.status end;
    v_after := case when action = 'status' then v_value else app.bump_count(v_before) end;

    if v_after is null then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name,
        'reason', format('"%s" is not a number', v_before));
      continue;
    end if;
    if v_after is not distinct from v_before then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name, 'reason', 'already ' || v_after);
      continue;
    end if;

    if v_field = 'lgas' then
      update public.roster_entries set lgas = v_after where id = v_row.id;
    elsif v_field = 'ngas' then
      update public.roster_entries set ngas = v_after where id = v_row.id;
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
             when 'lgas' then r.lgas when 'ngas' then r.ngas else r.status end
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
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.like_escape(text) owner to postgres;
alter function app.name_skeleton(text) owner to postgres;
alter function app.roster_match(text) owner to postgres;
alter function app.roster_row_json(public.roster_entries) owner to postgres;
alter function app.bump_count(text) owner to postgres;
alter function public.search_roster(text, text, int, int) owner to postgres;
alter function public.match_roster_lines(jsonb) owner to postgres;
alter function public.bulk_update_roster(uuid[], text, text, text) owner to postgres;
alter function public.undo_roster_bulk_update(bigint) owner to postgres;

revoke execute on function app.like_escape(text) from public;
revoke execute on function app.name_skeleton(text) from public;
revoke execute on function app.roster_match(text) from public, anon, authenticated, service_role;
revoke execute on function app.roster_row_json(public.roster_entries) from public;
revoke execute on function app.bump_count(text) from public;

revoke execute on function public.search_roster(text, text, int, int) from public, anon;
grant execute on function public.search_roster(text, text, int, int) to authenticated;
revoke execute on function public.match_roster_lines(jsonb) from public, anon;
grant execute on function public.match_roster_lines(jsonb) to authenticated;
revoke execute on function public.bulk_update_roster(uuid[], text, text, text) from public, anon;
grant execute on function public.bulk_update_roster(uuid[], text, text, text) to authenticated;
revoke execute on function public.undo_roster_bulk_update(bigint) from public, anon;
grant execute on function public.undo_roster_bulk_update(bigint) to authenticated;
