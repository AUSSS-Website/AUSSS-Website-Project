-- The term rollover: the Executive Board alone previews and runs it; the work accounts keep
-- their positions into the new term (and an address with no account yet is offered one), the
-- roster's positions below officer are offered again, a position the roster does not list ends,
-- open tasks move into the new term and done ones stay, the ticked albums go to the archive
-- under the old term and keep their pages, the term switches, the old term's unanswered offers
-- go, and the site is rebuilt. A rollover that would leave nobody on the board is refused. Also:
-- a task's term moves with the rollover only, 'archive' is the gallery archive's own link, and
-- a link cut at a hyphen loses the hyphen.
begin;
select plan(45);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true, starts_on = excluded.starts_on, ends_on = excluded.ends_on;

insert into public.committees (slug, name, abbr, kind)
values ('scoph', 'Public Health', 'SCOPH', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scoph.lpo', (select id from public.committees where slug = 'scoph'), 'Local Public Health Officer', 'LPO', 'officer'),
       ('scoph.assistant', (select id from public.committees where slug = 'scoph'), 'Assistant', null, 'assistant'),
       ('scoph.member', (select id from public.committees where slug = 'scoph'), 'Member', null, 'member'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR & HIV/AIDS', 'LORA', 'officer')
on conflict do nothing;

-- The work accounts: the President's and the LPO's exist and hold their positions; the LORA's
-- address has no account yet.
select tests.work_email('president@pgtap.test', 'eb.president');
select tests.work_email('lpo@pgtap.test', 'scoph.lpo');
select tests.work_email('lora@pgtap.test', 'scora.lora');
select tests.create_user('president@pgtap.test', 'The President');
select tests.create_user('lpo@pgtap.test', 'Public Health Officer');
select tests.assign('president@pgtap.test', 'eb.president');
select tests.assign('lpo@pgtap.test', 'scoph.lpo');

-- A member the roster lists under SCOPH (the roster gives the position), an assistant the
-- roster does not list (invited by hand this term), and a member with no position.
select tests.create_user('listed@pgtap.test', 'Listed Member');
select tests.create_user('helper@pgtap.test', 'Hand Picked Helper');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.roster('Listed Member', 'listed@pgtap.test', 'Active');
update public.roster_entries
   set committee_id = (select id from public.committees where slug = 'scoph'),
       position_id = (select id from public.positions where key = 'scoph.member')
 where email_normalized = 'listed@pgtap.test';
select tests.assign('helper@pgtap.test', 'scoph.assistant');
select tests.invite('never-signed-in@pgtap.test', 'scoph.assistant');

insert into public.tasks (committee_id, title, status)
values ((select id from public.committees where slug = 'scoph'), 'Plan the blood drive', 'doing'),
       ((select id from public.committees where slug = 'scoph'), 'Book the hall', 'done');

-- Two albums with a photo each (gallery_public lists albums that have one).
insert into public.albums (id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Spring camp'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Health week');
insert into public.gallery_photos (id, album_id, path, width, height) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001/bbbbbbbb-0000-0000-0000-000000000001', 1600, 1200),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000002/bbbbbbbb-0000-0000-0000-000000000002', 1600, 1200);

update app.site_rebuild set requested_at = null, reason = null where id;

-- ---- the setup holds ----------------------------------------------------------------------------
select ok(
  exists (select 1 from public.assignments a
          join public.positions p on p.id = a.position_id
          where p.key = 'scoph.member' and a.profile_id = tests.user_id('listed@pgtap.test')
            and a.term_id = app.current_term_id() and a.status = 'active'),
  'the roster gave the listed member SCOPH membership this term'
);

-- ---- who may look and run it --------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.rollover_preview() $$,
  '42501', null,
  'a visitor cannot preview the rollover'
);
select tests.clear_auth();

select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.rollover_preview() $$,
  '42501', null,
  'a member cannot preview the rollover'
);
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
select throws_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31') $$,
  '42501', null,
  'an officer cannot run the rollover'
);
select tests.clear_auth();

-- ---- the preview ----------------------------------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');

