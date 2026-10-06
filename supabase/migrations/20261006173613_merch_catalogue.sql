-- Phase 6, step 3: the merch catalogue, edited from the portal.
--
-- Until now merch_products was only the price book the orders RPC priced against; what a visitor
-- saw (the tagline, the description, the picture, the sizes, the designs) lived in
-- src/data/merchProducts.js and the two had to be kept in step by hand. The table now holds the
-- whole product, so it is the one source: the shop page, the cart and the checkout read it, and
-- the orders RPC prices against the same rows. The file stays as the copy the site shows when the
-- database cannot be reached.
--
--   merch_products     + tagline, description, image, size_chart, sizes, designs, wide_designs
--                      the EB adds, edits, hides, orders and removes products (row-level security)
--   bucket `merch`     the product and size-chart pictures, '<product id>/<file>.jpg', EB-written
--   site_settings      `merchOrdersOpen`: when false the checkout says pre-orders are closed and
--                      rpc/submit_order refuses (it was ORDERS_OPEN in src/data/merchConfig.js)
--   rpc/submit_order   a hidden product is no longer sold: it is dropped and flagged like an
--                      unknown one
--   the rebuild        any change to the catalogue asks for a rebuild of the public pages

-- ---------------------------------------------------------------------------------------------
-- The product, whole
-- ---------------------------------------------------------------------------------------------

alter table public.merch_products
  add column if not exists tagline text not null default '',
  add column if not exists description text not null default '',
  add column if not exists image text not null default '',
  add column if not exists size_chart text not null default '',
  add column if not exists sizes text[] not null default '{}',
  add column if not exists designs text[] not null default '{}',
  add column if not exists wide_designs text[] not null default '{}';

-- A picture is an uploaded file (an https address) or one that ships with the site (/assets/…).
alter table public.merch_products drop constraint if exists merch_products_text_limits;
alter table public.merch_products add constraint merch_products_text_limits check (
  length(tagline) <= 200
  and length(description) <= 2000
  and (image = '' or (length(image) <= 500 and image ~ '^(https://|/[^/])[^\s<>"'']*$'))
  and (size_chart = '' or (length(size_chart) <= 500 and size_chart ~ '^(https://|/[^/])[^\s<>"'']*$'))
);
alter table public.merch_products drop constraint if exists merch_products_list_limits;
alter table public.merch_products add constraint merch_products_list_limits check (
  cardinality(sizes) <= 20 and length(array_to_string(sizes, '')) <= 400
  and cardinality(designs) <= 30 and length(array_to_string(designs, '')) <= 1200
  and cardinality(wide_designs) <= 30 and wide_designs <@ designs
);

-- The four products of the 2025-26 drop, as src/data/merchProducts.js has them. Only rows that
-- were never given a description are filled, so a re-run never overwrites an edit.
update public.merch_products p
set tagline = v.tagline, description = v.description, image = v.image, size_chart = v.size_chart,
    sizes = v.sizes, designs = v.designs, wide_designs = v.wide_designs
