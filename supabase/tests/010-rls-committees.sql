-- RLS on committees: the public website reads them anonymously; only the executive board writes.
-- Missing grants surface as 42501 (anon has no INSERT), and so do RLS with-check failures, so both
-- refusals are asserted on the SQLSTATE rather than the message.
begin;
select plan(6);

-- Fixtures (as postgres). Independent of the generated reference-data migration: the upserts do
-- nothing when it has already loaded these rows, and the term is forced to be the current one.
update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');

-- anon: read yes, write no (no INSERT grant at all)
select tests.authenticate_as_anon();
select results_eq(
  $$ select slug from public.committees where slug in ('scope', 'score') order by slug $$,
  $$ values ('scope'), ('score') $$,
  'anon can read committees'
);
select throws_ok(
  $$ insert into public.committees (slug, name, abbr, kind) values ('pgtap-anon', 'Anon', 'ANON', 'standing') $$,
  '42501', null,
  'anon cannot insert committees'
);

-- signed-in member without an EB assignment: read yes, write blocked by the RLS with-check
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select is(
  (select count(*)::int from public.committees where slug in ('scope', 'score')),
  2,
  'a signed-in member can read committees'
);
select throws_ok(
  $$ insert into public.committees (slug, name, abbr, kind) values ('pgtap-member', 'Member', 'MEM', 'standing') $$,
  '42501', null,
  'non-EB insert is rejected by RLS'
);

-- executive board: write allowed
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.committees (slug, name, abbr, kind) values ('pgtap-eb', 'Test Committee', 'TEST', 'standing') $$,
  'EB can insert a committee'
);
select is(
  (select count(*)::int from public.committees where slug = 'pgtap-eb'),
  1,
  'the EB row was written and is readable'
);

select tests.clear_auth();
select * from finish();
rollback;
