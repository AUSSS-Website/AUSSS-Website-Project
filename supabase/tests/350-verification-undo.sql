-- Undo on member verification: a decision keeps what it found, only the board member who made
-- it takes it back and only by its own name, an approval undone leaves the request pending and
-- the member exactly as they were (a candidate is a candidate again, not unverified), a decline
-- undone touches no profile, the audit log gains the undo and keeps the decision, and the
-- request can then be decided again.
-- What is refused, each with its own sentence: an undo twice, a decision named wrongly or made
-- again since by a colleague, a decision made before the migration, a member who has asked
-- again since or whose other request was decided later, an approval over a newer change of
-- status, tier or joining year, and an approval of a member the roster or a position verifies
-- by now (a suspended roster row and an ended position do not). A member files a request with
-- their profile and a message and no other column, cannot change their own decided request,
-- and the kept columns hold only what the check constraints allow.
--
-- Also here, because the committee editor now relies on it: an application whose call was
-- removed stays readable and editable for that committee's officers, and for nobody else's.
begin;
select plan(61);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing'),
       ('scoph', 'Public Health', 'SCOPH', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer'),
       ('scoph.member', (select id from public.committees where slug = 'scoph'), 'Member', null, 'member')
on conflict do nothing;

-- Two board members and two officers, each on the work email of the position.
select tests.work_email('board@pgtap.test', 'eb.president');
select tests.work_email('vp@pgtap.test', 'eb.vp-internal');
select tests.work_email('leo@pgtap.test', 'scope.leo-out');
select tests.work_email('lore@pgtap.test', 'score.lore');
select tests.create_user('board@pgtap.test', 'Board Member');
select tests.create_user('vp@pgtap.test', 'Second Board Member');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.assign('board@pgtap.test', 'eb.president');
select tests.assign('vp@pgtap.test', 'eb.vp-internal');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lore@pgtap.test', 'score.lore');

-- The members. Two are on the roster as candidates before signing in; the rest are unverified.
select tests.roster('Listed Candidate', 'candidate@pgtap.test', 'Candidate Member', 2025);
select tests.roster('Same Status', 'same@pgtap.test', 'Candidate Member', 2025);
select tests.create_user('slip@pgtap.test', 'Approved By A Slip');
select tests.create_user('declined@pgtap.test', 'Declined By A Slip');
select tests.create_user('candidate@pgtap.test', 'Listed Candidate');
select tests.create_user('same@pgtap.test', 'Same Status');
select tests.create_user('moved@pgtap.test', 'Moved On Since');
select tests.create_user('tier@pgtap.test', 'Tier Changed Since');
select tests.create_user('year@pgtap.test', 'Year Changed Since');
select tests.create_user('placed@pgtap.test', 'Given A Position');
select tests.create_user('listed@pgtap.test', 'Put On The Roster');
select tests.create_user('lapsed@pgtap.test', 'Suspended And Ended');
select tests.create_user('again@pgtap.test', 'Asked Again');
select tests.create_user('later@pgtap.test', 'Decided Later');
select tests.create_user('stale@pgtap.test', 'Stale Line');
select tests.create_user('before@pgtap.test', 'Decided Before');

insert into public.verification_requests (id, profile_id, message) values
  ('eeeeeeee-0000-0000-0000-000000000001', tests.user_id('slip@pgtap.test'), 'Please verify me'),
  ('eeeeeeee-0000-0000-0000-000000000002', tests.user_id('declined@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000003', tests.user_id('candidate@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000004', tests.user_id('moved@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000005', tests.user_id('placed@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000006', tests.user_id('listed@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000007', tests.user_id('again@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000010', tests.user_id('tier@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000011', tests.user_id('year@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000012', tests.user_id('same@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000013', tests.user_id('lapsed@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000014', tests.user_id('later@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000016', tests.user_id('stale@pgtap.test'), null);

-- A decision from before this migration: it is on the row, and nothing was kept beside it.
insert into public.verification_requests (id, profile_id, status, decided_by, decided_at) values
  ('eeeeeeee-0000-0000-0000-000000000008', tests.user_id('before@pgtap.test'), 'approved',
   tests.user_id('board@pgtap.test'), now());
update public.profiles set membership_status = 'active' where id = tests.user_id('before@pgtap.test');

-- The candidate as the roster left them, to compare with after the undo.
create temporary table pgtap_was on commit drop as
  select p.membership_status, p.membership_tier, p.joined_year
  from public.profiles p
  where p.id = tests.user_id('candidate@pgtap.test');

select is(
  (select membership_status from pgtap_was),
  'candidate',
  'the roster made the listed member a candidate before any request'
);

-- ---- who may call it at all -----------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.undo_verification_decision(uuid, text)', 'execute'),
  'anon holds no execute on the undo'
);
select ok(
  to_regprocedure('public.undo_verification_decision(uuid)') is null,
  'the undo that took a request''s id alone is not there'
);

-- ---- a decision keeps what it found ---------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');
select lives_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000001', 'approved', 'active') $$,
  'the board approves a request'
);
select is(
  (select jsonb_build_object('before', member_status_before, 'after', member_status_after)
   from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '{"before": "unverified", "after": "active"}'::jsonb,
  'an approval keeps the status it found and the one it left'
);
select lives_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000002', 'declined') $$,
  'the board declines a request'
);
select is(
  (select jsonb_build_object('before', member_status_before, 'after', member_status_after)
   from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000002'),
  '{"before": "unverified", "after": "unverified"}'::jsonb,
  'a decline keeps the same status twice'
);
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000003', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000004', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000005', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000006', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000007', 'declined');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000010', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000011', 'approved', 'active');
-- A candidate approved as a candidate: the approval leaves the status as it found it.
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000012', 'approved', 'candidate');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000013', 'approved', 'active');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000014', 'approved', 'active');
select throws_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000001', 'declined') $$,
  '22023', 'verification request eeeeeeee-0000-0000-0000-000000000001 is already approved',
  'a second decision is refused in the words the portal reads "is already approved" out of'
);
select tests.clear_auth();

-- ---- who may undo ---------------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  '42501', null,
  'a visitor cannot undo a decision'
);
select tests.clear_auth();

select tests.authenticate_as('slip@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  '42501', 'Only the Executive Board can undo a verification decision.',
  'the member a decision is about cannot undo it'
);
-- RLS leaves the member no row to update (zero rows, no error), so the row is read afterwards.
update public.verification_requests
   set status = 'pending', member_status_before = 'alumni', member_status_after = 'alumni'
 where id = 'eeeeeeee-0000-0000-0000-000000000001';
select throws_ok(
  $$ insert into public.verification_requests (profile_id, created_at)
     values (tests.user_id('slip@pgtap.test'), now() + interval '1 day') $$,
  '42501', null,
  'a member cannot give a request a date of their own'
);
select throws_ok(
  $$ insert into public.verification_requests (profile_id, member_status_before, member_status_after)
     values (tests.user_id('slip@pgtap.test'), 'alumni', 'alumni') $$,
  '42501', null,
  'a member cannot file a request that already holds a "before"'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  '42501', null,
  'an officer cannot undo a decision'
);
select tests.clear_auth();

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  '22023', 'This decision was made by another board member, and only they can undo it.',
  'a board member cannot undo a colleague''s decision'
);
select tests.clear_auth();

select is(
  (select jsonb_build_object('status', status, 'before', member_status_before, 'after', member_status_after)
   from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '{"status": "approved", "before": "unverified", "after": "active"}'::jsonb,
  'a refused undo, and a member''s update of their own decided request, change nothing'
);

-- ---- an approval undone ---------------------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'declined') $$,
  '22023', 'This request has been decided again since, so that decision is no longer there to undo.',
  'an approval is not taken back by an undo that names a decline'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'pending') $$,
  '22023', 'decision must be approved or declined',
  'the decision named is approved or declined'
);
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  'the board member who approved undoes the approval'
);
select tests.clear_auth();

select is(
  (select jsonb_build_object('status', status, 'decided_by', decided_by, 'decided_at', decided_at,
                             'before', member_status_before, 'after', member_status_after)
   from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '{"status": "pending", "decided_by": null, "decided_at": null, "before": null, "after": null}'::jsonb,
  'the request is pending again and keeps nothing of the decision'
);
select is(
  (select membership_status from public.profiles where id = tests.user_id('slip@pgtap.test')),
  'unverified',
  'the member is unverified again'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'verification_requests'
      and l.row_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and l.action = 'UPDATE'
      and l.actor = tests.user_id('board@pgtap.test')
      and l.before ->> 'status' = 'approved'
      and l.after ->> 'status' = 'pending'
  ),
  'the audit log records the undo on the request, with who undid it'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'profiles'
      and l.row_id = tests.user_id('slip@pgtap.test')::text
      and l.action = 'UPDATE'
      and l.actor = tests.user_id('board@pgtap.test')
      and l.before ->> 'membership_status' = 'active'
      and l.after ->> 'membership_status' = 'unverified'
  ),
  'and on the member''s profile'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'verification_requests'
      and l.row_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and l.before ->> 'status' = 'pending'
      and l.after ->> 'status' = 'approved'
  ),
  'the rows of the decision itself stay in the audit log'
);

-- ---- undo twice, and a second decision ------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001', 'approved') $$,
  '22023', 'This request is waiting for a decision, so there is nothing to undo.',
  'a decision cannot be undone twice'
);
select lives_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000001', 'declined') $$,
  'the request can be decided again, the other way this time'
);

