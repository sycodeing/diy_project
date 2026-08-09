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

alter table public.orders
  add column if not exists sales_channel text not null default 'direct',
  add column if not exists temu_parent_order_sn text,
  add column if not exists temu_order_sn text,
  add column if not exists temu_status temu_order_status not null default 'NOT_SUBMITTED',
  add column if not exists temu_status_label text,
  add column if not exists temu_last_synced_at timestamptz,
  add column if not exists temu_raw jsonb;

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

