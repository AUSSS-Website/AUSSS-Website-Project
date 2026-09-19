-- app.roster_match ignored skeletons shorter than three letters, so a real word that reduces to
-- two ("elsayed" -> "sd", "elnaggar" -> "ngr" is fine, "elsisi" -> "ss") never met its spaced
-- spelling: an attendance list saying "Sara Elsayed" did not find "Sara Youssef El Sayed".
-- A two-letter skeleton now counts when the typed word has five or more letters and the skeleton
-- equals a WHOLE part of the name's (a three-letter one may still start a run of parts).
-- Same rule as scoreToken() in src/portal/rosterSearch.js, which searches the Roster page.

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
  cross join lateral (select ' ' || app.name_skeleton(r.name_normalized) || ' ' as skel) s
  cross join lateral (
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
        case when length(replace(toks.skel, ' ', '')) >= 3
              and s.skel like '% ' || toks.skel || '%' then 2 else 0 end,
        case when length(replace(toks.skel, ' ', '')) = 2 and length(toks.tok) >= 5
              and s.skel like '% ' || toks.skel || ' %' then 2 else 0 end,
        case when length(toks.tok) >= 4
              and extensions.word_similarity(toks.tok, r.name_normalized) >= 0.5 then 1 else 0 end
      ) as best,
      extensions.word_similarity(toks.tok, r.name_normalized) as sim
      from toks
    ) t
  ) m
  where m.ok
$$;

alter function app.roster_match(text) owner to postgres;
revoke execute on function app.roster_match(text) from public, anon, authenticated, service_role;
