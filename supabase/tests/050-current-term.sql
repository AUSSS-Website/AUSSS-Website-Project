-- Current term: the partial unique index terms_one_current allows exactly one is_current row
-- (23505 otherwise), and public.set_current_term is the EB-only two-step switch around it.
-- The EB user is assigned in pgtap-a, so their EB status ends with the switch: the non-EB attempt
-- and any other EB-only work must come before it.
begin;
select plan(10);

-- Fixtures (as postgres). Independent of the generated reference-data migration: the upserts do
-- nothing when it has already loaded these rows; pgtap-a is forced to be the only current term.
update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap-a', '2025-09-01', '2026-08-31', true),
       ('pgtap-b', '2026-09-01', '2027-08-31', false)
on conflict (label) do update set is_current = excluded.is_current;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');

-- the invariant itself (as postgres, so RLS is out of the picture)
select throws_ok(
  $$ update public.terms set is_current = true where label = 'pgtap-b' $$,
  '23505', null,
  'a second current term violates terms_one_current'
);
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, is_current)
     values ('pgtap-c', '2027-09-01', '2028-08-31', true) $$,
  '23505', null,
  'inserting another current term violates terms_one_current'
);
select is(
  (select label from public.terms where is_current),
  'pgtap-a', 'pgtap-a is still the only current term'
);

-- non-EB
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.set_current_term((select id from public.terms where label = 'pgtap-b')) $$,
  '42501', null,
  'non-EB cannot switch the current term'
);
select is(
  app.current_term_id(),
  (select id from public.terms where label = 'pgtap-a'),
  'current term unchanged after the refused call'
);

-- EB
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select throws_ok(
  $$ select public.set_current_term(gen_random_uuid()) $$,
  'P0002', null,
  'an unknown term id is rejected'
);
select lives_ok(
  $$ select public.set_current_term((select id from public.terms where label = 'pgtap-b')) $$,
  'EB switches the current term'
);
select is(
  (select count(*)::int from public.terms where is_current),
  1, 'exactly one current term after the switch'
);
select is(
  (select label from public.terms where is_current),
  'pgtap-b', 'pgtap-b is now current'
);
select is(
  app.current_term_id(),
  (select id from public.terms where label = 'pgtap-b'),
  'app.current_term_id() follows the switch'
);

select tests.clear_auth();
select * from finish();
rollback;
