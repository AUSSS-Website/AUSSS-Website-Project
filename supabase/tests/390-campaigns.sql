-- Campaigns: whoever may hand out tasks in a committee opens one, and makes subtasks inside it.
-- A subtask sits in its campaign's committee and never changes campaign. A person sees the
-- campaigns they are in and only the subtasks they are on; the campaign's manager sees and
-- manages every subtask. Notes on a campaign reach everybody in it; the line about a person in
-- a subtask is its manager's to write. Deleting a campaign takes its subtasks, its notes and
-- their notifications along.
begin;
select plan(37);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level, can_assign_tasks)
values ('eb.president', null, 'President', 'President', 'eb', false),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer', false),
       ('scope.assistant', (select id from public.committees where slug = 'scope'), 'SCOPE Assistant', 'Assistant', 'assistant', true),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'SCOPE Member', 'Member', 'member', false),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer', false)
on conflict do nothing;
update public.positions set can_assign_tasks = true where key = 'scope.assistant';

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('helper@pgtap.test', 'Scope Assistant');
select tests.create_user('sara@pgtap.test', 'Scope Member');
select tests.create_user('omar@pgtap.test', 'Scope Second');
select tests.create_user('lora@pgtap.test', 'Scora Officer');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('helper@pgtap.test', 'scope.assistant');
select tests.assign('sara@pgtap.test', 'scope.member');
select tests.assign('omar@pgtap.test', 'scope.member');
select tests.assign('lora@pgtap.test', 'scora.lora');

-- ---- opening a campaign -----------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ insert into public.campaigns (committee_id, title, starts_on, ends_on)
     values ((select id from public.committees where slug = 'scope'), '  Exchange week ', '2026-11-20', '2026-11-27') $$,
  'an officer opens a campaign for their committee'
);
select is(
  (select jsonb_build_object('title', title, 'by', created_by, 'term', term_id, 'status', status) from public.campaigns),
  jsonb_build_object('title', 'Exchange week', 'by', tests.user_id('leo@pgtap.test'), 'term', app.current_term_id(), 'status', 'planning'),
  'the title is trimmed, the creator and the term are stamped, and it opens as planning'
);
select throws_ok(
  $$ insert into public.campaigns (committee_id, title)
     values ((select id from public.committees where slug = 'scora'), 'Not mine') $$,
  '42501', null, 'an officer cannot open a campaign in another committee'
);
select throws_ok(
  $$ insert into public.campaigns (committee_id, title) values (null, 'Society wide') $$,
  '42501', null, 'society-wide campaigns are for the EB'
);
select throws_ok(
  $$ update public.campaigns set ends_on = '2026-11-01' $$,
  '23514', null, 'a campaign cannot end before it starts'
);

-- ---- the concept note --------------------------------------------------------------------------
select lives_ok(
  $$ update public.campaigns
     set concept_note_path = id::text || '/11111111-1111-4111-8111-111111111111.pdf', concept_note_name = 'Concept note.pdf' $$,
  'the officer points the campaign at its concept note'
);
select throws_ok(
  $$ update public.campaigns
     set concept_note_path = gen_random_uuid()::text || '/11111111-1111-4111-8111-111111111111.pdf' $$,
  '23514', null, 'the concept note sits in the campaign''s own folder'
);
select is(
  (select app.campaign_file_campaign(concept_note_path) = id from public.campaigns),
  true, 'a well-formed storage key resolves to its campaign'
);
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
select throws_ok(
  $$ insert into public.campaigns (committee_id, title)
     values ((select id from public.committees where slug = 'scope'), 'Mine') $$,
  '42501', null, 'a member cannot open a campaign'
);

-- ---- subtasks ---------------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ insert into public.tasks (campaign_id, committee_id, title)
     select c.id, (select id from public.committees where slug = 'scora'), t.title
     from public.campaigns c, (values ('Media SWG'), ('Logistics SWG')) as t (title) $$,
  'the officer adds two subtasks to the campaign'
);
select is(
  (select count(*)::int from public.tasks
    where committee_id = (select id from public.committees where slug = 'scope')
      and campaign_id = (select id from public.campaigns)),
  2, 'a subtask sits in its campaign''s committee, whatever the request said'
);
select throws_ok(
  $$ insert into public.tasks (campaign_id, title) values (gen_random_uuid(), 'Nowhere') $$,
  '22023', null, 'a subtask needs a campaign that exists'
);
select lives_ok(
  $$ insert into public.task_assignees (task_id, profile_id, note)
     select id, tests.user_id('sara@pgtap.test'), 'Coordinator' from public.tasks where title = 'Media SWG' $$,
  'the officer puts a member on one subtask, with a line about them'
);
insert into public.task_assignees (task_id, profile_id)
select id, tests.user_id('omar@pgtap.test') from public.tasks where title = 'Logistics SWG';
select lives_ok(
  $$ update public.task_assignees set note = 'Books the hall' where profile_id = tests.user_id('omar@pgtap.test') $$,
  'the officer changes the line about a person'
);
select throws_ok(
  $$ update public.task_assignees set profile_id = tests.user_id('helper@pgtap.test') $$,
  '42501', null, '...and nothing else of that row'
);

