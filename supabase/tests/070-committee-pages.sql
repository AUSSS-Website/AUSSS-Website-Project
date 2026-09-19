-- Committee page editing: public.save_committee_page is the only write path for officers.
-- An officer edits their own committee only, EB edits any, members none; the document is
-- normalised (unknown keys dropped, caps applied, members limited to 10, data: URIs refused);
-- {} clears the override. Storage: officers may only write under their committee's folder.
begin;
select plan(16);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('scope.assistant', (select id from public.committees where slug = 'scope'), 'Assistant', 'Assistant', 'assistant')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('assistant@pgtap.test', 'Scope Assistant');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('assistant@pgtap.test', 'scope.assistant');

-- anon: no execute at all
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.save_committee_page('scope', '{"tagline":"x"}'::jsonb) $$,
  '42501', null,
  'anon cannot call save_committee_page'
);

-- member and assistant: refused
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ select public.save_committee_page('scope', '{"tagline":"x"}'::jsonb) $$,
  '42501', null,
  'a plain member cannot edit a committee page'
);
select tests.clear_auth();
select tests.authenticate_as('assistant@pgtap.test');
select throws_ok(
  $$ select public.save_committee_page('scope', '{"tagline":"x"}'::jsonb) $$,
  '42501', null,
  'an assistant cannot edit their committee page'
);

-- officer: own committee yes, other committee no, unknown slug P0002
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.save_committee_page('score', '{"tagline":"x"}'::jsonb) $$,
  '42501', null,
  'an officer cannot edit another committee'
);
select throws_ok(
  $$ select public.save_committee_page('nope', '{"tagline":"x"}'::jsonb) $$,
  'P0002', null,
  'unknown slug is rejected'
);
select is(
  public.save_committee_page('scope', $j$ {
    "tagline": "  Exchange the world  ",
    "about": ["First", "", "  Second  "],
    "whatWeDo": ["a", "b"],
    "whatWeDoEnabled": true,
    "photo": "https://lh3.googleusercontent.com/d/abc=w1000",
    "membersEnabled": "true",
    "members": [
      {"id": "m1", "name": " Reem ", "title": "LEO-Out", "photo": ""},
      {"name": "", "title": "ghost", "photo": ""},
      {"name": "Photo only", "photo": "/assets/team/x.jpg", "extra": 1}
    ],
    "activities": [{"title": "dropped"}],
    "colour": "#ff0000"
  } $j$::jsonb),
  $j$ {
    "tagline": "Exchange the world",
    "about": ["First", "Second"],
    "whatWeDo": ["a", "b"],
    "whatWeDoEnabled": true,
    "photo": "https://lh3.googleusercontent.com/d/abc=w1000",
    "membersEnabled": true,
    "members": [
      {"id": "m1", "name": "Reem", "title": "LEO-Out", "photo": ""},
      {"id": "m2", "name": "Photo only", "title": "", "photo": "/assets/team/x.jpg"}
    ]
  } $j$::jsonb,
  'the document is normalised: trimmed, empties dropped, unknown keys removed, member without name/photo dropped'
);
select is(
  (select page ->> 'tagline' from public.committees where slug = 'scope'),
  'Exchange the world',
  'the normalised page was stored on the committee row'
);
-- audit_log is readable by the webmaster only, so count it as postgres
select tests.clear_auth();
select is(
  (select count(*)::int from public.audit_log where table_name = 'committees' and action = 'UPDATE'
     and actor = tests.user_id('leo@pgtap.test')),
  1,
  'the edit is audited with the officer as actor'
);
select tests.authenticate_as('leo@pgtap.test');
select throws_ok(
  $$ select public.save_committee_page('scope', '{"photo":"data:image/jpeg;base64,AAAA"}'::jsonb) $$,
  '22023', null,
  'inline image data is refused (photos go to Storage)'
);
select is(
  jsonb_array_length(
    public.save_committee_page('scope', (
      select jsonb_build_object('membersEnabled', true, 'members',
        jsonb_agg(jsonb_build_object('name', 'Member ' || g)))
      from generate_series(1, 14) g
    )) -> 'members'
  ),
  10,
  'members are capped at 10'
);
select is(
  public.save_committee_page('scope', '{}'::jsonb),
  '{}'::jsonb,
  'an empty object clears the override'
);
select is(
  (select page from public.committees where slug = 'scope'),
  '{}'::jsonb,
  'the committee row is back to no override'
);

-- EB edits any committee; committees_update (direct) is still EB-only
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ select public.save_committee_page('score', '{"tagline":"Research"}'::jsonb) $$,
  'EB edits another committee'
);

-- storage: the write guard follows the first path segment
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select ok(app.can_write_committee_media('scope/officer-1.jpg'), 'officer may write under their own slug');
select ok(not app.can_write_committee_media('score/officer-1.jpg'), 'officer may not write under another slug');
select ok(not app.can_write_committee_media('officer-1.jpg'), 'a path without a committee folder is refused');

select tests.clear_auth();
select * from finish();
rollback;
