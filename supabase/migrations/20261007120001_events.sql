-- Phase 6, step 4: the events page.
--
-- The site has had no list of events since the unconfigured Google Calendar embed was removed in
-- the clean-up of 2026-09-24. Events are many dated records that officers add one at a time and
-- the pages sort and split by date, so they get a table of their own and not a content block.
--
--   events        one row per event: its title, the committee it belongs to (none for a
--                 society-wide one), when it starts and (optionally) ends in Cairo time or the
--                 days it covers, where it is, a short text (markdown), a picture, a sign-up
--                 link, and whether it is published. `slug` is its link, /events/<slug>.
--   event_slugs   every link an event has ever had, so a link shared before a rename still
--                 opens it (the site redirects), as album_slugs does for the gallery.
--   bucket        `event-media`, public: an event's picture, '<event id>/<file>.jpg'
--
-- Who writes: the committee's officers and the EB (app.is_officer_of, which is the EB alone for
-- a society-wide event). Visitors never read the table: rpc/events_public() hands them the
-- published events with what the pages need, including when each one is over and which term
-- it belongs to.
--
-- The archive needs no state. An event is over at its end, or at its start when it has none
-- (an all-day event at the end of its last day); the pages list what is not over yet as
-- upcoming and the rest in /events/archive by term, so an event moves on its own. The nightly
-- rebuild keeps the saved pages in step, and the browser splits by the clock it reads.
--
-- A change to a published event (or publishing one) asks for a rebuild of the public pages;
-- a draft does not.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- When an event leaves the upcoming list: its end, else its start; an all-day event at the
-- Cairo midnight after its last day.
create or replace function app.event_over_at(p_starts timestamptz, p_ends timestamptz, p_all_day boolean)
returns timestamptz
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_all_day then
      ((coalesce(p_ends, p_starts) at time zone 'Africa/Cairo')::date + 1)::timestamp at time zone 'Africa/Cairo'
    else coalesce(p_ends, p_starts)
  end
$$;

