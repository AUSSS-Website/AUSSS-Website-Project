-- A campaign's online posts: what the campaign puts out on the society's pages.
--
-- Each row is one post: where it goes (Instagram, Facebook, ...), its caption, a link (to the
-- design while it is being made, to the post itself once it is out), the day it is meant for
-- and how far it is (draft, ready, posted). Anyone who can see the campaign adds one, so the
-- people on a media working group can; a post is changed or removed by whoever added it or by
-- the campaign's managers. Nothing here is published by the portal: it is the campaign's own
-- list of what goes out and when.
--
-- (Not to be confused with public.posts, which are the portal's Updates.)

create table if not exists public.campaign_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  author_id uuid null references public.profiles (id) on delete set null,
  platform text not null default 'instagram'
    check (platform in ('instagram', 'facebook', 'tiktok', 'linkedin', 'x', 'youtube', 'other')),
  caption text not null default '' check (length(caption) <= 4000),
  link text not null default '' check (link = '' or (link ~ '^https?://' and length(link) <= 500)),
  -- a Cairo calendar day
  post_on date null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'posted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_posts_content_check check (caption <> '' or link <> '')
);

create index if not exists campaign_posts_campaign_id_idx on public.campaign_posts (campaign_id);
create index if not exists campaign_posts_author_id_idx on public.campaign_posts (author_id);

create or replace function app.guard_campaign_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.caption := left(btrim(coalesce(new.caption, '')), 4000);
  new.link := btrim(coalesce(new.link, ''));
  if new.caption = '' and new.link = '' then
    raise exception 'Write the caption, or paste a link.' using errcode = '22023';
  end if;
  if new.link <> '' and new.link !~ '^https?://' then
    raise exception 'The link has to start with http:// or https://.' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    return new;
  end if;

  -- a post never changes campaign or author
  new.campaign_id := old.campaign_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  return new;
end
$$;

drop trigger if exists guard_campaign_post on public.campaign_posts;
create trigger guard_campaign_post before insert or update on public.campaign_posts
  for each row execute function app.guard_campaign_post();
drop trigger if exists set_updated_at on public.campaign_posts;
create trigger set_updated_at before update on public.campaign_posts
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.campaign_posts;
create trigger audit after insert or update or delete on public.campaign_posts
  for each row execute function app.audit();

alter table public.campaign_posts enable row level security;

revoke all on public.campaign_posts from anon, authenticated;
grant select, delete on public.campaign_posts to authenticated;
-- the author and the times are the trigger's
grant insert (campaign_id, platform, caption, link, post_on, status) on public.campaign_posts to authenticated;
grant update (platform, caption, link, post_on, status) on public.campaign_posts to authenticated;
grant all on public.campaign_posts to service_role;

drop policy if exists campaign_posts_select on public.campaign_posts;
create policy campaign_posts_select on public.campaign_posts
  for select to authenticated
  using ((select app.can_see_campaign(campaign_id)));
drop policy if exists campaign_posts_insert on public.campaign_posts;
create policy campaign_posts_insert on public.campaign_posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select app.can_see_campaign(campaign_id)));
drop policy if exists campaign_posts_update on public.campaign_posts;
create policy campaign_posts_update on public.campaign_posts
  for update to authenticated
  using (author_id = (select auth.uid()) or (select app.can_manage_campaign(campaign_id)))
  with check (author_id = (select auth.uid()) or (select app.can_manage_campaign(campaign_id)));
drop policy if exists campaign_posts_delete on public.campaign_posts;
create policy campaign_posts_delete on public.campaign_posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select app.can_manage_campaign(campaign_id)));

alter function app.guard_campaign_post() owner to postgres;
revoke execute on function app.guard_campaign_post() from public;
