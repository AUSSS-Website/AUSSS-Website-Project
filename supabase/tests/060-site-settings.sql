-- site_settings: anyone (including the anonymous public site) reads; only EB writes; updated_by
-- is stamped from auth.uid() regardless of what the client sends; keys must look like identifiers.
begin;
select plan(9);

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

insert into public.site_settings (key, value) values ('pgtap.flag', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;

-- anon reads, cannot write (no grant -> 42501)
select tests.authenticate_as_anon();
select is(
  (select value from public.site_settings where key = 'pgtap.flag'),
  'false'::jsonb,
  'anon can read a setting'
);
select throws_ok(
  $$ update public.site_settings set value = 'true'::jsonb where key = 'pgtap.flag' $$,
  '42501', null,
  'anon cannot update a setting'
);

-- plain member reads, cannot write (RLS)
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select is(
  (select value from public.site_settings where key = 'pgtap.flag'),
  'false'::jsonb,
  'a signed-in member can read a setting'
);
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('pgtap.member', 'true'::jsonb) $$,
  '42501', null,
  'non-EB insert is rejected by RLS'
);
-- an update that matches no visible-and-writable row is silently zero rows, so assert the value
update public.site_settings set value = 'true'::jsonb where key = 'pgtap.flag';
select is(
  (select value from public.site_settings where key = 'pgtap.flag'),
  'false'::jsonb,
  'non-EB update changes nothing'
);

-- EB writes; updated_by is stamped even when the client sends something else
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.site_settings (key, value, updated_by)
     values ('pgtap.flag', 'true'::jsonb, tests.user_id('member@pgtap.test'))
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by $$,
  'EB upserts a setting'
);
select is(
  (select value from public.site_settings where key = 'pgtap.flag'),
  'true'::jsonb,
  'the EB value was written'
);
select is(
  (select updated_by from public.site_settings where key = 'pgtap.flag'),
  tests.user_id('eb@pgtap.test'),
  'updated_by is the signed-in EB member, not what the client sent'
);
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('Not a key!', 'true'::jsonb) $$,
  '23514', null,
  'keys must look like identifiers'
);

select tests.clear_auth();
select * from finish();
rollback;
