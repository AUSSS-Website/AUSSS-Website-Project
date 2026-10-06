-- The merch catalogue: the EB adds, edits, hides and removes products; everyone reads them; a
-- member or an officer changes nothing; the table refuses a bad picture address; a hidden
-- product is not sold; closing pre-orders (site setting merchOrdersOpen) refuses an order; and
-- a change asks for a rebuild of the public pages.
begin;
select plan(16);

update public.terms set is_current = false where is_current;
insert into public.terms (label, starts_on, ends_on, is_current)
values ('pgtap', '2026-09-01', '2027-08-31', true)
on conflict (label) do update set is_current = true;

insert into public.committees (slug, name, abbr, kind)
values ('pnsd', 'Public Relations and Media', 'PNSD', 'division')
on conflict (slug) do nothing;
insert into public.positions (key, committee_id, title, short_title, level)
values ('eb.president', null, 'President', 'President', 'eb'),
       ('pnsd.director', (select id from public.committees where slug = 'pnsd'), 'PNSD Director', 'PNSD', 'officer')
on conflict do nothing;

select tests.create_user('eb@pgtap.test', 'EB Person');
select tests.create_user('pnsd@pgtap.test', 'Media Officer');
select tests.create_user('member@pgtap.test', 'Plain Member');
select tests.assign('eb@pgtap.test', 'eb.president');
select tests.assign('pnsd@pgtap.test', 'pnsd.director');

delete from public.orders;

-- the shipped products came with their whole description
select is(
  (select sizes from public.merch_products where id = 'jacket'),
  array['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
  'the jacket keeps its sizes'
);
select is(
  (select wide_designs from public.merch_products where id = 'notebook'),
  array['Exchange', 'Support Divisions'],
  'the notebook keeps its wide designs'
);
select is(
  (select value from public.site_settings where key = 'merchOrdersOpen'),
  'true'::jsonb,
  'pre-orders start open'
);

-- anon reads, writes nothing
select tests.authenticate_as_anon();
select is(
  (select image from public.merch_products where id = 'tshirt-55'),
  '/assets/merch/page-04.jpg',
  'a visitor reads the catalogue'
);
select throws_ok(
  $$ insert into public.merch_products (id, name, price) values ('x', 'X', 1) $$,
  '42501', null,
  'a visitor cannot add a product'
);

-- a plain member and an officer: no writes
select tests.clear_auth();
select tests.authenticate_as('member@pgtap.test');
select throws_ok(
  $$ insert into public.merch_products (id, name, price) values ('x', 'X', 1) $$,
  '42501', null,
  'a member cannot add a product'
);
select tests.clear_auth();
select tests.authenticate_as('pnsd@pgtap.test');
update public.merch_products set price = 1 where id = 'jacket';
delete from public.merch_products where id = 'jacket';
select tests.clear_auth();
select is(
  (select price from public.merch_products where id = 'jacket'),
  650,
  'an officer neither reprices nor removes a product'
);

-- the EB
update app.site_rebuild set requested_at = null where id;
select tests.authenticate_as('eb@pgtap.test');
select lives_ok(
  $$ insert into public.merch_products (id, name, price, tagline, image, sizes, designs, wide_designs, sort_order)
     values ('pgtap-mug', 'Mug', 120, 'Hot.', 'https://example.supabase.co/storage/v1/object/public/merch/pgtap-mug/a.jpg',
             '{}', array['Green', 'Cream'], array['Cream'], 9) $$,
  'the EB adds a product'
);
select throws_ok(
  $$ update public.merch_products set image = 'javascript:alert(1)' where id = 'pgtap-mug' $$,
  '23514', null,
  'a picture must be an https address or a file of the site'
);
select throws_ok(
  $$ update public.merch_products set wide_designs = array['Blue'] where id = 'pgtap-mug' $$,
  '23514', null,
  'a wide design must be one of the designs'
);
select lives_ok(
  $$ update public.merch_products set available = false, price = 130 where id = 'pgtap-mug' $$,
  'the EB hides and reprices a product'
);
select tests.clear_auth();
select ok(
  (select requested_at is not null from app.site_rebuild where id),
  'a change to the catalogue asks for a rebuild'
);

-- ordering: a hidden product is not sold
select tests.authenticate_as_anon();
select is(
  public.submit_order('AUSSS-MUG1', 'Omar', 'omar@example.com', '01000000000',
    '[{"productId":"pgtap-mug","qty":1},{"productId":"notebook","qty":2}]'::jsonb,
    subtotal => 210) ->> 'ok',
  'true',
  'an order with a hidden product goes through for the rest'
);
select tests.clear_auth();
select is(
  (select subtotal || ' | ' || jsonb_array_length(items) || ' | ' || (price_flag <> '')
   from public.orders where ref = 'AUSSS-MUG1'),
  '80 | 1 | true',
  'the hidden product is dropped and the order flagged'
);

-- closing pre-orders
update public.site_settings set value = 'false'::jsonb where key = 'merchOrdersOpen';
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.submit_order('AUSSS-SHUT', 'Omar', 'omar@example.com', '01000000000',
       '[{"productId":"notebook","qty":1}]'::jsonb) $$,
  '22023', 'Pre-orders are closed at the moment.',
  'a closed shop refuses an order'
);

-- the EB removes a product
select tests.clear_auth();
select tests.authenticate_as('eb@pgtap.test');
delete from public.merch_products where id = 'pgtap-mug';
select tests.clear_auth();
select is(
  (select count(*) from public.merch_products where id = 'pgtap-mug'),
  0::bigint,
  'the EB removes a product'
);

select * from finish();
rollback;