-- ---- a decline undone -----------------------------------------------------------------------------
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000002', 'declined') $$,
  'the board member who declined undoes the decline'
);
select tests.clear_auth();

select is(
  (select status from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'declined',
  'the second decision stands'
);
select is(
  (select jsonb_build_object('status', status, 'decided_by', decided_by, 'before', member_status_before)
   from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000002'),
  '{"status": "pending", "decided_by": null, "before": null}'::jsonb,
  'a declined request undone is pending again'
);
select is(
  (select membership_status from public.profiles where id = tests.user_id('declined@pgtap.test')),
  'unverified',
  'and its member is as they were, which a decline never changed'
);

-- ---- exactly what it was --------------------------------------------------------------------------
select is(
  (select membership_status from public.profiles where id = tests.user_id('candidate@pgtap.test')),
  'active',
  'the approval made the candidate an active member'
);
-- The member edits their own details after the approval. The undo writes none of them.
update public.profiles set phone = '01000000001' where id = tests.user_id('candidate@pgtap.test');
-- How many times the audit log has seen the profile of the member approved as what they were.
create temporary table pgtap_seen on commit drop as
  select count(*)::int as n
  from public.audit_log l
  where l.table_name = 'profiles' and l.row_id = tests.user_id('same@pgtap.test')::text;

select tests.authenticate_as('board@pgtap.test');
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000003', 'approved') $$,
  'an approval is undone although the member has edited their own details since'
);
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000012', 'approved') $$,
  'an approval that left the status as it found it is undone'
);
select tests.clear_auth();

