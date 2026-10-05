-- The Executive Board on the roster, and where access comes from. A row with no committee may
-- say that somebody holds a board position or is an assistant to one. Saying so gives the
-- row's (personal) email nothing for a board or an officer's position: access to the board's
-- and the officers' pages is given by an invite to the position's work email and nothing
-- else. An assistant's position, like every position below officer, still reaches the account.
begin;
select plan(19);

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
select tests.create_user('vera.personal@pgtap.test', 'Vera Vice');
select tests.create_user('vpi.work@pgtap.test', 'AUSSS VPI');
select tests.create_user('aide@pgtap.test', 'Adam Aide');
select tests.create_user('pat.personal@pgtap.test', 'Pat Personal');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('lora@pgtap.test', 'scora.lora');
select tests.work_email('vpi.work@pgtap.test', 'eb.vp-internal');

create temporary table pgtap_ids on commit drop as
select (select id from public.positions where key = 'eb.vp-internal') as vpi,
       (select id from public.positions where key = 'eb.president-assistant') as aide,
       (select id from public.positions where key = 'society.webmaster') as webmaster,
       (select id from public.positions where key = 'scora.lora') as lora,
       (select id from public.positions where key = 'scora.member') as scora_member,
       (select id from public.committees where slug = 'scora') as scora;
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
  $$ insert into public.roster_entries (source_key, full_name, name_normalized, email, status, committee_id, position_id)
     values ('b1', 'Vera Vice', '', 'vera.personal@pgtap.test', 'Full Member', null, (select vpi from pgtap_ids)),
            ('b2', 'Adam Aide', '', 'aide@pgtap.test', 'Full Member', null, (select aide from pgtap_ids)),
            ('b3', 'Nour Not Yet', '', 'nour@pgtap.test', 'Full Member', null, (select vpi from pgtap_ids)),
            ('b4', 'Wael Web', '', 'web@pgtap.test', 'Full Member', null, (select webmaster from pgtap_ids)),
            ('b5', 'Mona Misfiled', '', 'mona@pgtap.test', 'Full Member', null, (select scora_member from pgtap_ids)),
            ('b6', 'Pat Personal', '', 'pat.personal@pgtap.test', 'Full Member', (select scora from pgtap_ids), (select lora from pgtap_ids)) $$,
  'the Executive Board records who holds what'
);
select tests.clear_auth();
select results_eq(
  $$ select r.source_key, p.key
     from public.roster_entries r left join public.positions p on p.id = r.position_id
     where r.source_key like 'b%' order by r.source_key $$,
  $$ values ('b1', 'eb.vp-internal'), ('b2', 'eb.president-assistant'), ('b3', 'eb.vp-internal'),
            ('b4', null::text), ('b5', null::text), ('b6', 'scora.lora') $$,
  'the roster keeps a board position, a board assistant''s and an officer''s; not the webmaster''s, not a committee''s without the committee'
);

-- ---- a personal email gets nothing for a board or an officer's position ------------------------
select results_eq(
  $$ select pr.full_name, p.key, a.status
     from public.assignments a
     join public.positions p on p.id = a.position_id
     join public.profiles pr on pr.id = a.profile_id
     where pr.email_normalized in ('vera.personal@pgtap.test', 'aide@pgtap.test', 'pat.personal@pgtap.test')
     order by pr.full_name $$,
  $$ values ('Adam Aide', 'eb.president-assistant', 'active') $$,
  'only the assistant''s position reached an account'
);
select is(
  (select count(*)::int from public.invites i join public.positions p on p.id = i.position_id
    where p.level in ('officer', 'eb', 'webmaster')
      and i.email_normalized in ('vera.personal@pgtap.test', 'nour@pgtap.test', 'pat.personal@pgtap.test')),
  0, 'and no offer of a board or an officer''s position waits for a roster email'
);
select tests.authenticate_as('vera.personal@pgtap.test');
select is(app.is_eb(), false, 'the Vice President''s personal account has none of the board''s access');
select tests.clear_auth();
select tests.authenticate_as('pat.personal@pgtap.test');
select is(app.is_officer_of((select scora from pgtap_ids)), false, 'the officer''s personal account is not an officer in the portal');
select tests.clear_auth();
select tests.authenticate_as('aide@pgtap.test');
select is(app.is_eb(), false, 'an assistant to the board is not the board');
select tests.clear_auth();

-- ---- access is an invite to the work email -----------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
select throws_ok(
  $$ select public.invite_to_position('vera.personal@pgtap.test', (select vpi from pgtap_ids)) $$,
  '22023', null, 'the board cannot invite the Vice President''s personal email to the position'
);
select is(
  public.invite_to_position('vpi.work@pgtap.test', (select vpi from pgtap_ids)),
  'assigned', '...only the position''s work email'
);
select is(
  public.assign_roster_member((select id from public.roster_entries where source_key = 'b6'), (select lora from pgtap_ids)),
  'recorded', 'setting an officer''s position on a member is recorded, not given'
);
select tests.clear_auth();
select tests.authenticate_as('vpi.work@pgtap.test');
select is(app.is_eb(), true, 'the work account has the board''s access');
select tests.clear_auth();

-- ---- the roster does not take it away either --------------------------------------------------
select tests.authenticate_as('eb@pgtap.test');
update public.roster_entries set position_id = null where source_key = 'b1';
select tests.clear_auth();
select is(
  (select a.status from public.assignments a
    where a.profile_id = tests.user_id('vpi.work@pgtap.test') and a.position_id = (select vpi from pgtap_ids)),
  'active', 'clearing the position on the roster leaves the work account as it was'
);
select tests.authenticate_as('eb@pgtap.test');
update public.roster_entries set position_id = (select vpi from pgtap_ids), email = 'vpi.work@pgtap.test' where source_key = 'b1';
select lives_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a
        where a.profile_id = tests.user_id('vpi.work@pgtap.test') and a.position_id = (select vpi from pgtap_ids))) $$,
  'a board position is removed from the invites screen even when a roster row names the same email'
);
select tests.clear_auth();

-- ---- the position text never moves such a row -------------------------------------------------
update public.roster_entries set current_position = 'VPI' || chr(10) || 'SCORA GA' where source_key = 'b3';
select is(
  (select jsonb_build_object('committee', r.committee_id is not null, 'position', p.key)
     from public.roster_entries r left join public.positions p on p.id = r.position_id where r.source_key = 'b3'),
  '{"committee": false, "position": "eb.vp-internal"}'::jsonb,
  'text that names a committee does not pull a board member into it'
);
update public.roster_entries set current_position = 'SCORA GA' where source_key = 'b5';
select is(
  (select c.slug from public.roster_entries r join public.committees c on c.id = r.committee_id where r.source_key = 'b5'),
  'scora', '...while a row with no position is still placed by its text'
);

-- ---- nobody but the board -------------------------------------------------------------------
select tests.authenticate_as('lora@pgtap.test');
select throws_ok(
  $$ insert into public.roster_entries (source_key, full_name, name_normalized, email, position_id)
     values ('b9', 'Self Made', '', 'lora@pgtap.test', (select vpi from pgtap_ids)) $$,
  '42501', null, 'an officer cannot write the roster'
);
select throws_ok(
  $$ select public.invite_to_position('friend@pgtap.test', (select lora from pgtap_ids)) $$,
  '42501', null, '...nor invite anyone to an officer''s position'
);
select throws_ok(
  $$ select public.remove_position(
       (select a.id from public.assignments a where a.profile_id = tests.user_id('aide@pgtap.test'))) $$,
  '42501', null, '...nor remove a board assistant'
);

select tests.clear_auth();
select * from finish();
rollback;
