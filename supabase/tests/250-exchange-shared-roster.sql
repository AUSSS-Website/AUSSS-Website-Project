-- SCOPE and SCORE share one roster. Either committee's officers see the same members, hand out
-- the positions below officer, read each other's notes and give their own committee's tasks to
-- the same people. Nothing else is shared: an officer of one is not an officer of the other,
-- and a committee outside the group sees none of it.
begin;
select plan(16);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;
-- the group is data: set it here too, in case this database was seeded without it
update public.committees set roster_group = 'exchange' where slug in ('scope', 'score');
update public.committees set roster_group = null where slug = 'scora';

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('scope.incomings-assistant', (select id from public.committees where slug = 'scope'), 'Incomings Assistant', null, 'assistant'),
       ('scope.member', (select id from public.committees where slug = 'scope'), 'Local Member', null, 'member'),
       ('score.lore', (select id from public.committees where slug = 'score'), 'Local Officer on Research Exchange', 'LORE', 'officer'),
       ('score.member', (select id from public.committees where slug = 'score'), 'Local Member', null, 'member'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member')
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('lore@pgtap.test', 'Score Officer');
select tests.create_user('lora@pgtap.test', 'Scora Officer');
select tests.create_user('sara@pgtap.test', 'Sara Assistant');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('lore@pgtap.test', 'score.lore');
select tests.assign('lora@pgtap.test', 'scora.lora');

create temporary table pgtap_ids on commit drop as
select (select id from public.committees where slug = 'scope') as scope,
       (select id from public.committees where slug = 'score') as score,
       (select id from public.committees where slug = 'scora') as scora,
       (select id from public.positions where key = 'scope.incomings-assistant') as assistant,
       (select id from public.positions where key = 'scope.leo-out') as leo_out,
       (select id from public.positions where key = 'score.member') as score_member;
grant select on pgtap_ids to authenticated;

-- the shared members are filed under SCOPE: one with an account, one who never signed in
delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, committee_id, position_id)
values ('x1', 'Sara Assistant', '', 'sara@pgtap.test', 'Full Member', (select scope from pgtap_ids), (select assistant from pgtap_ids)),
       ('x2', 'Nour Not Yet', '', 'nour@pgtap.test', 'Full Member', (select scope from pgtap_ids), null);
create temporary table pgtap_rows on commit drop as
select source_key, id from public.roster_entries where source_key in ('x1', 'x2');
grant select on pgtap_rows to authenticated;

-- ---- the group ---------------------------------------------------------------------------------
select is(
  (select array_agg(c.slug order by c.slug) from public.committees c
    where c.id = any (app.roster_group_ids((select score from pgtap_ids)))),
  array['scope', 'score'], 'SCORE shares its roster with SCOPE'
);
select is(
  cardinality(app.roster_group_ids((select scora from pgtap_ids))), 1,
  'a committee outside the group stands alone'
);

-- ---- SCORE's officer and the members filed under SCOPE -----------------------------------------
select tests.authenticate_as('lore@pgtap.test');
select is(
  (select jsonb_agg(m ->> 'full_name' order by m ->> 'full_name')
     from jsonb_array_elements(public.committee_roster((select score from pgtap_ids))) m),
  '["Nour Not Yet", "Sara Assistant"]'::jsonb,
  'SCORE''s officer sees the members filed under SCOPE on their own committee''s list'
);
select is(
  public.assign_roster_member((select id from pgtap_rows where source_key = 'x2'), (select assistant from pgtap_ids)),
  'invited', '...and gives one of them a shared position'
);
select throws_ok(
  $$ select public.assign_roster_member((select id from pgtap_rows where source_key = 'x2'), (select leo_out from pgtap_ids)) $$,
  '42501', null, '...but not an officer''s position'
);
select lives_ok(
  $$ insert into public.member_notes (roster_entry_id, committee_id, body)
     values ((select id from pgtap_rows where source_key = 'x1'), (select scope from pgtap_ids), 'Reliable with incomings.') $$,
  'SCORE''s officer writes a note about a shared member'
);
select is(
  (select jsonb_agg(h ->> 'full_name' order by h ->> 'full_name')
     from jsonb_array_elements(public.committee_positions((select score from pgtap_ids)) -> 'holders') h),
  '["Sara Assistant", "Scope Officer", "Score Officer"]'::jsonb,
  'the position holders of both committees are one list'
);

-- ---- tasks: SCORE's task, a member filed under SCOPE --------------------------------------------
insert into public.tasks (committee_id, title) values ((select score from pgtap_ids), 'Match research incomings');
select lives_ok(
  $$ insert into public.task_assignees (task_id, profile_id)
     select id, tests.user_id('sara@pgtap.test') from public.tasks where title = 'Match research incomings' $$,
  'SCORE''s officer gives a SCORE task to a member filed under SCOPE'
);
select ok(
  exists (select 1 from public.task_assignable_people((select score from pgtap_ids)) p where p.full_name = 'Sara Assistant'),
  '...who is offered in the assignee list'
);

-- ---- what stays per committee -------------------------------------------------------------------
select is(app.is_officer_of((select scope from pgtap_ids)), false, 'SCORE''s officer is not an officer of SCOPE');
select throws_ok(
  $$ insert into public.tasks (committee_id, title) values ((select scope from pgtap_ids), 'Not mine to create') $$,
  '42501', null, '...and cannot create SCOPE''s tasks'
);

-- ---- SCOPE's officer sees the same -------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select is(
  (select count(*)::int from public.member_notes), 1, 'SCOPE''s officer reads the note SCORE''s officer wrote'
);
select is(
  public.assign_roster_member((select id from pgtap_rows where source_key = 'x2'), (select score_member from pgtap_ids)),
  'invited', 'SCOPE''s officer hands out a position that belongs to SCORE'
);
select tests.clear_auth();
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'x2'),
  'score', '...and the member is refiled under the committee the position belongs to'
);

-- ---- a committee outside the group --------------------------------------------------------------
select tests.authenticate_as('lora@pgtap.test');
select throws_ok(
  $$ select public.committee_roster((select scope from pgtap_ids)) $$,
  '42501', null, 'another committee''s officer does not see the exchange members'
);
insert into public.tasks (committee_id, title) values ((select scora from pgtap_ids), 'SCORA only');
select throws_ok(
  $$ insert into public.task_assignees (task_id, profile_id)
     select id, tests.user_id('sara@pgtap.test') from public.tasks where title = 'SCORA only' $$,
  '22023', null, '...and cannot give them SCORA''s tasks'
);

select tests.clear_auth();
select * from finish();
rollback;
