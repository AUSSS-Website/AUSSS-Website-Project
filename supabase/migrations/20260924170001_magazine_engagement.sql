-- Phase 5 (magazine counters, migration step 8): the reads, likes and downloads counters move
-- from apps-script/magazine.gs into the database, and reading depth is recorded too, so the
-- CBSD officers can see how far into an edition readers get.
--
-- Shape:
--   magazine_stats     one row per edition: the running totals (views, likes, downloads). The
--                      Apps Script totals as of 2026-09-24 are seeded below so nothing is lost.
--   magazine_sessions  one row per reading visit: a random id the browser makes when it opens
--                      an edition, the furthest page it reached, whether it liked or downloaded.
--                      No personal data: no IP, no user agent, no account.
--
-- Writes come only through rpc/magazine_track(session, issue, event, page), callable by anon:
--   'view'      starts the session (views + 1); repeated calls for the same session are no-ops
--   'page'      records the furthest page reached (never goes backwards)
--   'like'      likes + 1, once per session
--   'download'  downloads + 1, once per session
-- It returns the edition's totals so the page can show them. Reads for the editors go through
-- rpc/magazine_insights(issue): totals, how many readers reached each page, the median and the
-- share that reached the end. Nobody reads the tables directly.

create table if not exists public.magazine_stats (
  issue_slug text primary key references public.magazine_issues (slug) on update cascade on delete cascade,
  views int not null default 0,
  likes int not null default 0,
  downloads int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.magazine_sessions (
  id uuid primary key,
  issue_slug text not null references public.magazine_issues (slug) on update cascade on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  max_page int not null default 0,
  page_count int not null default 0,
  liked boolean not null default false,
  downloaded boolean not null default false,
  constraint magazine_sessions_pages check (max_page >= 0 and page_count >= 0 and max_page <= greatest(page_count, 1) + 1)
);

create index if not exists magazine_sessions_issue_idx on public.magazine_sessions (issue_slug, started_at);

alter table public.magazine_stats enable row level security;
alter table public.magazine_sessions enable row level security;
-- no policies on purpose: the two RPCs below (security definer) are the only readers and writers

-- ---------------------------------------------------------------------------------------------
-- rpc/magazine_track: the public site's one write
-- ---------------------------------------------------------------------------------------------

create or replace function public.magazine_track(session uuid, issue text, event text, page int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_issue public.magazine_issues%rowtype;
  v_session public.magazine_sessions%rowtype;
  v_page int;
  v_stats public.magazine_stats%rowtype;
begin
  if session is null then
    raise exception 'session is required' using errcode = '22023';
  end if;
  select * into v_issue from public.magazine_issues m where m.slug = lower(btrim(coalesce(issue, '')));
  if v_issue.id is null then
    raise exception 'unknown edition %', issue using errcode = 'P0002';
  end if;
  if event not in ('view', 'page', 'like', 'download') then
    raise exception 'unknown event %', event using errcode = '22023';
  end if;

  insert into public.magazine_stats (issue_slug) values (v_issue.slug) on conflict (issue_slug) do nothing;
  select * into v_session from public.magazine_sessions s where s.id = session for update;

  if v_session.id is null then
    -- a new visit: cap the rate of new sessions so a script cannot inflate the reads
    if (select count(*) from public.magazine_sessions s where s.started_at > now() - interval '1 minute') >= 60 then
      select * into v_stats from public.magazine_stats st where st.issue_slug = v_issue.slug;
      return jsonb_build_object('views', v_stats.views, 'likes', v_stats.likes, 'downloads', v_stats.downloads, 'throttled', true);
    end if;
    insert into public.magazine_sessions (id, issue_slug, page_count)
    values (session, v_issue.slug, v_issue.page_count)
    returning * into v_session;
    update public.magazine_stats set views = views + 1, updated_at = now() where issue_slug = v_issue.slug;
  elsif v_session.issue_slug <> v_issue.slug then
    raise exception 'that session belongs to another edition' using errcode = '22023';
  end if;

  if event = 'page' then
    v_page := least(greatest(coalesce(page, 0), 0), greatest(v_issue.page_count, 1) + 1);
    update public.magazine_sessions
      set max_page = greatest(max_page, v_page), page_count = greatest(page_count, v_issue.page_count), last_seen_at = now()
    where id = session;
  elsif event = 'like' and not v_session.liked then
    update public.magazine_sessions set liked = true, last_seen_at = now() where id = session;
    update public.magazine_stats set likes = likes + 1, updated_at = now() where issue_slug = v_issue.slug;
  elsif event = 'download' and not v_session.downloaded then
    update public.magazine_sessions set downloaded = true, last_seen_at = now() where id = session;
    update public.magazine_stats set downloads = downloads + 1, updated_at = now() where issue_slug = v_issue.slug;
  else
    update public.magazine_sessions set last_seen_at = now() where id = session;
  end if;

  select * into v_stats from public.magazine_stats st where st.issue_slug = v_issue.slug;
  return jsonb_build_object('views', v_stats.views, 'likes', v_stats.likes, 'downloads', v_stats.downloads);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/magazine_insights: for the editors
-- ---------------------------------------------------------------------------------------------

-- { views, likes, downloads, sessions, tracked (sessions that turned at least one page),
--   finished (reached the last page), median_page, reach: [{ page, readers }, ...] }
-- `reach[n]` = how many tracked sessions got to page n or further. Sessions from before the
-- page tracking (the seeded Apps Script totals) are counted in `views` but not in `sessions`.
create or replace function public.magazine_insights(issue text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issue public.magazine_issues%rowtype;
  v_stats public.magazine_stats%rowtype;
  v_pages int;
begin
  if not app.is_magazine_editor() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_issue from public.magazine_issues m where m.slug = lower(btrim(coalesce(issue, '')));
  if v_issue.id is null then
    raise exception 'unknown edition %', issue using errcode = 'P0002';
  end if;
  select * into v_stats from public.magazine_stats st where st.issue_slug = v_issue.slug;
  v_pages := greatest(v_issue.page_count, 1);
  return jsonb_build_object(
    'views', coalesce(v_stats.views, 0),
    'likes', coalesce(v_stats.likes, 0),
    'downloads', coalesce(v_stats.downloads, 0),
    'sessions', (select count(*) from public.magazine_sessions s where s.issue_slug = v_issue.slug),
    'tracked', (select count(*) from public.magazine_sessions s where s.issue_slug = v_issue.slug and s.max_page > 0),
    'finished', (select count(*) from public.magazine_sessions s where s.issue_slug = v_issue.slug and s.max_page >= v_issue.page_count and v_issue.page_count > 0),
    'median_page', (
      select percentile_cont(0.5) within group (order by s.max_page)
      from public.magazine_sessions s where s.issue_slug = v_issue.slug and s.max_page > 0
    ),
    'reach', coalesce((
      select jsonb_agg(jsonb_build_object('page', p, 'readers', (
        select count(*) from public.magazine_sessions s where s.issue_slug = v_issue.slug and s.max_page >= p
      )) order by p)
      from generate_series(1, v_pages) as p
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function public.magazine_track(uuid, text, text, int) owner to postgres;
alter function public.magazine_insights(text) owner to postgres;
revoke execute on function public.magazine_track(uuid, text, text, int) from public;
grant execute on function public.magazine_track(uuid, text, text, int) to anon, authenticated;
revoke execute on function public.magazine_insights(text) from public, anon;
grant execute on function public.magazine_insights(text) to authenticated;
grant all on public.magazine_stats, public.magazine_sessions to service_role;

-- ---------------------------------------------------------------------------------------------
-- Seed: the Apps Script totals on 2026-09-24 (the old issue-1/issue-2 rows folded into
-- vol-6/vol-7, the rename magazine.gs never merged)
-- ---------------------------------------------------------------------------------------------

insert into public.magazine_stats (issue_slug, views, likes, downloads)
select v.slug, v.views, 0, v.downloads
from (values ('vol-7', 149, 12), ('vol-6', 175, 26), ('vol-5', 3, 0), ('vol-3', 3, 0), ('vol-1', 5, 0))
  as v(slug, views, downloads)
where exists (select 1 from public.magazine_issues m where m.slug = v.slug)
on conflict (issue_slug) do nothing;
