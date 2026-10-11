-- Dismissing a member and reinstating one: the President alone does either (not the rest of
-- the Executive Board, the webmaster, an officer, a member or a visitor); the row stays on the
-- roster as a record with the status Dismissed, a reason and who dismissed; the account goes
-- back to unverified and the positions it held end; and the audit log has it all with the
-- President as the actor.
-- No other path gets a row into or out of that state or changes the record: a direct update, a
-- direct delete, a second row for the same person, a bulk update or its undo, an import of a
-- sheet that still lists the member, a script. Nothing verifies the account or gives it a
-- position while the member is dismissed. The public check answers that the membership has
-- ended and nothing more. Reinstating gives the status back and nothing else.
begin;
select plan(63);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scoph', 'Public Health', 'SCOPH', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('society.webmaster', null, 'Webmaster', 'Webmaster', 'webmaster'),
       ('scoph.pgtap-officer', (select id from public.committees where slug = 'scoph'), 'Pgtap Officer', null, 'officer'),
       ('scoph.pgtap-helper', (select id from public.committees where slug = 'scoph'), 'Pgtap Helper', null, 'member'),
       ('scoph.pgtap-second', (select id from public.committees where slug = 'scoph'), 'Pgtap Second', null, 'member')
on conflict do nothing;

-- The roster, before anybody signs in. The trigger works name_normalized out again.
insert into public.roster_entries (id, source_key, full_name, name_normalized, email, status, joined_year)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'pgtap-target', 'Dismissed Target', 'dismissed target', 'target@pgtap.test', 'Full Member', 2023),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'pgtap-noacct', 'No Account Member', 'no account member', 'noacct@pgtap.test', 'Associate Member', 2024),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'pgtap-plain', 'Plain Member', 'plain member', 'plain@pgtap.test', 'Full Member', 2022),
       ('aaaaaaaa-0000-0000-0000-000000000004', 'pgtap-president', 'Sample President', 'sample president', 'president@pgtap.test', 'Full Member', 2021),
       ('aaaaaaaa-0000-0000-0000-000000000005', 'pgtap-twin-one', 'Twin One', 'twin one', 'twin@pgtap.test', 'Full Member', 2024),
       ('aaaaaaaa-0000-0000-0000-000000000006', 'pgtap-twin-two', 'Twin Two', 'twin two', 'twin@pgtap.test', 'Candidate Member', 2025);

-- Signing in ties each account to its roster row and verifies it.
select tests.create_user('president@pgtap.test', 'Sample President');
select tests.create_user('vp@pgtap.test', 'Board Member');
select tests.create_user('web@pgtap.test', 'Sample Webmaster');
select tests.create_user('officer@pgtap.test', 'Sample Officer');
select tests.create_user('plain@pgtap.test', 'Plain Member');
select tests.create_user('target@pgtap.test', 'Dismissed Target');

select tests.assign('president@pgtap.test', 'eb.president');
select tests.assign('vp@pgtap.test', 'eb.vp-internal');
select tests.assign('web@pgtap.test', 'society.webmaster');
select tests.assign('officer@pgtap.test', 'scoph.pgtap-officer');

-- What the member about to be dismissed holds: a position the roster gives (the row's own,
-- which reaches the account as an invite), one given by hand, and an offer still waiting (an
-- officer's position on an address that is not its work email is never accepted).
update public.roster_entries
   set committee_id = (select id from public.committees where slug = 'scoph'),
       position_id = (select id from public.positions where key = 'scoph.pgtap-helper')
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.assign('target@pgtap.test', 'scoph.pgtap-second');
select tests.invite('target@pgtap.test', 'scoph.pgtap-officer');

-- The home page's count with everybody still a member.
create temporary table pgtap_before on commit drop as
  select (public.roster_stats() ->> 'count')::int as members;

-- ---- who the President is -------------------------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');
select ok(app.is_president(), 'whoever holds the position eb.president this term is the President');
select tests.clear_auth();

select tests.authenticate_as('vp@pgtap.test');
select ok(not app.is_president(), 'another member of the Executive Board is not');
select tests.clear_auth();

select tests.authenticate_as('web@pgtap.test');
select ok(not app.is_president(), 'and neither is the webmaster');
-- An attendance list registered while the member is still one, to undo after the dismissal.
select public.bulk_update_roster(
  array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
  'lga', 'pgtap first ga');
select tests.clear_auth();

-- ---- who may not dismiss --------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'No reason.') $$,
  '42501', null,
  'a visitor cannot dismiss a member'
);
select tests.clear_auth();