-- The term a moment falls in: the terms table first, else the society's year, which runs from
-- 1 September to 31 August ('2026-27').
create or replace function app.term_label_for(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  with d as (select (p_at at time zone 'Africa/Cairo')::date as day)
  select coalesce(
    (select t.label from public.terms t, d
     where d.day between t.starts_on and t.ends_on
     order by t.is_current desc, t.starts_on desc
     limit 1),
    (select case
       when extract(month from d.day) >= 9
         then extract(year from d.day)::int::text || '-' || right((extract(year from d.day)::int + 1)::text, 2)
       else (extract(year from d.day)::int - 1)::text || '-' || right(extract(year from d.day)::int::text, 2)
     end
     from d)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  -- a committee that is ever removed leaves its events in the archive, as society-wide ones
  committee_id uuid null references public.committees (id) on delete set null,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz null,
  all_day boolean not null default false,
  place text not null default '',
  image text not null default '',
  signup_url text not null default '',
  published boolean not null default false,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title_len check (length(title) between 1 and 140),
  constraint events_description_len check (length(description) <= 4000),
  constraint events_place_len check (length(place) <= 200),
  constraint events_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  constraint events_dates check (
    starts_at >= '2000-01-01' and starts_at < '2100-01-01'
    and (ends_at is null or ends_at >= starts_at)
  ),
  -- an uploaded file (an https address) or one that ships with the site (/assets/…); never
  -- '//host' or '/\host', which a browser reads as another site
  constraint events_image_url check (
    image = '' or (length(image) <= 500 and image ~ '^(https://|/[^/\\])[^\s<>"'']*$')
  ),
  constraint events_signup_url check (
    signup_url = '' or (length(signup_url) <= 500 and signup_url ~ '^https://[^\s<>"'']+$')
  )
);

create index if not exists events_committee_id_idx on public.events (committee_id);
create index if not exists events_created_by_idx on public.events (created_by);
create index if not exists events_published_starts_idx on public.events (starts_at) where published;

create table if not exists public.event_slugs (
  slug text primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists event_slugs_event_idx on public.event_slugs (event_id);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- '-2', '-3' ... after a base link that any event has used, now or in the past.
create or replace function app.next_free_event_slug(p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int := 2;
  v_candidate text;
begin
  loop
    v_candidate := left(p_base, 80 - length('-' || v_n::text)) || '-' || v_n::text;
    exit when not exists (select 1 from public.event_slugs s where s.slug = v_candidate);
    v_n := v_n + 1;
    if v_n > 999 then
      raise exception 'Could not find a free link for %.', p_base using errcode = '22023';
    end if;
  end loop;
  return v_candidate;
end
$$;

-- Tidies what the editor typed and makes the link.
--   * A new event's link comes from its title, with the year it starts in when the title has
--     none ('world-health-day-2027'), so next year's event of the same name gets its own. A
--     link any event has used, or 'archive' (the archive's own page), gets '-2', '-3' ...
--   * An edit keeps the link unless the editor sets a new one, which must be free.
--   * An all-day event runs from Cairo midnight to Cairo midnight: its start and end are the
--     days, and an end on the start's day is no end.
--   * A sign-up link typed without https:// gets it; anything that is not a web address is
--     refused with a message the portal can show.
-- created_by is always the caller.
create or replace function app.normalize_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_given text := nullif(btrim(coalesce(new.slug, '')), '');
  v_year text;
begin
  new.title := left(btrim(coalesce(new.title, '')), 140);
  new.description := left(btrim(coalesce(new.description, '')), 4000);
  new.place := left(btrim(coalesce(new.place, '')), 200);
  new.image := btrim(coalesce(new.image, ''));
  new.signup_url := btrim(coalesce(new.signup_url, ''));
  if new.title = '' then
    raise exception 'An event needs a title.' using errcode = '22023';
  end if;
  if new.starts_at is null then
    raise exception 'An event needs a start.' using errcode = '22023';
  end if;

  if new.all_day then
    new.starts_at := ((new.starts_at at time zone 'Africa/Cairo')::date)::timestamp at time zone 'Africa/Cairo';
    if new.ends_at is not null then
      new.ends_at := ((new.ends_at at time zone 'Africa/Cairo')::date)::timestamp at time zone 'Africa/Cairo';
    end if;
  end if;
  if new.ends_at is not null and new.ends_at < new.starts_at then
    raise exception 'An event cannot end before it starts.' using errcode = '22023';
  end if;
  if new.ends_at = new.starts_at then
    new.ends_at := null;
  end if;

  if new.signup_url <> '' then
    -- 'forms.gle/x' and 'example.org:8080/x' have no scheme; 'mailto:x' has one, and is refused
    if new.signup_url !~* '^[a-z][a-z0-9+.-]*:(?![0-9])' then
      new.signup_url := 'https://' || new.signup_url;
    end if;
    new.signup_url := regexp_replace(new.signup_url, '^https?://', 'https://', 'i');
    if new.signup_url !~ '^https://[^\s<>"'']+$' or length(new.signup_url) > 500 then
      raise exception 'The sign-up link must be a web address that starts with https://.' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    -- slugify cuts at 60 characters, which can leave a hyphen at the end
    v_slug := btrim(app.slugify(coalesce(v_given, new.title)), '-');
    if v_slug = '' then
      v_slug := 'event';
    end if;
    if v_given is null then
      v_year := to_char(new.starts_at at time zone 'Africa/Cairo', 'YYYY');
      if v_slug !~ ('(^|-)' || v_year || '(-|$)') then
        v_slug := v_slug || '-' || v_year;
      end if;
    end if;
    if v_slug = 'archive' or exists (select 1 from public.event_slugs s where s.slug = v_slug) then
      v_slug := app.next_free_event_slug(v_slug);
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- An untouched link stays as it is: it may be longer than slugify makes a new one
    -- (a 60-character title plus its year), and re-making it would change a shared link.
    if new.slug is not distinct from old.slug then
      v_slug := old.slug;
    else
      v_slug := coalesce(nullif(btrim(app.slugify(v_given), '-'), ''), old.slug);
    end if;
    if v_slug = 'archive' then
      raise exception 'The link /events/archive is the archive''s own. Choose another.' using errcode = '22023';
    end if;
    if exists (select 1 from public.event_slugs s where s.slug = v_slug and s.event_id <> new.id) then
      raise exception 'The link /events/% already belongs to another event.', v_slug using errcode = '23505';
    end if;
  end if;
  new.slug := v_slug;
  return new;
end
$$;

-- Every link the event has held stays in event_slugs.
create or replace function app.record_event_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_slugs (slug, event_id)
  values (new.slug, new.id)
  on conflict (slug) do nothing;
  return new;
end
$$;

drop trigger if exists normalize_event on public.events;
create trigger normalize_event before insert or update on public.events
  for each row execute function app.normalize_event();
drop trigger if exists record_event_slug on public.events;
create trigger record_event_slug after insert or update of slug on public.events
  for each row execute function app.record_event_slug();
drop trigger if exists set_updated_at on public.events;
create trigger set_updated_at before update on public.events
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.events;
create trigger audit after insert or update or delete on public.events
  for each row execute function app.audit();

-- The public pages are rebuilt when what visitors see changes: a published event, or one being
-- published or withdrawn. Drafts do not.
drop trigger if exists touch_site_insert on public.events;
create trigger touch_site_insert after insert on public.events
  for each row when (new.published) execute function app.touch_site_row();
drop trigger if exists touch_site_update on public.events;
create trigger touch_site_update after update on public.events
  for each row when (old.published or new.published) execute function app.touch_site_row();
drop trigger if exists touch_site_delete on public.events;
create trigger touch_site_delete after delete on public.events
  for each row when (old.published) execute function app.touch_site_row();

-- ---------------------------------------------------------------------------------------------
-- Who may edit an event and its picture
-- ---------------------------------------------------------------------------------------------

-- The officers of the event's committee and the EB; the EB alone for a society-wide event.
create or replace function app.can_edit_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select app.is_officer_of(e.committee_id) from public.events e where e.id = p_event),
    false
  )
$$;

-- The first folder of a key in `event-media` is the event's id.
create or replace function app.can_edit_event_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then app.can_edit_event(p_folder::uuid)
    else false
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Public read: rpc/events_public()
-- ---------------------------------------------------------------------------------------------

-- Every published event, oldest first, with its committee's slug, when it is over, its term
-- and the old links that should redirect to it. Upcoming or archived is the page's call, by
-- the clock.
create or replace function public.events_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'slug', e.slug,
          'title', e.title,
          'committee', c.slug,
          'starts_at', e.starts_at,
          'ends_at', e.ends_at,
          'all_day', e.all_day,
          'over_at', app.event_over_at(e.starts_at, e.ends_at, e.all_day),
          'term', app.term_label_for(e.starts_at),
          'place', e.place,
          'description', e.description,
          'image', e.image,
          'signup_url', e.signup_url,
          'aliases', coalesce((
            select jsonb_agg(s.slug order by s.created_at)
            from public.event_slugs s
            where s.event_id = e.id and s.slug <> e.slug
          ), '[]'::jsonb),
          'updated_at', e.updated_at
        )
        order by e.starts_at, e.created_at, e.id
      )
      from public.events e
      left join public.committees c on c.id = e.committee_id
      where e.published
    ), '[]'::jsonb),
    'generated_at', now()
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: the editors only; the public reads through the RPC
-- ---------------------------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_slugs enable row level security;

