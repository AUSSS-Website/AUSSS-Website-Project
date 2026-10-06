-- The merch orders panel on the portal's Merch page, and the shop's wording.
--
--   orders.status   new, contacted, delivered (was new, confirmed, collected, cancelled): the EB
--                   marks an order contacted once they have reached the buyer and delivered
--                   once it is handed over. Existing rows move across (confirmed to contacted,
--                   collected and cancelled to delivered); there were none when this was written.
--   rpc/submit_order  the shop says "order" now, never "pre-order": the refusal while orders
--                   are closed reads "Orders are closed at the moment." Otherwise as in
--                   20261006173613.

alter table public.orders drop constraint if exists orders_status_check;
update public.orders set status = case status
  when 'confirmed' then 'contacted'
  when 'collected' then 'delivered'
  when 'cancelled' then 'delivered'
  else status end
where status not in ('new', 'contacted', 'delivered');
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'contacted', 'delivered'));

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
    raise exception 'Orders are closed at the moment.' using errcode = '22023';
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
