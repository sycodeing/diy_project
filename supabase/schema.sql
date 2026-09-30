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
    'shipped'
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
  active boolean not null default true,
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
  currency
) values (
  'custom-pillow',
  'Custom Pillow Cover Set',
  'pillow',
  'Two personalized 18in/45cm polyester pillow covers. Inserts are not included.',
  1999,
  'usd'
) on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  base_price_cents = excluded.base_price_cents,
  currency = excluded.currency,
  active = true;

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
    'link_generated', 'link_clicked', 'design_opened', 'preview_ready',
    'checkout_started', 'payment_completed'
  )),
  order_id uuid references public.orders(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (marketing_link_id, event_type)
);

create table if not exists public.marketing_ingest_nonces (
  nonce text primary key,
  request_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists marketing_link_id uuid references public.marketing_links(id) on delete set null;

create index if not exists marketing_links_dimensions_idx
  on public.marketing_links (created_at desc, campaign, channel, variant);
create index if not exists marketing_events_link_time_idx
  on public.marketing_events (marketing_link_id, created_at);
create index if not exists orders_marketing_link_idx
  on public.orders (marketing_link_id) where marketing_link_id is not null;

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
  insert into public.marketing_events (marketing_link_id, event_type)
  values (new.id, 'link_generated')
  on conflict (marketing_link_id, event_type) do nothing;
  return new;
end;
$$;

drop trigger if exists record_marketing_link_generated on public.marketing_links;
create trigger record_marketing_link_generated
after insert on public.marketing_links
for each row execute function public.record_marketing_link_generated();

create or replace function public.record_marketing_link_click(p_link_id uuid)
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
    insert into public.marketing_events (marketing_link_id, event_type)
    values (p_link_id, 'link_clicked')
    on conflict (marketing_link_id, event_type) do nothing;
  end if;
end;
$$;

revoke all on function public.record_marketing_link_click(uuid) from public, anon, authenticated;
grant execute on function public.record_marketing_link_click(uuid) to service_role;

alter table public.marketing_links enable row level security;
alter table public.marketing_events enable row level security;
alter table public.marketing_ingest_nonces enable row level security;

grant select on table public.marketing_links, public.marketing_events to authenticated;
grant select, insert, update, delete on table
  public.marketing_links, public.marketing_events, public.marketing_ingest_nonces
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

insert into public.marketing_events (marketing_link_id, event_type)
select id, 'link_generated' from public.marketing_links
on conflict (marketing_link_id, event_type) do nothing;
