-- Phase 5b: files on tasks. Whoever can see a task links files it has uploaded to it; the batch
-- lands as one timeline row; strangers neither read nor attach; the uploader or a manager
-- removes a file. Storage objects are seeded directly here, the way the Storage API would
-- have left them.
begin;
select plan(17);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level, can_assign_tasks)
values ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer', false),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'SCOPE Member', 'Member', 'member', false),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer', false)
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('sara@pgtap.test', 'Scope Member');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('sara@pgtap.test', 'scope.member');
select tests.assign('lore@pgtap.test', 'score.lore');

select tests.authenticate_as('leo@pgtap.test');
insert into public.tasks (committee_id, title)
values ((select id from public.committees where slug = 'scope'), 'Collect host forms');
insert into public.task_assignees (task_id, profile_id)
select id, tests.user_id('sara@pgtap.test') from public.tasks;
select tests.clear_auth();

create temporary table pgtap_task on commit drop as select id from public.tasks;
grant select on pgtap_task to authenticated;

-- three uploads under the task's folder, one under a folder that is no task
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'task-files', t.id::text || '/' || f.file, tests.user_id(f.owner)::text,
       jsonb_build_object('size', f.size, 'mimetype', f.mime)
from pgtap_task t,
     (values ('11111111-1111-4111-8111-111111111111.pdf', 'sara@pgtap.test', 1234, 'application/pdf'),
             ('22222222-2222-4222-8222-222222222222.png', 'sara@pgtap.test', 99, 'image/png'),
             ('33333333-3333-4333-8333-333333333333.docx', 'leo@pgtap.test', 5000, 'application/msword')
     ) as f (file, owner, size, mime);
delete from public.notifications;

-- ---- the storage key names its task ----------------------------------------------------------
select is(
  app.task_file_task((select id::text from pgtap_task) || '/11111111-1111-4111-8111-111111111111.pdf'),
  (select id from pgtap_task),
  'a well-formed key resolves to its task'
);
select is(app.task_file_task('receipts/../x.pdf'), null, 'anything else resolves to no task');

-- ---- attaching ---------------------------------------------------------------------------------
select tests.authenticate_as('sara@pgtap.test');
select lives_ok(
  $$ select public.attach_task_files(
       (select id from pgtap_task),
       jsonb_build_array(
         jsonb_build_object('path', (select id::text from pgtap_task) || '/11111111-1111-4111-8111-111111111111.pdf', 'name', ' Host form.pdf '),
         jsonb_build_object('path', (select id::text from pgtap_task) || '/22222222-2222-4222-8222-222222222222.png', 'name', 'Scan.png')
       )) $$,
  'an assignee attaches two uploaded files'
);
select results_eq(
  $$ select name, size_bytes, mime, uploaded_by from public.task_files order by name $$,
  $$ values ('Host form.pdf', 1234::bigint, 'application/pdf', tests.user_id('sara@pgtap.test')),
            ('Scan.png', 99::bigint, 'image/png', tests.user_id('sara@pgtap.test')) $$,
  'the name is trimmed; size and type come from Storage'
);
select is(
  (select jsonb_build_object('kind', u.kind, 'files', u.meta -> 'files', 'linked', count(f.id))
     from public.task_updates u join public.task_files f on f.update_id = u.id
     where u.kind = 'files' group by u.id),
  '{"kind": "files", "files": 2, "linked": 2}'::jsonb,
  'the batch is one timeline row'
);
select throws_ok(
  $$ select public.attach_task_files(
       (select id from pgtap_task),
       jsonb_build_array(jsonb_build_object(
         'path', (select id::text from pgtap_task) || '/11111111-1111-4111-8111-111111111111.pdf', 'name', 'Again.pdf'))) $$,
  '22023', null, 'a file is linked once'
);
select throws_ok(
  $$ select public.attach_task_files(
       (select id from pgtap_task),
       jsonb_build_array(jsonb_build_object(
         'path', (select id::text from pgtap_task) || '/44444444-4444-4444-8444-444444444444.pdf', 'name', 'Ghost.pdf'))) $$,
  '22023', null, 'a path that was never uploaded is refused'
);
select throws_ok(
  $$ select public.attach_task_files((select id from pgtap_task), '[]'::jsonb) $$,
  '22023', null, 'an empty batch is refused'
);
select throws_ok(
  $$ insert into public.task_files (task_id, update_id, path, name)
     select t.id, u.id, t.id::text || '/x.pdf', 'x' from pgtap_task t, public.task_updates u limit 1 $$,
  '42501', null, 'rows are written by the function only'
);

select tests.clear_auth();
select is(
  (select jsonb_build_object('kind', kind, 'count', payload -> 'count', 'name', payload ->> 'name')
     from public.notifications where profile_id = tests.user_id('leo@pgtap.test')),
  '{"kind": "task_files", "count": 2, "name": "Host form.pdf"}'::jsonb,
  'files on their own notify the others on the task'
);

-- ---- with a comment --------------------------------------------------------------------------
delete from public.notifications;
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ select public.attach_task_files(
       (select id from pgtap_task),
       jsonb_build_array(jsonb_build_object(
         'path', (select id::text from pgtap_task) || '/33333333-3333-4333-8333-333333333333.docx', 'name', 'Template.docx')),
       ' Use this template. ') $$,
  'a manager attaches a file with a comment'
);
select tests.clear_auth();
select results_eq(
  $$ select kind, payload ->> 'excerpt' from public.notifications
     where profile_id = tests.user_id('sara@pgtap.test') $$,
  $$ values ('task_comment', 'Use this template.') $$,
  '...which notifies once, as the comment'
);

-- ---- strangers -------------------------------------------------------------------------------
select tests.authenticate_as('lore@pgtap.test');
select is((select count(*)::int from public.task_files), 0, 'another committee''s officer sees no files');
select throws_ok(
  $$ select public.attach_task_files(
       (select id from pgtap_task),
       jsonb_build_array(jsonb_build_object(
         'path', (select id::text from pgtap_task) || '/22222222-2222-4222-8222-222222222222.png', 'name', 'Mine.png'))) $$,
  '42501', null, '...and cannot attach any'
);

-- ---- removing --------------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
delete from public.task_files where name = 'Template.docx';
select is((select count(*)::int from public.task_files), 3, 'an assignee cannot remove someone else''s file');
delete from public.task_files where name = 'Scan.png';
select is((select count(*)::int from public.task_files), 2, '...but removes their own');
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
delete from public.task_files where name = 'Host form.pdf';
select is((select count(*)::int from public.task_files), 1, 'a manager removes any file on the task');

select tests.clear_auth();
select * from finish();
rollback;