-- ---- who sees what ----------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
select is((select count(*)::int from public.campaigns), 1, 'a person on a subtask sees the campaign');
select results_eq(
  $$ select title from public.tasks $$,
  $$ values ('Media SWG') $$,
  '...and only the subtask they are on'
);
update public.task_assignees set note = 'Boss';
select is(
  (select note from public.task_assignees where profile_id = tests.user_id('sara@pgtap.test')),
  'Coordinator', 'the line about a person is not theirs to rewrite'
);
update public.campaigns set title = 'Hijacked', status = 'done';
delete from public.campaigns;
select is(
  (select jsonb_build_object('title', title, 'status', status) from public.campaigns),
  '{"title": "Exchange week", "status": "planning"}'::jsonb,
  'a person on a subtask neither edits nor deletes the campaign'
);
select throws_ok(
  $$ insert into public.tasks (campaign_id, title) select id, 'My own SWG' from public.campaigns $$,
  '42501', null, '...and adds no subtask to it'
);

select tests.clear_auth();
select tests.authenticate_as('lora@pgtap.test');
select is((select count(*)::int from public.campaigns), 0, 'another committee''s officer does not see the campaign');
select is((select count(*)::int from public.campaign_notes), 0, '...nor its notes');

select tests.clear_auth();
select tests.authenticate_as('helper@pgtap.test');
select is((select count(*)::int from public.campaigns), 1, 'whoever may hand out tasks there sees the campaign');
select is((select count(*)::int from public.tasks), 0, '...but not the subtasks of others');

-- ---- a campaign's creator manages every subtask in it -----------------------------------------
select lives_ok(
  $$ insert into public.campaigns (committee_id, title)
     values ((select id from public.committees where slug = 'scope'), 'Welcome day') $$,
  'an assistant whose position may hand out tasks opens a campaign'
);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
insert into public.tasks (campaign_id, title)
select id, 'Badges' from public.campaigns where title = 'Welcome day';
select tests.clear_auth();
select tests.authenticate_as('helper@pgtap.test');
update public.tasks set title = 'Name badges', campaign_id = (select id from public.campaigns where title = 'Exchange week')
 where title = 'Badges';
select is(
  (select c.title from public.tasks t join public.campaigns c on c.id = t.campaign_id where t.title = 'Name badges'),
  'Welcome day',
  'the campaign''s creator edits a subtask somebody else made; a subtask never changes campaign'
);

-- ---- notes on a campaign ----------------------------------------------------------------------
select tests.clear_auth();
delete from public.notifications;
select tests.authenticate_as('sara@pgtap.test');
select lives_ok(
  $$ insert into public.campaign_notes (campaign_id, body)
     select id, '  The hall is free on Thursday. ' from public.campaigns $$,
  'a person on a subtask leaves a note on the campaign'
);
select is(
  (select jsonb_build_object('body', body, 'by', author_id) from public.campaign_notes),
  jsonb_build_object('body', 'The hall is free on Thursday.', 'by', tests.user_id('sara@pgtap.test')),
  'the note is trimmed and its author stamped'
);
select throws_ok(
  $$ insert into public.campaign_notes (campaign_id, body) select id, '   ' from public.campaigns $$,
  '22023', null, 'an empty note is refused'
);
select tests.clear_auth();
select results_eq(
  $$ select p.full_name, n.payload ->> 'excerpt'
     from public.notifications n join public.profiles p on p.id = n.profile_id
     where n.kind = 'campaign_note' order by 1 $$,
  $$ values ('Scope Officer', 'The hall is free on Thursday.'), ('Scope Second', 'The hall is free on Thursday.') $$,
  'the creator and the people on the other subtasks are notified, the author is not'
);

create temporary table pgtap_campaign on commit drop as
select id from public.campaigns where title = 'Exchange week';
grant select on pgtap_campaign to authenticated;

select tests.authenticate_as('lora@pgtap.test');
select throws_ok(
  $$ insert into public.campaign_notes (campaign_id, body) select id, 'Hello' from pgtap_campaign $$,
  '42501', null, 'no notes on a campaign you cannot see'
);
select tests.clear_auth();
select tests.authenticate_as('omar@pgtap.test');
select is((select count(*)::int from public.campaign_notes), 1, 'everybody in the campaign reads its notes');
delete from public.campaign_notes;
select is((select count(*)::int from public.campaign_notes), 1, '...and cannot remove somebody else''s');
select tests.clear_auth();
select tests.authenticate_as('sara@pgtap.test');
insert into public.campaign_notes (campaign_id, body) select id, 'Scrap that.' from pgtap_campaign;
delete from public.campaign_notes where body = 'Scrap that.';
select is((select count(*)::int from public.campaign_notes), 1, 'the author removes their own note');

-- ---- deleting a campaign ----------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ delete from public.campaigns where id = (select id from pgtap_campaign) $$,
  'the officer deletes the campaign'
);
select tests.clear_auth();
select is(
  (select jsonb_build_object(
     'subtasks', (select count(*) from public.tasks where title like '% SWG'),
     'notes', (select count(*) from public.campaign_notes),
     'notifications', (select count(*) from public.notifications where payload ? 'campaign_id'))),
  '{"subtasks": 0, "notes": 0, "notifications": 0}'::jsonb,
  'its subtasks, its notes and the notifications about them go with it'
);
select is(
  (select count(*)::int from public.tasks where title = 'Name badges'),
  1, 'the other campaign keeps its subtask'
);

select * from finish();
rollback;