select tests.authenticate_as('plain@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'No reason.') $$,
  '42501', 'Only the President can dismiss a member.',
  'a member cannot dismiss a member'
);
select tests.clear_auth();

select tests.authenticate_as('officer@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'No reason.') $$,
  '42501', 'Only the President can dismiss a member.',
  'an officer cannot'
);
select tests.clear_auth();

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'No reason.') $$,
  '42501', 'Only the President can dismiss a member.',
  'another member of the Executive Board cannot'
);
select tests.clear_auth();

select tests.authenticate_as('web@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'No reason.') $$,
  '42501', 'Only the President can dismiss a member.',
  'the webmaster cannot'
);
select tests.clear_auth();

select is(
  (select status from public.roster_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Full Member',
  'every refusal leaves the member as they were'
);

-- ---- what the President is refused ----------------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', '   ') $$,
  '22023', 'Give the reason for the dismissal. It is kept on the record.',
  'a dismissal needs a reason'
);
select throws_ok(
  $$ select public.dismiss_roster_member('00000000-0000-0000-0000-00000000dead', 'No reason.') $$,
  '22023', 'That member is no longer on the roster.',
  'a row that is not there is said to be gone'
);
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000004', 'No reason.') $$,
  '22023', 'You cannot dismiss yourself.',
  'the President cannot dismiss the row of their own account'
);
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000005', 'No reason.') $$,
  '22023', 'This email is on another row of the roster as well, under the name Twin Two. Remove the duplicate row first, so that one record is dismissed.',
  'a person the roster lists twice is not dismissed until one row is left'
);

-- ---- the dismissal --------------------------------------------------------------------------------
select is(
  (select d from public.dismiss_roster_member(
     'aaaaaaaa-0000-0000-0000-000000000001', '  Repeated   breaches of the code of conduct.  ') as d),
  '{"accounts": 1, "positions_ended": 2}'::jsonb,
  'the President dismisses a member, and is told what ended'
);
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', 'Again.') $$,
  '22023', 'This member has already been dismissed.',
  'a member is not dismissed twice'
);
select tests.clear_auth();

select is(
  (select jsonb_build_object(
     'status', r.status, 'before', r.status_before_dismissal, 'reason', r.dismissal_reason,
     'by', r.dismissed_by, 'dated', r.dismissed_at is not null,
     'committee', r.committee_id, 'position', r.position_id, 'portal', r.portal_edited_by)
   from public.roster_entries r where r.id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  jsonb_build_object(
    'status', 'Dismissed', 'before', 'Full Member', 'reason', 'Repeated breaches of the code of conduct.',
    'by', tests.user_id('president@pgtap.test'), 'dated', true,
    'committee', null, 'position', null, 'portal', tests.user_id('president@pgtap.test')),
  'the row stays, as a record: Dismissed, the status before, the reason, who and when, no committee and no position'
);
select is(
  (select p.membership_status || ':' || coalesce(p.membership_tier, 'none')
   from public.profiles p where p.id = tests.user_id('target@pgtap.test')),
  'unverified:none',
  'the account is unverified again, and its tier is cleared'
);
select is(
  (select count(*)::int from public.assignments a
   where a.profile_id = tests.user_id('target@pgtap.test') and a.status = 'active'),
  0,
  'the account holds no position any more'
);
select is(
  (select count(*)::int from public.assignments a
   where a.profile_id = tests.user_id('target@pgtap.test')
     and a.status = 'ended' and a.ended_on = current_date),
  2,
  'the position the roster gave and the one given by hand are both ended today'
);
select is(
  (select count(*)::int from public.invites i where i.email_normalized = 'target@pgtap.test'),
  0,
  'no offer to that address is left, waiting or accepted'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'roster_entries'
      and l.row_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and l.action = 'UPDATE'
      and l.actor = tests.user_id('president@pgtap.test')
      and l.before ->> 'status' = 'Full Member'
      and l.after ->> 'status' = 'Dismissed'
      and l.after ->> 'dismissal_reason' = 'Repeated breaches of the code of conduct.'
  ),
  'the audit log records the dismissal on the roster row, with the President and the reason'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'profiles'
      and l.row_id = tests.user_id('target@pgtap.test')::text
      and l.action = 'UPDATE'
      and l.actor = tests.user_id('president@pgtap.test')
      and l.before ->> 'membership_status' = 'active'
      and l.after ->> 'membership_status' = 'unverified'
  ),
  'and on the account'
);
select is(
  (public.roster_stats() ->> 'count')::int,
  (select b.members - 1 from pgtap_before b),
  'the member count on the home page leaves the dismissed member out'
);

