-- Phase 5 (migration step 7): the photo gallery moves from a static pipeline
-- (_source/build-gallery.mjs writing src/data/gallery.js and /assets/gallery) and the admin-key
-- takedown page (apps-script/gallery.gs) into the database, edited from the portal by the PNSD
-- officers and the EB.
--
-- Shape:
--   albums          one row per album: slug (shareable /gallery/<slug>), title, blurb, cover,
--                   sort_order, published
--   gallery_photos  one row per photo. `path` is the object prefix in the public `gallery`
--                   bucket, '<album id>/<photo id>'; the files are <path>-thumb.jpg (600 px) and
--                   <path>-full.jpg (1600 px), made in the officer's browser before upload.
--                   `hidden` is a takedown (the photo stays in the album, greyed out in the
--                   editor, invisible to visitors); `deleted_at` is the bin: the editor restores
--                   or purges it, and the files go 30 days after removal.
--   album_slugs     every slug an album has ever had. A rename keeps the old slug here, so a link
--                   shared before the rename still opens the album (the client redirects).
--
-- Reads: the public site calls rpc/gallery_public() (anon), which returns the whole gallery as
-- one JSON document, and never touches the tables. Writes: PNSD officers and the EB through the
-- tables under row-level security (app.is_gallery_editor()).

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- PNSD (the media division) owns the gallery; the EB can always step in. is_officer_of already
-- includes is_eb.
create or replace function app.is_gallery_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.is_officer_of(app.committee_id_by_slug('pnsd')), false)
$$;

