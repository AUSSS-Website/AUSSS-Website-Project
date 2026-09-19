-- Open Calls: officers manage their own committee's calls through the table (RLS), the public
-- sees live calls only (open + deadline not passed, Cairo days) through open_calls with the
-- private columns hidden, applications arrive only via submit_application (validated, deduped)
-- and are readable by the committee's officers alone.
begin;
select plan(24);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lore@pgtap.test', 'score.lore');

-- ---- officer writes -------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ insert into public.calls (committee_id, title, kind, deadline, notify_email, positions, questions)
     values (
       (select id from public.committees where slug = 'scope'),
       '  Booklet SWG  ', 'Small Working Group', app.today_cairo() + 7, 'SCOPE@ausss.org ',
       '[{"id":"p1","title":"Designer","slots":"2 spots","blurb":"Canva"},{"title":""},{"id":"p2","title":"Writer"}]'::jsonb,
       '[{"id":"q1","label":"Portfolio link?","type":"short","required":true},
         {"id":"q2","label":"Track","type":"select","options":["A","B"],"required":false},
         {"id":"q3","label":"No options select","type":"select","options":[]},
         {"label":"","type":"short"}]'::jsonb
     ) $$,
  'an officer creates a call for their committee'
);
select is(
  (select title from public.calls where committee_id = (select id from public.committees where slug = 'scope')),
  'Booklet SWG', 'title is trimmed'
);
select is(
  (select notify_email from public.calls where title = 'Booklet SWG'),
  'scope@ausss.org', 'notify_email is normalised'
);
select is(
  (select positions from public.calls where title = 'Booklet SWG'),
  '[{"id":"p1","title":"Designer","blurb":"Canva","slots":"2 spots"},{"id":"p2","title":"Writer","blurb":"","slots":""}]'::jsonb,
  'positions without a title are dropped, fields capped and defaulted'
);
select is(
  (select questions -> 2 ->> 'type' from public.calls where title = 'Booklet SWG'),
  'short', 'a select question without options becomes a short answer'
);
select is(
  (select jsonb_array_length(questions) from public.calls where title = 'Booklet SWG'),
  3, 'questions without a label are dropped'
);
select is(
  (select created_by from public.calls where title = 'Booklet SWG'),
  tests.user_id('leo@pgtap.test'), 'created_by is the signed-in officer'
);
select throws_ok(
  $$ insert into public.calls (committee_id, title)
     values ((select id from public.committees where slug = 'score'), 'Not mine') $$,
  '42501', null,
  'an officer cannot create a call for another committee'
);
-- an update cannot re-home the call
update public.calls set committee_id = (select id from public.committees where slug = 'score')
where title = 'Booklet SWG';
select is(
  (select m.slug from public.calls c join public.committees m on m.id = c.committee_id where c.title = 'Booklet SWG'),
  'scope', 'a call keeps its committee on update'
);

-- an expired open call and a draft, to check visibility
select tests.clear_auth();
select tests.authenticate_as('lore@pgtap.test');
insert into public.calls (committee_id, title, status, deadline)
values ((select id from public.committees where slug = 'score'), 'Expired', 'open', app.today_cairo() - 1),
       ((select id from public.committees where slug = 'score'), 'Draft', 'draft', null),
       ((select id from public.committees where slug = 'score'), 'Today', 'open', app.today_cairo());

-- anon cannot see the expired call through RLS, so remember its id as postgres
select tests.clear_auth();
create temporary table pgtap_ids on commit drop as
  select title, id from public.calls where title in ('Expired', 'Booklet SWG');
grant select on pgtap_ids to anon, authenticated;

-- ---- public reads ---------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as_anon();
select results_eq(
  $$ select title from public.open_calls order by title $$,
  $$ values ('Booklet SWG'), ('Today') $$,
  'anon sees only live calls (deadline day itself still counts)'
);
select throws_ok(
  $$ select notify_email from public.calls $$,
  '42501', null,
  'anon cannot read notify_email'
);
select is(
  (select count(*)::int from public.calls),
  2, 'anon sees live rows only on the table too'
);