-- ---- the guard: every other path, for a member of the board ---------------------------------------
select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ update public.roster_entries set status = 'Full Member'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'the board cannot type another status over Dismissed'
);
select throws_ok(
  $$ update public.roster_entries
        set dismissed_at = null, dismissed_by = null, dismissal_reason = null,
            status_before_dismissal = null, status = 'Full Member'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'nor clear the dismissal by hand'
);
select throws_ok(
  $$ update public.roster_entries set dismissal_reason = 'Nothing much.'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'nor rewrite the reason'
);
select throws_ok(
  $$ delete from public.roster_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '22023', 'A dismissed member stays on the roster as a record and cannot be removed. The President can reinstate the member first.',
  'nor remove the record'
);
select throws_ok(
  $$ update public.roster_entries set status = 'Dismissed'
     where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  '42501', 'Only the President can dismiss a member, with Dismiss member on the Roster page.',
  'the board cannot dismiss by typing the status'
);
select throws_ok(
  $$ update public.roster_entries set dismissed_at = now(), dismissal_reason = 'By hand.'
     where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  '42501', 'Only the President can dismiss a member, with Dismiss member on the Roster page.',
  'nor by writing the dismissal columns'
);
select throws_ok(
  $$ insert into public.roster_entries (full_name, email, status)
     values ('Target Again', 'target@pgtap.test', 'Full Member') $$,
  '22023', 'This person was dismissed and is on the roster as a record. Only the President can reinstate a dismissed member.',
  'nor add the dismissed member again as a new row'
);
select throws_ok(
  $$ select public.bulk_update_roster(
       array['aaaaaaaa-0000-0000-0000-000000000003']::uuid[], 'status', 'pgtap by hand', 'Dismissed') $$,
  '42501', 'Only the President can dismiss a member, with Dismiss member on the Roster page.',
  'a bulk update cannot set the status Dismissed'
);
select is(
  (select jsonb_build_object('updated', b -> 'updated', 'why', b #>> '{skipped,0,reason}')
   from public.bulk_update_roster(
     array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
     'nga', 'pgtap second ga') as b),
  '{"updated": 1, "why": "dismissed"}'::jsonb,
  'a bulk update skips the dismissed member, says so, and updates the rest'
);
select is(
  (select jsonb_build_object('restored', u -> 'restored', 'why', u #>> '{skipped,0,reason}')
   from public.undo_roster_bulk_update(
     (select b.id from public.roster_bulk_updates b where b.label = 'pgtap first ga')) as u),
  '{"restored": 1, "why": "dismissed since"}'::jsonb,
  'the undo of an earlier bulk update skips the member dismissed since, and restores the rest'
);
select is(
  (select jsonb_build_object('inserted', i -> 'inserted', 'updated', i -> 'updated', 'dismissed', i -> 'skipped_dismissed')
   from public.import_roster('[
     {"full_name": "Dismissed Target", "email": "target@pgtap.test", "status": "Full Member", "joined_year": "2023"},
     {"full_name": "Dismissed Target", "email": "another@pgtap.test", "status": "Full Member"},
     {"full_name": "Plain Member", "email": "plain@pgtap.test", "status": "Dismissed"},
     {"full_name": "Brand New Member", "email": "new@pgtap.test", "status": "Candidate Member"}
   ]'::jsonb, 'pgtap-sheet') as i),
  '{"inserted": 1, "updated": 0, "dismissed": 3}'::jsonb,
  'an import leaves alone the dismissed member (under the old email and a new one) and a line that says Dismissed'
);
select tests.clear_auth();

select is(
  (select coalesce(r.lgas, '-') || '/' || coalesce(r.ngas, '-')
   from public.roster_entries r where r.id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '1/-',
  'the bulk update and the undo both left the record as it stood'
);
select is(
  (select count(*)::int from public.roster_entries r
   where r.name_normalized = 'dismissed target'
      or r.email_normalized in ('target@pgtap.test', 'another@pgtap.test')),
  1,
  'the import made no second row for the dismissed member'
);
select is(
  (select r.status || ':' || (r.dismissed_at is not null)::text
   from public.roster_entries r where r.id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Dismissed:true',
  'and the sheet that lists them as a Full Member did not bring them back'
);
select is(
  (select status from public.roster_entries where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'Full Member',
  'a sheet that says Dismissed dismisses nobody'
);

-- The guard is on the table, so a script that is nobody is held to it as well.
select throws_ok(
  $$ update public.roster_entries set lgas = '9'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'the record cannot be changed outside the portal either'
);
select lives_ok(
  $$ update public.roster_entries set years_spent = 9
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'the daily count of years spent still runs over a dismissed row'
);

-- ---- nothing lifts the account while the member is dismissed --------------------------------------
insert into public.verification_requests (id, profile_id, message)
values ('eeeeeeee-0000-0000-0000-000000000001', tests.user_id('target@pgtap.test'), 'Please verify me again');

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ select public.set_membership_status(tests.user_id('target@pgtap.test'), 'active') $$,
  '22023', 'This member was dismissed, so the account stays unverified. The President can reinstate the member on the Roster page.',
  'the board cannot set the account to a member''s status by hand'
);
select throws_ok(
  $$ select public.decide_verification('eeeeeeee-0000-0000-0000-000000000001', 'approved', 'active') $$,
  '22023', 'This member was dismissed, so the account stays unverified. The President can reinstate the member on the Roster page.',
  'nor approve a verification request from it'
);
select throws_ok(
  $$ select public.invite_to_position(
       'target@pgtap.test', (select id from public.positions where key = 'scoph.pgtap-helper')) $$,
  '22023', 'The membership of this person has ended, so they cannot hold a position.',
  'nor give it a position by invite'
);
select tests.clear_auth();

select throws_ok(
  $$ select tests.assign('target@pgtap.test', 'scoph.pgtap-second') $$,
  '22023', 'The membership of this person has ended, so they cannot hold a position.',
  'an assignment made by hand is refused as well'
);
select is(
  (select p.membership_status || ':' || (
     select count(*) from public.assignments a where a.profile_id = p.id and a.status = 'active')
   from public.profiles p where p.id = tests.user_id('target@pgtap.test')),
  'unverified:0',
  'the account is still unverified and still holds nothing'
);

-- ---- a member with no portal account --------------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');
select is(
  (select d from public.dismiss_roster_member(
     'aaaaaaaa-0000-0000-0000-000000000002', 'Left the faculty.') as d),
  '{"accounts": 0, "positions_ended": 0}'::jsonb,
  'a member who never signed in is dismissed all the same'
);
select tests.clear_auth();

-- They make an account afterwards, with the address the roster has for them.
select tests.create_user('noacct@pgtap.test', 'No Account Member');
select is(
  (select p.membership_status || ':' || (r.profile_id = p.id)::text
   from public.profiles p, public.roster_entries r
   where p.id = tests.user_id('noacct@pgtap.test')
     and r.id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'unverified:true',
  'the new account is tied to the record, and being on the roster does not verify it'
);

-- ---- the public check -----------------------------------------------------------------------------
select tests.authenticate_as_anon();
select is(
  public.check_membership('', 'target@pgtap.test'),
  '{"state": "ended"}'::jsonb,
  'the public check answers by email that the membership has ended, and nothing else: no status, no reason, no date'
);
select is(
  public.check_membership('Dismissed Target', ''),
  '{"state": "ended"}'::jsonb,
  'and the same by name'
);
select is(
  public.check_membership('', 'plain@pgtap.test') ->> 'state',
  'found',
  'a member who was not dismissed is found as before'
);
select tests.clear_auth();

-- ---- who may not reinstate ------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a visitor cannot reinstate a member'
);
select tests.clear_auth();

select tests.authenticate_as('plain@pgtap.test');
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', 'Only the President can reinstate a member.',
  'a member cannot reinstate a member'
);
select tests.clear_auth();

select tests.authenticate_as('officer@pgtap.test');
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', 'Only the President can reinstate a member.',
  'an officer cannot'
);
select tests.clear_auth();

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', 'Only the President can reinstate a member.',
  'another member of the Executive Board cannot'
);
select tests.clear_auth();

select tests.authenticate_as('web@pgtap.test');
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', 'Only the President can reinstate a member.',
  'the webmaster cannot'
);
select tests.clear_auth();

-- ---- the reinstatement ----------------------------------------------------------------------------
select tests.authenticate_as('president@pgtap.test');
select throws_ok(
  $$ select public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000003') $$,
  '22023', 'This member is not dismissed, so there is nothing to reinstate.',
  'a member who is not dismissed cannot be reinstated'
);
select is(
  (select r from public.reinstate_roster_member('aaaaaaaa-0000-0000-0000-000000000001') as r),
  '{"status": "Full Member"}'::jsonb,
  'the President reinstates the member, and is told the status they have again'
);
select tests.clear_auth();

select is(
  (select jsonb_build_object(
     'status', r.status, 'before', r.status_before_dismissal, 'reason', r.dismissal_reason,
     'by', r.dismissed_by, 'at', r.dismissed_at,
     'committee', r.committee_id, 'position', r.position_id)
   from public.roster_entries r where r.id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '{"status": "Full Member", "before": null, "reason": null, "by": null, "at": null, "committee": null, "position": null}'::jsonb,
  'the row has its status back and keeps nothing of the dismissal, and no committee or position comes back'
);
select is(
  (select p.membership_status || ':' || (
     select count(*) from public.assignments a where a.profile_id = p.id and a.status = 'active')
   from public.profiles p where p.id = tests.user_id('target@pgtap.test')),
  'unverified:0',
  'reinstating gives back neither portal access nor a position'
);
select ok(
  exists (
    select 1 from public.audit_log l
    where l.table_name = 'roster_entries'
      and l.row_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and l.action = 'UPDATE'
      and l.actor = tests.user_id('president@pgtap.test')
      and l.before ->> 'status' = 'Dismissed'
      and l.before ->> 'dismissal_reason' = 'Repeated breaches of the code of conduct.'
      and l.after ->> 'status' = 'Full Member'
      and l.after ->> 'dismissal_reason' is null
  ),
  'the audit log records the reinstatement with the President, and keeps the reason the row no longer holds'
);

-- The member asks again, and positions are given again.
select tests.authenticate_as('vp@pgtap.test');
select lives_ok(
  $$ select public.set_membership_status(tests.user_id('target@pgtap.test'), 'active') $$,
  'once reinstated, the board can verify the member again'
);
select tests.clear_auth();
select lives_ok(
  $$ select tests.assign('target@pgtap.test', 'scoph.pgtap-second') $$,
  'and the member can be given a position again'
);

-- ---- Remove is as it was for an ordinary row ------------------------------------------------------
select tests.authenticate_as('vp@pgtap.test');
delete from public.roster_entries where email_normalized = 'new@pgtap.test';
select tests.clear_auth();
select is(
  (select count(*)::int from public.roster_entries where email_normalized = 'new@pgtap.test'),
  0,
  'the board still removes an ordinary row'
);

select * from finish();
rollback;
