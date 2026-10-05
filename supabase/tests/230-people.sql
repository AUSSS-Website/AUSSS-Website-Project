-- Phase 5b: people, one source of truth. The public read names the holders of officer and
-- board positions and nobody else; a chosen photo lives in the person's own folder; the
-- directory is opt-in and for members; a change the public pages show asks for a rebuild, and
-- without the deploy hook nothing is fired.
begin;
select plan(16);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'Local Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', '  Scope Officer ');
select tests.create_user('sara@pgtap.test', 'Scope Member');
select tests.create_user('stranger@pgtap.test', 'Signed In Only');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('sara@pgtap.test', 'scope.member');

-- ---- the chosen photo ------------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ update public.profiles
        set photo_path = id::text || '/11111111-1111-4111-8111-111111111111.jpg'
      where id = tests.user_id('leo@pgtap.test') $$,
  'a person points their profile at a photo in their own folder'
);
select throws_ok(
  $$ update public.profiles
        set photo_path = tests.user_id('eb@pgtap.test')::text || '/x.jpg'
      where id = tests.user_id('leo@pgtap.test') $$,
  '23514', null, '...and at nobody else''s'
);

-- ---- the public read -------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as_anon();
select is(
  (select jsonb_agg(jsonb_build_object('key', p ->> 'key', 'name', p ->> 'name', 'photo', (p ->> 'photo') is not null)
                    order by p ->> 'key')
     from jsonb_array_elements(public.people_public() -> 'people') p
    where p ->> 'key' in ('eb.president', 'scope.leo-out', 'scope.member')),
  '[{"key": "eb.president", "name": "EB Person", "photo": false},
    {"key": "scope.leo-out", "name": "Scope Officer", "photo": true}]'::jsonb,
  'a visitor reads who holds the officer and board positions: name and chosen photo, nobody below officer'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.people_public() -> 'people') p
    where p ? 'email' or p ? 'id' or p ? 'avatar_url'),
  0, '...and nothing else about them'
);
select throws_ok(
  $$ select public.directory() $$,
  '42501', null, 'a visitor cannot read the directory'
);

-- ---- the directory ---------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
select is(jsonb_array_length(public.directory()), 0, 'nobody is listed until they opt in');
update public.profiles set directory_opt_in = true where id = tests.user_id('sara@pgtap.test');
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select is(
  (select jsonb_agg(jsonb_build_object('name', d ->> 'full_name', 'position', d -> 'positions' -> 0 ->> 'title',
                                       'committee', d -> 'positions' -> 0 ->> 'committee'))
     from jsonb_array_elements(public.directory()) d),
  '[{"name": "Scope Member", "position": "Local Member", "committee": "SCOPE"}]'::jsonb,
  'a member who opted in is listed with their position'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.directory()) d where d ? 'email' or d ? 'phone'),
  0, '...without contact details'
);
select tests.clear_auth();
select tests.authenticate_as('stranger@pgtap.test');
select throws_ok(
  $$ select public.directory() $$,
  '42501', null, 'an unverified account cannot read the directory'
);

-- ---- rebuild on publish ----------------------------------------------------------------------
select tests.clear_auth();
update app.site_rebuild set requested_at = null, reason = null, fired_at = null;
update public.profiles set full_name = 'Scope Member Renamed' where id = tests.user_id('sara@pgtap.test');
select ok(
  (select requested_at is null from app.site_rebuild),
  'a member changing their name asks for nothing: the public pages do not show them'
);
update public.profiles set full_name = 'Scope Officer Renamed' where id = tests.user_id('leo@pgtap.test');
select is(
  (select reason from app.site_rebuild), 'profiles',
  'an officer changing their name asks for a rebuild'
);
update app.site_rebuild set requested_at = null, reason = null;
select tests.assign('stranger@pgtap.test', 'scope.member');
select ok((select requested_at is null from app.site_rebuild), 'a new member-level assignment asks for nothing');
update public.assignments set status = 'ended', ended_on = current_date
 where profile_id = tests.user_id('leo@pgtap.test');
select is((select reason from app.site_rebuild), 'assignments', 'an officer leaving their position asks for a rebuild');

select is(app.fire_site_rebuild(), 'no hook', 'without the deploy hook nothing is fired');
select is(app.fire_site_rebuild(true), 'no hook', '...not even the nightly one');

select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.site_rebuild_status() $$,
  '42501', null, 'the rebuild status is the Executive Board''s to see'
);

select tests.clear_auth();
select * from finish();
rollback;
