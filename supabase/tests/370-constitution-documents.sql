-- The documents on /constitution: one block, constitution.documents, that the EB (and so the
-- webmaster) edits and nobody else; a bucket of its own for the PDFs, public to read, written
-- only by the block's editors under the block's folder, and never overwritten or emptied from
-- the portal; the pictures' bucket keeps its own limit.
begin;
select plan(18);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('pnsd', 'Public Relations and Media', 'PNSD', 'division')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('society.webmaster', null, 'Webmaster', 'Webmaster', 'webmaster'),
       ('pnsd.director', (select id from public.committees where slug = 'pnsd'), 'PNSD Director', 'PNSD', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'Board Member');
select tests.create_user('web@pgtap.test', 'Web Master');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('web@pgtap.test', 'society.webmaster');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');

-- ---- the block ---------------------------------------------------------------------------------
select is(
  (select editors from public.content_blocks where key = 'constitution.documents'),
  '{}'::text[],
  'the constitution block exists and names no committee: it is the EB''s'
);
select is(
  (select published from public.content_blocks where key = 'constitution.documents'),
  null::jsonb,
  'nothing is published at first, so the page shows the files the site ships with'
);

-- ---- the bucket --------------------------------------------------------------------------------
select is(
  (select jsonb_build_object('public', public, 'limit', file_size_limit, 'types', allowed_mime_types)
   from storage.buckets where id = 'content-files'),
  '{"public": true, "limit": 26214400, "types": ["application/pdf"]}'::jsonb,
  'content-files is public, takes PDFs only and up to 25 MB'
);
select is(
  (select file_size_limit from storage.buckets where id = 'content-media'),
  5242880::bigint,
  'the pictures'' bucket keeps its 5 MB limit'
);
select is(
  (select array_agg(cmd::text order by cmd::text) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'content\_files\_%'),
  '{INSERT,SELECT}'::text[],
  'editors may list and add PDFs; nobody overwrites or removes one, so a published file cannot vanish'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'content\_files\_%'
     and roles = '{authenticated}'::name[]
     and coalesce(qual, with_check) like '%content-files%'
     and coalesce(qual, with_check) like '%can_edit_content%foldername%'),
  2::bigint,
  'each rule is for signed-in people, in this bucket, and asks whether they edit the block the folder names'
);
select is(
  (select with_check like '%constitution.documents%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'content_files_insert'),
  true,
  'PDFs are taken only in the constitution block''s folder'
);

-- ---- who may edit ------------------------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select ok(app.can_edit_content('constitution.documents'), 'a board member may upload to the block''s folder');
select lives_ok(
  $$ select public.publish_content('constitution.documents',
       '{"ausss": {"url": "https://example.supabase.co/storage/v1/object/public/content-files/constitution.documents/a.pdf", "name": "AUSSS.pdf", "pages": 40, "bytes": 800000}, "ausssVersion": "As amended at the LGA of October 2026"}'::jsonb) $$,
  'a board member publishes a new version'
);

select tests.clear_auth();
select tests.authenticate_as('web@pgtap.test');
select ok(app.can_edit_content('constitution.documents'), 'the webmaster may upload to the block''s folder');
select lives_ok(
  $$ select public.save_content_draft('constitution.documents', '{"ausssVersion": "Draft"}'::jsonb) $$,
  'the webmaster saves a draft'
);

select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
select ok(not app.can_edit_content('constitution.documents'), 'a committee officer may not upload there');
select throws_ok(
  $$ select public.publish_content('constitution.documents', '{"ausssVersion": "x"}'::jsonb) $$,
  '42501', 'You cannot edit that part of the site.',
  'a committee officer cannot publish'
);
select is(
  (select count(*) from public.content_blocks where key = 'constitution.documents'),
  0::bigint,
  'and does not see the block'
);

select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select ok(not app.can_edit_content('constitution.documents'), 'a plain member may not upload there');
select throws_ok(
  $$ select public.save_content_draft('constitution.documents', '{"ausssVersion": "x"}'::jsonb) $$,
  '42501', 'You cannot edit that part of the site.',
  'a plain member cannot save a draft'
);

-- ---- what visitors read ------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  public.content_public() -> 'blocks' -> 'constitution.documents' -> 'ausss' ->> 'url',
  'https://example.supabase.co/storage/v1/object/public/content-files/constitution.documents/a.pdf',
  'visitors read the published file''s address'
);
select is(
  public.content_public() -> 'blocks' -> 'constitution.documents' ->> 'ausssVersion',
  'As amended at the LGA of October 2026',
  'and the published line, not the draft'
);

select * from finish();
rollback;
