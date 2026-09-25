-- Phase 5 follow-up: exchange stories go public from the portal. A submitted story stays private
-- until an exchange officer (or the EB) reviews it, optionally tidies the text and the name to
-- show, and sets it to `published`; a published story can also be `featured`, which pins it to
-- the top of the exchange page with a highlight.
--
--   stories.status        new | contacted | published | declined  (was: featured; now a flag)
--   stories.featured      pinned and highlighted on the site (only matters when published)
--   stories.public_name   what the site shows as the author ('' = the submitted name)
--   stories.public_story  what the site shows as the text ('' = the submitted story)
--   stories.published_at  set the first time the story is published
--
-- The site reads rpc/stories_public() (anon): published stories only, the public fields only,
-- featured first then newest. The submitter's email and phone never leave the database.

-- ---------------------------------------------------------------------------------------------
-- Columns + statuses
-- ---------------------------------------------------------------------------------------------

alter table public.stories
  add column if not exists featured boolean not null default false,
  add column if not exists public_name text not null default '' check (length(public_name) <= 140),
  add column if not exists public_story text not null default '' check (length(public_story) <= 4000),
  add column if not exists published_at timestamptz null;

update public.stories set status = 'published', featured = true where status = 'featured';

alter table public.stories drop constraint if exists stories_status_check;
alter table public.stories
  add constraint stories_status_check check (status in ('new', 'contacted', 'published', 'declined'));

create index if not exists stories_published_idx
  on public.stories (featured desc, published_at desc) where status = 'published';

-- Publishing stamps the date once and fills the public fields from the submission when the
-- officer left them blank; trimmed and capped either way.
create or replace function app.normalize_story_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.public_name := left(btrim(coalesce(new.public_name, '')), 140);
  new.public_story := left(btrim(coalesce(new.public_story, '')), 4000);
  if new.status = 'published' then
    if new.published_at is null then
      new.published_at := now();
    end if;
    if new.public_name = '' then
      new.public_name := left(btrim(new.name), 140);
    end if;
    if new.public_story = '' then
      new.public_story := btrim(new.story);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_story_publish on public.stories;
create trigger normalize_story_publish before update on public.stories
  for each row execute function app.normalize_story_publish();

-- ---------------------------------------------------------------------------------------------
-- rpc/stories_public: what the exchange page shows
-- ---------------------------------------------------------------------------------------------

create or replace function public.stories_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.public_name,
          'story', s.public_story,
          'destination', s.destination,
          'programme', s.programme,
          'year', s.year,
          'featured', s.featured,
          'publishedAt', s.published_at
        )
        order by s.featured desc, s.published_at desc, s.created_at desc
      )
      from (
        select * from public.stories st
        where st.status = 'published'
        order by st.featured desc, st.published_at desc, st.created_at desc
        limit 50
      ) s
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

grant update (featured, public_name, public_story) on public.stories to authenticated;

alter function app.normalize_story_publish() owner to postgres;
alter function public.stories_public() owner to postgres;
revoke execute on function app.normalize_story_publish() from public;
revoke execute on function public.stories_public() from public;
grant execute on function public.stories_public() to anon, authenticated;
