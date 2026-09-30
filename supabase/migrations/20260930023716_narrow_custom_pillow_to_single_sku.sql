with product as (
  select id from public.products where slug = 'custom-pillow'
)
update public.products
set
  name = 'Custom Pillow Cover Set',
  description = 'Two personalized 18in/45cm polyester pillow covers. Inserts are not included.',
  base_price_cents = 1999,
  currency = 'usd',
  active = true
where id in (select id from product);

with product as (
  select id from public.products where slug = 'custom-pillow'
)
insert into public.product_options (
  product_id,
  option_type,
  value,
  label,
  metadata,
  sort_order
)
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
  currency,
  active
)
select
  product.id,
  'PILLOW-COVER-STANDARD-45CM-2PCS',
  'standard-white',
  'polyester-cover',
  '18in/45cm',
  1999,
  'usd',
  true
from product
on conflict (product_id, color, style, size) do update set
  sku = excluded.sku,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  active = true;
