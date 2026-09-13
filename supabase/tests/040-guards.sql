-- Guards on the public RPCs: decide_verification / set_membership_status raise 42501 for anyone
-- who is not EB (the function checks app.is_eb() itself), an EB decision updates both the request
-- and the profile, and anon has no EXECUTE on claim_my_account at all (also 42501, from the
-- missing grant rather than from inside the function).
begin;
select plan(12);

-- Fixtures (as postgres). Independent of the generated reference-data migration: the upserts do
-- nothing when it has already loaded these rows, and the term is forced to be the current one.
update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');

-- a member files a request for themselves, then tries the EB-only RPCs
select tests.authenticate_as('member@pgtap.test');
select lives_ok(
  $$ insert into public.verification_requests (profile_id, message)
     values (tests.user_id('member@pgtap.test'), 'Please verify me') $$,
  'member can file a verification request for themselves'
);
select throws_ok(
  $$ insert into public.verification_requests (profile_id, status)
     values (tests.user_id('member@pgtap.test'), 'approved') $$,
  '42501', null,
  'member cannot file a pre-approved request (RLS with-check)'
);
select throws_ok(
  $$ select public.decide_verification(
       (select id from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
       'approved', 'active') $$,
  '42501', null,
  'non-EB cannot decide a verification request'
);
select is(
  (select status from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
  'pending', 'the request is untouched after the refused call'
);
select throws_ok(
  $$ select public.set_membership_status(tests.user_id('member@pgtap.test'), 'active') $$,
  '42501', null,
  'non-EB cannot set membership status'
);
select lives_ok(
  $$ select public.claim_my_account() $$,
  'a signed-in member may re-run claiming for themselves'
);

-- EB approves
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ select public.decide_verification(
       (select id from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
       'approved', 'active') $$,
  'EB approves the request'
);
select is(
  (select status from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
  'approved', 'request recorded as approved'
);
select is(
  (select decided_by from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
  tests.user_id('eb@pgtap.test'), 'decided_by is the EB member'
);
select is(
  (select membership_status from public.profiles where id = tests.user_id('member@pgtap.test')),
  'active', 'approval updated the member''s profile'
);
select throws_ok(
  $$ select public.decide_verification(
       (select id from public.verification_requests where profile_id = tests.user_id('member@pgtap.test')),
       'declined', 'active') $$,
  '22023', null,
  'a request cannot be decided twice'
);

-- anon: the RPC is not even executable
select tests.clear_auth();
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.claim_my_account() $$,
  '42501', null,
  'anon cannot execute claim_my_account'
);

select tests.clear_auth();
select * from finish();
rollback;
