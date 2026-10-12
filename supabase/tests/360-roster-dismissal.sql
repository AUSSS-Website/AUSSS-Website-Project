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
-- The President's position cannot be taken: the rest of the board and the webmaster can neither
-- repoint its work email nor change or remove the position. A dismissed member is offered no
-- position, and one that reaches the table without asking (a rollover's) waits unaccepted and
-- goes at the reinstatement, so a term rollover goes through with dismissed members on the
-- roster. A namesake the roster already had still follows the sheet.
-- The position belongs to the account of its work email: signing in with that address gives it,
-- with nobody named President beforehand; the board can neither remove that account from it nor
-- withdraw the offer that waits for the address; and a new address is offered it at once.
begin;
select plan(103);

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
       ('scoph.pgtap-deputy', (select id from public.committees where slug = 'scoph'), 'Pgtap Deputy', null, 'officer'),
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

-- More of it: a member listed by name only, with no joining year; a board member's row, under
-- an address that is also a position's work email; an officer's row; and a namesake of the
-- member with no account, keyed the way the importer keys a line.
insert into public.roster_entries (id, source_key, full_name, name_normalized, email, status, joined_year, years_spent)
values ('aaaaaaaa-0000-0000-0000-000000000007', 'pgtap-noyear', 'No Year Member', 'no year member', null, 'Candidate Member', null, 3),
       ('aaaaaaaa-0000-0000-0000-000000000008', 'pgtap-board', 'Board Member', 'board member', 'vp@pgtap.test', 'Full Member', 2022, null),
       ('aaaaaaaa-0000-0000-0000-000000000009', 'pgtap-officer', 'Sample Officer', 'sample officer', 'officer@pgtap.test', 'Full Member', 2022, null);
select tests.roster('No Account Member', 'namesake@pgtap.test', 'Candidate Member', 2025);

-- The work emails: the President's position on the President's address, which is offered the
-- position by that alone, and an officer's position on the address the board member's row
-- carries.
select tests.work_email('president@pgtap.test', 'eb.president');
select tests.work_email('vp@pgtap.test', 'scoph.pgtap-deputy');

-- Signing in ties each account to its roster row and verifies it.
select tests.create_user('president@pgtap.test', 'Sample President');
select tests.create_user('vp@pgtap.test', 'Board Member');
select tests.create_user('web@pgtap.test', 'Sample Webmaster');
select tests.create_user('officer@pgtap.test', 'Sample Officer');
select tests.create_user('plain@pgtap.test', 'Plain Member');
select tests.create_user('target@pgtap.test', 'Dismissed Target');

-- The President's account is given nothing here: see "who the President is".
select tests.assign('vp@pgtap.test', 'eb.vp-internal');
select tests.assign('web@pgtap.test', 'society.webmaster');
select tests.assign('officer@pgtap.test', 'scoph.pgtap-officer');

-- Three accounts that are not the President: one whose roster row says President, one that
-- held the position this term and no longer does, and one that held it in a term that is over.
update public.roster_entries
   set position_id = (select id from public.positions where key = 'eb.president')
 where id = 'aaaaaaaa-0000-0000-0000-000000000008';
select tests.assign('plain@pgtap.test', 'eb.president');
update public.assignments
   set status = 'ended', ended_on = current_date
 where profile_id = tests.user_id('plain@pgtap.test')
   and position_id = (select id from public.positions where key = 'eb.president');
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap-past', '2025-09-01', '2026-08-31', false)
on conflict (label) do nothing;
insert into public.assignments (profile_id, position_id, term_id)
values (tests.user_id('officer@pgtap.test'),
        (select id from public.positions where key = 'eb.president'),
        (select id from public.terms where label = 'pgtap-past'));

-- The officer's row moves to another address and stays tied to the account.
update public.roster_entries set email = 'officer.own@pgtap.test'
 where id = 'aaaaaaaa-0000-0000-0000-000000000009';

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
-- Nobody gave that account the position, and no roster row names it President. Its address is
-- the work email of the position, which was offered to the address when it was set, and the
-- first sign-in took the offer up.
select is(
  (select a.status from public.assignments a
   join public.positions p on p.id = a.position_id
   where a.profile_id = tests.user_id('president@pgtap.test')
     and p.key = 'eb.president'
     and a.term_id = app.current_term_id()),
  'active',
  'signing in with the work email of the President''s position gives the position, with nobody named President beforehand'
);
select tests.authenticate_as('president@pgtap.test');
select ok(app.is_president(), 'and whoever holds the position eb.president this term is the President');
select tests.clear_auth();

select tests.authenticate_as('vp@pgtap.test');
select ok(not app.is_president(), 'another member of the Executive Board is not, though the roster row of this one says President');
select tests.clear_auth();

select tests.authenticate_as('plain@pgtap.test');
select ok(not app.is_president(), 'an account that held the position this term and no longer does is not');
select tests.clear_auth();

select tests.authenticate_as('officer@pgtap.test');
select ok(not app.is_president(), 'nor one that held it in a term that is over');
select tests.clear_auth();

select tests.authenticate_as('web@pgtap.test');
select ok(not app.is_president(), 'and neither is the webmaster');
-- An attendance list registered while the member is still one, to undo after the dismissal.
select public.bulk_update_roster(
  array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
  'lga', 'pgtap first ga');
select tests.clear_auth();

-- ---- the President's position cannot be taken -----------------------------------------------------
-- Row-level security filters the two statements out: they change nothing and raise nothing.
select tests.authenticate_as('vp@pgtap.test');
update public.position_work_emails set email = 'vp.own@pgtap.test'
 where position_id = (select id from public.positions where key = 'eb.president');
delete from public.position_work_emails
 where position_id = (select id from public.positions where key = 'eb.president');
select tests.clear_auth();
select is(
  (select w.email from public.position_work_emails w
   join public.positions p on p.id = w.position_id where p.key = 'eb.president'),
  'president@pgtap.test',
  'a member of the board can neither repoint nor remove the work email of the President''s position'
);

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ update public.positions set level = 'member' where key = 'eb.president' $$,
  '42501', 'The President''s position belongs to the Executive Board. Its level cannot be changed.',
  'nor give the position a level that needs no work email'
);
select throws_ok(
  $$ update public.positions set title = 'Chair' where key = 'eb.president' $$,
  '42501', 'Only the President changes the President''s position.',
  'nor change anything else about it'
);
select throws_ok(
  $$ delete from public.positions where key = 'eb.president' $$,
  '42501', 'The President''s position cannot be removed.',
  'nor remove it, to add another under its key'
);
select throws_ok(
  $$ insert into public.positions (key, committee_id, title, level)
     values ('eb.president', null, 'President', 'member') $$,
  '42501', 'The President''s position belongs to the Executive Board.',
  'and a position under that key is never added at another level'
);
select throws_ok(
  $$ select public.remove_position((
       select a.id from public.assignments a
       join public.positions p on p.id = a.position_id
       where p.key = 'eb.president' and a.status = 'active'
         and a.term_id = (select id from public.terms where is_current))) $$,
  '22023', 'The President''s position stays with the account of its work email. To hand it to another address, the President changes the work email first.',
  'a member of the board cannot remove the President from the position'
);
select throws_ok(
  $$ delete from public.assignments
      where profile_id = tests.user_id('president@pgtap.test')
        and position_id = (select id from public.positions where key = 'eb.president')
        and status = 'active' $$,
  '22023', 'The President''s position stays with the account of its work email. To hand it to another address, the President changes the work email first.',
  'nor delete the President''s hold of it'
);
select is(
  (select h -> 'can_remove'
   from jsonb_array_elements(public.committee_positions() -> 'holders') as h
   where h #>> '{position,key}' = 'eb.president'),
  'false'::jsonb,
  'and the portal offers no Remove on it'
);
select tests.clear_auth();

select tests.authenticate_as('web@pgtap.test');
update public.position_work_emails set email = 'web.own@pgtap.test'
 where position_id = (select id from public.positions where key = 'eb.president');
select tests.clear_auth();
select is(
  (select w.email from public.position_work_emails w
   join public.positions p on p.id = w.position_id where p.key = 'eb.president'),
  'president@pgtap.test',
  'and the webmaster cannot repoint it either'
);

select tests.authenticate_as('president@pgtap.test');
update public.position_work_emails set email = 'president.new@pgtap.test'
 where position_id = (select id from public.positions where key = 'eb.president');
select lives_ok(
  $$ update public.positions set short_title = 'Pres' where key = 'eb.president' $$,
  'the President changes the position''s own row'
);
select tests.clear_auth();
select is(
  (select w.email from public.position_work_emails w
   join public.positions p on p.id = w.position_id where p.key = 'eb.president'),
  'president.new@pgtap.test',
  'and the President changes its work email'
);

-- The new address is offered the position there and then. The board cannot withdraw that
-- offer, and it can now remove the account of the address this one replaced.
select is(
  (select count(*)::int from public.invites i
   join public.positions p on p.id = i.position_id
   where p.key = 'eb.president'
     and i.email_normalized = 'president.new@pgtap.test'
     and i.term_id = app.current_term_id()
     and i.accepted_at is null),
  1,
  'the new address is offered the position at once, so its first sign-in is the President''s'
);
select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ delete from public.invites where email_normalized = 'president.new@pgtap.test' $$,
  '22023', 'This offer keeps the President''s position for its work email, so it cannot be withdrawn. To hand the position to another address, the President changes the work email first.',
  'the board cannot withdraw the offer that waits for the President''s work email'
);
select throws_ok(
  $$ update public.invites
        set accepted_at = now(), accepted_profile_id = tests.user_id('vp@pgtap.test')
      where email_normalized = 'president.new@pgtap.test' $$,
  '22023', 'This offer keeps the President''s position for its work email, so it cannot be withdrawn. To hand the position to another address, the President changes the work email first.',
  'nor mark it taken for another account, which would leave the address nothing to take up'
);
select lives_ok(
  $$ select public.remove_position((
       select a.id from public.assignments a
       join public.positions p on p.id = a.position_id
       where p.key = 'eb.president' and a.status = 'active'
         and a.term_id = (select id from public.terms where is_current))) $$,
  'the account of the address it replaced is removed like any other holder'
);
select tests.clear_auth();

