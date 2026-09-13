-- Claiming: app.handle_new_user (fired by tests.create_user's auth.users insert) links a roster
-- row by normalised email, upgrades an unverified profile, and turns standing invites into
-- assignments; app.handle_new_invite does the same for invites created after the profile exists.
-- Everything here runs as postgres; RLS is not the subject.
begin;
select plan(15);

-- Fixtures. Independent of the generated reference-data migration: the upserts do nothing when
-- it has already loaded these rows, and the term is forced to be the current one.
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
  ('scope.member', 'scope', 'Member', null, 'member'),
  ('score.lore', 'score', 'Local Officer on Research Exchange', 'LORE', 'officer')
) as v(key, slug, title, short_title, level)
join public.committees c on c.slug = v.slug
on conflict do nothing;

-- 1. roster row with a matching email (case differs on purpose: matching is on email_normalized)
select tests.roster('Full Person', 'Full.Person@PGTAP.test', 'Full Member', 2022);
select tests.roster('Candidate Person', 'candidate@pgtap.test', 'Candidate Member', 2025);
select tests.create_user('full.person@pgtap.test', 'Full Person');
select tests.create_user('candidate@pgtap.test', 'Candidate Person');

select is(
  (select membership_status from public.profiles where id = tests.user_id('full.person@pgtap.test')),
  'active', 'Full Member on the roster -> active'
);
select is(
  (select membership_tier from public.profiles where id = tests.user_id('full.person@pgtap.test')),
  'Full Member', 'raw roster status copied to membership_tier'
);
select is(
  (select joined_year from public.profiles where id = tests.user_id('full.person@pgtap.test')),
  2022, 'joined_year copied from the roster'
);
select is(
  (select profile_id from public.roster_entries where email = 'Full.Person@PGTAP.test'),
  tests.user_id('full.person@pgtap.test'), 'roster row links to the new profile'
);
select is(
  (select membership_status from public.profiles where id = tests.user_id('candidate@pgtap.test')),
  'candidate', 'Candidate Member on the roster -> candidate'
);
select is(
  (select profile_id from public.roster_entries where email = 'candidate@pgtap.test'),
  tests.user_id('candidate@pgtap.test'), 'candidate roster row links too'
);

-- 2. a pending invite becomes an assignment on sign-up
select tests.invite('invited@pgtap.test', 'score.lore');
select ok(
  (select accepted_at is null from public.invites where email = 'invited@pgtap.test'),
  'invite for an unknown email stays pending'
);
select tests.create_user('invited@pgtap.test', 'Invited Person');
select is(
  (select count(*)::int from public.assignments a
     join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('invited@pgtap.test') and p.key = 'score.lore' and a.status = 'active'),
  1, 'sign-up turned the invite into an active assignment'
);
select is(
  (select accepted_profile_id from public.invites where email = 'invited@pgtap.test'),
  tests.user_id('invited@pgtap.test'), 'invite marked accepted by that profile'
);

-- 3. an invite for an existing profile assigns immediately via app.handle_new_invite
select tests.invite('full.person@pgtap.test', 'scope.member');
select is(
  (select count(*)::int from public.assignments a
     join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('full.person@pgtap.test') and p.key = 'scope.member' and a.status = 'active'),
  1, 'invite for an existing profile assigns via the trigger'
);
select ok(
  (select accepted_at is not null from public.invites where email = 'full.person@pgtap.test'),
  'that invite is accepted immediately'
);

-- 4. neither on the roster nor invited: nothing happens
select tests.create_user('nobody@pgtap.test', 'No Body');
select is(
  (select membership_status from public.profiles where id = tests.user_id('nobody@pgtap.test')),
  'unverified', 'unknown email stays unverified'
);
select is(
  (select membership_tier from public.profiles where id = tests.user_id('nobody@pgtap.test')),
  null::text, 'no tier copied for an unknown email'
);
select is(
  (select count(*)::int from public.roster_entries where profile_id = tests.user_id('nobody@pgtap.test')),
  0, 'no roster row linked for an unknown email'
);
select is(
  (select count(*)::int from public.assignments where profile_id = tests.user_id('nobody@pgtap.test')),
  0, 'no assignments for an unknown email'
);

select * from finish();
rollback;
