-- Each committee's own roster: the committee is proposed from the position text and never
-- overrides a choice, bulk "move to committee" is logged and undoable, officers read only their
-- committee's members and cannot touch membership facts, every member of a committee holds one
-- position in it (Local Member unless the sheet or somebody says otherwise) which reaches their
-- account as an invite, and officer notes are hidden from the member they are about and from
-- other committees.
begin;
select plan(34);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on Sexual and Reproductive Health', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Member', null, 'member'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer'),
       ('score.member', (select id from public.committees where slug = 'score'), 'Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('lora@pgtap.test', 'Lora Officer');
select tests.create_user('lore@pgtap.test', 'Lore Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('lora@pgtap.test', 'scora.lora');
select tests.assign('lore@pgtap.test', 'score.lore');

delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, current_position)
values ('c1', 'Sara Youssef', '', 'sara@example.com', 'Associate Member', 'SCORA Core Team Member'),
       ('c2', 'Omar Nabil', '', null, 'Candidate Member', 'scora GA' || chr(10) || 'Exchange Contact Person'),
       ('c3', 'Mona Adel', '', 'mona@example.com', 'Full Member', 'LORE'),
       ('c4', 'Hana Samir', '', 'hana@example.com', 'Candidate Member', 'SCORA and SCORE liaison'),
       ('c5', 'Ali Hassan', '', 'ali@example.com', 'Candidate Member', null),
       ('c6', 'Lora Officer', '', 'lora@pgtap.test', 'Full Member', 'LORA'),
       ('c7', 'Old Member', '', 'old@example.com', 'Archived', 'SCORA Core Team Member');

-- ---- the committee is proposed from the position text ----------------------------------------
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'c1'),
  'scora', 'a committee abbreviation in the position places the member');
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'c3'),
  'score', 'so does an officer''s short title');
select ok((select committee_id is null from public.roster_entries where source_key = 'c4'), 'two committees named: nobody guesses');
select ok((select committee_id is null from public.roster_entries where source_key = 'c5'), 'no position, no committee');
select ok((select is_contact_person from public.roster_entries where source_key = 'c2'), 'Contact Person is a marker beside the committee');
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'c2'),
  'scora', 'and does not stand in for one');

-- ---- one position in the committee ------------------------------------------------------------
select is(
  (select p.key from public.roster_entries r join public.positions p on p.id = r.position_id where r.source_key = 'c1'),
  'scora.core-team', 'the position is read from the sheet''s text');
select is(
  (select p.key from public.roster_entries r join public.positions p on p.id = r.position_id where r.source_key = 'c6'),
  'scora.lora', 'an officer''s short title is their position');
select is(
  (select p.key from public.roster_entries r join public.positions p on p.id = r.position_id where r.source_key = 'c2'),
  'scora.ga', 'the committee''s abbreviation in front does not matter');
select ok(
  exists (select 1 from public.invites i join public.positions p on p.id = i.position_id
          where i.email_normalized = 'sara@example.com' and p.key = 'scora.core-team' and i.accepted_at is null),
  'and waits for the member as a standing invite');
update public.roster_entries set position_id = (select id from public.positions where key = 'scora.ga') where source_key = 'c1';
select is(
  (select string_agg(p.key, ',') from public.invites i join public.positions p on p.id = i.position_id
   where i.email_normalized = 'sara@example.com'),
  'scora.ga', 'changing the position replaces the invite');

update public.roster_entries set committee_id = null where source_key = 'c1';
select ok((select position_id is null from public.roster_entries where source_key = 'c1'), 'no committee, no position');
select ok((select committee_id is null from public.roster_entries where source_key = 'c1'), 'clearing a committee by hand sticks');
update public.roster_entries set committee_id = (select id from public.committees where slug = 'score') where source_key = 'c1';
update public.roster_entries set current_position = 'SCORA Treasurer' where source_key = 'c1';
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'c1'),
  'score', 'a new position text never overrides a chosen committee');
update public.roster_entries set committee_id = (select id from public.committees where slug = 'scora') where source_key = 'c1';

-- ---- bulk: move to a committee ---------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select is(
  (public.bulk_update_roster(
     array(select id from public.roster_entries where source_key in ('c4', 'c5', 'c1')), 'committee', 'SCORA intake', 'SCORA') ->> 'updated')::int,
  2, 'a bulk update places people in a committee and skips who is already there');
select ok(
  (select portal_edited_at is null from public.roster_entries where source_key = 'c5'),
  'placing someone does not take the row away from the spreadsheet');
select throws_ok(
  $$ select public.bulk_update_roster(array(select id from public.roster_entries where source_key = 'c5'), 'committee', 'x', 'nope') $$,
  '22023', null, 'an unknown committee is refused');