-- Back on its first address: the account that held the position and lost it has it again
-- without anybody inviting it, and the offer to the other address goes.
select tests.work_email('president@pgtap.test', 'eb.president');
select tests.authenticate_as('president@pgtap.test');
select ok(app.is_president(), 'an account whose address the position is given back to is the President again');
select tests.clear_auth();
select is(
  (select count(*)::int from public.invites where email_normalized = 'president.new@pgtap.test'),
  0,
  'and the offer to an address that is no longer the work email is gone'
);

select ok(
  not has_function_privilege('service_role', 'public.dismiss_roster_member(uuid, text)', 'execute')
    and not has_function_privilege('service_role', 'public.reinstate_roster_member(uuid)', 'execute'),
  'the secret key, which is nobody''s account, is granted neither of the two functions'
);

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
-- A second row for the officer, under the address the officer's account signs in with.
insert into public.roster_entries (id, source_key, full_name, name_normalized, email, status)
values ('aaaaaaaa-0000-0000-0000-000000000010', 'pgtap-officer-again', 'Officer Again', 'officer again', 'officer@pgtap.test', 'Candidate Member');

select tests.authenticate_as('president@pgtap.test');
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', '   ') $$,
  '22023', 'Give the reason for the dismissal. It is kept on the record.',
  'a dismissal needs a reason'
);
select throws_ok(
  format(
    $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000001', %L) $$,
    repeat('x', 1001)),
  '22023', 'The reason is too long. Keep it under 1,000 characters.',
  'and one of no more than 1,000 characters'
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
  '22023', 'This member has another row on the roster, under the name Twin Two. Remove the duplicate row first, so that one record is dismissed.',
  'a person the roster lists twice is not dismissed until one row is left'
);
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000010', 'No reason.') $$,
  '22023', 'This member has another row on the roster, under the name Sample Officer. Remove the duplicate row first, so that one record is dismissed.',
  'nor is one whose other row has another email and is tied to the same account'
);
select throws_ok(
  $$ select public.dismiss_roster_member('aaaaaaaa-0000-0000-0000-000000000008', 'No reason.') $$,
  '22023', 'This row is tied to the work account of a position (Pgtap Deputy), which is handed on with the position and cannot be dismissed. Remove the row, add the member again under their own email, and dismiss that row.',
  'a row under the work email of a position is not dismissed: that account belongs to the position'
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

delete from public.roster_entries where id = 'aaaaaaaa-0000-0000-0000-000000000010';

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
  $$ update public.roster_entries set profile_id = tests.user_id('target@pgtap.test')
     where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  '22023', 'This person was dismissed and is on the roster as a record. Only the President can reinstate a dismissed member.',
  'nor tie another row to the account of the dismissed member'
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
  (select jsonb_build_object('updated', b -> 'updated', 'log', b -> 'log_id', 'why', b #>> '{skipped,0,reason}')
   from public.bulk_update_roster(
     array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[], 'committee', 'pgtap move', 'scoph') as b),
  '{"updated": 0, "log": null, "why": "dismissed"}'::jsonb,
  'a bulk action on the dismissed member alone changes nothing and logs nothing'
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
select throws_ok(
  $$ update public.roster_entries set import_batch = 'by hand'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'nor the batch it came in with'
);
select throws_ok(
  $$ update public.roster_entries set created_at = now() - interval '1 year'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'nor the day it was added'
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
select throws_ok(
  $$ insert into public.invites (email, position_id, term_id)
     values ('target@pgtap.test',
             (select id from public.positions where key = 'scoph.pgtap-helper'),
             (select id from public.terms where is_current)) $$,
  '42501', null,
  'nor write the offer into the table'
);
select tests.clear_auth();

-- The term rollover and the roster write their offers many at a time and ask nobody. One to a
-- dismissed member is not refused, which would stop all the others: it is left waiting.
select lives_ok(
  $$ select tests.invite('target@pgtap.test', 'scoph.pgtap-helper') $$,
  'an offer written without asking raises nothing'
);
select is(
  (select (i.accepted_at is null)::text from public.invites i where i.email_normalized = 'target@pgtap.test'),
  'true',
  'and is left unaccepted'
);

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
select is(
  (select d from public.dismiss_roster_member(
     'aaaaaaaa-0000-0000-0000-000000000007', 'Never took part.') as d),
  '{"accounts": 0, "positions_ended": 0}'::jsonb,
  'and so is a member the roster lists by name only'
);
select tests.clear_auth();

select throws_ok(
  $$ update public.roster_entries set years_spent = 9
     where id = 'aaaaaaaa-0000-0000-0000-000000000007' $$,
  '42501', 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.',
  'where a dismissed row has no joining year, its years spent are the sheet''s own number and stay'
);

select tests.authenticate_as('vp@pgtap.test');
select throws_ok(
  $$ select public.invite_to_position(
       'noacct@pgtap.test', (select id from public.positions where key = 'scoph.pgtap-helper')) $$,
  '22023', 'The membership of this person has ended, so they cannot hold a position.',
  'an address with no account yet is offered nothing either, so no offer waits for a reinstatement'
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

-- The sheet still lists the dismissed member, and a namesake the roster had before.
select tests.authenticate_as('vp@pgtap.test');
select is(
  (select jsonb_build_object(
     'dismissed', i -> 'skipped_dismissed',
     'namesake', (i ->> 'updated')::int + (i ->> 'unchanged')::int + (i ->> 'kept_portal_edits')::int)
   from public.import_roster('[
     {"full_name": "No Account Member", "email": "noacct@pgtap.test", "status": "Associate Member", "joined_year": "2024"},
     {"full_name": "No Account Member", "email": "namesake@pgtap.test", "status": "Full Member", "joined_year": "2025"}
   ]'::jsonb, 'pgtap-sheet-two') as i),
  '{"dismissed": 1, "namesake": 1}'::jsonb,
  'a namesake who was on the roster before the dismissal still follows the sheet'
);
select tests.clear_auth();

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
select is(
  (select count(*)::int from public.invites i where i.email_normalized = 'target@pgtap.test'),
  0,
  'and the offer that reached the table while the member was dismissed is gone'
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

-- ---- a term rollover with dismissed members -------------------------------------------------------
-- An officer's position is pointed at the address of a member who is still dismissed. The
-- rollover offers every work email its position again, all in one statement.
select tests.work_email('noacct@pgtap.test', 'scoph.pgtap-officer');
select tests.authenticate_as('vp@pgtap.test');
select lives_ok(
  $$ select public.roll_over_term('2027-28', '2027-09-01', '2028-08-31') $$,
  'a term rollover goes through with dismissed members on the roster'
);
select tests.clear_auth();
select is(
  (select (select count(*) from public.assignments a
           where a.profile_id = tests.user_id('noacct@pgtap.test') and a.status = 'active')::text
          || ':' ||
          (select count(*) from public.invites i
           where i.email_normalized = 'noacct@pgtap.test'
             and i.term_id = app.current_term_id()
             and i.accepted_at is null)::text),
  '0:1',
  'and gives the dismissed member nothing: the offer waits, unaccepted'
);

-- ---- a term made current by hand ------------------------------------------------------------------
-- rpc/set_current_term offers nobody anything by itself. The President's address is offered the
-- position in whichever term becomes the current one, so the account holds it there at once.
select tests.authenticate_as('president@pgtap.test');
select lives_ok(
  $$ select public.set_current_term((select id from public.terms where label = 'pgtap-past')) $$,
  'the board can still switch the current term by hand'
);
select tests.clear_auth();
select is(
  (select a.status from public.assignments a
   join public.positions p on p.id = a.position_id
   where a.profile_id = tests.user_id('president@pgtap.test')
     and p.key = 'eb.president'
     and a.term_id = (select id from public.terms where label = 'pgtap-past')),
  'active',
  'and the account of the President''s work email holds the position in that term too'
);

select * from finish();
rollback;
