create extension if not exists "pgcrypto";

do $$
begin
  create type payment_status as enum (
    'pending_payment',
    'paid',
    'failed',
    'canceled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type fulfillment_status as enum (
    'awaiting_payment',
    'ordered',
    'production',
    'packing',
    'shipped',
    'delivered'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type temu_order_status as enum (
    'NOT_SUBMITTED',
    'UN_SHIPPING',
    'CANCELED',
    'SHIPPED',
    'UNKNOWN'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  description text,
  base_price_cents integer not null check (base_price_cents > 0),
  currency text not null default 'usd',
  card_image_url text,
  customization jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_type text not null,
  value text not null,
  label text not null,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  unique (product_id, option_type, value)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  color text not null,
  style text not null,
  size text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  procurement jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, color, style, size)
);

create table if not exists public.custom_designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  configuration jsonb not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  custom_design_id uuid not null references public.custom_designs(id),
  order_number text not null unique,
  customer_email text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  payment_status payment_status not null default 'pending_payment',
  payment_provider text not null default 'stripe' check (payment_provider in ('stripe', 'paypal')),
  fulfillment_status fulfillment_status not null default 'awaiting_payment',
  sales_channel text not null default 'direct',
  temu_parent_order_sn text,
  temu_order_sn text,
  temu_status temu_order_status not null default 'NOT_SUBMITTED',
  temu_status_label text,
  temu_last_synced_at timestamptz,
  temu_raw jsonb,
  design_snapshot jsonb not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  paypal_order_id text unique,
  paypal_capture_id text unique,
  shipping jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status fulfillment_status not null,
  changed_by uuid references auth.users(id),
  note text,
  external_event_id text unique,
  created_at timestamptz not null default now()
);

create unique index if not exists orders_temu_parent_order_sn_idx
  on public.orders (temu_parent_order_sn)
  where temu_parent_order_sn is not null;

create unique index if not exists orders_temu_order_sn_idx
  on public.orders (temu_order_sn)
  where temu_order_sn is not null;

create table if not exists public.temu_purchase_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'configuration_required' check (
    status in (
      'configuration_required', 'ready_for_payment', 'in_progress',
      'login_required', 'captcha_required', 'payment_challenge',
      'address_review_required', 'submit_uncertain', 'temu_bound',
      'failed', 'canceled'
    )
  ),
  product_url text,
  goods_id text,
  sku_id text,
  quantity integer not null default 1 check (quantity > 0),
  expected_amount_cents integer check (expected_amount_cents is null or expected_amount_cents > 0),
  currency text not null default 'usd',
  address_snapshot jsonb not null,
  address_fingerprint text not null,
  idempotency_key text not null unique,
  worker_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  temu_parent_order_sn text,
  temu_order_sn text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists temu_purchase_jobs_parent_sn_idx
  on public.temu_purchase_jobs (temu_parent_order_sn)
  where temu_parent_order_sn is not null;

create unique index if not exists temu_purchase_jobs_order_sn_idx
  on public.temu_purchase_jobs (temu_order_sn)
  where temu_order_sn is not null;

create index if not exists temu_purchase_jobs_queue_idx
  on public.temu_purchase_jobs (status, created_at);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.order_recipient_pii_vault (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete cascade,
  record_label text not null unique,
  is_test boolean not null default false,
  recipient_name_secret_id uuid not null unique,
  recipient_phone_secret_id uuid not null unique,
  recipient_address_secret_id uuid not null unique,
  recipient_email_secret_id uuid not null unique,
  encryption_scheme text not null default 'Supabase Vault authenticated encryption',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_recipient_pii_requires_order
    check (is_test or order_id is not null)
);

comment on table public.order_recipient_pii_vault is
  'Maps an order to recipient PII encrypted in Supabase Vault. Secret plaintext is never stored in this table.';
comment on column public.order_recipient_pii_vault.recipient_name_secret_id is
  'Vault secret identifier for the encrypted recipient name.';
comment on column public.order_recipient_pii_vault.recipient_phone_secret_id is
  'Vault secret identifier for the encrypted recipient phone number.';
comment on column public.order_recipient_pii_vault.recipient_address_secret_id is
  'Vault secret identifier for the encrypted delivery address.';
