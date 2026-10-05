-- The Executive Board on the roster. A row with no committee may carry a board position or a
-- board assistant's; it reaches the account like any roster position; nothing else society-level
-- can ride on a row, the position text never moves such a row into a committee, and only the
-- board writes any of it.
begin;
select plan(13);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('society.webmaster', null, 'Webmaster', 'Webmaster', 'webmaster'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('lora@pgtap.test', 'Scora Officer');
select tests.create_user('vpi@pgtap.test', 'Vera Vice');
select tests.create_user('aide@pgtap.test', 'Adam Aide');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('lora@pgtap.test', 'scora.lora');

create temporary table pgtap_ids on commit drop as
select (select id from public.positions where key = 'eb.vp-internal') as vpi,
       (select id from public.positions where key = 'eb.president-assistant') as aide,
       (select id from public.positions where key = 'society.webmaster') as webmaster,
       (select id from public.positions where key = 'scora.member') as scora_member;
grant select on pgtap_ids to authenticated;

select is(
  (select count(*)::int from public.positions
    where committee_id is null and level = 'assistant' and key like 'eb.%-assistant'),
  4, 'each member of the board has an assistant position'
);

delete from public.roster_entries;

-- ---- the board puts its people on the roster -------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.roster_entries (source_key, full_name, name_normalized, email, status, position_id)
     values ('b1', 'Vera Vice', '', 'vpi@pgtap.test', 'Full Member', (select vpi from pgtap_ids)),
            ('b2', 'Adam Aide', '', 'aide@pgtap.test', 'Full Member', (select aide from pgtap_ids)),
            ('b3', 'Nour Not Yet', '', 'nour@pgtap.test', 'Full Member', (select vpi from pgtap_ids)),
            ('b4', 'Wael Web', '', 'web@pgtap.test', 'Full Member', (select webmaster from pgtap_ids)),
            ('b5', 'Mona Misfiled', '', 'mona@pgtap.test', 'Full Member', (select scora_member from pgtap_ids)) $$,
  'the Executive Board adds rows with no committee'
);
select tests.clear_auth();
select results_eq(
  $$ select r.source_key, p.key
     from public.roster_entries r left join public.positions p on p.id = r.position_id
     where r.source_key like 'b%' order by r.source_key $$,
  $$ values ('b1', 'eb.vp-internal'), ('b2', 'eb.president-assistant'), ('b3', 'eb.vp-internal'),
            ('b4', null::text), ('b5', null::text) $$,
  'a board position and a board assistant''s stay; the webmaster''s and a committee''s do not'
);

-- ---- it reaches the account ------------------------------------------------------------------
select results_eq(
  $$ select pr.full_name, p.key, a.status
     from public.assignments a
     join public.positions p on p.id = a.position_id
     join public.profiles pr on pr.id = a.profile_id
     where pr.email_normalized in ('vpi@pgtap.test', 'aide@pgtap.test') order by pr.full_name $$,
  $$ values ('Adam Aide', 'eb.president-assistant', 'active'), ('Vera Vice', 'eb.vp-internal', 'active') $$,
  'the people with accounts hold their positions at once'
);
select is(
  (select p.key from public.invites i join public.positions p on p.id = i.position_id
    where i.email_normalized = 'nour@pgtap.test' and i.accepted_at is null),
  'eb.vp-internal', 'the one who has not signed in yet is offered hers'
);
select tests.authenticate_as('vpi@pgtap.test');
select is(app.is_eb(), true, 'a board position from the roster gives the board''s access');
select tests.clear_auth();
select tests.authenticate_as('aide@pgtap.test');
select is(app.is_eb(), false, 'an assistant to the board is not the board');
select tests.clear_auth();

-- ---- the position text never moves such a row -------------------------------------------------
update public.roster_entries set current_position = 'VPI' || chr(10) || 'SCORA GA' where source_key = 'b1';
select is(
  (select jsonb_build_object('committee', r.committee_id is not null, 'position', p.key)
     from public.roster_entries r left join public.positions p on p.id = r.position_id where r.source_key = 'b1'),
  '{"committee": false, "position": "eb.vp-internal"}'::jsonb,
  'text that names a committee does not pull a board member into it'
);
update public.roster_entries set current_position = 'SCORA GA' where source_key = 'b5';
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'b5'),
  'scora', '...while a row with no position is still placed by its text'
);

-- ---- taking someone off the board ------------------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
update public.roster_entries set position_id = null where source_key = 'b1';
select tests.clear_auth();
select is(
  (select a.status from public.assignments a join public.positions p on p.id = a.position_id
    where a.profile_id = tests.user_id('vpi@pgtap.test') and p.key = 'eb.vp-internal'),
  'ended', 'clearing the position on the roster ends it on the account'
);

-- ---- nobody but the board -------------------------------------------------------------------
select tests.authenticate_as('lora@pgtap.test');
select throws_ok(
  $$ insert into public.roster_entries (source_key, full_name, name_normalized, email, position_id)
     values ('b9', 'Self Made', '', 'lora@pgtap.test', (select vpi from pgtap_ids)) $$,
  '42501', null, 'an officer cannot write the roster, let alone a board position'
);
select throws_ok(
  $$ select public.assign_roster_member(
       (select id from public.roster_entries where source_key = 'b2'), (select vpi from pgtap_ids)) $$,
  '42501', null, '...nor hand one out through their committee'
);
select throws_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a where a.profile_id = tests.user_id('aide@pgtap.test'))) $$,
  '42501', null, '...nor remove a board assistant'
);

select tests.clear_auth();
select * from finish();
rollback;
