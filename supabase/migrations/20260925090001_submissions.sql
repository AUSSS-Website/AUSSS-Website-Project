-- Phase 5 (migration step 9): the last three public forms leave Google Apps Script. The
-- recruitment waitlist (apps-script/signups.gs), exchange stories (stories.gs) and merch
-- pre-orders (orders.gs) now land in the database and are triaged in the portal.
--
-- Shape:
--   signups         one row per waitlist sign-up (kind 'waitlist'; 'newsletter' kept for old rows)
--   stories         one row per exchange story sent from /exchange/share
--   orders          one row per merch pre-order from /merch/checkout, priced by the database
--   merch_products  the price book the orders RPC prices against (seeded from
--                   src/data/merchProducts.js, which the shop page still reads; keep the two
--                   in step, a mismatch is flagged on the order rather than refused)
--   Storage bucket `receipts` (private): the buyer's payment screenshot, '<order id>.jpg',
--                   uploaded by the buyer right after the order is accepted, read by the
--                   people who triage orders through signed URLs.
--
-- Writes from the public site come only through three anon RPCs that mirror the scripts'
-- validation, dedupe and flood caps (and their refusal messages, errcode 22023 so the site
-- shows them as-is): submit_signup, submit_story, submit_order (+ order_receipt_attached).
-- Nobody inserts directly. Reading and triage: the EB for all three, plus the exchange
-- officers (SCOPE, SCORE) for stories (app.can_triage). Orders and stories notify those
-- people through the notifications feed and the daily digest, the way the scripts emailed
-- aussswebsite@gmail.com; sign-ups only show as a count (they arrive in bulk).

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- 'order' | 'story' | 'signup': who may read and triage that kind of submission.
create or replace function app.can_triage(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() or (
    p_kind = 'story' and (
      coalesce(app.is_officer_of(app.committee_id_by_slug('scope')), false)
      or coalesce(app.is_officer_of(app.committee_id_by_slug('score')), false)
    )
  )
$$;

-- Everyone who triages that kind this term (for notifications): EB and webmaster, plus the
-- exchange officers for stories.
create or replace function app.triage_recipients(p_kind text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.profile_id
  from public.assignments a
  join public.positions p on p.id = a.position_id
  where a.status = 'active'
    and a.term_id = app.current_term_id()
    and (
      p.level in ('eb', 'webmaster')
      or (
        p_kind = 'story' and p.level = 'officer'
        and p.committee_id in (select c.id from public.committees c where c.slug in ('scope', 'score'))
      )
    )
$$;

create or replace function app.valid_email(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

-- ---------------------------------------------------------------------------------------------
-- merch_products: the price book
-- ---------------------------------------------------------------------------------------------

create table if not exists public.merch_products (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (name <> '' and length(name) <= 140),
  price int not null check (price >= 0 and price <= 100000),
  available boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.merch_products;
create trigger set_updated_at before update on public.merch_products
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.merch_products;
create trigger audit after insert or update or delete on public.merch_products
  for each row execute function app.audit();

insert into public.merch_products (id, name, price, sort_order)
values
  ('tshirt-55', 'AUSSS T-Shirt, 55th Limited Edition', 300, 0),
  ('jacket', '"The" AUSSS Jacket', 650, 1),
  ('bucket-hat', 'Dash Bucket Hat', 150, 2),
  ('notebook', 'AUSSS Notebook', 40, 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- signups
-- ---------------------------------------------------------------------------------------------

create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'waitlist' check (kind in ('waitlist', 'newsletter')),
  name text not null default '' check (length(name) <= 140),
  email text not null check (length(email) <= 200),
  email_normalized text generated always as (app.norm_email(email)) stored,
  phone text not null default '' check (length(phone) <= 60),
  status text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signups_created_at_idx on public.signups (created_at);
create index if not exists signups_dedupe_idx on public.signups (kind, email_normalized, created_at);

drop trigger if exists set_updated_at on public.signups;
create trigger set_updated_at before update on public.signups
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.signups;
create trigger audit after update or delete on public.signups
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- stories
-- ---------------------------------------------------------------------------------------------

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  ref text not null check (length(ref) <= 40),
  status text not null default 'new' check (status in ('new', 'contacted', 'featured', 'declined')),
  name text not null check (name <> '' and length(name) <= 140),
  email text not null check (length(email) <= 200),
  email_normalized text generated always as (app.norm_email(email)) stored,
  phone text not null default '' check (length(phone) <= 60),
  destination text not null default '' check (length(destination) <= 120),
  programme text not null default '' check (length(programme) <= 120),
  year text not null default '' check (length(year) <= 40),
  story text not null check (story <> '' and length(story) <= 4000),
  notes text not null default '' check (length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stories_created_at_idx on public.stories (created_at);
create index if not exists stories_dedupe_idx on public.stories (email_normalized, created_at);

drop trigger if exists set_updated_at on public.stories;
create trigger set_updated_at before update on public.stories
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.stories;
create trigger audit after update or delete on public.stories
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null check (length(ref) <= 40),
  status text not null default 'new' check (status in ('new', 'confirmed', 'collected', 'cancelled')),
  name text not null check (name <> '' and length(name) <= 140),
  email text not null check (length(email) <= 200),
  email_normalized text generated always as (app.norm_email(email)) stored,
  phone text not null default '' check (length(phone) <= 60),
  is_member boolean null,
  lc text not null default '' check (length(lc) <= 80),
  year text not null default '' check (length(year) <= 60),
  payment_method text not null default '' check (length(payment_method) <= 40),
  -- [{ product_id, name, size, design, qty, unit_price, line_total }], priced by the database
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal int not null default 0 check (subtotal >= 0),
  client_subtotal int not null default 0 check (client_subtotal >= 0),
  -- '' or a note when the client's total disagreed with the price book / had unknown items
  price_flag text not null default '' check (length(price_flag) <= 300),
  notes text not null default '' check (length(notes) <= 1000),
  officer_notes text not null default '' check (length(officer_notes) <= 4000),
  receipt_path text null check (receipt_path is null or length(receipt_path) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists orders_status_created_at_idx on public.orders (status, created_at);
create index if not exists orders_dedupe_idx on public.orders (email_normalized, created_at);

drop trigger if exists set_updated_at on public.orders;
create trigger set_updated_at before update on public.orders
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.orders;
create trigger audit after update or delete on public.orders
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Notifications: a new order or story reaches the people who triage it
-- ---------------------------------------------------------------------------------------------

create or replace function app.notify_submission(p_kind text, p_id uuid, p_ref text, p_name text, p_extra jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notifications (profile_id, kind, payload)
  select r, p_kind || '_new',
         jsonb_build_object('submission_id', p_id, 'ref', p_ref, 'name', p_name) || coalesce(p_extra, '{}'::jsonb)
  from app.triage_recipients(p_kind) as r
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/submit_signup (anon + authenticated)
-- ---------------------------------------------------------------------------------------------

-- Mirrors signups.gs: same email for the same kind within 24h is a quiet no-op, 30/min globally.
create or replace function public.submit_signup(
  email text,
  name text default '',
  kind text default 'waitlist',
  phone text default '',
  website text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(submit_signup.kind, '')));
  v_name text := left(btrim(coalesce(submit_signup.name, '')), 140);
  v_email text := left(btrim(coalesce(submit_signup.email, '')), 200);
  v_phone text := left(btrim(coalesce(submit_signup.phone, '')), 60);
  v_id uuid;
begin
  if v_kind not in ('waitlist', 'newsletter') then
    v_kind := 'waitlist';
  end if;
  -- honeypot: bots fill the hidden field; pretend it worked
  if btrim(coalesce(website, '')) <> '' then
    return jsonb_build_object('ok', true);
  end if;
  if not app.valid_email(v_email) then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.signups s
    where s.kind = v_kind
      and s.email_normalized = app.norm_email(v_email)
      and s.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if (select count(*) from public.signups s where s.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many sign-ups right now, please retry shortly.' using errcode = '22023';
  end if;

  insert into public.signups (kind, name, email, phone)
  values (v_kind, v_name, v_email, v_phone)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/submit_story (anon + authenticated)
-- ---------------------------------------------------------------------------------------------

-- Mirrors stories.gs: name, email, phone and the story are required; the same person sending
-- the same story again within 24h is a quiet no-op; 15/min globally. The reference comes from
-- the client (STORY-XXXXXXXX) so the success screen matches the row; a bad one is replaced.
create or replace function public.submit_story(
  ref text,
  name text,
  email text,
  phone text,
  story text,
  destination text default '',
  programme text default '',
  year text default '',
  website text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref text := upper(left(btrim(coalesce(submit_story.ref, '')), 40));
  v_name text := left(btrim(coalesce(submit_story.name, '')), 140);
  v_email text := left(btrim(coalesce(submit_story.email, '')), 200);
  v_phone text := left(btrim(coalesce(submit_story.phone, '')), 60);
  v_story text := left(btrim(coalesce(submit_story.story, '')), 4000);
  v_destination text := left(btrim(coalesce(submit_story.destination, '')), 120);
  v_programme text := left(btrim(coalesce(submit_story.programme, '')), 120);
  v_year text := left(btrim(coalesce(submit_story.year, '')), 40);
  v_id uuid;
begin
  if v_ref !~ '^STORY-[A-Z0-9]{1,12}$' then
    v_ref := 'STORY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  if btrim(coalesce(website, '')) <> '' then
    return jsonb_build_object('ok', true, 'ref', v_ref);
  end if;
  if v_name = '' or not app.valid_email(v_email) or v_phone = '' then
    raise exception 'Please enter your name, a valid email address and a phone number.' using errcode = '22023';
  end if;
  if v_story = '' then
    raise exception 'Please write your story before sending it.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.stories s
    where s.email_normalized = app.norm_email(v_email)
      and s.story = v_story
      and s.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('ok', true, 'ref', v_ref, 'duplicate', true);
  end if;
  if (select count(*) from public.stories s where s.created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Too many submissions right now, please retry shortly.' using errcode = '22023';
  end if;

  insert into public.stories (ref, name, email, phone, destination, programme, year, story)
  values (v_ref, v_name, v_email, v_phone, v_destination, v_programme, v_year, v_story)
  returning id into v_id;

  perform app.notify_submission('story', v_id, v_ref, v_name, jsonb_build_object('destination', v_destination));

  return jsonb_build_object('ok', true, 'ref', v_ref, 'id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/submit_order (anon + authenticated)
-- ---------------------------------------------------------------------------------------------

-- Mirrors orders.gs: contact fields and a non-empty cart are required; every line is priced
-- from merch_products (unknown products are dropped and flagged, quantities clamped to 1..20)
-- and the subtotal is recomputed, the client's figure is only recorded; an identical order
-- (same email, phone and cart) within 90s is a quiet no-op; 20/min globally.
-- items: [{ productId, size, design, qty }] as the cart holds them.
-- Returns { ok, ref, id, receipt_path }: the buyer then uploads the payment screenshot to
-- receipts/<receipt_path> and calls order_receipt_attached.
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
    select * into v_product from public.merch_products p where p.id = app.jtext(v_item -> 'productId', 40);
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

-- ---------------------------------------------------------------------------------------------
-- The receipt: a private bucket the buyer may put exactly one file into, right after ordering
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- True for '<order id>.jpg' when that order was placed in the last 30 minutes and has no
-- receipt yet: the only upload a visitor can make, and only once per order.
create or replace function app.receipt_upload_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1 from public.orders o
      where o.id = left(p_name, 36)::uuid
        and o.receipt_path is null
        and o.created_at > now() - interval '30 minutes'
    )
$$;

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'receipts' and (select app.receipt_upload_ok(name)));
drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (select app.can_triage('order')));
drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (select app.is_eb()));

-- rpc/order_receipt_attached(id, ref): called by the buyer once the upload finished; records
-- the path when the file really is there. The ref doubles as the proof this is the buyer.
create or replace function public.order_receipt_attached(id uuid, ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text := order_receipt_attached.id::text || '.jpg';
begin
  if not exists (
    select 1 from storage.objects s where s.bucket_id = 'receipts' and s.name = v_path
  ) then
    return jsonb_build_object('ok', false, 'error', 'No receipt was uploaded for this order.');
  end if;
  update public.orders o
    set receipt_path = v_path
  where o.id = order_receipt_attached.id
    and o.ref = upper(btrim(coalesce(order_receipt_attached.ref, '')))
    and o.receipt_path is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That order was not found.');
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS (explicit: migration 20260919160004 removed the defaults)
-- ---------------------------------------------------------------------------------------------

alter table public.merch_products enable row level security;
alter table public.signups enable row level security;
alter table public.stories enable row level security;
alter table public.orders enable row level security;

grant select on public.merch_products to anon, authenticated;
grant update (name, price, available, sort_order) on public.merch_products to authenticated;
grant select, delete on public.signups, public.stories, public.orders to authenticated;
grant update (status, notes) on public.signups to authenticated;
grant update (status, notes) on public.stories to authenticated;
grant update (status, officer_notes) on public.orders to authenticated;
grant all on public.merch_products, public.signups, public.stories, public.orders to service_role;

drop policy if exists merch_products_select on public.merch_products;
create policy merch_products_select on public.merch_products
  for select to anon, authenticated using (true);
drop policy if exists merch_products_update on public.merch_products;
create policy merch_products_update on public.merch_products
  for update to authenticated
  using ((select app.is_eb())) with check ((select app.is_eb()));

drop policy if exists signups_select on public.signups;
create policy signups_select on public.signups
  for select to authenticated using ((select app.can_triage('signup')));
drop policy if exists signups_update on public.signups;
create policy signups_update on public.signups
  for update to authenticated
  using ((select app.can_triage('signup'))) with check ((select app.can_triage('signup')));
drop policy if exists signups_delete on public.signups;
create policy signups_delete on public.signups
  for delete to authenticated using ((select app.is_eb()));

drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories
  for select to authenticated using ((select app.can_triage('story')));
drop policy if exists stories_update on public.stories;
create policy stories_update on public.stories
  for update to authenticated
  using ((select app.can_triage('story'))) with check ((select app.can_triage('story')));
drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories
  for delete to authenticated using ((select app.is_eb()));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated using ((select app.can_triage('order')));
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using ((select app.can_triage('order'))) with check ((select app.can_triage('order')));
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete to authenticated using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.can_triage(text) owner to postgres;
alter function app.triage_recipients(text) owner to postgres;
alter function app.valid_email(text) owner to postgres;
alter function app.notify_submission(text, uuid, text, text, jsonb) owner to postgres;
alter function app.receipt_upload_ok(text) owner to postgres;
alter function public.submit_signup(text, text, text, text, text) owner to postgres;
alter function public.submit_story(text, text, text, text, text, text, text, text, text) owner to postgres;
alter function public.submit_order(text, text, text, text, jsonb, boolean, text, text, text, text, int, text) owner to postgres;
alter function public.order_receipt_attached(uuid, text) owner to postgres;

revoke execute on function app.can_triage(text) from public;
revoke execute on function app.triage_recipients(text) from public;
revoke execute on function app.valid_email(text) from public;
revoke execute on function app.notify_submission(text, uuid, text, text, jsonb) from public;
revoke execute on function app.receipt_upload_ok(text) from public;
grant execute on function app.can_triage(text) to authenticated, service_role;
-- the storage policy runs as the uploader (anon), so the check must be callable by anon
grant execute on function app.receipt_upload_ok(text) to anon, authenticated, service_role;

revoke execute on function public.submit_signup(text, text, text, text, text) from public;
revoke execute on function public.submit_story(text, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.submit_order(text, text, text, text, jsonb, boolean, text, text, text, text, int, text) from public;
revoke execute on function public.order_receipt_attached(uuid, text) from public;
grant execute on function public.submit_signup(text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_story(text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_order(text, text, text, text, jsonb, boolean, text, text, text, text, int, text) to anon, authenticated;
grant execute on function public.order_receipt_attached(uuid, text) to anon, authenticated;
