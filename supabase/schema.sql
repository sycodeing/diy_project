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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status fulfillment_status not null,
  changed_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

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

alter table public.products enable row level security;
alter table public.product_options enable row level security;
alter table public.product_variants enable row level security;
alter table public.custom_designs enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_events enable row level security;
alter table public.admin_roles enable row level security;

grant select on table public.products to anon, authenticated;
grant select on table public.product_options to anon, authenticated;
grant select on table public.product_variants to anon, authenticated;
grant select, insert, update, delete on table public.custom_designs to authenticated;
grant select, insert, update on table public.orders to authenticated;
grant select, insert on table public.order_status_events to authenticated;
grant select on table public.admin_roles to authenticated;

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
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users view own orders" on public.orders;
create policy "Users view own orders"
on public.orders for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = auth.uid()
  )
);

drop policy if exists "Users create own orders" on public.orders;
create policy "Users create own orders"
on public.orders for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders"
on public.orders for update
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = auth.uid()
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
      orders.user_id = auth.uid()
      or exists (
        select 1 from public.admin_roles
        where admin_roles.user_id = auth.uid()
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
    where admin_roles.user_id = auth.uid()
  )
);

drop policy if exists "Users view own admin role" on public.admin_roles;
create policy "Users view own admin role"
on public.admin_roles for select
to authenticated
using (auth.uid() = user_id);

insert into public.products (
  slug,
  name,
  category,
  description,
  base_price_cents,
  currency
) values (
  'custom-pillow',
  'Custom Pillow',
  'pillow',
  'A soft 18in/45cm pillow built for personalized artwork and text.',
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
  ('color', 'soft-mint', 'Soft mint', '{"hex":"#dbeec6"}', 1),
  ('color', 'warm-cream', 'Warm cream', '{"hex":"#f7f1de"}', 2),
  ('color', 'baby-blue', 'Baby blue', '{"hex":"#d8ecff"}', 3),
  ('color', 'blush-pink', 'Blush pink', '{"hex":"#f8d7dc"}', 4),
  ('style', 'soft-plush', 'Soft plush cover', '{}', 1),
  ('style', 'smooth-peach', 'Smooth peach skin', '{}', 2),
  ('style', 'linen-texture', 'Linen texture cover', '{}', 3),
  ('size', '18in/45cm', '18in/45cm', '{}', 1),
  ('size', '16in/40cm', '16in/40cm', '{}', 2),
  ('size', '20in/50cm', '20in/50cm', '{}', 3)
) as options(option_type, value, label, metadata, sort_order)
on conflict (product_id, option_type, value) do update set
  label = excluded.label,
  metadata = excluded.metadata,
  sort_order = excluded.sort_order;

with product as (
  select id from public.products where slug = 'custom-pillow'
),
colors as (
  select unnest(array['soft-mint', 'warm-cream', 'baby-blue', 'blush-pink']) as color
),
styles as (
  select unnest(array['soft-plush', 'smooth-peach', 'linen-texture']) as style
),
sizes as (
  select unnest(array['18in/45cm', '16in/40cm', '20in/50cm']) as size
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
  'PILLOW-' || upper(replace(color, '-', '')) || '-' || upper(replace(style, '-', '')) || '-' || replace(replace(size, '/', ''), ' ', ''),
  color,
  style,
  size,
  1999,
  'usd'
from product, colors, styles, sizes
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
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users read own design assets" on storage.objects;
create policy "Users read own design assets"
on storage.objects for select
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own design assets" on storage.objects;
create policy "Users update own design assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own design assets" on storage.objects;
create policy "Users delete own design assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
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
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
