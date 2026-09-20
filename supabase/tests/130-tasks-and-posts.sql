-- Phase 3: tasks are visible to their assignees, creator and the committee's officers only; an
-- assignee moves the status and nothing else; the timeline and the notifications are written by
-- triggers. Posts reach their audience once published, and readers leave receipts that only the
-- post's managers can see.
begin;
select plan(37);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level, can_assign_tasks)
values ('eb.president', null, 'President', 'President', 'eb', false),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer', false),
       ('scope.assistant', (select id from public.committees where slug = 'scope'), 'SCOPE Assistant', 'Assistant', 'assistant', true),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'SCOPE Member', 'Member', 'member', false),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer', false)
on conflict do nothing;
update public.positions set can_assign_tasks = true where key = 'scope.assistant';

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('helper@pgtap.test', 'Scope Assistant');
select tests.create_user('sara@pgtap.test', 'Scope Member');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.create_user('stranger@pgtap.test', 'Signed In Only');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('helper@pgtap.test', 'scope.assistant');
select tests.assign('sara@pgtap.test', 'scope.member');
select tests.assign('lore@pgtap.test', 'score.lore');

-- ---- creating and assigning -----------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ insert into public.tasks (committee_id, title, priority, due_on)
     values ((select id from public.committees where slug = 'scope'), '  Collect host forms ', 'high', app.today_cairo() + 3) $$,
  'an officer creates a task for their committee'
);
select is(
  (select jsonb_build_object('title', title, 'by', created_by, 'term', term_id) from public.tasks),
  jsonb_build_object('title', 'Collect host forms', 'by', tests.user_id('leo@pgtap.test'), 'term', app.current_term_id()),
  'title is trimmed, creator and term are stamped'
);
select throws_ok(
  $$ insert into public.tasks (committee_id, title)
     values ((select id from public.committees where slug = 'score'), 'Not mine') $$,
  '42501', null, 'an officer cannot create a task in another committee'
);
select throws_ok(
  $$ insert into public.tasks (committee_id, title) values (null, 'Society wide') $$,
  '42501', null, 'society-wide tasks are for the EB'
);
select results_eq(
  $$ select full_name from public.task_assignable_people((select id from public.committees where slug = 'scope')) order by 1 $$,
  $$ values ('Scope Assistant'), ('Scope Member'), ('Scope Officer') $$,
  'the picker lists the people active in that committee'
);
select lives_ok(
  $$ insert into public.task_assignees (task_id, profile_id)
     select id, tests.user_id('sara@pgtap.test') from public.tasks $$,
  'the officer assigns a committee member'
);
select throws_ok(
  $$ insert into public.task_assignees (task_id, profile_id)
     select id, tests.user_id('lore@pgtap.test') from public.tasks $$,
  '22023', null, 'somebody outside the committee cannot be assigned'
);

select tests.clear_auth();
select is(
  (select jsonb_build_object('kind', kind, 'title', payload ->> 'title', 'actor', payload ->> 'actor_id')
     from public.notifications where profile_id = tests.user_id('sara@pgtap.test')),
  jsonb_build_object('kind', 'task_assigned', 'title', 'Collect host forms', 'actor', tests.user_id('leo@pgtap.test')),
  'the assignee is notified'
);
select results_eq(
  $$ select kind from public.task_updates order by created_at, kind $$,
  $$ values ('assigned'), ('created') $$,
  'the timeline records the creation and the assignment'
);

-- ---- visibility -----------------------------------------------------------------------------
select tests.authenticate_as('sara@pgtap.test');
select is((select count(*)::int from public.tasks), 1, 'the assignee sees the task');
select tests.clear_auth();
select tests.authenticate_as('helper@pgtap.test');
select is((select count(*)::int from public.tasks), 0, 'a committee colleague who is not assigned does not');
select tests.clear_auth();
select tests.authenticate_as('lore@pgtap.test');
select is((select count(*)::int from public.tasks), 0, 'another committee''s officer does not');
select is((select count(*)::int from public.task_updates), 0, '...nor its timeline');
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is((select count(*)::int from public.tasks), 1, 'the EB sees every task');

-- ---- the assignee moves the status, nothing else ---------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
update public.tasks set status = 'doing', title = 'Hijacked', due_on = null, priority = 'low';
select is(
  (select jsonb_build_object('status', status, 'title', title, 'priority', priority, 'due', due_on is not null) from public.tasks),
  '{"status": "doing", "title": "Collect host forms", "priority": "high", "due": true}'::jsonb,
  'an assignee changes the status; every other column is pinned'
);
select throws_ok(
  $$ insert into public.task_assignees (task_id, profile_id)
     select id, tests.user_id('helper@pgtap.test') from public.tasks $$,
  '42501', null, 'an assignee cannot assign others'
);
select lives_ok(
  $$ insert into public.task_updates (task_id, body) select id, '  Two forms are in. ' from public.tasks $$,
  'an assignee comments'
);
select throws_ok(
  $$ insert into public.task_updates (task_id, body, kind) select id, 'x', 'status' from public.tasks $$,
  '42501', null, 'clients can only write comments'
);
delete from public.tasks;
select is((select count(*)::int from public.tasks), 1, 'an assignee cannot delete the task');

