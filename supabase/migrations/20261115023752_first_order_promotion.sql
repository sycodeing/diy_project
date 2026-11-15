create table public.sales_promotions (
  key text primary key,
  product_slug text not null references public.products(slug),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint first_order_promotion_key check (key = 'first_order')
);

alter table public.sales_promotions enable row level security;
revoke all on public.sales_promotions from anon, authenticated;
grant select, update on public.sales_promotions to service_role;

insert into public.sales_promotions (key, product_slug, price_cents, currency, active)
values ('first_order', 'custom-pillow', 1499, 'usd', true);
