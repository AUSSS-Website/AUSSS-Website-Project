-- RLS on profiles: a member sees only their own row, an officer sees the members of their own
-- committee (this term), EB sees everyone. Members may edit contact columns but the column-level
-- grant stops them touching membership_status. RLS-hidden rows simply do not come back (assert on
-- count); the column grant is a hard 42501.
begin;
select plan(8);

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

insert into public.positions (key, committee_id, title, short_title, level, can_assign_tasks)
select v.key, c.id, v.title, v.short_title, v.level, v.level = 'officer'
from (values
  ('scope.leo-out', 'scope', 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
  ('scope.member', 'scope', 'Member', null, 'member'),
  ('score.lore', 'score', 'Local Officer on Research Exchange', 'LORE', 'officer')
) as v(key, slug, title, short_title, level)
join public.committees c on c.slug = v.slug
on conflict do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb')
on conflict do nothing;

select tests.create_user('a@pgtap.test', 'Member A');
select tests.create_user('b@pgtap.test', 'Member B');
select tests.create_user('scope-officer@pgtap.test', 'SCOPE Officer');
select tests.create_user('score-officer@pgtap.test', 'SCORE Officer');
select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.assign('b@pgtap.test', 'scope.member');
select tests.assign('scope-officer@pgtap.test', 'scope.leo-out');
select tests.assign('score-officer@pgtap.test', 'score.lore');
select tests.assign('eb@pgtap.test', 'eb.president');

-- member A: own row only, own contact columns only
select tests.authenticate_as('a@pgtap.test');
select is(
  (select count(*)::int from public.profiles where id = tests.user_id('a@pgtap.test')),
  1,
  'A sees own profile'
);
select is(
  (select count(*)::int from public.profiles where id = tests.user_id('b@pgtap.test')),
  0,
  'A cannot see B (RLS hides the row)'
);
select lives_ok(
  $$ update public.profiles set full_name = 'Member A Renamed' where id = tests.user_id('a@pgtap.test') $$,
  'A can update own full_name'
);
select is(
  (select full_name from public.profiles where id = tests.user_id('a@pgtap.test')),
  'Member A Renamed',
  'the rename persisted'
);
select throws_ok(
  $$ update public.profiles set membership_status = 'active' where id = tests.user_id('a@pgtap.test') $$,
  '42501', null,
  'A cannot update own membership_status (column-level grant)'
);

-- officer of a committee B is not in
select tests.clear_auth();
select tests.authenticate_as('score-officer@pgtap.test');
select is(
  (select count(*)::int from public.profiles where id = tests.user_id('b@pgtap.test')),
  0,
  'officer of another committee cannot see B'
);

-- officer of B's committee
select tests.clear_auth();
select tests.authenticate_as('scope-officer@pgtap.test');
select is(
  (select count(*)::int from public.profiles where id = tests.user_id('b@pgtap.test')),
  1,
  'officer of B''s committee sees B'
);

-- executive board
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is(
  (select count(*)::int from public.profiles where id = tests.user_id('b@pgtap.test')),
  1,
  'EB sees B'
);

select tests.clear_auth();
select * from finish();
rollback;