comment on column public.order_recipient_pii_vault.recipient_email_secret_id is
  'Vault secret identifier for the encrypted customer email.';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_custom_designs_updated_at on public.custom_designs;
create trigger touch_custom_designs_updated_at
before update on public.custom_designs
for each row execute function public.touch_updated_at();

drop trigger if exists touch_orders_updated_at on public.orders;
create trigger touch_orders_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

drop trigger if exists touch_temu_purchase_jobs_updated_at on public.temu_purchase_jobs;
create trigger touch_temu_purchase_jobs_updated_at
before update on public.temu_purchase_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists set_order_recipient_pii_vault_updated_at
  on public.order_recipient_pii_vault;
create trigger set_order_recipient_pii_vault_updated_at
before update on public.order_recipient_pii_vault
for each row execute function public.touch_updated_at();

alter table public.products enable row level security;
alter table public.product_options enable row level security;
alter table public.product_variants enable row level security;
alter table public.custom_designs enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_events enable row level security;
alter table public.temu_purchase_jobs enable row level security;
alter table public.admin_roles enable row level security;
alter table public.order_recipient_pii_vault enable row level security;

grant select on table public.products to anon, authenticated;
grant select on table public.product_options to anon, authenticated;
grant select on table public.product_variants to anon, authenticated;
grant select, insert, update, delete on table public.custom_designs to authenticated;
grant select, insert, update on table public.orders to authenticated;
grant select, insert on table public.order_status_events to authenticated;
grant select, update on table public.temu_purchase_jobs to authenticated;
grant select on table public.admin_roles to authenticated;
revoke all on table public.order_recipient_pii_vault from anon, authenticated;
grant select, insert, update, delete on table public.order_recipient_pii_vault to service_role;
grant select, insert, update, delete on table
  public.products,
  public.product_options,
  public.product_variants,
  public.custom_designs,
  public.orders,
  public.order_status_events,
  public.temu_purchase_jobs,
  public.admin_roles
to service_role;

drop policy if exists "Products are public" on public.products;
create policy "Products are public"
on public.products for select
using (active = true);

drop policy if exists "Product options are public" on public.product_options;
create policy "Product options are public"
on public.product_options for select
using (true);

drop policy if exists "Product variants are public" on public.product_variants;
create policy "Product variants are public"
on public.product_variants for select
using (active = true);