-- a signed-in member: live rows only
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select is(
  (select count(*)::int from public.calls),
  2, 'a plain member sees live calls only'
);
-- RLS filters the row out of the update (zero rows, no error), so assert the value
update public.calls set status = 'closed' where title = 'Today';
select is(
  (select status from public.calls where title = 'Today'),
  'open', 'a plain member cannot update a call'
);

-- the owning officer sees drafts and expired ones
select tests.clear_auth();
select tests.authenticate_as('lore@pgtap.test');
select is(
  (select count(*)::int from public.calls where committee_id = (select id from public.committees where slug = 'score')),
  3, 'the committee officer sees draft and expired calls'
);

-- ---- applications ---------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.submit_application(
       (select id from public.calls where title = 'Booklet SWG'),
       'CALL-1', 'Sara', 'sara@example.com', '', '', '{p1}', '', '{}'::jsonb, '') $$,
  '22023', 'Please tell us why you want to join.',
  'motivation is required'
);
select throws_ok(
  $$ select public.submit_application(
       (select id from public.calls where title = 'Booklet SWG'),
       'CALL-1', 'Sara', 'sara@example.com', '', '', '{}', 'Because', '{}'::jsonb, '') $$,
  '22023', 'Please choose at least one position.',
  'a position must be chosen when the call defines positions'
);
select throws_ok(
  $$ select public.submit_application(
       (select id from public.calls where title = 'Booklet SWG'),
       'CALL-1', 'Sara', 'sara@example.com', '', '', '{p1}', 'Because', '{}'::jsonb, '') $$,
  '22023', 'Please answer: Portfolio link?',
  'required questions must be answered'
);
select throws_ok(
  $$ select public.submit_application(
       (select id from pgtap_ids where title = 'Expired'),
       'CALL-1', 'Sara', 'sara@example.com', '', '', '{}', 'Because', '{}'::jsonb, '') $$,
  '22023', 'This call has closed.',
  'an expired call refuses applications'
);
select is(
  public.submit_application(
    (select id from public.calls where title = 'Booklet SWG'),
    'CALL-1', 'Sara', 'sara@example.com', '', '', '{p1,bogus}', 'Because',
    '{"q1":"https://x","q2":"Z","q3":"free text"}'::jsonb, 'http://spam') ->> 'ok',
  'true', 'the honeypot returns ok'
);
select tests.clear_auth();
select is((select count(*)::int from public.applications), 0, '...but writes nothing');
select tests.authenticate_as_anon();
select is(
  public.submit_application(
    (select id from public.calls where title = 'Booklet SWG'),
    'CALL-1', ' Sara ', 'Sara@Example.com', '0100', '3rd year', '{p1,bogus}', 'Because',
    '{"q1":"https://x","q2":"Z","q3":"free text"}'::jsonb, '') - 'id',
  '{"ok": true, "ref": "CALL-1"}'::jsonb,
  'a valid application is accepted'
);
-- read the stored row as postgres (anon has no select on applications)
select tests.clear_auth();
select is(
  (select jsonb_build_object('positions', positions, 'answers', answers, 'title', call_title)
     from public.applications where ref = 'CALL-1'),
  '{"positions": ["Designer"],
    "answers": [{"id":"q1","label":"Portfolio link?","value":"https://x"},{"id":"q3","label":"No options select","value":"free text"}],
    "title": "Booklet SWG"}'::jsonb,
  'positions resolve to titles, unknown ids and off-list select answers are dropped, the title is snapshotted'
);
select tests.authenticate_as_anon();
select is(
  public.submit_application(
    (select id from public.calls where title = 'Booklet SWG'),
    'CALL-2', 'Sara', 'sara@example.com', '', '', '{p2}', 'Again', '{"q1":"y"}'::jsonb, '') ->> 'duplicate',
  'true', 'a repeat from the same email within 24h is a quiet no-op'
);

select tests.clear_auth();
select * from finish();
rollback;
