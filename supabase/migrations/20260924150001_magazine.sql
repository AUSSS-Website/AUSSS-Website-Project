-- Phase 5 (magazine editor, requested 2026-09-24): the magazine shelf moves from src/data/magazine.js
-- and the _source/build-magazine.mjs rasterising step into the database, edited from the portal
-- by the CBSD officers and the EB.
--
-- Shape: one row per edition in magazine_issues. `slug` is the edition's stable id ('vol-7'),
-- also the key of the engagement counters in apps-script/magazine.gs. Page images live at
-- `<pages_base>/NNN.jpg` (zero-padded to 3 digits): for the editions built before the portal
-- that is a site path under /assets/magazine (served by Vercel), for editions uploaded from
-- the portal it is a folder in the public `magazine` Storage bucket, '<issue id>/pages'. The
-- client makes the JPEGs from the PDF (pdf.js) before upload, so no build step remains.
-- `hero_page` is the page shown as the edition's cover (header thumbnail, switcher, share
-- card); page 1 unless the editors pick another.
--
-- status: 'published' (on the shelf), 'missing' (a known back-issue with no copy yet: keeps a
-- slot in the switcher with a placeholder), 'draft' (not shown).
--
-- Reads: the public site calls rpc/magazine_public() (anon), which returns the shelf as one
-- JSON document. Writes: CBSD officers and the EB through the table under row-level security
-- (app.is_magazine_editor()).

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create or replace function app.is_magazine_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.is_officer_of(app.committee_id_by_slug('cbsd')), false)
$$;

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------

create table if not exists public.magazine_issues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  switcher_label text not null default '',
  date_label text not null default '',
  blurb text not null default '',
  status text not null default 'draft',
  sort_order int not null default 0,
  pages_base text not null default '',
  page_count int not null default 0,
  hero_page int not null default 1,
  download_url text not null default '',
  canva_url text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magazine_issues_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint magazine_issues_title_len check (length(title) between 1 and 120),
  constraint magazine_issues_switcher_len check (length(switcher_label) <= 60),
  constraint magazine_issues_date_len check (length(date_label) <= 80),
  constraint magazine_issues_blurb_len check (length(blurb) <= 600),
  constraint magazine_issues_status check (status in ('draft', 'published', 'missing')),
  constraint magazine_issues_pages check (page_count between 0 and 400),
  constraint magazine_issues_hero check (hero_page >= 1),
  constraint magazine_issues_urls check (
    (download_url = '' or download_url ~ '^https://') and (canva_url = '' or canva_url ~ '^https://')
  ),
  -- a site path or an https URL, never a data: URI or a protocol-relative link
  constraint magazine_issues_base check (pages_base = '' or pages_base ~ '^(/assets/|https://)')
);

-- Trim and cap the text columns, keep the hero page inside the edition, set authorship.
create or replace function app.normalize_magazine_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := left(btrim(coalesce(new.title, '')), 120);
  new.switcher_label := left(btrim(coalesce(new.switcher_label, '')), 60);
  new.date_label := left(btrim(coalesce(new.date_label, '')), 80);
  new.blurb := left(btrim(coalesce(new.blurb, '')), 600);
  new.download_url := btrim(coalesce(new.download_url, ''));
  new.canva_url := btrim(coalesce(new.canva_url, ''));
  new.pages_base := rtrim(btrim(coalesce(new.pages_base, '')), '/');
  if new.title = '' then
    raise exception 'an edition needs a title' using errcode = '22023';
  end if;
  new.slug := app.slugify(coalesce(nullif(btrim(new.slug), ''), new.title));
  if new.slug = '' then
    raise exception 'an edition needs a link name' using errcode = '22023';
  end if;
  if new.page_count = 0 then
    new.hero_page := 1;
  elsif new.hero_page > new.page_count then
    new.hero_page := new.page_count;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_magazine_issue on public.magazine_issues;
create trigger normalize_magazine_issue before insert or update on public.magazine_issues
  for each row execute function app.normalize_magazine_issue();
drop trigger if exists set_updated_at on public.magazine_issues;
create trigger set_updated_at before update on public.magazine_issues
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.magazine_issues;
create trigger audit after insert or update or delete on public.magazine_issues
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Public read: rpc/magazine_public()
-- ---------------------------------------------------------------------------------------------

-- The shelf as visitors see it: published editions and the known-missing ones, in shelf order
-- (newest first by convention). A published edition without pages and without a Canva link is
-- left out, as the static data did.
create or replace function public.magazine_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'issues', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.slug,
          'title', m.title,
          'switcherLabel', m.switcher_label,
          'date', m.date_label,
          'blurb', m.blurb,
          'missing', m.status = 'missing',
          'pages', jsonb_build_object('base', m.pages_base, 'count', m.page_count),
          'heroPage', m.hero_page,
          'download', m.download_url,
          'canva', m.canva_url
        )
        order by m.sort_order, m.created_at, m.id
      )
      from public.magazine_issues m
      where m.status = 'missing'
         or (m.status = 'published' and (m.page_count > 0 or m.canva_url <> ''))
    ), '[]'::jsonb),
    'generated_at', now()
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: editors only; the public reads through the RPC
-- ---------------------------------------------------------------------------------------------