drop policy if exists "Users manage own designs" on public.custom_designs;
create policy "Users manage own designs"
on public.custom_designs for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users view own orders" on public.orders;
create policy "Users view own orders"
on public.orders for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Users create own orders" on public.orders;
create policy "Users create own orders"
on public.orders for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders"
on public.orders for update
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Users view own order events" on public.order_status_events;
create policy "Users view own order events"
on public.order_status_events for select
to authenticated
using (
  exists (
    select 1 from public.orders
    where orders.id = order_status_events.order_id
    and (
      orders.user_id = (select auth.uid())
      or exists (
        select 1 from public.admin_roles
        where admin_roles.user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Admins create order events" on public.order_status_events;
create policy "Admins create order events"
on public.order_status_events for insert
to authenticated
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins view Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins view Temu purchase jobs"
on public.temu_purchase_jobs for select
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins update Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins update Temu purchase jobs"
on public.temu_purchase_jobs for update
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Users view own admin role" on public.admin_roles;
create policy "Users view own admin role"
on public.admin_roles for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.products (
  slug,
  name,
  category,
  description,
  base_price_cents,
  currency,
  active
) values (
  'custom-pillow',
  'Custom Pillow Cover Set',
  'pillow',
  'Two personalized 18in/45cm polyester pillow covers. Inserts are not included.',
  1999,
  'usd',
  true
) on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  base_price_cents = excluded.base_price_cents,
  currency = excluded.currency,
  active = true;

update public.products
set
  card_image_url = coalesce(card_image_url, '/showcase/wood-chair.webp'),
  customization = jsonb_build_object(
    'printSides', jsonb_build_array('front'),
    'outputWidth', 1200,
    'outputHeight', 1200,
    'frameLabel', 'Square pillow artwork',
    'previewMode', 'reuse',
    'mockupTemplateIds', jsonb_build_array(
      'pillow-psd-03-grey-sofa',
      'pillow-psd-04-size',
      'pillow-psd-06-wood-chair',
      'pillow-psd-01'
    )
  )
where slug = 'custom-pillow'
  and (customization = '{}'::jsonb or card_image_url is null);

update public.products
set active = false
where slug = 'studio-tee';

with product as (
  select id from public.products where slug = 'custom-pillow'
)
insert into public.product_options (product_id, option_type, value, label, metadata, sort_order)
select product.id, option_type, value, label, metadata::jsonb, sort_order
from product,
(values
  ('color', 'standard-white', 'Standard white', '{"hex":"#f5f2ea"}', 1),
  ('style', 'polyester-cover', 'Polyester pillow cover', '{}', 1),
  ('size', '18in/45cm', '18in/45cm', '{}', 1)
) as options(option_type, value, label, metadata, sort_order)
on conflict (product_id, option_type, value) do update set
  label = excluded.label,
  metadata = excluded.metadata,
  sort_order = excluded.sort_order;

with product as (
  select id from public.products where slug = 'custom-pillow'
)
update public.product_variants
set active = false
where product_id in (select id from product);

with product as (
  select id from public.products where slug = 'custom-pillow'
)
insert into public.product_variants (
  product_id,
  sku,
  color,
  style,
  size,
  price_cents,
  currency
)
select
  product.id,
  'PILLOW-COVER-STANDARD-45CM-2PCS',
  'standard-white',
  'polyester-cover',
  '18in/45cm',
  1999,
  'usd'
from product
on conflict (product_id, color, style, size) do update set
  sku = excluded.sku,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  active = true;

insert into storage.buckets (id, name, public)
values ('design-assets', 'design-assets', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-catalog-assets',
  'product-catalog-assets',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own design assets" on storage.objects;
create policy "Users upload own design assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own design assets" on storage.objects;
create policy "Users read own design assets"
on storage.objects for select
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own design assets" on storage.objects;
create policy "Users update own design assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own design assets" on storage.objects;
create policy "Users delete own design assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public"
on storage.objects for select
to public
using (bucket_id = 'avatars');

drop policy if exists "Product catalog images are public" on storage.objects;
create policy "Product catalog images are public"
on storage.objects for select
to public
using (bucket_id = 'product-catalog-assets');

drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create table if not exists public.marketing_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  idempotency_key text not null unique,
  campaign text not null,
  channel text not null check (channel in ('consent_reply', 'public_reply', 'direct_message')),
  variant text not null,
  source_hash text not null check (length(source_hash) = 64),
  source_image_url text,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  click_count integer not null default 0 check (click_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  marketing_link_id uuid not null references public.marketing_links(id) on delete cascade,
  event_type text not null check (event_type in (
    'link_generated', 'link_clicked', 'landing_confirmed', 'design_opened',
    'preview_ready', 'checkout_started', 'payment_completed'
  )),
  order_id uuid references public.orders(id) on delete set null,
  activity_session_id uuid,
  is_internal boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (marketing_link_id, event_type, is_internal)
);

create table if not exists public.marketing_link_visits (
  id uuid primary key default gen_random_uuid(),
  marketing_link_id uuid not null references public.marketing_links(id) on delete cascade,
  device_class text not null default 'unknown' check (device_class in ('desktop', 'mobile', 'tablet', 'unknown')),
  referrer_group text not null default 'direct' check (referrer_group in ('direct', 'internal', 'search', 'x', 'other')),
  suspected_bot boolean not null default false,
  is_internal boolean not null default false,
  visited_at timestamptz not null default now()
);

comment on table public.marketing_link_visits is
  'One privacy-minimized row per valid marketing-link redirect. Funnel milestones remain deduplicated in marketing_events.';

create table if not exists public.marketing_ingest_nonces (
  nonce text primary key,
  request_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_activity_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  event_type text not null check (event_type in (
    'page_view', 'page_exit', 'click', 'landing_confirmed', 'design_opened',
    'upload_started', 'crop_confirmed', 'preview_started', 'preview_cache_hit',
    'preview_ready', 'delivery_opened', 'delivery_canceled',
    'address_validation_failed', 'checkout_started', 'payment_redirected',
    'purchase_completed'
  )),
  route text not null check (length(route) between 1 and 160 and left(route, 1) = '/'),
  target text check (target is null or length(target) <= 64),
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 3600),
  event_key text unique,
  order_id uuid references public.orders(id) on delete set null,
  marketing_link_id uuid references public.marketing_links(id) on delete set null,
  device_class text not null default 'unknown' check (device_class in ('desktop', 'mobile', 'tablet', 'unknown')),
  referrer_group text not null default 'direct' check (referrer_group in ('direct', 'internal', 'search', 'x', 'other')),
  suspected_bot boolean not null default false,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists marketing_link_id uuid references public.marketing_links(id) on delete set null,
  add column if not exists activity_session_id uuid;

create index if not exists marketing_links_dimensions_idx
  on public.marketing_links (created_at desc, campaign, channel, variant);
create index if not exists marketing_events_link_time_idx
  on public.marketing_events (marketing_link_id, created_at);
create index if not exists marketing_events_activity_session_idx
  on public.marketing_events (activity_session_id, created_at desc)
  where activity_session_id is not null;
create index if not exists marketing_link_visits_link_time_idx
  on public.marketing_link_visits (marketing_link_id, visited_at desc);
create index if not exists marketing_link_visits_quality_time_idx
  on public.marketing_link_visits (is_internal, suspected_bot, visited_at desc);
create index if not exists orders_marketing_link_idx
  on public.orders (marketing_link_id) where marketing_link_id is not null;
create index if not exists customer_activity_events_time_idx
  on public.customer_activity_events (created_at desc);
create index if not exists customer_activity_events_session_time_idx
  on public.customer_activity_events (session_id, created_at);
create index if not exists customer_activity_events_quality_time_idx
  on public.customer_activity_events (is_internal, suspected_bot, created_at desc);
create index if not exists customer_activity_events_marketing_link_idx
  on public.customer_activity_events (marketing_link_id, created_at desc)
  where marketing_link_id is not null;
create index if not exists orders_activity_session_id_idx
  on public.orders (activity_session_id) where activity_session_id is not null;

drop trigger if exists touch_marketing_links_updated_at on public.marketing_links;
create trigger touch_marketing_links_updated_at
before update on public.marketing_links
for each row execute function public.touch_updated_at();

create or replace function public.record_marketing_link_generated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.marketing_events (marketing_link_id, event_type, is_internal)
  values (new.id, 'link_generated', false)
  on conflict (marketing_link_id, event_type, is_internal) do nothing;
  return new;
end;
$$;

drop trigger if exists record_marketing_link_generated on public.marketing_links;
create trigger record_marketing_link_generated
after insert on public.marketing_links
for each row execute function public.record_marketing_link_generated();

create or replace function public.record_marketing_link_click(
  p_link_id uuid,
  p_device_class text,
  p_referrer_group text,
  p_suspected_bot boolean,
  p_is_internal boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketing_links
  set click_count = click_count + 1,
      first_clicked_at = coalesce(first_clicked_at, now()),
      last_clicked_at = now()
  where id = p_link_id and expires_at > now();

  if found then
    insert into public.marketing_link_visits (
      marketing_link_id, device_class, referrer_group, suspected_bot, is_internal
    ) values (
      p_link_id, p_device_class, p_referrer_group, p_suspected_bot, p_is_internal
    );

    insert into public.marketing_events (marketing_link_id, event_type, is_internal)
    values (p_link_id, 'link_clicked', p_is_internal)
    on conflict (marketing_link_id, event_type, is_internal) do nothing;
  end if;
end;
$$;

revoke all on function public.record_marketing_link_click(uuid, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_marketing_link_click(uuid, text, text, boolean, boolean) to service_role;

alter table public.marketing_links enable row level security;
alter table public.marketing_events enable row level security;
alter table public.marketing_link_visits enable row level security;
alter table public.marketing_ingest_nonces enable row level security;
alter table public.customer_activity_events enable row level security;

grant select on table public.marketing_links, public.marketing_events, public.marketing_link_visits to authenticated;
revoke all on table public.customer_activity_events from anon, authenticated;
grant select on table public.customer_activity_events to authenticated;
grant select, insert, update, delete on table
  public.marketing_links, public.marketing_events, public.marketing_link_visits, public.marketing_ingest_nonces,
  public.customer_activity_events
to service_role;

drop policy if exists "Admins view marketing links" on public.marketing_links;
create policy "Admins view marketing links"
on public.marketing_links for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins view marketing events" on public.marketing_events;
create policy "Admins view marketing events"
on public.marketing_events for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins view marketing link visits" on public.marketing_link_visits;
create policy "Admins view marketing link visits"
on public.marketing_link_visits for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

insert into public.marketing_events (marketing_link_id, event_type, is_internal)
select id, 'link_generated', false from public.marketing_links
on conflict (marketing_link_id, event_type, is_internal) do nothing;

drop policy if exists "Admins view customer activity" on public.customer_activity_events;
create policy "Admins view customer activity"
on public.customer_activity_events for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

create table if not exists public.x_lead_account_blacklist (
  author_hash text primary key check (author_hash ~ '^[a-f0-9]{64}$'),
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,50}$'),
  reason text not null default 'manual_review' check (length(reason) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_lead_account_blacklist_handle_idx
  on public.x_lead_account_blacklist (lower(x_handle));
create index if not exists x_lead_account_blacklist_created_by_idx
  on public.x_lead_account_blacklist (created_by) where created_by is not null;

drop trigger if exists touch_x_lead_account_blacklist_updated_at on public.x_lead_account_blacklist;
create trigger touch_x_lead_account_blacklist_updated_at
before update on public.x_lead_account_blacklist
for each row execute function public.touch_updated_at();

alter table public.x_lead_account_blacklist enable row level security;
revoke all on table public.x_lead_account_blacklist from anon, authenticated;
grant select, insert, update, delete on table public.x_lead_account_blacklist to service_role;

create table if not exists public.x_reply_accounts (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique check (account_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  display_name text not null check (length(display_name) between 1 and 80),
  positioning text not null check (length(positioning) between 1 and 500),
  audience text not null check (length(audience) between 1 and 500),
  voice text not null check (length(voice) between 1 and 500),
  topics text[] not null default '{}'::text[],
  prohibited_topics text not null default '',
  daily_limit integer not null default 5 check (daily_limit between 1 and 20),
  copy_style text not null default 'warm'
    check (copy_style in ('warm', 'playful', 'concise')),
  copy_variation_notes text not null default ''
    check (length(copy_variation_notes) <= 500),
  bitbrowser_window_id text,
  bitbrowser_window_name text not null default '',
  executor_id text check (executor_id is null or length(executor_id) between 1 and 120),
  network_mode text not null default 'vpn_direct'
    check (network_mode in ('vpn_direct', 'fixed_proxy')),
  expected_egress_ip inet,
  require_daily_first_confirmation boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_reply_account_proxies (
  account_id uuid primary key references public.x_reply_accounts(id) on delete cascade,
  encrypted_url text not null check (length(encrypted_url) between 32 and 4096),
  display_host text not null check (length(display_host) between 1 and 255),
  expected_country text not null default 'US' check (expected_country ~ '^[A-Z]{2}$'),
  expected_region text not null default '' check (length(expected_region) <= 100),
  status text not null default 'pending' check (status in ('pending', 'healthy', 'error')),
  egress_ip inet,
  last_tested_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.x_reply_accounts(id) on delete restrict,
  x_lead_id uuid references public.x_leads(id) on delete set null,
  action_type text not null default 'reply' check (action_type in ('post', 'reply')),
  target_post_url text,
  reply_text text not null check (length(reply_text) between 1 and 270),
  scheduled_for timestamptz not null default now(),
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'claimed', 'sent', 'failed', 'uncertain', 'rejected')),
  preparation_status text not null default 'ready'
    check (preparation_status in ('pending', 'processing', 'ready', 'failed')),
  preparation_error text,
  prepared_at timestamptz,
  account_key_snapshot text,
  positioning_snapshot text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  worker_id text,
  xuse_draft_id text,
  action_id text,
  result_url text,
  error_code text,
  error_message text,
  egress_ip inet,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_reply_jobs_action_target_check check (
    (action_type = 'post' and target_post_url is null)
    or
    (action_type = 'reply' and target_post_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+')
  )
);

create table if not exists public.x_manual_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.x_reply_accounts(id) on delete restrict,
  x_lead_id uuid references public.x_leads(id) on delete set null,
  action_type text not null check (action_type in ('post', 'reply')),
  target_post_url text,
  post_text text not null check (length(post_text) between 1 and 270),
  status text not null default 'draft' check (status in ('draft', 'sent', 'discarded')),
  preparation_status text not null default 'ready'
    check (preparation_status in ('pending', 'processing', 'ready', 'failed')),
  preparation_error text,
  prepared_at timestamptz,
  result_url text check (result_url is null or result_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+'),
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_manual_posts_action_target_check check (
    (action_type = 'post' and target_post_url is null)
    or
    (action_type = 'reply' and target_post_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+')
  )
);

create table if not exists public.x_reply_daily_gates (
  account_id uuid not null references public.x_reply_accounts(id) on delete cascade,
  gate_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'awaiting_confirmation', 'authorized', 'paused')),
  first_job_id uuid references public.x_reply_jobs(id) on delete set null,
  first_sent_at timestamptz,
  authorized_at timestamptz,
  authorized_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, gate_date)
);

create table if not exists public.x_reply_workers (
  worker_id text primary key check (length(worker_id) between 1 and 120),
  status text not null default 'paused' check (status in ('online', 'busy', 'paused', 'error')),
  xuse_available boolean not null default false,
  configured_accounts text[] not null default '{}'::text[],
  bitbrowser_available boolean not null default false,
  bitbrowser_version text,
  bitbrowser_windows jsonb not null default '[]'::jsonb,
  executor_id text check (executor_id is null or length(executor_id) between 1 and 120),
  execution_mode text not null default 'observe'
    check (execution_mode in ('observe', 'send')),
  device_label text,
  current_egress_ip inet,
  network_probe_status text not null default 'unknown'
    check (network_probe_status in ('unknown', 'healthy', 'mismatch', 'error')),
  current_job_id uuid references public.x_reply_jobs(id) on delete set null,
  worker_version text,
  last_error text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_reply_jobs_queue_idx on public.x_reply_jobs (status, created_at);
create index if not exists x_reply_jobs_account_history_idx on public.x_reply_jobs (account_id, created_at desc);
create unique index if not exists x_reply_jobs_no_duplicate_active_target_idx
  on public.x_reply_jobs (account_id, target_post_url)
  where action_type = 'reply' and status in ('queued', 'claimed', 'sent', 'uncertain');
create index if not exists x_reply_jobs_due_queue_idx
  on public.x_reply_jobs (scheduled_for, created_at) where status = 'queued' and attempt_count = 0;
create index if not exists x_reply_jobs_preparation_idx
  on public.x_reply_jobs (preparation_status, created_at desc)
  where preparation_status in ('pending', 'processing', 'failed');
create index if not exists x_reply_jobs_x_lead_idx
  on public.x_reply_jobs (x_lead_id, created_at desc) where x_lead_id is not null;
create index if not exists x_manual_posts_account_history_idx
  on public.x_manual_posts (account_id, created_at desc);
create unique index if not exists x_manual_posts_one_task_per_lead_idx
  on public.x_manual_posts (x_lead_id) where x_lead_id is not null;
create index if not exists x_manual_posts_preparation_idx
  on public.x_manual_posts (preparation_status, created_at desc)
  where preparation_status in ('pending', 'processing', 'failed');
create index if not exists x_manual_posts_created_by_idx
  on public.x_manual_posts (created_by) where created_by is not null;
create index if not exists x_reply_accounts_created_by_idx
  on public.x_reply_accounts (created_by) where created_by is not null;
create unique index if not exists x_reply_accounts_bitbrowser_window_id_unique
  on public.x_reply_accounts (bitbrowser_window_id)
  where bitbrowser_window_id is not null;
create index if not exists x_reply_accounts_executor_active_idx
  on public.x_reply_accounts (executor_id, id)
  where active = true and executor_id is not null;
create index if not exists x_reply_account_proxies_status_idx
  on public.x_reply_account_proxies (status, last_tested_at desc);
create unique index if not exists x_reply_account_proxies_unique_egress_idx
  on public.x_reply_account_proxies (egress_ip) where egress_ip is not null;
create index if not exists x_reply_jobs_approved_by_idx
  on public.x_reply_jobs (approved_by) where approved_by is not null;
create index if not exists x_reply_jobs_created_by_idx
  on public.x_reply_jobs (created_by) where created_by is not null;
create index if not exists x_reply_workers_current_job_id_idx
  on public.x_reply_workers (current_job_id) where current_job_id is not null;
create unique index if not exists x_reply_workers_executor_id_unique
  on public.x_reply_workers (executor_id) where executor_id is not null;
create index if not exists x_reply_daily_gates_date_status_idx
  on public.x_reply_daily_gates (gate_date, status);
create index if not exists x_reply_daily_gates_first_job_id_idx
  on public.x_reply_daily_gates (first_job_id) where first_job_id is not null;
create index if not exists x_reply_daily_gates_authorized_by_idx
  on public.x_reply_daily_gates (authorized_by) where authorized_by is not null;

drop trigger if exists touch_x_reply_accounts_updated_at on public.x_reply_accounts;
create trigger touch_x_reply_accounts_updated_at before update on public.x_reply_accounts
for each row execute function public.touch_updated_at();
drop trigger if exists touch_x_reply_account_proxies_updated_at on public.x_reply_account_proxies;
create trigger touch_x_reply_account_proxies_updated_at before update on public.x_reply_account_proxies
for each row execute function public.touch_updated_at();
drop trigger if exists touch_x_reply_jobs_updated_at on public.x_reply_jobs;
create trigger touch_x_reply_jobs_updated_at before update on public.x_reply_jobs
for each row execute function public.touch_updated_at();
drop trigger if exists touch_x_reply_workers_updated_at on public.x_reply_workers;
create trigger touch_x_reply_workers_updated_at before update on public.x_reply_workers
for each row execute function public.touch_updated_at();
drop trigger if exists touch_x_reply_daily_gates_updated_at on public.x_reply_daily_gates;
create trigger touch_x_reply_daily_gates_updated_at before update on public.x_reply_daily_gates
for each row execute function public.touch_updated_at();
drop trigger if exists touch_x_manual_posts_updated_at on public.x_manual_posts;
create trigger touch_x_manual_posts_updated_at before update on public.x_manual_posts
for each row execute function public.touch_updated_at();

alter table public.x_reply_accounts enable row level security;
alter table public.x_reply_account_proxies enable row level security;
alter table public.x_reply_jobs enable row level security;
alter table public.x_reply_workers enable row level security;
alter table public.x_reply_daily_gates enable row level security;
alter table public.x_manual_posts enable row level security;
revoke all on table public.x_reply_accounts, public.x_reply_account_proxies, public.x_reply_jobs, public.x_reply_workers, public.x_reply_daily_gates, public.x_manual_posts from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.x_reply_accounts, public.x_reply_account_proxies, public.x_reply_jobs, public.x_reply_workers, public.x_reply_daily_gates, public.x_manual_posts to service_role;

comment on column public.x_reply_accounts.copy_style is
  'Deterministic per-account copy profile used to vary approved outreach drafts.';
comment on column public.x_reply_accounts.copy_variation_notes is
  'Operator guidance for the account voice; never interpreted as permission to auto-send.';
comment on column public.x_reply_accounts.bitbrowser_window_id is
  'BitBrowser local API browser environment id. One X account must map to exactly one environment.';
comment on column public.x_reply_accounts.executor_id is
  'Stable local executor binding. A worker cannot claim jobs for accounts bound to another executor.';
comment on column public.x_reply_accounts.network_mode is
  'Network policy: vpn_direct uses the macOS system VPN; fixed_proxy uses one non-rotating per-account proxy.';
comment on column public.x_reply_accounts.expected_egress_ip is
  'Administrator-confirmed VPN egress. Worker observations never replace this value automatically.';
comment on column public.x_reply_workers.execution_mode is
  'Fail-closed local mode. observe only reports health; send is required before any job can be claimed.';
comment on column public.x_reply_workers.current_egress_ip is
  'Cookie-free Patchright browser egress observation. Never sourced from a plain HTTP client.';
comment on column public.x_reply_jobs.egress_ip is
  'Browser route observed immediately before the single X write attempt.';
comment on table public.x_reply_daily_gates is
  'Daily first-post supervision gate in Asia/Shanghai. The first successful send waits for an admin release before later jobs can run.';
comment on table public.x_reply_account_proxies is
  'Application-encrypted per-account proxy routes. Plaintext credentials are only released to the authenticated local worker.';