select is(
  (select doc -> 'next' ->> 'label' || ' ' || (doc -> 'next' ->> 'starts_on') || ' ' || (doc -> 'next' ->> 'ends_on') from (select public.rollover_preview() as doc) p),
  '2027-28 2027-09-01 2028-08-31',
  'the next term is the year after the current one'
);
select is(
  (select doc -> 'current' ->> 'label' from (select public.rollover_preview() as doc) p),
  'pgtap',
  'the preview names the current term'
);
select ok(
  (select doc -> 'work_accounts' @> '[{"email": "president@pgtap.test", "has_account": true, "holds_now": true}]' from (select public.rollover_preview() as doc) p),
  'the President''s work account is listed as holding the position'
);
select ok(
  (select doc -> 'work_accounts' @> '[{"email": "lora@pgtap.test", "has_account": false, "holds_now": false}]' from (select public.rollover_preview() as doc) p),
  'an address with no account yet is listed as such'
);
select ok(
  (select doc -> 'ending' @> '[{"title": "Assistant", "committee": "SCOPH", "name": "Hand Picked Helper"}]' from (select public.rollover_preview() as doc) p),
  'a position the roster does not list is shown as ending'
);
select ok(
  (select not doc -> 'ending' @> '[{"name": "Listed Member"}]' from (select public.rollover_preview() as doc) p),
  'a position the roster lists is not shown as ending'
);
select cmp_ok(
  (select (doc ->> 'roster_positions')::int from (select public.rollover_preview() as doc) p), '>=', 1,
  'the roster''s positions are counted'
);
select cmp_ok(
  (select (doc ->> 'open_tasks')::int from (select public.rollover_preview() as doc) p), '>=', 1,
  'open tasks are counted'
);
select ok(
  (select doc -> 'albums' @> '[{"title": "Spring camp", "photos": 1}, {"title": "Health week", "photos": 1}]' from (select public.rollover_preview() as doc) p),
  'the albums still in the gallery are listed with their photos'
);
select ok(
  (select (doc ->> 'storage_bytes')::bigint >= 0 from (select public.rollover_preview() as doc) p),
  'the storage used is reported'
);

-- ---- what it refuses ------------------------------------------------------------------------------
select throws_ok(
  $$ select public.roll_over_term('next year', '2027-09-01', '2028-08-31') $$,
  '22023', 'A term is named like 2027-28.',
  'a term is named like 2027-28'
);
select throws_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2027-08-01') $$,
  '22023', null,
  'the last day must come after the first'
);
select throws_ok(
  $$ select public.roll_over_term('2027-28', '2026-01-01', '2026-12-31') $$,
  '22023', null,
  'the new term must start after the current one started'
);
select throws_ok(
  $$ select public.roll_over_term('2025-26', '2027-09-01', '2028-08-31') $$,
  '22023', 'The term 2025-26 is over. The new term needs a name of its own.',
  'an old term''s name cannot be used again'
);
delete from public.position_work_emails
 where position_id = (select id from public.positions where key = 'eb.president');
select throws_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31') $$,
  '22023', null,
  'a rollover that would leave nobody on the board is refused'
);
select tests.work_email('president@pgtap.test', 'eb.president');
select is(
  (select label from public.terms where is_current), 'pgtap',
  'a refused rollover leaves the term as it was'
);

-- ---- the rollover ---------------------------------------------------------------------------------
select lives_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31',
                                  array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  'the board rolls the society over to 2027-28'
);
select tests.clear_auth();

select is(
  (select reason from app.site_rebuild where id),
  'rollover',
  'the rollover asks for a rebuild'
);
select ok(
  not exists (select 1 from public.invites where email_normalized = 'never-signed-in@pgtap.test'),
  'the old term''s offers nobody took up are withdrawn'
);

select is(
  (select label from public.terms where is_current), '2027-28',
  '2027-28 is now the current term'
);
select is(
  (select count(*)::int from public.assignments a
   join public.terms t on t.id = a.term_id
   where t.label = 'pgtap' and a.status = 'active'),
  0,
  'every assignment of the old term has ended'
);

