-- Events: a committee's officers and the EB add, edit, publish and remove them; the EB alone
-- the society-wide ones; a member and a visitor write nothing and read only what is published,
-- through rpc/events_public(). The link comes from the title and the year and never collides;
-- an old link keeps redirecting; an all-day event covers whole Cairo days; a sign-up link is a
-- web address; publishing asks for a rebuild and a draft does not; and the picture bucket
-- follows the event's editors.
begin;
select plan(43);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scoph', 'Public Health', 'SCOPH', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scoph.lpo', (select id from public.committees where slug = 'scoph'), 'Local Public Health Officer', 'LPO', 'officer'),
       ('scoph.member', (select id from public.committees where slug = 'scoph'), 'Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('lpo@pgtap.test', 'Public Health Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('lpo@pgtap.test', 'scoph.lpo');
select tests.assign('member@pgtap.test', 'scoph.member');

delete from public.events;
update app.site_rebuild set requested_at = null, reason = null where id;

-- ---- who may add one ---------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select count(*) from public.events $$,
  '42501', null,
  'a visitor cannot read the table'
);
select tests.clear_auth();

select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.events (committee_id, title, starts_at)
     values ((select id from public.committees where slug = 'scoph'), 'Blood drive', '2027-04-07 18:00+02') $$,
  '42501', null,
  'a member cannot add an event'
);
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
select lives_ok(
  $$ insert into public.events (committee_id, title, starts_at, ends_at, place, signup_url)
     values ((select id from public.committees where slug = 'scoph'), 'World Health Day',
             '2027-04-07 18:00+02', '2027-04-07 20:00+02', 'Faculty garden', 'forms.gle/abc') $$,
  'an officer adds an event for their committee'
);
select throws_ok(
  $$ insert into public.events (committee_id, title, starts_at)
     values ((select id from public.committees where slug = 'scora'), 'Not mine', '2027-04-07 18:00+02') $$,
  '42501', null,
  'an officer cannot add an event for another committee'
);
select throws_ok(
  $$ insert into public.events (committee_id, title, starts_at) values (null, 'Society-wide', '2027-04-07 18:00+02') $$,
  '42501', null,
  'an officer cannot add a society-wide event'
);

-- ---- the link ----------------------------------------------------------------------------------
select is(
  (select slug from public.events where title = 'World Health Day'),
  'world-health-day-2027',
  'the link is the title and the year'
);
select is(
  (select signup_url from public.events where title = 'World Health Day'),
  'https://forms.gle/abc',
  'a sign-up link typed without https:// gets it'
);
insert into public.events (committee_id, title, starts_at)
values ((select id from public.committees where slug = 'scoph'), 'World Health Day', '2027-04-08 10:00+02');
select is(
  (select slug from public.events where starts_at = '2027-04-08 10:00+02'),
  'world-health-day-2027-2',
  'the same title in the same year gets its own link'
);
insert into public.events (committee_id, title, starts_at)
values ((select id from public.committees where slug = 'scoph'), 'NGA 2026', '2026-11-20 09:00+02');
select is(
  (select slug from public.events where title = 'NGA 2026'),
  'nga-2026',
  'a title that already names its year is not given it twice'
);
insert into public.events (committee_id, title, slug, starts_at)
values ((select id from public.committees where slug = 'scoph'), 'Archive', 'archive', '2026-11-21 09:00+02');
select is(
  (select slug from public.events where title = 'Archive'),
  'archive-2',
  'a new event never takes the archive''s link'
);
select throws_ok(
  $$ update public.events set slug = 'archive' where title = 'NGA 2026' $$,
  '22023', null,
  'an edit cannot take the archive''s link'
);
select throws_ok(
  $$ update public.events set slug = 'world-health-day-2027' where title = 'NGA 2026' $$,
  '23505', null,
  'an edit cannot take another event''s link'
);

-- ---- what the table refuses --------------------------------------------------------------------
select throws_ok(
  $$ update public.events set ends_at = '2027-04-07 17:00+02' where slug = 'world-health-day-2027' $$,
  '22023', 'An event cannot end before it starts.',
  'an event cannot end before it starts'
);
select throws_ok(
  $$ update public.events set signup_url = 'javascript:alert(1)' where slug = 'world-health-day-2027' $$,
  '22023', null,
  'a sign-up link must be a web address'
);
select throws_ok(
  $$ update public.events set image = 'javascript:alert(1)' where slug = 'world-health-day-2027' $$,
  '23514', null,
  'a picture must be an https address or a file of the site'
);
select lives_ok(
  $$ update public.events set signup_url = 'example.org:8080/register' where slug = 'world-health-day-2027' $$,
  'a sign-up link with a port and no scheme is taken'
);
select is(
  (select signup_url from public.events where slug = 'world-health-day-2027'),
  'https://example.org:8080/register',
  'and given https://'
);