-- 'Aswan NGA 2026!' -> 'aswan-nga-2026'. Lower-case ASCII letters, digits and single hyphens,
-- at most 60 characters; '' when nothing usable is left.
create or replace function app.slugify(p text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $
  select left(
    btrim(
      regexp_replace(
        regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g'
      ),
      '-'
    ),
    60
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  blurb text not null default '',
  cover_photo_id uuid,
  sort_order int not null default 0,
  published boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint albums_title_len check (length(title) between 1 and 120),
  constraint albums_blurb_len check (length(blurb) <= 500),
  constraint albums_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  path text not null unique,
  width int not null,
  height int not null,
  sort_order int not null default 0,
  label text not null default '',
  featured boolean not null default false,
  hidden boolean not null default false,
  deleted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_photos_size check (width between 1 and 10000 and height between 1 and 10000),
  constraint gallery_photos_label_len check (length(label) <= 80),
  -- '<album id>/<photo id>': no folder escapes, no suffix (the client adds -thumb/-full)
  constraint gallery_photos_path_shape check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$')
);

create index if not exists gallery_photos_album_idx
  on public.gallery_photos (album_id, sort_order, created_at);

alter table public.albums
  drop constraint if exists albums_cover_photo_fk;
alter table public.albums
  add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references public.gallery_photos (id) on delete set null;

create table if not exists public.album_slugs (
  slug text primary key,
  album_id uuid not null references public.albums (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists album_slugs_album_idx on public.album_slugs (album_id);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- '-2', '-3' ... after a base slug that any album has used, now or in the past.
create or replace function app.next_free_album_slug(p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $
declare
  v_n int := 2;
  v_candidate text;
begin
  loop
    v_candidate := left(p_base, 60 - length('-' || v_n::text)) || '-' || v_n::text;
    exit when not exists (select 1 from public.album_slugs s where s.slug = v_candidate);
    v_n := v_n + 1;
    if v_n > 999 then
      raise exception 'could not find a free link for %', p_base using errcode = '22023';
    end if;
  end loop;
  return v_candidate;
end
$;

-- The slug comes from the title when the editor leaves it blank, is normalised otherwise, and
-- can never be one another album has used (a shared link must keep pointing at one album).
-- created_by is always the caller.
create or replace function app.normalize_album()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  new.title := left(btrim(coalesce(new.title, '')), 120);
  new.blurb := left(btrim(coalesce(new.blurb, '')), 500);
  if new.title = '' then
    raise exception 'an album needs a title' using errcode = '22023';
  end if;
  v_slug := app.slugify(coalesce(nullif(btrim(new.slug), ''), new.title));
  if v_slug = '' then
    v_slug := 'album';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    -- '-2', '-3' ... when the natural slug is taken (by any album, now or in the past)
    if exists (select 1 from public.album_slugs s where s.slug = v_slug) then
      v_slug := app.next_free_album_slug(v_slug);
    end if;
  else
    new.created_by := old.created_by;
    if exists (select 1 from public.album_slugs s where s.slug = v_slug and s.album_id <> new.id) then
      raise exception 'the link /gallery/% already belongs to another album', v_slug
        using errcode = '23505';
    end if;
  end if;
  new.slug := v_slug;
  return new;
end
$$;

-- Every slug the album has held stays in album_slugs.
create or replace function app.record_album_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.album_slugs (slug, album_id)
  values (new.slug, new.id)
  on conflict (slug) do nothing;
  return new;
end
$$;

drop trigger if exists normalize_album on public.albums;
create trigger normalize_album before insert or update on public.albums
  for each row execute function app.normalize_album();
drop trigger if exists record_album_slug on public.albums;
create trigger record_album_slug after insert or update of slug on public.albums
  for each row execute function app.record_album_slug();
drop trigger if exists set_updated_at on public.albums;
create trigger set_updated_at before update on public.albums
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.albums;
create trigger audit after insert or update or delete on public.albums
  for each row execute function app.audit();

-- A photo's path must sit in its album's folder and carry its own id; at most one photo per
-- album is the featured banner; created_by is the caller.
create or replace function app.normalize_gallery_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.label := left(btrim(coalesce(new.label, '')), 80);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.path := old.path;
    new.album_id := old.album_id;
  end if;
  if new.path <> new.album_id::text || '/' || new.id::text then
    raise exception 'photo path must be <album id>/<photo id>' using errcode = '22023';
  end if;
  return new;
end
$$;

create or replace function app.single_featured_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.featured then
    update public.gallery_photos p
      set featured = false
    where p.album_id = new.album_id and p.id <> new.id and p.featured;
  end if;
  return null;
end
$$;

drop trigger if exists normalize_gallery_photo on public.gallery_photos;
create trigger normalize_gallery_photo before insert or update on public.gallery_photos
  for each row execute function app.normalize_gallery_photo();
drop trigger if exists single_featured_photo on public.gallery_photos;
create trigger single_featured_photo after insert or update of featured on public.gallery_photos
  for each row when (new.featured) execute function app.single_featured_photo();
drop trigger if exists set_updated_at on public.gallery_photos;
create trigger set_updated_at before update on public.gallery_photos
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.gallery_photos;
create trigger audit after insert or update or delete on public.gallery_photos
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Public read: rpc/gallery_public()
-- ---------------------------------------------------------------------------------------------

-- The whole gallery as visitors should see it: published albums that have at least one visible
-- photo, in shelf order, each with its photos (featured banner first), its cover (the chosen
-- cover while it is visible, else the first photo) and the old slugs that should redirect to it.
-- Paths are bucket-relative; the client prefixes the Storage URL.
create or replace function public.gallery_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.*
    from public.gallery_photos p
    where not p.hidden and p.deleted_at is null
  ),
  ordered as (
    select v.*,
      row_number() over (
        partition by v.album_id
        order by v.featured desc, v.sort_order, v.created_at, v.id
      ) as rn
    from visible v
  ),
  per_album as (
    select
      o.album_id,
      count(*)::int as photo_count,
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'path', o.path,
          'w', o.width,
          'h', o.height,
          'featured', o.featured,
          'label', o.label
        )
        order by o.rn
      ) as photos,
      (array_agg(o.path order by o.rn))[1] as first_path
    from ordered o
    group by o.album_id
  )
  select jsonb_build_object(
    'albums', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'slug', a.slug,
          'title', a.title,
          'blurb', a.blurb,
          'count', pa.photo_count,
          'cover', coalesce(
            (select c.path from visible c where c.id = a.cover_photo_id),
            pa.first_path
          ),
          'aliases', coalesce((
            select jsonb_agg(s.slug order by s.created_at)
            from public.album_slugs s
            where s.album_id = a.id and s.slug <> a.slug
          ), '[]'::jsonb),
          'photos', pa.photos
        )
        order by a.sort_order, a.created_at, a.id
      )
      from public.albums a
      join per_album pa on pa.album_id = a.id
      where a.published
    ), '[]'::jsonb),
    'generated_at', now()
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: editors only; the public reads through the RPC
-- ---------------------------------------------------------------------------------------------

