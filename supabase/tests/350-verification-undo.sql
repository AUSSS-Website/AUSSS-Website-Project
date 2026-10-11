-- Undo on member verification: a decision keeps what it found, the Executive Board alone takes
-- one back, an approval undone leaves the request pending and the member exactly as they were
-- (a candidate is a candidate again, not unverified), a decline undone touches no profile, the
-- audit log gains the undo and keeps the decision, and the request can then be decided again.
-- What is refused, each with its own sentence: an undo twice, a decision made before the
-- migration, a member who has asked again since, an approval over a newer change of status,
-- and an approval of a member the roster or a position verifies by now. A member cannot file a
-- request that already holds a "before".
--
-- Also here, because the committee editor now relies on it: an application whose call was
-- removed stays readable and editable for that committee's officers, and for nobody else's.
begin;
select plan(36);

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
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer'),
       ('scoph.member', (select id from public.committees where slug = 'scoph'), 'Member', null, 'member')
on conflict do nothing;

-- The board member and two officers, each on the work email of the position.
select tests.work_email('board@pgtap.test', 'eb.president');
select tests.work_email('leo@pgtap.test', 'scope.leo-out');
select tests.work_email('lore@pgtap.test', 'score.lore');
select tests.create_user('board@pgtap.test', 'Board Member');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.assign('board@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lore@pgtap.test', 'score.lore');

-- The members. One is on the roster as a candidate before signing in; the rest are unverified.
select tests.roster('Listed Candidate', 'candidate@pgtap.test', 'Candidate Member', 2025);
select tests.create_user('slip@pgtap.test', 'Approved By A Slip');
select tests.create_user('declined@pgtap.test', 'Declined By A Slip');
select tests.create_user('candidate@pgtap.test', 'Listed Candidate');
select tests.create_user('moved@pgtap.test', 'Moved On Since');
select tests.create_user('placed@pgtap.test', 'Given A Position');
select tests.create_user('listed@pgtap.test', 'Put On The Roster');
select tests.create_user('again@pgtap.test', 'Asked Again');
select tests.create_user('before@pgtap.test', 'Decided Before');

insert into public.verification_requests (id, profile_id, message) values
  ('eeeeeeee-0000-0000-0000-000000000001', tests.user_id('slip@pgtap.test'), 'Please verify me'),
  ('eeeeeeee-0000-0000-0000-000000000002', tests.user_id('declined@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000003', tests.user_id('candidate@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000004', tests.user_id('moved@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000005', tests.user_id('placed@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000006', tests.user_id('listed@pgtap.test'), null),
  ('eeeeeeee-0000-0000-0000-000000000007', tests.user_id('again@pgtap.test'), null);

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
select tests.clear_auth();

-- ---- who may undo ---------------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a visitor cannot undo a decision'
);
select tests.clear_auth();

select tests.authenticate_as('slip@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', 'Only the Executive Board can undo a verification decision.',
  'the member a decision is about cannot undo it'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', null,
  'an officer cannot undo a decision'
);
select tests.clear_auth();

select is(
  (select status from public.verification_requests where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'approved',
  'a refused undo leaves the decision as it was'
);

-- ---- an approval undone ---------------------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001') $$,
  'the board undoes the approval'
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
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000001') $$,
  '22023', 'This request is waiting for a decision, so there is nothing to undo.',
  'a decision cannot be undone twice'
);
select lives_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000001', 'declined') $$,
  'the request can be decided again, the other way this time'
);

-- ---- a decline undone -----------------------------------------------------------------------------
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000002') $$,
  'the board undoes a decline'
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

select tests.authenticate_as('board@pgtap.test');
select lives_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000003') $$,
  'an approval is undone although the member has edited their own details since'
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

-- ---- what is refused ------------------------------------------------------------------------------
select tests.authenticate_as('board@pgtap.test');

-- The board gives the member another status by hand after approving them.
select public.set_membership_status(tests.user_id('moved@pgtap.test'), 'alumni');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000004') $$,
  '22023', 'The membership of this member has changed since the approval, so the approval cannot be undone.',
  'an approval is not undone over a newer change of status'
);

-- The member is given a position after the approval.
select tests.assign('placed@pgtap.test', 'scoph.member');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000005') $$,
  '22023', 'This member is now on the roster or holds a position, which verifies them, so the approval cannot be undone.',
  'nor once the member holds a position'
);
select tests.clear_auth();

-- The member is put on the roster after the approval, and the row links to their account.
select tests.roster('Put On The Roster', 'listed@pgtap.test', 'Full Member');
-- The member who was declined asks again a minute later.
insert into public.verification_requests (id, profile_id, message, created_at) values
  ('eeeeeeee-0000-0000-0000-000000000009', tests.user_id('again@pgtap.test'), 'With more detail',
   now() + interval '1 minute');

select tests.authenticate_as('board@pgtap.test');
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000006') $$,
  '22023', 'This member is now on the roster or holds a position, which verifies them, so the approval cannot be undone.',
  'nor once the member is on the roster'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000007') $$,
  '22023', 'This member has sent a newer request since the decision. Decide that request instead.',
  'a decline is not undone once the member has asked again'
);
select throws_ok(
  $$ select public.undo_verification_decision('eeeeeeee-0000-0000-0000-000000000008') $$,
  '22023', 'This decision was made before decisions could be undone. The webmaster can change the status of the member by hand.',
  'a decision made before this migration cannot be undone'
);
select throws_ok(
  $$ select public.undo_verification_decision('00000000-0000-0000-0000-00000000dead') $$,
  '22023', 'That verification request no longer exists.',
  'a request that is not there is said to be gone'
);
select tests.clear_auth();

select is(
  (select count(*)::int from public.verification_requests
   where id in ('eeeeeeee-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000005',
                'eeeeeeee-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000008')
     and status = 'approved'),
  4,
  'every refused undo leaves its approval standing'
);

-- ---- a request is filed with nothing kept ---------------------------------------------------------
select tests.authenticate_as('before@pgtap.test');
select throws_ok(
  $$ insert into public.verification_requests (profile_id, member_status_before, member_status_after)
     values (tests.user_id('before@pgtap.test'), 'alumni', 'alumni') $$,
  '23514', null,
  'a member cannot file a request that already holds a "before"'
);
select tests.clear_auth();

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
