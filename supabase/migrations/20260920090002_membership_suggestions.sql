-- "Did you mean ...?" on the public membership check. A member who types "Mohammed Aly" for
-- "Mohamed Ali", or one wrong character in their email, was told they are not a member.
--
-- This endpoint is anonymous, so a suggestion must never become a way to read the roster:
--   * NAMES are suggested only when at least two words were typed and EVERY typed word is a
--     near-spelling of a whole word of the member's name (same word, same consonant skeleton,
--     one edit away, or trigram-similar). A prefix or a single word suggests nothing, so nobody
--     can walk the roster with "mo", "moh", ... And only when at most three different names
--     qualify; a query vague enough to fit more gets none.
--   * EMAILS are never returned. A unique roster address within two edits of what was typed
--     yields a masked hint (first and last character of the local part) and, if the visitor
--     confirms, the membership facts of that row, which identify nobody. The real address never
--     leaves the database.
-- The existing rate limit (30 per 10 minutes per address, 300 per minute overall) counts these
-- calls too.

create extension if not exists fuzzystrmatch with schema extensions;

-- Up to three member names that p_name is a near-spelling of; null when there are none, too
-- many, or fewer than two words were typed.
create or replace function app.roster_name_suggestions(p_name text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with toks as (
    -- the particles carry no identity ("Abd El Rahman" is two words' worth, not three)
    select u.tok, app.name_skeleton(u.tok) as skel
    from unnest((array_remove(
      regexp_split_to_array(app.normalize_text(left(coalesce(p_name, ''), 200)), '\s+'), ''))[1:8]) as u(tok)
    where u.tok not in ('el', 'al')
  ),
  hits as (
    select min(r.full_name) as full_name
    from public.roster_entries r
    cross join lateral (select ' ' || app.name_skeleton(r.name_normalized) || ' ' as skel) s
    where (select count(*) from toks) >= 2
      and not (coalesce(r.status, '') ilike '%archiv%')
      and not exists (
        select 1 from toks t
        where not (
          -- whole skeleton parts, so "abdel" + "rahman" meet "abdelrahman" (abd rmn)
          (length(replace(t.skel, ' ', '')) >= 3 and s.skel like '% ' || t.skel || ' %')
          or exists (
            select 1
            from regexp_split_to_table(r.name_normalized, '\s+') as w(word)
            where w.word = t.tok
               or (length(t.tok) >= 4 and length(w.word) <= 60
                   and extensions.levenshtein_less_equal(w.word, left(t.tok, 60), 1) <= 1)
               or (length(t.tok) >= 5 and extensions.similarity(w.word, t.tok) >= 0.6)
          )
        )
      )
    group by r.name_normalized
  )
  select case when count(*) between 1 and 3 then array_agg(h.full_name order by h.full_name) end
  from hits h
$$;

-- s•••a@gmail.com: enough for the owner to recognise, nothing anyone else can use.
create or replace function app.mask_email(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(split_part($1, '@', 1), 1) || '•••'
      || case when length(split_part($1, '@', 1)) >= 3 then right(split_part($1, '@', 1), 1) else '' end
      || '@' || split_part($1, '@', 2)
$$;

-- Same contract as before plus:
--   accept_near : the visitor confirmed the masked email hint; answer with that row's facts.
--   a not-found answer may carry suggestions: { names: [...] } or { email: 's•••a@gmail.com' }.
drop function if exists public.check_membership(text, text, text);
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
      'currentPosition', coalesce(v_row.current_position, '')
    )
  );
end
$$;

alter function app.roster_name_suggestions(text) owner to postgres;
alter function app.mask_email(text) owner to postgres;
alter function public.check_membership(text, text, text, boolean) owner to postgres;

revoke execute on function app.roster_name_suggestions(text) from public, anon, authenticated, service_role;
revoke execute on function app.mask_email(text) from public;
revoke execute on function public.check_membership(text, text, text, boolean) from public;
grant execute on function public.check_membership(text, text, text, boolean) to anon, authenticated;