select is(
  (select jsonb_build_object('status', p.membership_status, 'tier', p.membership_tier,
                             'year', p.joined_year, 'phone', p.phone)
   from public.profiles p where p.id = tests.user_id('candidate@pgtap.test')),
  (select jsonb_build_object('status', w.membership_status, 'tier', w.membership_tier,
                             'year', w.joined_year, 'phone', '01000000001'::text)
   from pgtap_was w),
  'the member is a candidate again, with the roster''s tier and year and the phone number they typed'
);
select is(
  jsonb_build_object(
    'request', (select status from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000012'),
    'member', (select membership_status from public.profiles where id = tests.user_id('same@pgtap.test')),
    'profile_writes', (select count(*)::int from public.audit_log l
                       where l.table_name = 'profiles' and l.row_id = tests.user_id('same@pgtap.test')::text)
                      - (select n from pgtap_seen)
  ),
  '{"request": "pending", "member": "candidate", "profile_writes": 0}'::jsonb,
  'and its undo leaves the request pending without writing the profile'
);

-- ---- what is refused ------------------------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');

-- The board gives the member another status by hand after approving them.
select public.set_membership_status(tests.user_id('moved@pgtap.test'), 'alumni');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000004', 'approved') $$,
  '22023', 'The membership of this member has changed since the approval, so the approval cannot be undone.',
  'an approval is not undone over a newer change of status'
);

