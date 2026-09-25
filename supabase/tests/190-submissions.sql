-- Public forms on Supabase: sign-ups, stories and orders arrive only through the three anon
-- RPCs (validated, deduped, capped, priced by the database), the EB reads all three, the
-- exchange officers read stories, other officers and members read nothing, and the receipt
-- bucket accepts one file per fresh order.
begin;
select plan(33);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('scope', 'Professional Exchange', 'SCOPE', 'standing'),
       ('pnsd', 'Publications Support Division', 'PNSD', 'division')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('scope.leo-out', (select id from public.committees where slug = 'scope'), 'Local Exchange Officer (LEO-Out)', 'LEO-Out', 'officer'),
       ('pnsd.director', (select id from public.committees where slug = 'pnsd'), 'PNSD Director', 'PNSD', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('leo@pgtap.test', 'Scope Officer');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('leo@pgtap.test', 'scope.leo-out');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');

delete from public.signups;
delete from public.stories;
delete from public.orders;
delete from public.notifications;
insert into public.merch_products (id, name, price) values ('tshirt-55', 'Tee', 300), ('notebook', 'Notebook', 40)
on conflict (id) do update set price = excluded.price;

-- ---- sign-ups --------------------------------------------------------------------------------
select tests.authenticate_as_anon();
select is(
  public.submit_signup('  Someone@Example.com ', ' Some One ', 'waitlist') ->> 'ok',
  'true',
  'a visitor joins the waitlist'
);
select is(
  public.submit_signup('someone@example.com', '', 'waitlist') ->> 'duplicate',
  'true',
  'the same email again within a day is a quiet duplicate'
);
select throws_ok(
  $$ select public.submit_signup('not-an-email', 'x', 'waitlist') $$,
  '22023', 'Please enter a valid email address.',
  'a bad email is refused with the site''s message'
);
select is(
  public.submit_signup('bot@example.com', 'Bot', 'waitlist', '', 'http://spam') ->> 'ok',
  'true',
  'the honeypot pretends to work'
);
select throws_ok(
  $$ select count(*) from public.signups $$,
  '42501', null,
  'anon cannot read the sign-ups'
);

-- ---- stories ---------------------------------------------------------------------------------
select is(
  public.submit_story('story-abc123', ' Sara ', 'sara@example.com', '01000000000', ' A great exchange. ', 'Spain', 'SCOPE', '2025') ->> 'ref',
  'STORY-ABC123',
  'a story keeps the client reference (upper-cased)'
);
select alike(
  public.submit_story('bad ref', 'Sara', 'sara2@example.com', '01000000000', 'Another one.') ->> 'ref',
  'STORY-________',
  'a bad reference is replaced'
);
select is(
  public.submit_story('STORY-ABC124', 'Sara', 'sara@example.com', '01000000000', 'A great exchange.') ->> 'duplicate',
  'true',
  'the same story from the same email within a day is a quiet duplicate'
);
select throws_ok(
  $$ select public.submit_story('STORY-X', 'Sara', 'sara@example.com', '', 'Text') $$,
  '22023', null,
  'a story without a phone number is refused'
);
select throws_ok(
  $$ select public.submit_story('STORY-X', 'Sara', 'sara3@example.com', '0100', '   ') $$,
  '22023', 'Please write your story before sending it.',
  'an empty story is refused'
);

-- ---- orders ----------------------------------------------------------------------------------
select is(
  public.submit_order('ausss-abc123', 'Omar', 'omar@example.com', '01000000000',
    '[{"productId":"tshirt-55","size":"M","qty":2},{"productId":"notebook","design":"SCOPH","qty":"1"}]'::jsonb,
    true, 'Cairo', '3rd year', 'thanks', 'instapay', 640) - 'id' - 'receipt_path',
  '{"ok": true, "ref": "AUSSS-ABC123"}'::jsonb,
  'an order is accepted with the client reference'
);
select tests.clear_auth();
select is(
  (select o.subtotal from public.orders o where o.ref = 'AUSSS-ABC123'),
  640,
  'the subtotal is recomputed from the price book'
);
select is(
  (select o.price_flag from public.orders o where o.ref = 'AUSSS-ABC123'),
  '',
  'a matching client total is not flagged'
);
select is(
  (select o.lc from public.orders o where o.ref = 'AUSSS-ABC123'),
  '',
  'a member''s LC is dropped'
);
select is(
  (select o.items -> 1 ->> 'line_total' from public.orders o where o.ref = 'AUSSS-ABC123'),
  '40',
  'every line carries its price'
);
select is(
  (select count(*) from public.notifications n where n.kind = 'order_new'),
  1::bigint,
  'the EB person is notified of the order'
);
select is(
  (select count(*) from public.notifications n where n.kind = 'story_new'),
  4::bigint,
  'the EB person and the exchange officer are notified of the two stories'
);

select tests.authenticate_as_anon();
select is(
  public.submit_order('AUSSS-ABC123', 'Omar', 'omar@example.com', '01000000000',
    '[{"productId":"tshirt-55","size":"M","qty":2},{"productId":"notebook","design":"SCOPH","qty":"1"}]'::jsonb,
    true, '', '3rd year', 'thanks', 'instapay', 640) ->> 'duplicate',
  'true',
  'the same order again within 90 seconds is a quiet duplicate'
);
select is(
  public.submit_order('AUSSS-XYZ', 'Nour', 'nour@example.com', '01000000001',
    '[{"productId":"gone","qty":1},{"productId":"notebook","qty":99}]'::jsonb,
    false, 'Alex', '1st year', '', 'telda', 1000) ->> 'ok',
  'true',
  'unknown items are dropped, not refused'
);
select tests.clear_auth();
select is(
  (select o.subtotal || ' | ' || o.lc || ' | ' || (o.items -> 0 ->> 'qty') from public.orders o where o.ref = 'AUSSS-XYZ'),
  '800 | Alex | 20',
  'quantities are clamped and a non-member keeps their LC'
);
select alike(
  (select o.price_flag from public.orders o where o.ref = 'AUSSS-XYZ'),
  'price mismatch%unknown items dropped)',
  'a wrong total is flagged for the officers'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.submit_order('AUSSS-E', 'Omar', 'omar@example.com', '0100', '[]'::jsonb) $$,
  '22023', 'Your cart is empty.',
  'an empty cart is refused'
);
select throws_ok(
  $$ select public.submit_order('AUSSS-E', 'Omar', 'omar@example.com', '0100', '[{"productId":"gone","qty":1}]'::jsonb) $$,
  '22023', null,
  'a cart of only unknown items is refused'
);

-- ---- the receipt -----------------------------------------------------------------------------
select ok(
  app.receipt_upload_ok((select o.id::text || '.jpg' from public.orders o where o.ref = 'AUSSS-XYZ')),
  'the buyer may upload the receipt for a fresh order'
);
select ok(
  not app.receipt_upload_ok('11111111-1111-1111-1111-111111111111.jpg'),
  'no upload for an order that does not exist'
);
select ok(
  not app.receipt_upload_ok((select o.id::text || '.png' from public.orders o where o.ref = 'AUSSS-XYZ')),
  'only the .jpg path is accepted'
);
select is(
  public.order_receipt_attached((select o.id from public.orders o where o.ref = 'AUSSS-XYZ'), 'AUSSS-XYZ') ->> 'ok',
  'false',
  'the receipt is not recorded before the file exists'
);

-- ---- who reads what --------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
select is((select count(*) from public.orders), 2::bigint, 'the EB reads the orders');
select is((select count(*) from public.signups), 1::bigint, 'the EB reads the sign-ups (the honeypot hit was never stored)');
select lives_ok(
  $$ update public.stories set status = 'contacted', notes = 'called' where ref = 'STORY-ABC123' $$,
  'the EB triages a story'
);
select tests.clear_auth();
select tests.authenticate_as('leo@pgtap.test');
select is((select count(*) from public.stories), 2::bigint, 'the exchange officer reads the stories');
select is((select count(*) from public.orders), 0::bigint, 'the exchange officer sees no orders');
select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
select is(
  (select count(*) from public.stories) + (select count(*) from public.orders) + (select count(*) from public.signups),
  0::bigint,
  'another committee''s officer sees nothing'
);

select * from finish();
rollback;
