-- Removing a position type. The Executive Board deletes a position a committee hands out;
-- whoever held it falls back to the committee's Local Member position, on the roster and on
-- their account, and nobody but the board can remove one.
begin;
select plan(7);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member'),
       ('scora.pgtap-coordinator', (select id from public.committees where slug = 'scora'), 'Pgtap Coordinator', null, 'assistant')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('lora@pgtap.test', 'Lora Officer');
select tests.create_user('sara@pgtap.test', 'Sara Signed In');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('lora@pgtap.test', 'scora.lora');

-- two holders of the position: one with an account, one who has never signed in
delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, committee_id, position_id)
select v.key, v.name, '', v.email, 'Full Member', c.id, p.id
from (values ('p1', 'Sara Signed In', 'sara@pgtap.test'), ('p2', 'Nour Not Yet', 'nour@pgtap.test')) as v (key, name, email),
     public.committees c, public.positions p
where c.slug = 'scora' and p.key = 'scora.pgtap-coordinator';

select is(
  (select p.key from public.assignments a join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('sara@pgtap.test') and a.status = 'active'),
  'scora.pgtap-coordinator', 'before: the member with an account holds the position'
);

-- ---- an officer cannot remove a position type --------------------------------------------------
select tests.authenticate_as('lora@pgtap.test');
delete from public.positions where key = 'scora.pgtap-coordinator';
select tests.clear_auth();
select is(
  (select count(*)::int from public.positions where key = 'scora.pgtap-coordinator'),
  1, 'an officer cannot remove a position type'
);

-- ---- the board removes it ----------------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ delete from public.positions where key = 'scora.pgtap-coordinator' $$,
  'the Executive Board removes a position that members hold'
);
select tests.clear_auth();
select is(
  (select count(*)::int from public.positions where key = 'scora.pgtap-coordinator'),
  0, 'the position is gone'
);
select results_eq(
  $$ select r.full_name, p.key
     from public.roster_entries r left join public.positions p on p.id = r.position_id
     where r.source_key in ('p1', 'p2') order by r.full_name $$,
  $$ values ('Nour Not Yet', 'scora.member'), ('Sara Signed In', 'scora.member') $$,
  'everyone who held it is a Local Member on the roster'
);
select results_eq(
  $$ select p.key, a.status
     from public.assignments a join public.positions p on p.id = a.position_id
     where a.profile_id = tests.user_id('sara@pgtap.test') order by p.key $$,
  $$ values ('scora.member', 'active') $$,
  '...and on their account: Local Member, and nothing left of the removed position'
);
select is(
  (select p.key from public.invites i join public.positions p on p.id = i.position_id
    where i.email_normalized = 'nour@pgtap.test' and i.accepted_at is null),
  'scora.member', 'the member who has not signed in yet is offered Local Member instead'
);

select * from finish();
rollback;
