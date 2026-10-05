-- The work emails, enforced. An officer's, a board member's or the webmaster's position has
-- one work email and can be held by the account of that address only: an invite to any other
-- address is refused, a direct write is refused, and an offer that got into the table some
-- other way is never accepted. Positions below officer are untouched. The Executive Board
-- keeps the list; only the webmaster changes the webmaster's.
begin;
select plan(21);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('society.webmaster', null, 'Webmaster', 'Webmaster', 'webmaster'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member')
on conflict do nothing;

select tests.create_user('president.work@pgtap.test', 'AUSSS President');
select tests.create_user('web.work@pgtap.test', 'AUSSS Website');
select tests.create_user('lora.work@pgtap.test', 'AUSSS LORA');
select tests.create_user('pat.personal@pgtap.test', 'Pat Personal');
select tests.work_email('president.work@pgtap.test', 'eb.president');
select tests.work_email('web.work@pgtap.test', 'society.webmaster');
select tests.work_email('lora.work@pgtap.test', 'scora.lora');
select tests.work_email('vpi.work@pgtap.test', 'eb.vp-internal');
select tests.assign('president.work@pgtap.test', 'eb.president');
select tests.assign('web.work@pgtap.test', 'society.webmaster');
select tests.assign('lora.work@pgtap.test', 'scora.lora');

create temporary table pgtap_ids on commit drop as
select (select id from public.positions where key = 'eb.vp-internal') as vpi,
       (select id from public.positions where key = 'society.webmaster') as webmaster,
       (select id from public.positions where key = 'scora.lora') as lora,
       (select id from public.positions where key = 'scora.member') as member,
       (select id from public.terms where is_current) as term;
grant select on pgtap_ids to authenticated;

-- ---- offering --------------------------------------------------------------------------------
select tests.authenticate_as('president.work@pgtap.test');
select throws_ok(
  $$ select public.invite_to_position('pat.personal@pgtap.test', (select vpi from pgtap_ids)) $$,
  '22023', 'This position can only be given to its work email, vpi.work@pgtap.test.',
  'a board position is refused to any address but its work email, and the refusal names it'
);
select throws_ok(
  $$ select public.invite_to_position('pat.personal@pgtap.test', (select lora from pgtap_ids)) $$,
  '22023', null, 'so is an officer''s position'
);
select is(
  public.invite_to_position(' VPI.Work@PGTAP.test ', (select vpi from pgtap_ids)),
  'invited', 'the work email itself is invited, however it is typed'
);
select is(
  public.invite_to_position('pat.personal@pgtap.test', (select member from pgtap_ids)),
  'assigned', 'a position below officer goes to any address, as before'
);
select throws_ok(
  $$ insert into public.invites (email, position_id, term_id)
     values ('pat.personal@pgtap.test', (select lora from pgtap_ids), (select term from pgtap_ids)) $$,
  '42501', null, 'writing the offer straight into the table is refused too'
);
select throws_ok(
  $$ insert into public.assignments (profile_id, position_id, term_id)
     values (tests.user_id('pat.personal@pgtap.test'), (select lora from pgtap_ids), (select term from pgtap_ids)) $$,
  '42501', null, '...and so is writing the position itself'
);
select lives_ok(
  $$ insert into public.assignments (profile_id, position_id, term_id, status, ended_on)
     values (tests.user_id('pat.personal@pgtap.test'), (select lora from pgtap_ids), (select term from pgtap_ids), 'ended', current_date) $$,
  'a record of a position that has ended is not access and may be written'
);
select throws_ok(
  $$ update public.assignments set status = 'active', ended_on = null
      where profile_id = tests.user_id('pat.personal@pgtap.test') and position_id = (select lora from pgtap_ids) $$,
  '42501', null, '...but it cannot be brought back to life on a personal account'
);
select tests.clear_auth();

-- ---- accepting: an offer that got in another way is never taken up ---------------------------
select tests.invite('sam.personal@pgtap.test', 'scora.lora');
select tests.create_user('sam.personal@pgtap.test', 'Sam Personal');
select is(
  (select count(*)::int from public.assignments a where a.profile_id = tests.user_id('sam.personal@pgtap.test')),
  0, 'signing up does not turn an officer''s offer to a personal address into the position'
);
select ok(
  (select accepted_at is null from public.invites where email_normalized = 'sam.personal@pgtap.test'),
  '...the offer just stays unaccepted'
);
select tests.invite('pat.personal@pgtap.test', 'eb.vp-internal');
select is(
  (select count(*)::int from public.assignments a join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('pat.personal@pgtap.test') and p.key = 'eb.vp-internal'),
  0, 'nor does an offer to an account that already exists'
);
select tests.create_user('vpi.work@pgtap.test', 'AUSSS VPI');
select is(
  (select p.key from public.assignments a join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('vpi.work@pgtap.test') and a.status = 'active'),
  'eb.vp-internal', 'the work email takes up its offer at first sign-in'
);

-- ---- the list --------------------------------------------------------------------------------
select tests.authenticate_as('lora.work@pgtap.test');
select is((select count(*)::int from public.position_work_emails), 0, 'an officer cannot read the work emails');
select tests.clear_auth();
select tests.authenticate_as('president.work@pgtap.test');
select ok((select count(*) >= 4 from public.position_work_emails), 'the Executive Board reads them');
select lives_ok(
  $$ update public.position_work_emails set email = ' LORA.New@PGTAP.test ' where position_id = (select lora from pgtap_ids) $$,
  'the board changes an officer''s work email'
);
select is(
  (select email from public.position_work_emails where position_id = (select lora from pgtap_ids)),
  'lora.new@pgtap.test', '...which is stored tidied'
);
update public.position_work_emails set email = 'president.work@pgtap.test' where position_id = (select webmaster from pgtap_ids);
select is(
  (select email from public.position_work_emails where position_id = (select webmaster from pgtap_ids)),
  'web.work@pgtap.test', 'a board member cannot point the webmaster''s position at another address'
);
select throws_ok(
  $$ insert into public.position_work_emails (position_id, email) values ((select member from pgtap_ids), 'x@pgtap.test') $$,
  '22023', null, 'a position below officer has no work email'
);
select tests.clear_auth();
select is(
  (select a.status from public.assignments a
    where a.profile_id = tests.user_id('lora.work@pgtap.test') and a.position_id = (select lora from pgtap_ids)),
  'active', 'changing a work email does not move anybody''s access: the old account keeps the position until it is removed'
);
select tests.authenticate_as('web.work@pgtap.test');
select lives_ok(
  $$ update public.position_work_emails set email = 'web.new@pgtap.test' where position_id = (select webmaster from pgtap_ids) $$,
  'the webmaster changes the webmaster''s work email'
);
select tests.clear_auth();
select is(
  (select email from public.position_work_emails where position_id = (select webmaster from pgtap_ids)),
  'web.new@pgtap.test', '...and it is saved'
);

select * from finish();
rollback;
