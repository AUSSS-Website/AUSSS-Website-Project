-- The public member lookup answers with what the roster says a member holds: the position set
-- on the roster first (under the name the society uses for it), then the other positions from
-- the text that do not repeat it, then the contact-person marker. A member with nothing is
-- still a general member.
begin;
select plan(10);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('score', 'Research Exchange', 'SCORE', 'standing'),
       ('scora', 'Sexual and Reproductive Health', 'SCORA', 'standing')
on conflict (slug) do nothing;
update public.committees set roster_group = 'exchange' where slug in ('scope', 'score');

insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.vp-internal', null, 'Vice President, Internal Affairs', 'VPI', 'eb'),
       ('scora.lora', (select id from public.committees where slug = 'scora'), 'Local Officer on SRHR', 'LORA', 'officer'),
       ('scora.ga', (select id from public.committees where slug = 'scora'), 'General Assistant', 'GA', 'assistant'),
       ('scora.core-team', (select id from public.committees where slug = 'scora'), 'Core Team Member', null, 'member'),
       ('scora.member', (select id from public.committees where slug = 'scora'), 'Local Member', null, 'member'),
       ('scope.incomings-assistant', (select id from public.committees where slug = 'scope'), 'Incomings Assistant', null, 'assistant')
on conflict do nothing;
-- the titles this file expects, whatever an earlier seed called them
update public.positions set title = 'General Assistant', short_title = 'GA' where key = 'scora.ga';
update public.positions set title = 'Core Team Member', short_title = null where key = 'scora.core-team';
update public.positions set title = 'Local Member', short_title = null where key = 'scora.member';
update public.positions set title = 'Incomings Assistant', short_title = null where key = 'scope.incomings-assistant';
update public.positions set short_title = 'LORA' where key = 'scora.lora';
update public.positions set title = 'Vice President, Internal Affairs', short_title = 'VPI' where key = 'eb.vp-internal';

delete from public.roster_entries;
insert into public.roster_entries (source_key, full_name, name_normalized, email, status, committee_id, position_id, current_position)
select v.key, v.name, '', v.email, 'Full Member',
       (select id from public.committees where slug = v.committee),
       (select id from public.positions where key = v.position),
       v.other
from (values
  ('l1', 'Core Member',     'core@pgtap.test',    'scora', 'scora.core-team',           'SCORA Core Team Member'),
  ('l2', 'The Officer',     'officer@pgtap.test', 'scora', 'scora.lora',                null),
  ('l3', 'Exchange Helper', 'helper@pgtap.test',  'scope', 'scope.incomings-assistant', 'Exchange Incomings Assistant' || chr(10) || 'National Exchange Team'),
  ('l4', 'Vice President',  'vp@pgtap.test',      null,    'eb.vp-internal',            'VPI'),
  ('l5', 'Only Contact',    'contact@pgtap.test', null,    null,                        'Exchange Contact Person'),
  ('l6', 'Assistant Too',   'both@pgtap.test',    'scora', 'scora.ga',                  'SCORA GA' || chr(13) || chr(10) || 'Exchange Contact Person'),
  ('l7', 'Plain Member',    'plain@pgtap.test',   null,    null,                        null),
  ('l8', 'Member Plus',     'plus@pgtap.test',    'scora', 'scora.member',              'LORA GA'),
  ('l9', 'Short Text',      'short@pgtap.test',   'scora', 'scora.core-team',           'SCORA Core Team')
) as v (key, name, email, committee, position, other);

create or replace function pg_temp.looked_up(p_email text) returns text
language sql as $$
  select public.check_membership('', p_email) -> 'record' ->> 'currentPosition'
$$;

select is(pg_temp.looked_up('core@pgtap.test'), 'SCORA Core Team Member',
  'a position the text also names is shown once');
select is(pg_temp.looked_up('short@pgtap.test'), 'SCORA Core Team Member',
  '...also when the text spells it shorter');
select is(pg_temp.looked_up('officer@pgtap.test'), 'LORA',
  'an officer set on the roster shows by the short name, with no text at all');
select is(pg_temp.looked_up('helper@pgtap.test'), 'SCOPE/SCORE Incomings Assistant' || chr(10) || 'National Exchange Team',
  'the exchange committees are one name, and only the other position is kept from the text');
select is(pg_temp.looked_up('vp@pgtap.test'), 'Vice President, Internal Affairs',
  'a board position set on the roster shows by its title');
select is(pg_temp.looked_up('contact@pgtap.test'), 'Exchange Contact Person',
  'a contact person with no committee is a contact person, once');
select is(pg_temp.looked_up('both@pgtap.test'), 'SCORA General Assistant' || chr(10) || 'Exchange Contact Person',
  'a committee position and the contact-person marker are both shown');
select is(pg_temp.looked_up('plus@pgtap.test'), 'SCORA Local Member' || chr(10) || 'LORA GA',
  'text that names something else is kept beside the roster position');
select is(pg_temp.looked_up('plain@pgtap.test'), '',
  'a member with nothing set has no position (the page shows General Member)');
select is(
  public.check_membership('', 'vp@pgtap.test') -> 'record' ?| array['email', 'full_name', 'name', 'committee_id'],
  false, 'the lookup still answers with nothing that identifies the person'
);

select tests.clear_auth();
select * from finish();
rollback;