-- Split from the anon role on purpose: anon holds no grant on these tables at all.
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using ((select app.is_officer_of(committee_id)));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check ((select app.is_officer_of(committee_id)));
-- Moving an event to another committee needs a right over both.
drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using ((select app.is_officer_of(committee_id)))
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated
  using ((select app.is_officer_of(committee_id)));

drop policy if exists event_slugs_select on public.event_slugs;
create policy event_slugs_select on public.event_slugs
  for select to authenticated
  using ((select app.can_edit_event(event_id)));

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `event-media`, written by an event's editors under <event id>/…
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-media', 'event-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves its files by address without a policy; the select policy lets an
-- editor list the event's folder to clear it when the event is removed. A replaced picture is
-- a new file under a new name, so there is no update policy.
drop policy if exists event_media_read on storage.objects;
create policy event_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'event-media' and (select app.can_edit_event_folder((storage.foldername(name))[1])));
drop policy if exists event_media_insert on storage.objects;
create policy event_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-media' and (select app.can_edit_event_folder((storage.foldername(name))[1])));
drop policy if exists event_media_delete on storage.objects;
create policy event_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-media' and (select app.can_edit_event_folder((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter function app.event_over_at(timestamptz, timestamptz, boolean) owner to postgres;
alter function app.term_label_for(timestamptz) owner to postgres;
alter function app.next_free_event_slug(text) owner to postgres;
alter function app.normalize_event() owner to postgres;
alter function app.record_event_slug() owner to postgres;
alter function app.can_edit_event(uuid) owner to postgres;
alter function app.can_edit_event_folder(text) owner to postgres;
alter function public.events_public() owner to postgres;

revoke execute on function app.event_over_at(timestamptz, timestamptz, boolean) from public;
revoke execute on function app.term_label_for(timestamptz) from public;
revoke execute on function app.next_free_event_slug(text) from public;
revoke execute on function app.normalize_event() from public;
revoke execute on function app.record_event_slug() from public;
revoke execute on function app.can_edit_event(uuid) from public;
grant execute on function app.can_edit_event(uuid) to authenticated;
revoke execute on function app.can_edit_event_folder(text) from public;
grant execute on function app.can_edit_event_folder(text) to authenticated;
revoke execute on function public.events_public() from public;
grant execute on function public.events_public() to anon, authenticated;

-- Editors write the content columns only; the id, authorship and timestamps are the
-- database's, and event_slugs only ever by the trigger.
revoke all on public.events, public.event_slugs from anon, authenticated;
grant select on public.events, public.event_slugs to authenticated;
grant insert (committee_id, slug, title, description, starts_at, ends_at, all_day, place, image,
              signup_url, published)
  on public.events to authenticated;
grant update (committee_id, slug, title, description, starts_at, ends_at, all_day, place, image,
              signup_url, published)
  on public.events to authenticated;
grant delete on public.events to authenticated;
grant all on public.events, public.event_slugs to service_role;