alter table public.magazine_issues enable row level security;

drop policy if exists magazine_editor_select on public.magazine_issues;
create policy magazine_editor_select on public.magazine_issues
  for select to authenticated using ((select app.is_magazine_editor()));
drop policy if exists magazine_editor_insert on public.magazine_issues;
create policy magazine_editor_insert on public.magazine_issues
  for insert to authenticated with check ((select app.is_magazine_editor()));
drop policy if exists magazine_editor_update on public.magazine_issues;
create policy magazine_editor_update on public.magazine_issues
  for update to authenticated
  using ((select app.is_magazine_editor()))
  with check ((select app.is_magazine_editor()));
drop policy if exists magazine_editor_delete on public.magazine_issues;
create policy magazine_editor_delete on public.magazine_issues
  for delete to authenticated using ((select app.is_magazine_editor()));

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `magazine`, written by the magazine editors
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('magazine', 'magazine', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists magazine_read on storage.objects;
create policy magazine_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'magazine');
drop policy if exists magazine_insert on storage.objects;
create policy magazine_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'magazine' and (select app.is_magazine_editor()));
drop policy if exists magazine_update on storage.objects;
create policy magazine_update on storage.objects
  for update to authenticated
  using (bucket_id = 'magazine' and (select app.is_magazine_editor()))
  with check (bucket_id = 'magazine' and (select app.is_magazine_editor()));
drop policy if exists magazine_delete on storage.objects;
create policy magazine_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'magazine' and (select app.is_magazine_editor()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter function app.is_magazine_editor() owner to postgres;
alter function app.normalize_magazine_issue() owner to postgres;
alter function public.magazine_public() owner to postgres;

revoke execute on function app.is_magazine_editor() from public;
grant execute on function app.is_magazine_editor() to authenticated;
revoke execute on function app.normalize_magazine_issue() from public;
revoke execute on function public.magazine_public() from public;
grant execute on function public.magazine_public() to anon, authenticated;

grant select on public.magazine_issues to authenticated;
grant insert (slug, title, switcher_label, date_label, blurb, status, sort_order, pages_base, page_count,
              hero_page, download_url, canva_url)
  on public.magazine_issues to authenticated;
grant update (slug, title, switcher_label, date_label, blurb, status, sort_order, pages_base, page_count,
              hero_page, download_url, canva_url)
  on public.magazine_issues to authenticated;
grant delete on public.magazine_issues to authenticated;
grant all on public.magazine_issues to service_role;

-- ---------------------------------------------------------------------------------------------
-- The seven editions from src/data/magazine.js (page images stay under /assets/magazine)
-- ---------------------------------------------------------------------------------------------

insert into public.magazine_issues
  (slug, title, switcher_label, date_label, blurb, status, sort_order, pages_base, page_count, download_url, canva_url)
values
  ('vol-7', 'Summer', 'Summer, Vol. 7', 'Volume 7 · A CBSD production',
   'The seventh volume of the AUSSS Magazine. Read it in full below or download it, and share it with your friends.',
   'published', 1, '/assets/magazine/vol-7/pages', 23,
   'https://drive.google.com/file/d/1bI7nD273A_3t8vtUwUtBlL7jOaU6IsW9/view', 'https://canva.link/buxysnx205xfisq'),
  ('vol-6', 'The Story of Origin, Vol. 6', '', 'A CBSD production',
   'The sixth volume of the AUSSS Magazine. Read it in full below or download it, and share it with your friends.',
   'published', 2, '/assets/magazine/vol-6/pages', 30,
   'https://drive.google.com/file/d/17zMEOGekcoC09X4NDcgBxFlgaA-FiXuw/view',
   'https://www.canva.com/design/DAHGTEatDDQ/0BPis3tFKLYKp4OCFfUVXw/view'),
  ('vol-5', 'Volume 5', '', '5th Edition', '', 'published', 3, '/assets/magazine/vol-5/pages', 19,
   'https://drive.google.com/file/d/1jmY2TL1r8UuqKXePgxQgHYqXJWTjuwyU/view', ''),
  ('vol-4', 'Volume 4', '', '', '', 'missing', 4, '', 0, '', ''),
  ('vol-3', 'Palestine', 'Palestine, Vol. 3', 'Vol. 03 · December', '', 'published', 5,
   '/assets/magazine/vol-3/pages', 42,
   'https://drive.google.com/file/d/1SQoJCpbFo2naY_1hw2h_77h0cXRTi679/view', ''),
  ('vol-2', 'Volume 2', '', '', '', 'missing', 6, '', 0, '', ''),
  ('vol-1', 'Volume 1', '', 'Vol. 01 · March', '', 'published', 7, '/assets/magazine/vol-1/pages', 32,
   'https://drive.google.com/file/d/12ancWzotqyaZ4hf0mvw9mH6IowHS6xHO/view', '')
on conflict (slug) do nothing;
