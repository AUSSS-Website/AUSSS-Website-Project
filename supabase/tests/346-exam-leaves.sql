-- The exam counts how many times a taker left the page. The phone sends its whole count and the
-- database keeps the larger number, so a request sent twice counts once and the number never
-- goes down. Only a running paper counts. The officers read the count off the paper; a taker can
-- read nobody's, and nobody without a paper can send one.
begin;
select plan(14);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer')
on conflict do nothing;

select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.create_user('amal@pgtap.test', 'Amal From Google');
select tests.create_user('basel@pgtap.test', 'Basel From Google');
select tests.create_user('carim@pgtap.test', 'Carim From Google');

delete from public.exams;

create temporary table pgtap_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on pgtap_ids to authenticated;

select tests.authenticate_as('leo@pgtap.test');
insert into public.exams (title, address_word, opens_at, closes_at, minutes, start_code, status)
values ('Leaves exam', 'leaves-exam', now() - interval '5 minutes', now() + interval '2 hours', 60, 'GO', 'ready');
insert into pgtap_ids select 'exam', id from public.exams where address_word = 'leaves-exam';
select public.save_exam_question((select id from pgtap_ids where name = 'exam'), null, 'Q1', '["A", "B"]'::jsonb, 0, true);
select public.exam_add_registrations((select id from pgtap_ids where name = 'exam'), array['2001', '2002']);
select tests.clear_auth();

-- ---- a running paper ---------------------------------------------------------------------------------
select tests.authenticate_as('amal@pgtap.test');
select public.exam_save_details('leaves-exam', 'amal taker', 'Year 3', '01000000001', '2001');
select throws_ok(
  $$ select public.exam_left('leaves-exam', 1) $$,
  '22023', 'You have not started this exam.',
  'nobody leaves a paper they have not started'
);
select is(public.exam_start('leaves-exam', 'GO') ->> 'ok', 'true', 'Amal starts');
select is(public.exam_left('leaves-exam', 0), '{"left": 0}'::jsonb, 'a paper starts at none');
select is(public.exam_left('leaves-exam', 1), '{"left": 1}'::jsonb, 'the first time is counted');
select is(public.exam_left('leaves-exam', 1), '{"left": 1}'::jsonb, 'the same count sent again counts once');
select is(public.exam_left('leaves-exam', 3), '{"left": 3}'::jsonb, 'a phone that was offline for two more sends its whole count');
select is(public.exam_left('leaves-exam', 1), '{"left": 3}'::jsonb, 'a phone that lost its count cannot bring the number down');
select is(public.exam_left('leaves-exam', -5), '{"left": 3}'::jsonb, 'nor can a number below nought');
select is(public.exam_left('leaves-exam', null), '{"left": 3}'::jsonb, 'nor no number at all');
select is(
  (select count(*) from public.exam_attempts),
  0::bigint,
  'a taker reads no paper''s count, not even their own'
);
select throws_ok(
  $$ select public.exam_left('no-such-exam', 1) $$,
  '22023', 'There is no exam at this address.',
  'an address with no exam is refused'
);

-- ---- after the hand-in -------------------------------------------------------------------------------
select public.exam_save('leaves-exam', '[]'::jsonb, true);
select is(public.exam_left('leaves-exam', 9), '{"left": 3}'::jsonb, 'a paper that is handed in counts no more');
select tests.clear_auth();

-- ---- who else ----------------------------------------------------------------------------------------
select tests.authenticate_as('carim@pgtap.test');
select throws_ok(
  $$ select public.exam_left('leaves-exam', 1) $$,
  '22023', 'You have not started this exam.',
  'an account with no paper cannot send a count'
);
select tests.clear_auth();

select tests.authenticate_as('leo@pgtap.test');
select is(
  (select times_left || ' ' || (last_left_at is not null) from public.exam_attempts where student_id = '2001'),
  '3 true',
  'the officers read the count and when it last went up'
);
select tests.clear_auth();

select * from finish();
rollback;