-- The member is given a position after the approval.
select tests.assign('placed@pgtap.test', 'scoph.member');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000005', 'approved') $$,
  '22023', 'This member is now on the roster or holds a position, which verifies them, so the approval cannot be undone.',
  'nor once the member holds a position'
);
select tests.clear_auth();

-- The member is put on the roster after the approval, and the row links to their account.
select tests.roster('Put On The Roster', 'listed@pgtap.test', 'Full Member');
-- The tier alone changes after the approval, and for another member the joining year alone.
update public.profiles set membership_tier = 'Associate Member' where id = tests.user_id('tier@pgtap.test');
update public.profiles set joined_year = 2024 where id = tests.user_id('year@pgtap.test');
-- The member who was declined asks again a minute later.
insert into public.verification_requests (id, profile_id, message, created_at) values
  ('eeeeeeee-0000-0000-0000-000000000009', tests.user_id('again@pgtap.test'), 'With more detail',
   now() + interval '1 minute');
-- An older request of the same member is decided a minute after the approval.
insert into public.verification_requests (id, profile_id, status, decided_by, decided_at, created_at) values
  ('eeeeeeee-0000-0000-0000-000000000015', tests.user_id('later@pgtap.test'), 'declined',
   tests.user_id('vp@pgtap.test'), now() + interval '1 minute', now() - interval '1 hour');
-- A suspended roster row links to the member after the approval, and a position they held has
-- ended: neither verifies anyone.
select tests.roster('Suspended And Ended', 'lapsed@pgtap.test', 'Suspended');
insert into public.assignments (profile_id, position_id, term_id, status, ended_on) values
  (tests.user_id('lapsed@pgtap.test'), (select id from public.positions where key = 'scoph.member'),
   app.current_term_id(), 'ended', current_date);

select tests.authenticate_as('board@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000006', 'approved') $$,
  '22023', 'This member is now on the roster or holds a position, which verifies them, so the approval cannot be undone.',
  'nor once the member is on the roster'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000010', 'approved') $$,
  '22023', 'The membership of this member has changed since the approval, so the approval cannot be undone.',
  'a change of tier alone stands in the way'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000011', 'approved') $$,
  '22023', 'The membership of this member has changed since the approval, so the approval cannot be undone.',
  'and so does a change of joining year alone'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000007', 'declined') $$,
  '22023', 'This member has sent a newer request since the decision. Decide that request instead.',
  'a decline is not undone once the member has asked again'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000014', 'approved') $$,
  '22023', 'Another request from this member has been decided since, so this decision can no longer be undone.',
  'nor a decision once another request of the member was decided after it'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000008', 'approved') $$,
  '22023', 'This decision was made before decisions could be undone. The webmaster can change the status of the member by hand.',
  'a decision made before this migration cannot be undone'
);
select throws_ok(
  $$ select public.undo_verification_decision('00000000-0000-0000-0000-00000000dead', 'approved') $$,
  '22023', 'That verification request no longer exists.',
  'a request that is not there is said to be gone'
);
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000013', 'approved') $$,
  'a suspended roster row and an ended position do not stand in the way'
);
select tests.clear_auth();

select is(
  (select membership_status from public.profiles where id = tests.user_id('lapsed@pgtap.test')),
  'unverified',
  'and that member is unverified again'
);
select is(
  (select count(*)::int from public.verification_requests
   where id in ('eeeeeeee-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000005',
                'eeeeeeee-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000008',
                'eeeeeeee-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000011',
                'eeeeeeee-0000-0000-0000-000000000014')
     and status = 'approved'),
  7,
  'every refused undo leaves its approval standing'
);