select is(
  (public.undo_roster_bulk_update((select max(id) from public.roster_bulk_updates)) ->> 'restored')::int,
  2, 'and it can be undone');
select ok((select committee_id is null from public.roster_entries where source_key = 'c5'), 'undo puts "no committee" back');

-- ---- officers: their committee only, read-only -----------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.committee_roster((select id from public.committees where slug = 'scora')) $$,
  '42501', null, 'a plain member cannot read a committee roster');

select tests.clear_auth();
select tests.authenticate_as('lora@pgtap.test');
select is(
  jsonb_array_length(public.committee_roster((select id from public.committees where slug = 'scora'))),
  3, 'an officer sees their committee''s members, archived ones left out');
select throws_ok(
  $$ select public.committee_roster((select id from public.committees where slug = 'score')) $$,
  '42501', null, 'but not another committee''s');
select is((select count(*) from public.roster_entries)::int, 0, 'the roster table itself stays closed to officers');
update public.roster_entries set status = 'Full Member' where source_key = 'c2';
select tests.clear_auth();
select is(
  (select status from public.roster_entries where source_key = 'c2'),
  'Candidate Member', 'an officer cannot change a membership fact');

-- ---- assigning a member to a position --------------------------------------------------------
select tests.authenticate_as('lora@pgtap.test');
select is(
  public.assign_roster_member(
    (select r.id from public.committee_roster((select id from public.committees where slug = 'scora')) j,
       lateral jsonb_to_recordset(j) as r(id uuid, full_name text) where r.full_name = 'Sara Youssef'),
    (select id from public.positions where key = 'scora.member')),
  'invited', 'a member without an account gets a standing invite');
select is(
  (select r.title from public.committee_roster((select id from public.committees where slug = 'scora')) j,
     lateral jsonb_to_recordset(j) as x(full_name text, "position" jsonb), lateral (select x."position" ->> 'title' as title) r
   where x.full_name = 'Sara Youssef'),
  'Local Member', 'and the committee roster shows the position');
select throws_ok(
  $$ select public.assign_roster_member(
       (select r.id from public.committee_roster((select id from public.committees where slug = 'scora')) j,
          lateral jsonb_to_recordset(j) as r(id uuid, full_name text) where r.full_name = 'Sara Youssef'),
       (select id from public.positions where key = 'scora.lora')) $$,
  '42501', null, 'an officer cannot hand out an officer position');
select is(
  public.assign_roster_member(
    (select r.id from public.committee_roster((select id from public.committees where slug = 'scora')) j,
       lateral jsonb_to_recordset(j) as r(id uuid, full_name text) where r.full_name = 'Omar Nabil'),
    (select id from public.positions where key = 'scora.member')),
  'noted', 'without an email on the roster the title is kept but reaches no account');

-- ---- officer notes ---------------------------------------------------------------------------
select tests.clear_auth();
select set_config('tests.sara', (select id::text from public.roster_entries where source_key = 'c1'), true);
select tests.authenticate_as('lore@pgtap.test');
insert into public.member_notes (roster_entry_id, committee_id, body)
select j.id, (select id from public.committees where slug = 'score'), 'Reliable, wants to lead the next campaign.'
from public.committee_roster((select id from public.committees where slug = 'score')) x,
     lateral jsonb_to_recordset(x) as j(id uuid);
select is((select count(*) from public.member_notes)::int, 1, 'an officer keeps a note on their member');
select throws_ok(
  $$ insert into public.member_notes (roster_entry_id, committee_id, body)
     values (current_setting('tests.sara')::uuid, (select id from public.committees where slug = 'scora'), 'x') $$,
  '42501', null, 'not on another committee''s member');

select tests.clear_auth();
select tests.authenticate_as('lora@pgtap.test');
select is((select count(*) from public.member_notes)::int, 0, 'another committee''s officer does not see it');

select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is((select count(*) from public.member_notes)::int, 1, 'the EB does');
insert into public.member_notes (roster_entry_id, committee_id, body)
select r.id, r.committee_id, 'About the officer herself.' from public.roster_entries r where r.source_key = 'c6';

select tests.clear_auth();
update public.roster_entries set profile_id = (select id from public.profiles where email = 'lora@pgtap.test') where source_key = 'c6';
select tests.authenticate_as('lora@pgtap.test');
select is((select count(*) from public.member_notes)::int, 0, 'nobody reads the notes about themselves, officer or not');
select is(
  (select (r.notes)::int from public.committee_roster((select id from public.committees where slug = 'scora')) j,
     lateral jsonb_to_recordset(j) as r(full_name text, notes int) where r.full_name = 'Lora Officer'),
  0, 'nor learns that there are any');

select * from finish();
rollback;