-- a link at full length (a 60-character title and its year) survives an edit untouched
insert into public.events (committee_id, title, starts_at)
values ((select id from public.committees where slug = 'scoph'),
        'A very long workshop title that runs well past sixty characters in all', '2027-05-01 12:00+03');
update public.events set place = 'Hall 3'
where title = 'A very long workshop title that runs well past sixty characters in all';
select is(
  (select length(slug) || ' ' || right(slug, 5) from public.events
   where title = 'A very long workshop title that runs well past sixty characters in all'),
  (select length(app.slugify('A very long workshop title that runs well past sixty characters in all')) + 5 || ' -2027'),
  'an edit keeps a long link as it was made'
);
insert into public.events (committee_id, title, starts_at)
values ((select id from public.committees where slug = 'scoph'), repeat('x', 59) || ' tail', '2027-05-02 12:00+03');
select is(
  (select slug from public.events where title = repeat('x', 59) || ' tail'),
  repeat('x', 59) || '-2027',
  'a link cut at a hyphen loses the hyphen before the year'
);

-- ---- all day -----------------------------------------------------------------------------------
insert into public.events (committee_id, title, starts_at, ends_at, all_day)
values ((select id from public.committees where slug = 'scoph'), 'Summer camp',
        '2027-07-10 15:00+03', '2027-07-12 11:00+03', true);
-- event_over_at is the database's own helper: checked as its owner
select tests.clear_auth();
select is(
  (select starts_at from public.events where title = 'Summer camp'),
  '2027-07-10 00:00'::timestamp at time zone 'Africa/Cairo',
  'an all-day event starts at Cairo midnight'
);
select is(
  (select app.event_over_at(starts_at, ends_at, all_day) from public.events where title = 'Summer camp'),
  '2027-07-13 00:00'::timestamp at time zone 'Africa/Cairo',
  'an all-day event is over at the midnight after its last day'
);
select is(
  (select app.event_over_at(starts_at, ends_at, all_day) from public.events where title = 'NGA 2026'),
  '2026-11-20 09:00+02'::timestamptz,
  'an event without an end is over at its start'
);

-- ---- multiple days --------------------------------------------------------------------------------
-- days given out of order, with all_day set by mistake
insert into public.events (committee_id, title, starts_at, all_day, days)
values ((select id from public.committees where slug = 'scoph'), 'Spring school', '2027-03-12 09:00+02', true,
        '[{"starts_at": "2027-03-12T09:00:00+02:00", "ends_at": "2027-03-12T13:00:00+02:00"},
          {"starts_at": "2027-03-10T10:00:00+02:00", "ends_at": "2027-03-10T16:00:00+02:00"},
          {"starts_at": "2027-03-11T12:00:00+02:00", "ends_at": "2027-03-11T18:00:00+02:00"}]'::jsonb);
select is(
  (select (days -> 0 ->> 'starts_at')::timestamptz || ' | ' || starts_at || ' | ' || ends_at || ' | ' || all_day
          || ' | ' || jsonb_array_length(days)
   from public.events where title = 'Spring school'),
  '2027-03-10T10:00:00+02:00'::timestamptz || ' | ' || '2027-03-10T10:00:00+02:00'::timestamptz || ' | '
    || '2027-03-12T13:00:00+02:00'::timestamptz || ' | false | 3',
  'multiple days: the days in order, the event from the first start to the last end, never all day'
);
select throws_ok(
  $$ update public.events set days = '[{"starts_at": "2027-03-10T10:00:00+02:00", "ends_at": "2027-03-10T16:00:00+02:00"},
                                         {"starts_at": "2027-03-10T15:00:00+02:00", "ends_at": "2027-03-10T18:00:00+02:00"}]'::jsonb
     where title = 'Spring school' $$,
  '22023', 'Two of the days overlap.',
  'two days cannot overlap'
);
select throws_ok(
  $$ update public.events set days = '[{"starts_at": "2027-03-10T10:00:00+02:00", "ends_at": "2027-03-10T09:00:00+02:00"},
                                         {"starts_at": "2027-03-11T10:00:00+02:00", "ends_at": "2027-03-11T16:00:00+02:00"}]'::jsonb
     where title = 'Spring school' $$,
  '22023', 'Each day needs a start and an end after it.',
  'a day cannot end before it starts'
);
select throws_ok(
  $$ update public.events set days = '[{"starts_at": "soon", "ends_at": "later"}, {}]'::jsonb where title = 'Spring school' $$,
  '22023', 'Each day needs a start and an end.',
  'a day must be times'
);
update public.events
set days = '[{"starts_at": "2027-03-20T10:00:00+02:00", "ends_at": "2027-03-20T12:00:00+02:00"}]'::jsonb
where title = 'Spring school';
select is(
  (select jsonb_array_length(days) || ' | ' || starts_at || ' | ' || ends_at from public.events where title = 'Spring school'),
  '0 | ' || '2027-03-20T10:00:00+02:00'::timestamptz || ' | ' || '2027-03-20T12:00:00+02:00'::timestamptz,
  'a single day is a one-time event'
);

