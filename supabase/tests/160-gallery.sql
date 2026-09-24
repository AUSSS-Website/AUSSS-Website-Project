-- Gallery editor: PNSD officers and the EB edit albums and photos through the tables; nobody
-- else can read or write them; visitors read rpc/gallery_public() only. Slugs come from the
-- title, are unique across every slug an album has ever had, and a rename keeps the old slug
-- as an alias. Hidden and binned photos never reach the public document; an album with no
-- visible photo is not listed.
begin;
select plan(25);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('pnsd', 'Public Relations and Media', 'PNSD', 'division'),
       ('scope', 'Professional Exchange', 'SCOPE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('pnsd.director', (select id from public.committees where slug = 'pnsd'), 'PNSD Director', 'PNSD', 'officer'),
       ('pnsd.assistant', (select id from public.committees where slug = 'pnsd'), 'Assistant', 'Assistant', 'assistant'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('pnsd-assistant@pgtap.test', 'Media Assistant');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');
select tests.assign('pnsd-assistant@pgtap.test', 'pnsd.assistant');
select tests.assign('leo@pgtap.test', 'scope.leo-out');

-- anon: the RPC only
select tests.authenticate_as_anon();
select is(public.gallery_public() -> 'albums', '[]'::jsonb, 'anon reads an empty gallery');
select throws_ok(
  $$ select count(*) from public.albums $$,
  '42501', null,
  'anon cannot read albums'
);

-- member, assistant, another committee's officer: refused (RLS makes the insert fail)
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.albums (title) values ('Members album') $$,
  '42501', null,
  'a plain member cannot create an album'
);
select tests.clear_auth();
select tests.authenticate_as('pnsd-assistant@pgtap.test');
select throws_ok(
  $$ insert into public.albums (title) values ('Assistant album') $$,
  '42501', null,
  'a PNSD assistant cannot create an album'
);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ insert into public.albums (title) values ('SCOPE album') $$,
  '42501', null,
  'an officer of another committee cannot create an album'
);
select is((select count(*) from public.albums), 0::bigint, 'and they see no albums');

-- PNSD officer: creates an album; the slug comes from the title
select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
insert into public.albums (title, blurb) values ('Aswan NGA 2026!', '  Delegation trip  ');
select is(
  (select slug || '|' || blurb from public.albums where title = 'Aswan NGA 2026!'),
  'aswan-nga-2026|Delegation trip',
  'the slug is made from the title and the blurb is trimmed'
);
select is(
  (select created_by from public.albums where slug = 'aswan-nga-2026'),
  tests.user_id('pnsd@pgtap.test'),
  'created_by is the caller'
);
insert into public.albums (title) values ('Aswan NGA 2026');
select is(
  (select slug from public.albums where title = 'Aswan NGA 2026'),
  'aswan-nga-2026-2',
  'a second album with the same title gets -2'
);
select throws_ok(
  $$ insert into public.albums (title) values ('') $$,
  '22023', null,
  'an album needs a title'
);

-- rename keeps the old slug as an alias; a slug another album has held is refused
update public.albums set slug = 'Aswan 2026' where slug = 'aswan-nga-2026';
select is(
  (select array_agg(slug order by slug) from public.album_slugs
   where album_id = (select id from public.albums where slug = 'aswan-2026')),
  array['aswan-2026', 'aswan-nga-2026'],
  'renaming keeps the old slug as an alias'
);
select throws_ok(
  $$ update public.albums set slug = 'aswan-nga-2026' where slug = 'aswan-nga-2026-2' $$,
  '23505', null,
  'a slug another album has used cannot be taken'
);

-- photos: the path must be <album id>/<photo id>; one featured per album
select throws_ok(
  $$ insert into public.gallery_photos (id, album_id, path, width, height)
     values ('11111111-1111-1111-1111-111111111111',
             (select id from public.albums where slug = 'aswan-2026'),
             '11111111-1111-1111-1111-111111111111/11111111-1111-1111-1111-111111111111', 1600, 1200) $$,
  '22023', null,
  'a photo path outside its album folder is refused'
);
insert into public.gallery_photos (id, album_id, path, width, height, featured, label)
select '11111111-1111-1111-1111-111111111111', a.id, a.id::text || '/11111111-1111-1111-1111-111111111111', 1600, 1200, true, 'Delegation'
from public.albums a where a.slug = 'aswan-2026';
insert into public.gallery_photos (id, album_id, path, width, height, sort_order)
select '22222222-2222-2222-2222-222222222222', a.id, a.id::text || '/22222222-2222-2222-2222-222222222222', 1200, 1600, 0
from public.albums a where a.slug = 'aswan-2026';
insert into public.gallery_photos (id, album_id, path, width, height, sort_order)
select '33333333-3333-3333-3333-333333333333', a.id, a.id::text || '/33333333-3333-3333-3333-333333333333', 1600, 1067, 1
from public.albums a where a.slug = 'aswan-2026';
update public.gallery_photos set featured = true where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select array_agg(id::text order by id) from public.gallery_photos where featured),
  array['22222222-2222-2222-2222-222222222222'],
  'setting a new featured photo clears the old one'
);

-- the public document: album with cover, aliases and photos, featured first
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  jsonb_array_length(public.gallery_public() -> 'albums'),
  1,
  'only the album with visible photos is listed'
);
select is(
  public.gallery_public() -> 'albums' -> 0 -> 'aliases',
  '["aswan-nga-2026"]'::jsonb,
  'the old slug is listed as an alias'
);
select is(
  (select jsonb_agg(p ->> 'id') from jsonb_array_elements(public.gallery_public() -> 'albums' -> 0 -> 'photos') p),
  '["22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333"]'::jsonb,
  'the featured photo comes first, then sort order'
);
select is(
  public.gallery_public() -> 'albums' -> 0 ->> 'cover',
  (select path from public.gallery_photos where id = '22222222-2222-2222-2222-222222222222'),
  'without a chosen cover, the first photo is the cover'
);

-- chosen cover, then hidden: falls back to the first visible photo
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
update public.albums set cover_photo_id = '33333333-3333-3333-3333-333333333333' where slug = 'aswan-2026';
update public.gallery_photos set hidden = true where id = '33333333-3333-3333-3333-333333333333';
update public.gallery_photos set deleted_at = now() where id = '11111111-1111-1111-1111-111111111111';
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  public.gallery_public() -> 'albums' -> 0 ->> 'count',
  '1',
  'hidden and binned photos are not counted'
);
select is(
  public.gallery_public() -> 'albums' -> 0 ->> 'cover',
  (select path from public.gallery_photos where id = '22222222-2222-2222-2222-222222222222'),
  'a hidden cover falls back to the first visible photo'
);

-- EB edits too; an unpublished album disappears from the public document
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
update public.albums set published = false where slug = 'aswan-2026';
select is((select published from public.albums where slug = 'aswan-2026'), false, 'the EB can edit an album');
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(public.gallery_public() -> 'albums', '[]'::jsonb, 'an unpublished album is not listed');

-- storage: the bucket exists and only editors may write to it
select tests.clear_auth();
select is((select public from storage.buckets where id = 'gallery'), true, 'the gallery bucket is public');
select tests.authenticate_as('pnsd@pgtap.test');
select ok(app.is_gallery_editor(), 'a PNSD officer is a gallery editor');
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select ok(not app.is_gallery_editor(), 'another committee''s officer is not');

select * from finish();
rollback;