alter table public.albums enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.album_slugs enable row level security;

drop policy if exists albums_editor_select on public.albums;
create policy albums_editor_select on public.albums
  for select to authenticated using ((select app.is_gallery_editor()));
drop policy if exists albums_editor_insert on public.albums;
create policy albums_editor_insert on public.albums
  for insert to authenticated with check ((select app.is_gallery_editor()));
drop policy if exists albums_editor_update on public.albums;
create policy albums_editor_update on public.albums
  for update to authenticated
  using ((select app.is_gallery_editor()))
  with check ((select app.is_gallery_editor()));
drop policy if exists albums_editor_delete on public.albums;
create policy albums_editor_delete on public.albums
  for delete to authenticated using ((select app.is_gallery_editor()));

drop policy if exists gallery_photos_editor_select on public.gallery_photos;
create policy gallery_photos_editor_select on public.gallery_photos
  for select to authenticated using ((select app.is_gallery_editor()));
drop policy if exists gallery_photos_editor_insert on public.gallery_photos;
create policy gallery_photos_editor_insert on public.gallery_photos
  for insert to authenticated with check ((select app.is_gallery_editor()));
drop policy if exists gallery_photos_editor_update on public.gallery_photos;
create policy gallery_photos_editor_update on public.gallery_photos
  for update to authenticated
  using ((select app.is_gallery_editor()))
  with check ((select app.is_gallery_editor()));
drop policy if exists gallery_photos_editor_delete on public.gallery_photos;
create policy gallery_photos_editor_delete on public.gallery_photos
  for delete to authenticated using ((select app.is_gallery_editor()));

drop policy if exists album_slugs_editor_select on public.album_slugs;
create policy album_slugs_editor_select on public.album_slugs
  for select to authenticated using ((select app.is_gallery_editor()));

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `gallery`, written by the gallery editors
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gallery_read on storage.objects;
create policy gallery_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'gallery');
drop policy if exists gallery_insert on storage.objects;
create policy gallery_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery' and (select app.is_gallery_editor()));
drop policy if exists gallery_update on storage.objects;
create policy gallery_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gallery' and (select app.is_gallery_editor()))
  with check (bucket_id = 'gallery' and (select app.is_gallery_editor()));
drop policy if exists gallery_delete on storage.objects;
create policy gallery_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gallery' and (select app.is_gallery_editor()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter function app.is_gallery_editor() owner to postgres;
alter function app.slugify(text) owner to postgres;
alter function app.normalize_album() owner to postgres;
alter function app.next_free_album_slug(text) owner to postgres;
alter function app.record_album_slug() owner to postgres;
alter function app.normalize_gallery_photo() owner to postgres;
alter function app.single_featured_photo() owner to postgres;
alter function public.gallery_public() owner to postgres;

revoke execute on function app.is_gallery_editor() from public;
grant execute on function app.is_gallery_editor() to authenticated;
revoke execute on function app.slugify(text) from public;
grant execute on function app.slugify(text) to authenticated, service_role;
revoke execute on function app.normalize_album() from public;
revoke execute on function app.next_free_album_slug(text) from public;
revoke execute on function app.record_album_slug() from public;
revoke execute on function app.normalize_gallery_photo() from public;
revoke execute on function app.single_featured_photo() from public;

revoke execute on function public.gallery_public() from public;
grant execute on function public.gallery_public() to anon, authenticated;

-- Editors write the content columns only; ids, paths, authorship and timestamps are the
-- database's (the photo id is chosen by the client so the file can be uploaded under it first).
grant select on public.albums, public.gallery_photos, public.album_slugs to authenticated;
grant insert (slug, title, blurb, cover_photo_id, sort_order, published) on public.albums to authenticated;
grant update (slug, title, blurb, cover_photo_id, sort_order, published) on public.albums to authenticated;
grant delete on public.albums to authenticated;
grant insert (id, album_id, path, width, height, sort_order, label, featured, hidden)
  on public.gallery_photos to authenticated;
grant update (sort_order, label, featured, hidden, deleted_at) on public.gallery_photos to authenticated;
grant delete on public.gallery_photos to authenticated;
grant all on public.albums, public.gallery_photos, public.album_slugs to service_role;
