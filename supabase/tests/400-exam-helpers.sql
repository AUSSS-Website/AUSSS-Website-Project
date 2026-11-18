-- Helpers for an exam's registered list. The exam officers name a helper by the address their
-- account signs in with. A helper adds IDs to that exam's list, reads it, frees an ID and takes
-- one off, as an officer does, and reaches nothing else: no other exam's list, no exam table,
-- not who else helps. Someone who was never named reaches nothing. The helpers go with the list
-- when the term ends.
begin;
select plan(30);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer')
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.create_user('hana@pgtap.test', 'Hana Helper');
select tests.create_user('omar@pgtap.test', 'Omar Onlooker');
select tests.create_user('amal@pgtap.test', 'Amal From Google');

delete from public.exams;

create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

-- ---- the officers name a helper -----------------------------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Helped exam', 'helped-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready'),
       ('Other exam', 'other-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'helped', id from public.exams where address_word = 'helped-exam';
insert into pgtap_ids select 'other', id from public.exams where address_word = 'other-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'helped'), null, 'S1', '["A", "B"]'::jsonb, 0, true, null);
select public.exam_add_registrations((select id from pgtap_ids where name = 'helped'), array['6001', '6002']);
select public.exam_add_registrations((select id from pgtap_ids where name = 'other'), array['7001']);
insert into pgtap_ids select 'other-reg', id from public.exam_registrations where student_id = '7001';

select throws_ok(
  $$ select public.exam_add_helper((select id from pgtap_ids where name = 'helped'), 'nobody@pgtap.test') $$,
  '22023', 'No account on the website uses that address. Ask them to sign in to the portal once, then add them.',
  'an address no account uses names nobody'
);
select throws_ok(
  $$ select public.exam_add_helper((select id from pgtap_ids where name = 'helped'), '   ') $$,
  '22023', 'Type the address the helper signs in with.',
  'and an empty one is asked for'
);
select is(
  public.exam_add_helper((select id from pgtap_ids where name = 'helped'), '  HANA@pgtap.test ') ->> 'added',
  'true',
  'an officer names a helper by their address, however it is typed'
);
select is(
  public.exam_add_helper((select id from pgtap_ids where name = 'helped'), 'hana@pgtap.test') ->> 'added',
  'false',
  'naming them again changes nothing'
);
select is(
  (select string_agg(h ->> 'email', ' | ' order by t.ord)
   from jsonb_array_elements(public.exam_helper_list((select id from pgtap_ids where name = 'helped'))) with ordinality as t(h, ord)),
  'hana@pgtap.test',
  'the officers read who helps with the exam'
);
select tests.clear_auth();

-- ---- someone who was not named ---------------------------------------------------------------------------
select tests.authenticate_as('omar@pgtap.test');
select throws_ok(
  $$ select public.exam_add_helper((select id from pgtap_ids where name = 'helped'), 'omar@pgtap.test') $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'an account with no part in the exam cannot name itself'
);
select throws_ok(
  $$ select public.exam_registration_list((select id from pgtap_ids where name = 'helped')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor read the list'
);
select is(public.exam_helper_exams(), '[]'::jsonb, 'and helps with no exam');
select throws_ok(
  $$ select public.exam_remove_registration(gen_random_uuid()) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor is told anything about an ID that is nowhere'
);
select tests.clear_auth();

-- ---- what a helper reaches ---------------------------------------------------------------------------------
select tests.authenticate_as('hana@pgtap.test');
select is(
  (select string_agg(e ->> 'title', ' | ') from jsonb_array_elements(public.exam_helper_exams()) as x(e)),
  'Helped exam',
  'a helper is told which exam they help with'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.exam_helper_exams() -> 0) as x(k)),
  array['closes_at', 'id', 'minutes', 'opens_at', 'registrations', 'started', 'status', 'term', 'title'],
  'and of it only what the list''s page shows: neither the word in its address nor its start code'
);
select is(
  public.exam_add_registrations((select id from pgtap_ids where name = 'helped'), array['6003', '6001']) ->> 'added',
  '1',
  'a helper puts IDs on the list'
);
select is(
  jsonb_array_length(public.exam_registration_list((select id from pgtap_ids where name = 'helped'))),
  3,
  'and reads it'
);
select throws_ok(
  $$ select public.exam_add_registrations((select id from pgtap_ids where name = 'other'), array['7002']) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'but adds nothing to the list of an exam they were not named for'
);
select throws_ok(
  $$ select public.exam_registration_list((select id from pgtap_ids where name = 'other')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor reads it'
);
select throws_ok(
  $$ select public.exam_release_registration((select id from pgtap_ids where name = 'other-reg')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor frees an ID on it'
);
select throws_ok(
  $$ select public.exam_remove_registration((select id from pgtap_ids where name = 'other-reg')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor takes one off it'
);
select lives_ok(
  $$ select public.exam_remove_registration(gen_random_uuid()) $$,
  'an ID that is gone already, as when two helpers remove it at once, is no error'
);
select is(
  (select count(*) from public.exams) + (select count(*) from public.exam_registrations)
    + (select count(*) from public.exam_questions) + (select count(*) from public.exam_helpers),
  0::bigint,
  'a helper reads no exam table: not the exam, its questions, the list''s rows or who helps'
);
select throws_ok(
  $$ select public.exam_helper_list((select id from pgtap_ids where name = 'helped')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'a helper cannot ask who else helps'
);
select throws_ok(
  $$ select public.exam_add_helper((select id from pgtap_ids where name = 'helped'), 'omar@pgtap.test') $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'nor name another helper'
);
select tests.clear_auth();

-- ---- a helper frees an ID and takes one off ------------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('helped-exam', 'amal taker', 'Year 3', '01000000001', '6002');
select tests.clear_auth();

select ok(
  (select profile_id = tests.user_id('amal@pgtap.test') from public.exam_registrations where student_id = '6002'),
  'a student holds an ID a helper added'
);

insert into pgtap_ids select 'reg-6002', id from public.exam_registrations where student_id = '6002';
insert into pgtap_ids select 'reg-6003', id from public.exam_registrations where student_id = '6003';
insert into pgtap_ids select 'reg-6001', id from public.exam_registrations where student_id = '6001';

select tests.authenticate_as('hana@pgtap.test');
select lives_ok(
  $$ select public.exam_release_registration((select id from pgtap_ids where name = 'reg-6002')) $$,
  'a helper frees an ID from the account that holds it'
);
select lives_ok(
  $$ select public.exam_remove_registration((select id from pgtap_ids where name = 'reg-6003')) $$,
  'and takes an ID off the list'
);
select tests.clear_auth();
select is(
  (select string_agg(r.student_id || ' ' || coalesce(r.profile_id::text, 'free'), ' | ' order by r.student_id)
   from public.exam_registrations r where r.exam_id = (select id from pgtap_ids where name = 'helped')),
  '6001 free | 6002 free',
  'the freed ID is free and the removed one is gone'
);

-- ---- the officers still do all of it, and take a helper off ---------------------------------------------------
select tests.authenticate_as('leo@pgtap.test');
select lives_ok(
  $$ select public.exam_remove_registration((select id from pgtap_ids where name = 'reg-6001')) $$,
  'an officer takes an ID off the list through the same function'
);
select lives_ok(
  $$ select public.exam_remove_helper((select id from pgtap_ids where name = 'helped'), tests.user_id('hana@pgtap.test')) $$,
  'an officer takes a helper off'
);
select tests.clear_auth();

select tests.authenticate_as('hana@pgtap.test');
select throws_ok(
  $$ select public.exam_registration_list((select id from pgtap_ids where name = 'helped')) $$,
  '42501', 'Only the exchange officers and the Executive Board can do this.',
  'who then reads the list no more'
);
select tests.clear_auth();

-- ---- the log, and the term's end --------------------------------------------------------------------------------
select is(
  (select string_agg(l.action, ' ' order by l.id) from public.audit_log l where l.table_name = 'exam_helpers'),
  'INSERT DELETE',
  'naming a helper and taking one off are both in the audit log'
);

select tests.authenticate_as('leo@pgtap.test');
select public.exam_add_helper((select id from pgtap_ids where name = 'helped'), 'hana@pgtap.test');
select tests.clear_auth();
select app.clear_exam_rows((select id from public.terms where is_current));
select is(
  (select count(*) from public.exam_helpers),
  0::bigint,
  'the helpers go with the list when the term ends'
);

select * from finish();
rollback;
