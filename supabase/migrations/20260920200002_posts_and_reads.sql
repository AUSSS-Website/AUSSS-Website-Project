-- Phase 3 (portal core), part 2: updates (posts) and read receipts.
--
-- posts: announcements, news and resources for signed-in members. Audience is a committee
-- (null = the whole society) optionally narrowed to position levels; publish_at null is a draft,
-- a future publish_at is scheduled, expires_at takes the post off the feed by itself. Officers
-- write for their committee, the EB for anyone. There are no per-post notification rows: what a
-- person has not read is derived from post_reads, which is also what the digest will use.
--
-- post_reads: one row per person per post, written by the reader. The post's managers read them
-- to see who has (and through rpc/post_audience who has not) seen an update.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid null references public.committees (id) on delete cascade,
  kind text not null default 'announcement' check (kind in ('announcement', 'news', 'resource')),
  title text not null check (title <> '' and length(title) <= 200),
  body text not null default '' check (length(body) <= 12000),
  -- empty = every level in the audience
  levels text[] not null default '{}'
    check (levels <@ array['webmaster', 'eb', 'officer', 'assistant', 'member']),
  pinned boolean not null default false,
  publish_at timestamptz null default now(),
  expires_at timestamptz null,
  author_id uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_committee_id_idx on public.posts (committee_id);
create index if not exists posts_publish_at_idx on public.posts (publish_at desc);
create index if not exists posts_author_id_idx on public.posts (author_id);

create table if not exists public.post_reads (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index if not exists post_reads_profile_id_idx on public.post_reads (profile_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Is the caller in the audience? The EB sees everything. A committee post reaches people active
-- in that committee this term (at one of the levels, when levels are set); a society post
-- reaches every member (or every holder of one of the levels).
create or replace function app.post_in_audience(p_committee uuid, p_levels text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() or case
    when p_committee is null and cardinality(p_levels) = 0 then app.is_member()
    else exists (
      select 1
      from public.assignments a
      join public.positions p on p.id = a.position_id
      where a.profile_id = (select auth.uid())
        and a.status = 'active'
        and a.term_id = app.current_term_id()
        and (p_committee is null or p.committee_id = p_committee)
        and (cardinality(p_levels) = 0 or p.level = any (p_levels))
    )
  end
$$;

create or replace function app.post_is_live(p_publish_at timestamptz, p_expires_at timestamptz)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select p_publish_at is not null and p_publish_at <= now()
     and (p_expires_at is null or p_expires_at > now())
$$;

create or replace function app.can_see_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post
      and (
        app.is_officer_of(p.committee_id)
        or (app.post_is_live(p.publish_at, p.expires_at)
            and app.post_in_audience(p.committee_id, p.levels))
      )
  )
$$;

create or replace function app.can_manage_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p where p.id = p_post and app.is_officer_of(p.committee_id)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := left(btrim(coalesce(new.title, '')), 200);
  new.body := left(btrim(coalesce(new.body, '')), 12000);
  new.levels := coalesce(new.levels, '{}');
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
  else
    -- a post is never re-homed or re-attributed
    new.committee_id := old.committee_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

create or replace function app.guard_post_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_at := now();
  return new;
end
$$;

drop trigger if exists guard_post on public.posts;
create trigger guard_post before insert or update on public.posts
  for each row execute function app.guard_post();
drop trigger if exists set_updated_at on public.posts;
create trigger set_updated_at before update on public.posts
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.posts;
create trigger audit after insert or update or delete on public.posts
  for each row execute function app.audit();
drop trigger if exists guard_post_read on public.post_reads;
create trigger guard_post_read before insert on public.post_reads
  for each row execute function app.guard_post_read();

-- ---------------------------------------------------------------------------------------------
-- RPC: who the post was for, and who has read it (managers only)
-- ---------------------------------------------------------------------------------------------

create or replace function public.post_audience(post uuid)
returns table (id uuid, full_name text, avatar_url text, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
begin
  select * into v_post from public.posts p where p.id = post_audience.post;
  if not found or not app.is_officer_of(v_post.committee_id) then
    raise exception 'You cannot see who read that post.' using errcode = '42501';
  end if;
  return query
    select pr.id, pr.full_name, pr.avatar_url, r.read_at
    from public.profiles pr
    left join public.post_reads r on r.post_id = v_post.id and r.profile_id = pr.id
    where case
      when v_post.committee_id is null and cardinality(v_post.levels) = 0 then
        pr.membership_status <> 'unverified'
        or exists (
          select 1 from public.assignments a
          where a.profile_id = pr.id and a.status = 'active' and a.term_id = app.current_term_id()
        )
      else exists (
        select 1
        from public.assignments a
        join public.positions p on p.id = a.position_id
        where a.profile_id = pr.id
          and a.status = 'active'
          and a.term_id = app.current_term_id()
          and (v_post.committee_id is null or p.committee_id = v_post.committee_id)
          and (cardinality(v_post.levels) = 0 or p.level = any (v_post.levels))
      )
    end
    order by r.read_at is null desc, pr.full_name;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------------------------

alter table public.posts enable row level security;
alter table public.post_reads enable row level security;

grant select, insert, update, delete on public.posts to authenticated;
grant select on public.post_reads to authenticated;
grant insert (post_id, profile_id) on public.post_reads to authenticated;
grant all on public.posts, public.post_reads to service_role;

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using (
    (select app.is_officer_of(committee_id))
    or (app.post_is_live(publish_at, expires_at)
        and (select app.post_in_audience(committee_id, levels)))
  );
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts
  for update to authenticated
  using ((select app.is_officer_of(committee_id)))
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts
  for delete to authenticated
  using ((select app.is_officer_of(committee_id)));

drop policy if exists post_reads_select on public.post_reads;
create policy post_reads_select on public.post_reads
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select app.can_manage_post(post_id)));
drop policy if exists post_reads_insert on public.post_reads;
create policy post_reads_insert on public.post_reads
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select app.can_see_post(post_id)));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.post_in_audience(uuid, text[]) owner to postgres;
alter function app.post_is_live(timestamptz, timestamptz) owner to postgres;
alter function app.can_see_post(uuid) owner to postgres;
alter function app.can_manage_post(uuid) owner to postgres;
alter function app.guard_post() owner to postgres;
alter function app.guard_post_read() owner to postgres;
alter function public.post_audience(uuid) owner to postgres;

revoke execute on function app.post_in_audience(uuid, text[]) from public;
revoke execute on function app.post_is_live(timestamptz, timestamptz) from public;
revoke execute on function app.can_see_post(uuid) from public;
revoke execute on function app.can_manage_post(uuid) from public;
revoke execute on function app.guard_post() from public;
revoke execute on function app.guard_post_read() from public;
grant execute on function app.post_in_audience(uuid, text[]) to authenticated;
grant execute on function app.post_is_live(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function app.can_see_post(uuid) to authenticated;
grant execute on function app.can_manage_post(uuid) to authenticated;

revoke execute on function public.post_audience(uuid) from public, anon;
grant execute on function public.post_audience(uuid) to authenticated;