-- ---- drafts, publishing and the rebuild --------------------------------------------------------
select ok(
  (select requested_at is null from app.site_rebuild where id),
  'a draft does not ask for a rebuild'
);
select tests.authenticate_as_anon();
select is(
  jsonb_array_length(public.events_public() -> 'events'),
  0,
  'a visitor sees no draft'
);
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
update public.events set published = true where slug in ('world-health-day-2027', 'nga-2026');
update public.events set slug = 'nga-cairo' where slug = 'nga-2026';
select tests.clear_auth();
select is(
  (select reason from app.site_rebuild where id),
  'events',
  'publishing asks for a rebuild'
);

select tests.authenticate_as_anon();
select is(
  (select jsonb_agg(e ->> 'slug' order by e ->> 'starts_at') from jsonb_array_elements(public.events_public() -> 'events') as e),
  '["nga-cairo", "world-health-day-2027"]'::jsonb,
  'a visitor reads the published events, oldest first'
);
select is(
  (select e -> 'aliases' from jsonb_array_elements(public.events_public() -> 'events') as e where e ->> 'slug' = 'nga-cairo'),
  '["nga-2026"]'::jsonb,
  'the old link is kept to redirect'
);
select is(
  (select (e ->> 'committee') || ' | ' || (e ->> 'term') from jsonb_array_elements(public.events_public() -> 'events') as e
   where e ->> 'slug' = 'world-health-day-2027'),
  'scoph | pgtap',
  'each event names its committee and its term'
);
select ok(
  (select bool_and(e ? 'days') from jsonb_array_elements(public.events_public() -> 'events') as e),
  'each event carries its days'
);
select tests.clear_auth();
select is(
  app.term_label_for('2031-03-10 12:00+02'),
  '2030-31',
  'a date outside every term falls in the society''s year'
);

-- ---- the EB's society-wide events --------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.events (committee_id, title, starts_at, published)
     values (null, 'General Assembly', '2027-03-01 17:00+02', true) $$,
  'the EB adds a society-wide event'
);
select tests.clear_auth();

select tests.authenticate_as('lpo@pgtap.test');
update public.events set title = 'Hijacked' where title = 'General Assembly';
select is(
  (select count(*) from public.events where committee_id is null),
  0::bigint,
  'an officer neither sees nor edits a society-wide event'
);
select is(
  (select app.can_edit_event_folder(id::text) from public.events where slug = 'world-health-day-2027'),
  true,
  'an officer may put a picture in their event''s folder'
);
select is(
  app.can_edit_event_folder('..'),
  false,
  'a folder that is no event''s id is nobody''s'
);
select tests.clear_auth();
select is(
  (select title from public.events where committee_id is null),
  'General Assembly',
  'the society-wide event is untouched'
);

create temporary table pgtap_event on commit drop as
  select id from public.events where slug = 'world-health-day-2027';
grant select on pgtap_event to authenticated;

select tests.authenticate_as('member@pgtap.test');
select is(
  (select count(*) from public.events),
  0::bigint,
  'a member sees no event through the table'
);
select is(
  app.can_edit_event_folder((select id::text from pgtap_event)),
  false,
  'a member may not put a picture in an event''s folder'
);
select tests.clear_auth();

-- ---- removing ----------------------------------------------------------------------------------
select tests.authenticate_as('lpo@pgtap.test');
delete from public.events where slug = 'nga-cairo';
select tests.clear_auth();
select is(
  (select count(*) from public.event_slugs s where s.slug in ('nga-2026', 'nga-cairo')),
  0::bigint,
  'removing an event frees its links'
);

select * from finish();
rollback;
