-- Magazine counters and reading depth: anyone can track a reading session through the RPC
-- (view once per session, pages never go backwards, like and download once per session,
-- clamped to the edition); nobody reads the tables; the insights RPC is for CBSD and the EB.
begin;
select plan(15);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('cbsd', 'Capacity Building Support Division', 'CBSD', 'division')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('cbsd.director', (select id from public.committees where slug = 'cbsd'), 'CBSD Director', 'CBSD', 'officer')
on conflict do nothing;
select tests.create_user('cbsd@pgtap.test', 'Magazine Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('cbsd@pgtap.test', 'cbsd.director');

delete from public.magazine_issues;
insert into public.magazine_issues (slug, title, status, sort_order, pages_base, page_count)
values ('vol-9', 'Volume 9', 'published', 0, '/assets/magazine/vol-9/pages', 10);

select tests.authenticate_as_anon();
select is(
  public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'view'),
  '{"views": 1, "likes": 0, "downloads": 0}'::jsonb,
  'the first view of a session counts a read'
);
select is(
  public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'view') ->> 'views',
  '1',
  'a repeated view from the same session does not'
);
select is(
  public.magazine_track('22222222-2222-2222-2222-222222222222', 'vol-9', 'page', 4) ->> 'views',
  '2',
  'a page event from a new session starts it (and counts the read)'
);
select is(
  public.magazine_track('22222222-2222-2222-2222-222222222222', 'vol-9', 'page', 2) ->> 'views',
  '2',
  'going back to an earlier page is accepted'
);
select is(
  public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'like') ->> 'likes',
  '1',
  'a like counts once'
);
select is(
  public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'like') ->> 'likes',
  '1',
  'a second like from the same session does not'
);
select is(
  public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'download') ->> 'downloads',
  '1',
  'a download counts once'
);
select throws_ok(
  $$ select public.magazine_track('33333333-3333-3333-3333-333333333333', 'vol-nope', 'view') $$,
  'P0002', null,
  'an unknown edition is refused'
);
select throws_ok(
  $$ select public.magazine_track('11111111-1111-1111-1111-111111111111', 'vol-9', 'explode') $$,
  '22023', null,
  'an unknown event is refused'
);
select throws_ok(
  $$ select count(*) from public.magazine_sessions $$,
  '42501', null,
  'anon cannot read the sessions'
);
select throws_ok(
  $$ select public.magazine_insights('vol-9') $$,
  '42501', null,
  'anon cannot read the insights'
);
-- page 4 then 10 (the end) then 99 (clamped to page count + 1) for the second session
select tests.clear_auth();
select tests.authenticate_as_anon();
select lives_ok(
  $$ select public.magazine_track('22222222-2222-2222-2222-222222222222', 'vol-9', 'page', 10) $$,
  'reaching the last page is recorded'
);

-- a plain member cannot read insights; the CBSD officer can
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.magazine_insights('vol-9') $$,
  '42501', null,
  'a plain member cannot read the insights'
);
select tests.clear_auth();
select tests.authenticate_as('cbsd@pgtap.test');
select is(
  public.magazine_insights('vol-9') - 'reach' - 'median_page',
  '{"views": 2, "likes": 1, "downloads": 1, "sessions": 2, "tracked": 1, "finished": 1}'::jsonb,
  'the officer sees totals, tracked sessions and finishers'
);
select is(
  (select jsonb_agg(r -> 'readers') from jsonb_array_elements(public.magazine_insights('vol-9') -> 'reach') r),
  '[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]'::jsonb,
  'the reach curve counts the session that got to the end on every page'
);

select * from finish();
rollback;
