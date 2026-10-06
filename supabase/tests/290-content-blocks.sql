-- Content blocks: a block's editors (the EB, and the officers of the committees it names) keep a
-- working copy and publish it through three functions; nobody writes the table directly;
-- visitors read rpc/content_public() and never see a draft. A save over someone else's newer
-- version is refused. Publishing asks for a rebuild of the public pages, and the audit log
-- names the block.
begin;
select plan(28);

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
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');
select tests.assign('leo@pgtap.test', 'scope.leo-out');

insert into public.content_blocks (key, editors)
values ('pgtap.page', '{scope}'), ('pgtap.board', '{}');

-- the blocks the site ships with, and who edits them
select is(
  (select jsonb_object_agg(key, to_jsonb(editors)) from public.content_blocks
   where key in ('join.faq', 'exchange.incomings', 'exchange.outgoings', 'site.contact', 'home.page', 'ifmsa.page')),
  '{"join.faq": [], "exchange.incomings": ["scope", "score"], "exchange.outgoings": ["scope", "score"], "site.contact": [], "home.page": [], "ifmsa.page": []}'::jsonb,
  'the FAQ, the contact details, the home page and the IFMSA page are the EB''s; the two exchange pages are also the exchange officers'''
);

-- anon: the RPC only, and nothing is published yet
select tests.authenticate_as_anon();
select ok(
  not ((public.content_public() -> 'blocks') ? 'pgtap.page'),
  'an unpublished block is not in the public answer'
);
select throws_ok(
  $$ select count(*) from public.content_blocks $$,
  '42501', null,
  'anon cannot read the table'
);
select throws_ok(
  $$ select public.save_content_draft('pgtap.page', '{"title":"x"}'::jsonb) $$,
  '42501', null,
  'anon cannot save a draft'
);

-- a plain member and another committee's officer: no rows, no writes
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select is(
  (select count(*) from public.content_blocks where key like 'pgtap.%'),
  0::bigint,
  'a plain member sees no blocks'
);
select throws_ok(
  $$ select public.save_content_draft('pgtap.page', '{"title":"x"}'::jsonb) $$,
  '42501', 'You cannot edit that part of the site.',
  'a plain member cannot save a draft'
);
select ok(not app.can_edit_content('pgtap.page'), 'a plain member cannot upload to the block''s folder');

select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
select throws_ok(
  $$ select public.publish_content('pgtap.page', '{"title":"x"}'::jsonb) $$,
  '42501', 'You cannot edit that part of the site.',
  'another committee''s officer cannot publish'
);

-- the block's own officer
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select is(
  (select count(*) from public.content_blocks where key like 'pgtap.%'),
  1::bigint,
  'an officer sees the block that names their committee, and not the EB''s'
);
select ok(app.can_edit_content('pgtap.page'), 'the officer may upload to the block''s folder');
select ok(not app.can_edit_content('pgtap.board'), 'and not to the EB block''s folder');
select ok(not app.can_edit_content('pgtap.nothing'), 'a block that does not exist has no editors');
select lives_ok(
  $$ select public.save_content_draft('pgtap.page', '{"title":"Draft"}'::jsonb) $$,
  'the officer saves a draft'
);
select is(
  (select draft from public.content_blocks where key = 'pgtap.page'),
  '{"title":"Draft"}'::jsonb,
  'the draft is kept'
);
select is(
  (select draft_saved_by from public.content_blocks where key = 'pgtap.page'),
  tests.user_id('leo@pgtap.test'),
  'and signed with the officer'
);
select throws_ok(
  $$ select public.save_content_draft('pgtap.page', '[1,2]'::jsonb) $$,
  '22023', null,
  'a document must be an object'
);
select throws_ok(
  $$ select public.save_content_draft('pgtap.board', '{"title":"x"}'::jsonb) $$,
  '42501', null,
  'the officer cannot touch the EB block'
);
select throws_ok(
  $$ update public.content_blocks set published = '{"title":"direct"}'::jsonb where key = 'pgtap.page' $$,
  '42501', null,
  'nobody updates the table directly'
);
select throws_ok(
  $$ select public.save_content_draft('pgtap.page', '{"title":"Late"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz) $$,
  '40001', null,
  'a save over a newer version is refused'
);

-- a draft is invisible to visitors
select tests.clear_auth();
select tests.authenticate_as_anon();
select ok(
  not ((public.content_public() -> 'blocks') ? 'pgtap.page'),
  'a draft does not reach the public answer'
);

-- publish
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ select public.publish_content('pgtap.page', '{"title":"Live"}'::jsonb) $$,
  'the officer publishes'
);
select is(
  (select jsonb_build_object('published', published, 'draft', draft) from public.content_blocks where key = 'pgtap.page'),
  '{"published":{"title":"Live"},"draft":null}'::jsonb,
  'publishing sets the published copy and clears the draft'
);
select lives_ok(
  $$ select public.save_content_draft('pgtap.page', '{"title":"Live"}'::jsonb) $$,
  'saving a draft equal to the published copy is accepted'
);
select is(
  (select draft from public.content_blocks where key = 'pgtap.page'),
  null::jsonb,
  'and leaves no draft'
);
select public.save_content_draft('pgtap.page', '{"title":"Second thoughts"}'::jsonb);
select public.discard_content_draft('pgtap.page');
select is(
  (select jsonb_build_object('published', published, 'draft', draft) from public.content_blocks where key = 'pgtap.page'),
  '{"published":{"title":"Live"},"draft":null}'::jsonb,
  'discarding a draft leaves the published copy alone'
);

select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  public.content_public() -> 'blocks' -> 'pgtap.page',
  '{"title":"Live"}'::jsonb,
  'visitors read the published copy'
);

-- behind the scenes
select tests.clear_auth();
select is(
  (select reason from app.site_rebuild where id),
  'content_blocks',
  'publishing asks for a rebuild of the public pages'
);
select ok(
  exists (
    select 1 from public.audit_log
    where table_name = 'content_blocks' and row_id = 'pgtap.page' and action = 'UPDATE'
      and actor = tests.user_id('leo@pgtap.test')
  ),
  'the audit log names the block and who changed it'
);

select * from finish();
rollback;