-- ---- an Undo left open while a colleague decides again --------------------------------------------
-- One board member declines and undoes; the other then approves. The first one's line, still
-- open in another tab, names the decline.
select tests.authenticate_as('board@pgtap.test');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000016', 'declined');
select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000016', 'declined');
select tests.clear_auth();
select tests.authenticate_as('vp@pgtap.test');
select public.decide_verification('eeeeeeee-0000-0000-0000-000000000016', 'approved', 'active');
select tests.clear_auth();

select tests.authenticate_as('board@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000016', 'declined') $$,
  '22023', 'This request has been decided again since, so that decision is no longer there to undo.',
  'a line left open does not take back the decision a colleague made since'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000016', 'approved') $$,
  '22023', 'This decision was made by another board member, and only they can undo it.',
  'not even when it names that decision'
);
select tests.clear_auth();

select is(
  (select decided_by from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000016'),
  tests.user_id('vp@pgtap.test'),
  'the colleague''s approval stands'
);
select tests.authenticate_as('vp@pgtap.test');
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000016', 'approved') $$,
  'and the colleague who made it can take it back'
);
select tests.clear_auth();

-- ---- what the kept columns may hold ---------------------------------------------------------------
-- Request 4 is approved and holds unverified and active; request 2 is pending and holds nothing.
select throws_ok(
  $$ update public.verification_requests set member_status_before = 'banned'
     where id = 'eeeeeeee-0000-0000-0000-000000000004' $$,
  '23514', null,
  'a "before" is one of the four statuses'
);
select throws_ok(
  $$ update public.verification_requests set member_status_after = 'banned'
     where id = 'eeeeeeee-0000-0000-0000-000000000004' $$,
  '23514', null,
  'and so is an "after"'
);
select throws_ok(
  $$ update public.verification_requests set member_status_after = null
     where id = 'eeeeeeee-0000-0000-0000-000000000004' $$,
  '23514', null,
  'a "before" is not kept without an "after"'
);
select throws_ok(
  $$ update public.verification_requests set member_status_before = null
     where id = 'eeeeeeee-0000-0000-0000-000000000004' $$,
  '23514', null,
  'nor an "after" without a "before"'
);
select throws_ok(
  $$ update public.verification_requests set member_status_before = 'active', member_status_after = 'active'
     where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  '23514', null,
  'a pending request keeps no statuses'
);
select throws_ok(
  $$ update public.verification_requests set member_tier_before = 'Full Member'
     where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  '23514', null,
  'no tier'
);
select throws_ok(
  $$ update public.verification_requests set member_joined_year_before = 2024
     where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  '23514', null,
  'and no joining year'
);

-- ---- applications outlive their call, for the committee's officers --------------------------------
insert into public.calls (id, committee_id, title, status) values
  ('cccccccc-0000-0000-0000-000000000001', (select id from public.committees where slug = 'scope'),
   'Booklet team', 'closed');
insert into public.applications (ref, call_id, committee_id, call_title, name, email, motivation) values
  ('CALL-PGTAP1', 'cccccccc-0000-0000-0000-000000000001',
   (select id from public.committees where slug = 'scope'), 'Booklet team',
   'Sara Sample', 'sara@example.com', 'Because');

select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ delete from public.calls where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'an officer removes a call of their committee'
);
select is(
  (select jsonb_build_object('call', a.call_id, 'title', a.call_title)
   from public.applications a where a.ref = 'CALL-PGTAP1'),
  '{"call": null, "title": "Booklet team"}'::jsonb,
  'its application stays, readable by that officer under the title the call had'
);
update public.applications set status = 'shortlisted', notes = 'Rang her.' where ref = 'CALL-PGTAP1';
select is(
  (select status || ': ' || notes from public.applications where ref = 'CALL-PGTAP1'),
  'shortlisted: Rang her.',
  'and the officer can still move it on and write notes on it'
);
select tests.clear_auth();

select tests.authenticate_as('lore@pgtap.test');
select is(
  (select count(*)::int from public.applications where ref = 'CALL-PGTAP1'),
  0,
  'another committee''s officer does not see it'
);
select tests.clear_auth();

select * from finish();
rollback;