select tests.clear_auth();
select results_eq(
  $$ select kind, payload ->> 'to', payload ->> 'excerpt' from public.notifications
     where profile_id = tests.user_id('leo@pgtap.test') order by created_at, kind $$,
  $$ values ('task_comment', null::text, 'Two forms are in.'), ('task_status', 'doing', null::text) $$,
  'the creator hears about the status change and the comment'
);
select is(
  (select count(*)::int from public.notifications
    where profile_id = tests.user_id('sara@pgtap.test') and kind <> 'task_assigned'),
  0, 'nobody is notified about their own actions'
);

-- ---- an assistant with can_assign_tasks ------------------------------------------------------
select tests.authenticate_as('helper@pgtap.test');
select lives_ok(
  $$ insert into public.tasks (committee_id, title, status)
     values ((select id from public.committees where slug = 'scope'), 'Print badges', 'done') $$,
  'an assistant whose position may assign tasks creates one'
);
select ok(
  (select completed_at is not null from public.tasks where title = 'Print badges'),
  'a task created as done is stamped completed'
);
update public.tasks set status = 'todo', title = 'Print the badges' where title = 'Print badges';
select is(
  (select jsonb_build_object('title', title, 'completed', completed_at is not null) from public.tasks where created_by = tests.user_id('helper@pgtap.test')),
  '{"title": "Print the badges", "completed": false}'::jsonb,
  'the creator edits their task; reopening clears completed_at'
);
select is(
  (select meta -> 'fields' from public.task_updates where kind = 'edited'),
  '["title"]'::jsonb, 'the edit is recorded on the timeline with the fields that changed'
);
select is(
  (select count(*)::int from public.profile_names(array[tests.user_id('leo@pgtap.test'), tests.user_id('sara@pgtap.test')])),
  2, 'members resolve names for ids they hold'
);

-- ---- notifications belong to their owner -----------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
select is((select count(*)::int from public.notifications), 1, 'a person sees only their own notifications');
update public.notifications set read_at = now();
select is((select count(*)::int from public.notifications where read_at is not null), 1, '...and marks them read');
select throws_ok(
  $$ update public.notifications set payload = '{}'::jsonb $$,
  '42501', null, 'the payload is not theirs to rewrite'
);
select tests.clear_auth();
select tests.authenticate_as('stranger@pgtap.test');
select throws_ok(
  $$ select * from public.profile_names(array[tests.user_id('leo@pgtap.test')]) $$,
  '42501', null, 'an unverified account cannot resolve names'
);

-- ---- posts ----------------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
insert into public.posts (committee_id, title, body, publish_at, levels)
values ((select id from public.committees where slug = 'scope'), 'Exchange season opens', 'Read the guide.', now() - interval '1 minute', '{}'),
       ((select id from public.committees where slug = 'scope'), 'Officers only', '', now() - interval '1 minute', '{officer}'),
       ((select id from public.committees where slug = 'scope'), 'Draft', '', null, '{}'),
       ((select id from public.committees where slug = 'scope'), 'Expired', '', now() - interval '2 days', '{}');
update public.posts set expires_at = now() - interval '1 day' where title = 'Expired';
select throws_ok(
  $$ insert into public.posts (committee_id, title) values (null, 'To everyone') $$,
  '42501', null, 'society-wide posts are for the EB'
);
select is((select count(*)::int from public.posts), 4, 'the author''s officer view includes drafts and expired posts');

select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
select results_eq(
  $$ select title from public.posts order by title $$,
  $$ values ('Exchange season opens') $$,
  'a member sees live posts addressed to their level only'
);
select lives_ok(
  $$ insert into public.post_reads (post_id, profile_id)
     select id, tests.user_id('sara@pgtap.test') from public.posts $$,
  'a reader leaves a receipt'
);
select tests.clear_auth();
create temporary table pgtap_posts on commit drop as select title, id from public.posts;
grant select on pgtap_posts to authenticated;
select tests.authenticate_as('lore@pgtap.test');
select is((select count(*)::int from public.posts), 0, 'another committee sees none of it');
select throws_ok(
  $$ insert into public.post_reads (post_id, profile_id)
     select id, tests.user_id('lore@pgtap.test') from pgtap_posts where title = 'Exchange season opens' $$,
  '42501', null, 'no receipts for posts you cannot see'
);

select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select results_eq(
  $$ select full_name, read_at is not null
     from public.post_audience((select id from pgtap_posts where title = 'Exchange season opens')) $$,
  $$ values ('Scope Assistant', false), ('Scope Officer', false), ('Scope Member', true) $$,
  'the post''s manager sees who has and has not read it, unread first'
);

select tests.clear_auth();
select * from finish();
rollback;
