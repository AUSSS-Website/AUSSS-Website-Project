-- Magazine editor: CBSD officers and the EB edit editions through the table; nobody else can
-- read or write them; visitors read rpc/magazine_public() only. Drafts are not listed, a
-- published edition needs pages or a Canva link, missing editions keep their slot, and the
-- hero page is kept inside the edition.
begin;
select plan(17);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('cbsd', 'Capacity Building Support Division', 'CBSD', 'division'),
       ('pnsd', 'Public Relations and Media', 'PNSD', 'division')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('cbsd.director', (select id from public.committees where slug = 'cbsd'), 'CBSD Director', 'CBSD', 'officer'),
       ('pnsd.director', (select id from public.committees where slug = 'pnsd'), 'PNSD Director', 'PNSD', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('cbsd@pgtap.test', 'Magazine Officer');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('cbsd@pgtap.test', 'cbsd.director');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');

-- the migration seeded the seven pre-portal editions; clear them for a deterministic shelf
delete from public.magazine_issues;

-- anon: the RPC only
select tests.authenticate_as_anon();
select is(public.magazine_public() -> 'issues', '[]'::jsonb, 'anon reads an empty shelf');
select throws_ok(
  $$ select count(*) from public.magazine_issues $$,
  '42501', null,
  'anon cannot read magazine_issues'
);

-- member and the gallery's officer: refused
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.magazine_issues (title) values ('Members edition') $$,
  '42501', null,
  'a plain member cannot add an edition'
);
select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
select throws_ok(
  $$ insert into public.magazine_issues (title) values ('PNSD edition') $$,
  '42501', null,
  'an officer of another committee cannot add an edition'
);

-- CBSD officer: adds a draft; slug from the title; not listed until published with pages
select tests.clear_auth();
select tests.authenticate_as('cbsd@pgtap.test');
insert into public.magazine_issues (title, blurb) values ('Volume 8!', '  Autumn issue  ');
select is(
  (select slug || '|' || blurb || '|' || status from public.magazine_issues where title = 'Volume 8!'),
  'volume-8|Autumn issue|draft',
  'the slug comes from the title, the blurb is trimmed, new editions start as drafts'
);
select is(
  (select created_by from public.magazine_issues where slug = 'volume-8'),
  tests.user_id('cbsd@pgtap.test'),
  'created_by is the caller'
);
select throws_ok(
  $$ insert into public.magazine_issues (title, download_url) values ('Bad link', 'http://example.com/x.pdf') $$,
  '23514', null,
  'links must be https'
);
select throws_ok(
  $$ insert into public.magazine_issues (title, pages_base) values ('Bad base', 'data:image/jpeg;base64,xx') $$,
  '23514', null,
  'the pages folder must be a site path or an https URL'
);

update public.magazine_issues set status = 'published' where slug = 'volume-8';
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(public.magazine_public() -> 'issues', '[]'::jsonb, 'a published edition without pages or Canva is not listed');

select tests.clear_auth();
select tests.authenticate_as('cbsd@pgtap.test');
update public.magazine_issues
  set pages_base = 'https://example.supabase.co/storage/v1/object/public/magazine/x/pages/', page_count = 24, hero_page = 99, sort_order = 5
where slug = 'volume-8';
select is(
  (select pages_base || '|' || hero_page from public.magazine_issues where slug = 'volume-8'),
  'https://example.supabase.co/storage/v1/object/public/magazine/x/pages|24',
  'the trailing slash is dropped and the hero page is clamped to the last page'
);
update public.magazine_issues set hero_page = 3 where slug = 'volume-8';
insert into public.magazine_issues (slug, title, status, sort_order) values ('vol-4', 'Volume 4', 'missing', 9);
insert into public.magazine_issues (slug, title, status, sort_order, canva_url)
  values ('vol-9', 'Canva only', 'published', 0, 'https://www.canva.com/design/abc/view');

select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(public.magazine_public() -> 'issues') i),
  '["vol-9", "volume-8", "vol-4"]'::jsonb,
  'the shelf lists published and missing editions in sort order'
);
select is(
  public.magazine_public() -> 'issues' -> 1 -> 'heroPage',
  '3'::jsonb,
  'the hero page is published'
);
select is(
  public.magazine_public() -> 'issues' -> 2 -> 'missing',
  'true'::jsonb,
  'a missing edition is flagged'
);

-- the EB edits too; a draft disappears from the shelf
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
update public.magazine_issues set status = 'draft' where slug = 'vol-9';
select is((select status from public.magazine_issues where slug = 'vol-9'), 'draft', 'the EB can edit an edition');
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(jsonb_array_length(public.magazine_public() -> 'issues'), 2, 'a draft is not listed');

-- storage: bucket exists, editors only
select tests.clear_auth();
select is((select public from storage.buckets where id = 'magazine'), true, 'the magazine bucket is public');
select tests.authenticate_as('pnsd@pgtap.test');
select ok(not app.is_magazine_editor(), 'the gallery officer is not a magazine editor');

select * from finish();
rollback;
