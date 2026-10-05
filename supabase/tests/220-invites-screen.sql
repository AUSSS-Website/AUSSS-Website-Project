-- Phase 5b: the invites screen. An officer offers the positions below their own to an address,
-- sees what is waiting and who holds what, withdraws an offer and removes a position; the
-- roster's own positions are changed on the roster and nowhere else; the society-level
-- positions are the Executive Board's.
-- The outsider is SCORA's officer: SCOPE and SCORE share one roster (test 250), so SCORE's
-- officer is no stranger to SCOPE's members.
begin;
select plan(23);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('scope.assistant', (select id from public.committees where slug = 'scope'), 'SCOPE Assistant', 'Assistant', 'assistant'),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'Local Member', null, 'member'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lora@pgtap.test', 'Scora Officer');
select tests.create_user('sara@pgtap.test', 'Sara Signed In');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lora@pgtap.test', 'scora.lora');

create temporary table pgtap_ids on commit drop as
select (select id from public.committees where slug = 'scope') as scope,
       (select id from public.positions where key = 'scope.assistant') as assistant,
       (select id from public.positions where key = 'scope.member') as member,
       (select id from public.positions where key = 'scope.leo-out') as leo_out,
       (select id from public.positions where key = 'scora.member') as scora_member;
grant select on pgtap_ids to authenticated;

-- a roster member of SCOPE with no account: the roster writes her invite itself
delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, committee_id)
values ('i1', 'Rana Roster', '', 'rana@pgtap.test', 'Full Member', (select scope from pgtap_ids));

-- ---- offering --------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select is(
  public.invite_to_position(' New.Person@PGTAP.test ', (select assistant from pgtap_ids)),
  'invited', 'an officer offers a position to an address with no account yet'
);
select is(
  public.invite_to_position('sara@pgtap.test', (select member from pgtap_ids)),
  'assigned', '...and to somebody who has one, where it lands at once'
);
select is(
  public.invite_to_position('new.person@pgtap.test', (select assistant from pgtap_ids)),
  'invited', 'offering it twice is harmless'
);
select throws_ok(
  $$ select public.invite_to_position('x@pgtap.test', (select leo_out from pgtap_ids)) $$,
  '42501', null, 'an officer cannot hand out an officer''s position'
);
select throws_ok(
  $$ select public.invite_to_position('x@pgtap.test', (select scora_member from pgtap_ids)) $$,
  '42501', null, '...nor a position in another committee'
);
select throws_ok(
  $$ select public.invite_to_position('not an address', (select assistant from pgtap_ids)) $$,
  '22023', null, 'the address has to look like one'
);

-- ---- seeing ----------------------------------------------------------------------------------
select is(
  (select jsonb_agg(jsonb_build_object('email', i ->> 'email', 'roster', i -> 'from_roster', 'withdraw', i -> 'can_withdraw')
                    order by i ->> 'email')
     from jsonb_array_elements(public.committee_positions((select scope from pgtap_ids)) -> 'invites') i),
  '[{"email": "new.person@pgtap.test", "roster": false, "withdraw": true},
    {"email": "rana@pgtap.test", "roster": true, "withdraw": true}]'::jsonb,
  'the officer sees what is waiting, and which of it the roster owns'
);
select is(
  (select jsonb_agg(jsonb_build_object('name', h ->> 'full_name', 'key', h -> 'position' ->> 'key', 'remove', h -> 'can_remove')
                    order by h ->> 'full_name')
     from jsonb_array_elements(public.committee_positions((select scope from pgtap_ids)) -> 'holders') h),
  '[{"name": "Sara Signed In", "key": "scope.member", "remove": true},
    {"name": "Scope Officer", "key": "scope.leo-out", "remove": false}]'::jsonb,
  '...and who holds what, with nothing removable above their own level'
);
select throws_ok(
  $$ select public.committee_positions(null) $$,
  '42501', null, 'the society-level positions are not an officer''s to see'
);
select tests.clear_auth();
select tests.authenticate_as('lora@pgtap.test');
select throws_ok(
  $$ select public.committee_positions((select scope from pgtap_ids)) $$,
  '42501', null, 'another committee''s officer sees none of it'
);

-- ---- withdrawing -----------------------------------------------------------------------------
delete from public.invites where email_normalized = 'new.person@pgtap.test';
select tests.clear_auth();
select is(
  (select count(*)::int from public.invites where email_normalized = 'new.person@pgtap.test'),
  1, 'another committee''s officer cannot withdraw it'
);
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ delete from public.invites where email_normalized = 'rana@pgtap.test' $$,
  '22023', null, 'an offer the roster made is changed on the roster'
);
delete from public.invites where email_normalized = 'new.person@pgtap.test';
select tests.clear_auth();
select is(
  (select count(*)::int from public.invites where email_normalized = 'new.person@pgtap.test'),
  0, 'the officer withdraws their own offer'
);

-- ---- removing --------------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a
        where a.profile_id = tests.user_id('sara@pgtap.test') and a.position_id = (select member from pgtap_ids))) $$,
  'the officer removes a member''s position'
);
select tests.clear_auth();
select is(
  (select jsonb_build_object(
     'status', (select a.status from public.assignments a
                where a.profile_id = tests.user_id('sara@pgtap.test') and a.position_id = (select member from pgtap_ids)),
     'offers', (select count(*) from public.invites i where i.email_normalized = 'sara@pgtap.test'))),
  '{"status": "ended", "offers": 0}'::jsonb,
  'the assignment ends and its offer goes with it'
);
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a where a.profile_id = tests.user_id('leo@pgtap.test'))) $$,
  '42501', null, 'an officer cannot remove an officer''s position, their own included'
);
select is(
  public.invite_to_position('sara@pgtap.test', (select member from pgtap_ids)),
  'assigned', 'offering a removed position again brings it back'
);
select tests.clear_auth();
select is(
  (select a.status from public.assignments a
   where a.profile_id = tests.user_id('sara@pgtap.test') and a.position_id = (select member from pgtap_ids)),
  'active', '...as the same assignment, active again'
);

-- the roster owns Rana's position once she has an account, too
select tests.create_user('rana@pgtap.test', 'Rana Roster');
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a where a.profile_id = tests.user_id('rana@pgtap.test'))) $$,
  '22023', null, 'a position the roster gave is not removed here'
);

-- ---- the Executive Board ---------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is(
  (select jsonb_agg(jsonb_build_object('name', h ->> 'full_name', 'remove', h -> 'can_remove'))
     from jsonb_array_elements(public.committee_positions(null) -> 'holders') h),
  '[{"name": "EB Person", "remove": false}]'::jsonb,
  'the board sees the society-level positions; nobody removes their own'
);
select throws_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a where a.profile_id = tests.user_id('eb@pgtap.test'))) $$,
  '22023', null, '...and the function agrees'
);
select throws_ok(
  $$ select public.invite_to_position('leo@pgtap.test', (select id from public.positions where key = 'eb.vp-internal')) $$,
  '22023', null, 'the board cannot hand a board position to an address that is not its work email'
);
select tests.clear_auth();
select tests.work_email('leo@pgtap.test', 'eb.vp-internal');
select tests.authenticate_as('eb@pgtap.test');
select is(
  public.invite_to_position('leo@pgtap.test', (select id from public.positions where key = 'eb.vp-internal')),
  'assigned', '...and hands it to the work email'
);

select tests.clear_auth();
select * from finish();
rollback;