from (values
  ('tshirt-55', 'Think Global. Act Local.',
   'Forest-green ringer tee with white trim. AUSSS shield embroidered on the chest, alligator monogram on the side, and the "Life Savers, Change Makers" script on the back, finished with "55 years of youth, 55 years of impact."',
   '/assets/merch/page-04.jpg', '/assets/merch/size-chart-tshirt.jpg',
   array['S', 'M', 'L', 'XL', 'XXL'], '{}'::text[], '{}'::text[]),
  ('jacket', 'Same vibe. Same legacy.',
   'The varsity jacket is back. Forest-green body with cream wool-blend sleeves, AUSSS shield on the chest, "Life Savers, Change Makers" embroidered on the back, "25/26" and the AUSSS-Earth crest on the left sleeve, the AUSSS alligator on the right.',
   '/assets/merch/page-11.jpg', '/assets/merch/size-chart-jacket.jpg',
   array['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], '{}'::text[], '{}'::text[]),
  ('bucket-hat', 'When things get too hot.',
   'Cream cotton bucket hat with the green AUSSS alligator embroidered on the front.',
   '/assets/merch/page-12.jpg', '',
   array['One size'], '{}'::text[], '{}'::text[]),
  ('notebook', 'Like it? Note it down.',
   'Spiral-bound notebook with a committee-themed cover. Pick a standing committee, the Exchange (SCOPE + SCORE) cover, or the Support Divisions cover.',
   '/assets/merch/page-13.jpg', '',
   '{}'::text[], array['SCOPH', 'SCORA', 'SCOME', 'SCORP', 'Exchange', 'Support Divisions'],
   array['Exchange', 'Support Divisions'])
) as v(id, tagline, description, image, size_chart, sizes, designs, wide_designs)
where p.id = v.id and p.description = '';

-- ---------------------------------------------------------------------------------------------
-- Who writes it: the EB (reading stays open to everyone, as before)
-- ---------------------------------------------------------------------------------------------

grant insert (id, name, price, available, sort_order, tagline, description, image, size_chart,
              sizes, designs, wide_designs)
  on public.merch_products to authenticated;
grant update (name, price, available, sort_order, tagline, description, image, size_chart,
              sizes, designs, wide_designs)
  on public.merch_products to authenticated;
grant delete on public.merch_products to authenticated;

drop policy if exists merch_products_insert on public.merch_products;
create policy merch_products_insert on public.merch_products
  for insert to authenticated
  with check ((select app.is_eb()));
drop policy if exists merch_products_delete on public.merch_products;
create policy merch_products_delete on public.merch_products
  for delete to authenticated
  using ((select app.is_eb()));

-- The shop is pre-rendered, so a change to it asks for a rebuild.
drop trigger if exists touch_site on public.merch_products;
create trigger touch_site after insert or update or delete on public.merch_products
  for each statement execute function app.touch_site();

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `merch`, written by the EB under <product id>/…
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('merch', 'merch', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves its files by address without a policy; the select policy lets the EB
-- list a product's folder to clear it when the product is removed. A replaced picture is a new
-- file under a new name, so there is no update policy.
drop policy if exists merch_read on storage.objects;
create policy merch_read on storage.objects
  for select to authenticated
  using (bucket_id = 'merch' and (select app.is_eb()));
drop policy if exists merch_insert on storage.objects;
create policy merch_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'merch' and (select app.is_eb()));
drop policy if exists merch_delete on storage.objects;
create policy merch_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'merch' and (select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- Taking orders: a site setting
-- ---------------------------------------------------------------------------------------------

insert into public.site_settings (key, value)
values ('merchOrdersOpen', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- rpc/submit_order: closed shop refused, hidden products not sold
-- ---------------------------------------------------------------------------------------------

-- As in 20260925090001, with two changes: when the setting `merchOrdersOpen` is false the order
-- is refused, and a product the EB has hidden is dropped and flagged like an unknown one.
create or replace function public.submit_order(
  ref text,
  name text,
  email text,
  phone text,
  items jsonb,
  is_member boolean default null,
  lc text default '',
  year text default '',
  notes text default '',
  payment_method text default '',
  subtotal int default 0,
  website text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref text := upper(left(btrim(coalesce(submit_order.ref, '')), 40));
  v_name text := left(btrim(coalesce(submit_order.name, '')), 140);
  v_email text := left(btrim(coalesce(submit_order.email, '')), 200);
  v_phone text := left(btrim(coalesce(submit_order.phone, '')), 60);
  -- the local committee only means something for a non-member
  v_lc text := case when submit_order.is_member is false
                    then left(btrim(coalesce(submit_order.lc, '')), 80) else '' end;
  v_year text := left(btrim(coalesce(submit_order.year, '')), 60);
  v_notes text := left(btrim(coalesce(submit_order.notes, '')), 1000);
  v_method text := left(btrim(coalesce(submit_order.payment_method, '')), 40);
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_product public.merch_products%rowtype;
  v_qty int;
  v_total int := 0;
  v_unknown boolean := false;
  v_flag text := '';
  v_existing public.orders%rowtype;
  v_id uuid;
begin
  if v_ref !~ '^AUSSS-[A-Z0-9]{1,12}$' then
    v_ref := 'AUSSS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  if btrim(coalesce(website, '')) <> '' then
    return jsonb_build_object('ok', true, 'ref', v_ref);
  end if;
  if (select s.value from public.site_settings s where s.key = 'merchOrdersOpen') = 'false'::jsonb then
    raise exception 'Pre-orders are closed at the moment.' using errcode = '22023';
  end if;
  if v_name = '' or not app.valid_email(v_email) or v_phone = '' then
    raise exception 'Please enter your name, a valid email address and a phone number.' using errcode = '22023';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;

  for v_item in select e from jsonb_array_elements(items) as t(e) limit 20 loop
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;
    select * into v_product from public.merch_products p
    where p.id = app.jtext(v_item -> 'productId', 40) and p.available;
    if v_product.id is null then
      v_unknown := true;
      continue;
    end if;
    begin
      v_qty := least(20, greatest(1, coalesce((v_item ->> 'qty')::int, 1)));
    exception when others then
      v_qty := 1;
    end;
    v_total := v_total + v_product.price * v_qty;
    v_items := v_items || jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'size', app.jtext(v_item -> 'size', 40),
      'design', app.jtext(v_item -> 'design', 60),
      'qty', v_qty,
      'unit_price', v_product.price,
      'line_total', v_product.price * v_qty
    );
  end loop;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'None of the items in your cart is available any more.' using errcode = '22023';
  end if;
  if v_unknown or v_total <> coalesce(submit_order.subtotal, 0) then
    v_flag := format('price mismatch (client said %s, server %s%s)',
                     coalesce(submit_order.subtotal, 0), v_total,
                     case when v_unknown then ', unknown items dropped' else '' end);
  end if;

  -- an identical order in the last 90 seconds is a double click: hand back the first one
  select * into v_existing from public.orders o
  where o.email_normalized = app.norm_email(v_email)
    and o.phone = v_phone
    and o.items = v_items
    and o.created_at > now() - interval '90 seconds'
  order by o.created_at desc
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'ref', v_existing.ref, 'id', v_existing.id,
                              'receipt_path', v_existing.id::text || '.jpg', 'duplicate', true);
  end if;
  if (select count(*) from public.orders o where o.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many orders right now, please retry shortly.' using errcode = '22023';
  end if;

  insert into public.orders (
    ref, name, email, phone, is_member, lc, year, payment_method, items, subtotal, client_subtotal,
    price_flag, notes
  )
  values (
    v_ref, v_name, v_email, v_phone, submit_order.is_member, v_lc, v_year, v_method, v_items, v_total,
    greatest(coalesce(submit_order.subtotal, 0), 0), v_flag, v_notes
  )
  returning id into v_id;

  perform app.notify_submission('order', v_id, v_ref, v_name,
                                jsonb_build_object('subtotal', v_total, 'flagged', v_flag <> ''));

  return jsonb_build_object('ok', true, 'ref', v_ref, 'id', v_id, 'receipt_path', v_id::text || '.jpg');
end
$$;
