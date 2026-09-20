-- The daily digest: admin_digest_batch lists each person once with what they have not seen
-- (unread, never-emailed notifications and live unread updates addressed to them), skips people
-- who opted out or were emailed within the day, and admin_digest_mark makes a run final.
begin;
select plan(10);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'SCOPE Member', 'Member', 'member'),
       ('score.member', (select id from public.committees where slug = 'score'), 'SCORE Member', 'Member', 'member')
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('sara@pgtap.test', 'Sara Member');
select tests.create_user('omar@pgtap.test', 'Omar Member');
select tests.create_user('nour@pgtap.test', 'Nour Elsewhere');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('sara@pgtap.test', 'scope.member');
select tests.assign('omar@pgtap.test', 'scope.member');
select tests.assign('nour@pgtap.test', 'score.member');
update public.profiles set email_digest = false where id = tests.user_id('omar@pgtap.test');

-- the officer hands a task to Sara and Omar and posts to the committee
select tests.authenticate_as('leo@pgtap.test');
insert into public.tasks (committee_id, title)
values ((select id from public.committees where slug = 'scope'), 'Collect host forms');
insert into public.task_assignees (task_id, profile_id)
select t.id, p from public.tasks t, unnest(array[tests.user_id('sara@pgtap.test'), tests.user_id('omar@pgtap.test')]) p;
insert into public.posts (committee_id, title, publish_at)
values ((select id from public.committees where slug = 'scope'), 'Exchange season opens', now() - interval '1 minute'),
       ((select id from public.committees where slug = 'scope'), 'Still a draft', null);

select throws_ok(
  $$ select public.admin_digest_batch(80) $$,
  '42501', null, 'signed-in users cannot read the digest queue'
);

select tests.clear_auth();
create temporary table pgtap_batch on commit drop as
  select e from jsonb_array_elements(public.admin_digest_batch(80)) as t(e)
  where e ->> 'email' like '%@pgtap.test';

select results_eq(
  $$ select e ->> 'email' from pgtap_batch order by 1 $$,
  $$ values ('sara@pgtap.test') $$,
  'only people with something unread who kept the digest on: not the author, not the opt-out, not another committee'
);
select is(
  (select e -> 'notifications' -> 0 ->> 'kind' from pgtap_batch),
  'task_assigned', 'the assignment is in the digest'
);
select is(
  (select jsonb_agg(p ->> 'title') from pgtap_batch, jsonb_array_elements(e -> 'posts') as t(p)),
  '["Exchange season opens"]'::jsonb, 'live unread updates are in it, drafts are not'
);

-- a read notification and a read post drop out
update public.notifications set read_at = now() where profile_id = tests.user_id('sara@pgtap.test');
insert into public.post_reads (post_id, profile_id)
select id, tests.user_id('sara@pgtap.test') from public.posts where title = 'Exchange season opens';
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_digest_batch(80)) as t(e) where e ->> 'email' = 'sara@pgtap.test'),
  0, 'nothing unread, no email'
);

-- marking a run
delete from public.post_reads where profile_id = tests.user_id('sara@pgtap.test');
update public.notifications set read_at = null where profile_id = tests.user_id('sara@pgtap.test');
select lives_ok(
  $$ select public.admin_digest_mark(array[tests.user_id('sara@pgtap.test')], 1, 'test run') $$,
  'a run is recorded'
);
select ok(
  (select emailed_at is not null from public.notifications where profile_id = tests.user_id('sara@pgtap.test')),
  'her notifications are stamped as emailed'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_digest_batch(80)) as t(e) where e ->> 'email' = 'sara@pgtap.test'),
  0, 'nobody is emailed twice within a day'
);
select is(
  (select jsonb_build_object('sent', sent, 'failed', failed, 'note', note) from public.digest_runs order by id desc limit 1),
  '{"sent": 1, "failed": 1, "note": "test run"}'::jsonb, 'the run log has the counts'
);

select tests.authenticate_as('sara@pgtap.test');
select is((select count(*)::int from public.digest_runs), 0, 'the run log is for the EB');

select tests.clear_auth();
select * from finish();
rollback;