select tests.authenticate_as('president@pgtap.test');
select ok(app.is_eb(), 'the President''s work account is still on the board');
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
select ok(
  app.is_officer_of((select id from public.committees where slug = 'scoph')),
  'the LPO''s work account still runs SCOPH'
);
select tests.clear_auth();

select is(
  (select accepted_at is null from public.invites i
   join public.positions p on p.id = i.position_id
   where p.key = 'scora.lora' and i.term_id = app.current_term_id()
     and i.email_normalized = 'lora@pgtap.test'),
  true,
  'an address with no account is offered its position for the new term'
);
select tests.create_user('lora@pgtap.test', 'Officer Who Signs In Later');
select tests.authenticate_as('lora@pgtap.test');
select ok(
  app.is_officer_of((select id from public.committees where slug = 'scora')),
  'and holds it from its first sign-in'
);
select tests.clear_auth();

select ok(
  exists (select 1 from public.assignments a
          join public.positions p on p.id = a.position_id
          where p.key = 'scoph.member' and a.profile_id = tests.user_id('listed@pgtap.test')
            and a.term_id = app.current_term_id() and a.status = 'active'),
  'the roster''s member keeps SCOPH membership in the new term'
);
select ok(
  not exists (select 1 from public.assignments a
              where a.profile_id = tests.user_id('helper@pgtap.test')
                and a.term_id = app.current_term_id()),
  'a position the roster does not list is not carried over'
);
select is(
  (select ended_on from public.assignments a
   where a.profile_id = tests.user_id('helper@pgtap.test')),
  (now() at time zone 'Africa/Cairo')::date,
  'and its old assignment ended today, in Cairo'
);

select is(
  (select t.label from public.tasks k join public.terms t on t.id = k.term_id
   where k.title = 'Plan the blood drive'),
  '2027-28',
  'an open task moves into the new term'
);
select is(
  (select t.label from public.tasks k join public.terms t on t.id = k.term_id
   where k.title = 'Book the hall'),
  'pgtap',
  'a done task stays in its term'
);
select is(
  (select status from public.tasks where title = 'Plan the blood drive'),
  'doing',
  'a moved task keeps its status'
);

select is(
  (select t.label from public.albums a join public.terms t on t.id = a.archived_term_id
   where a.id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'pgtap',
  'a ticked album is archived under the term that ended'
);
select is(
  (select archived_term_id from public.albums where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::uuid,
  'an unticked album stays in the gallery'
);

select tests.authenticate_as_anon();
select is(
  (select a ->> 'term' from jsonb_array_elements(public.gallery_public() -> 'albums') a
   where a ->> 'title' = 'Spring camp'),
  'pgtap',
  'visitors still get the archived album, with its term'
);
select ok(
  (select (a -> 'term') = 'null'::jsonb from jsonb_array_elements(public.gallery_public() -> 'albums') a
   where a ->> 'title' = 'Health week'),
  'an album in the gallery has no term'
);
select tests.clear_auth();

select throws_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31') $$,
  '42501', null,
  'without a board session it refuses'
);

-- ---- a task's term moves with the rollover only ----------------------------------------------------
update public.tasks set term_id = (select id from public.terms where label = 'pgtap')
where title = 'Plan the blood drive';
select is(
  (select t.label from public.tasks k join public.terms t on t.id = k.term_id
   where k.title = 'Plan the blood drive'),
  '2027-28',
  'outside the rollover a task keeps its term'
);

-- ---- the gallery editor moves an album back --------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');
update public.albums set archived_term_id = null where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select archived_at from public.albums where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null::timestamptz,
  'an album moved back to the gallery loses its archive stamp'
);

-- ---- links -------------------------------------------------------------------------------------------
insert into public.albums (title) values ('Archive');
select is(
  (select slug from public.albums where title = 'Archive'),
  'archive-2',
  'an album never takes the archive''s own link'
);
select throws_ok(
  $$ update public.albums set slug = 'archive' where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  '22023', null,
  'an album cannot be renamed to the archive''s link'
);
select tests.clear_auth();

select is(
  app.slugify(repeat('a', 59) || ' tail'),
  repeat('a', 59),
  'a link cut at a hyphen loses the hyphen'
);

select * from finish();
rollback;
