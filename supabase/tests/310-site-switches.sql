-- The switches that moved from config files into site settings (Open Calls on the public site,
-- the magazine's counter, the addresses on the domain): the EB flips them, every visitor reads
-- them, a member cannot, and a change asks for a rebuild of the saved pages, which carry them.
begin;
select plan(5);

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

delete from public.site_settings where key in ('openCallsLive', 'magazineCountersVisible', 'domainEmailsLive');
update app.site_rebuild set requested_at = null, reason = null where id;

select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('domainEmailsLive', 'true'::jsonb) $$,
  '42501', null,
  'a member cannot flip a switch'
);
select tests.clear_auth();

select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.site_settings (key, value)
     values ('openCallsLive', 'true'::jsonb), ('magazineCountersVisible', 'false'::jsonb), ('domainEmailsLive', 'true'::jsonb) $$,
  'the EB flips the switches'
);
select tests.clear_auth();

select is(
  (select reason from app.site_rebuild where id),
  'site_settings',
  'a switch change asks for a rebuild'
);

select tests.authenticate_as_anon();
select is(
  (select jsonb_object_agg(key, value) from public.site_settings
   where key in ('openCallsLive', 'magazineCountersVisible', 'domainEmailsLive')),
  '{"openCallsLive": true, "magazineCountersVisible": false, "domainEmailsLive": true}'::jsonb,
  'every visitor reads the switches'
);
select tests.clear_auth();

select is(
  (select editors from public.content_blocks where key = 'site.contact'),
  '{}'::text[],
  'the footer and contact details are the EB''s alone'
);

select * from finish();
rollback;
