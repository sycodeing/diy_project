alter table public.orders
  add column if not exists payment_provider text not null default 'stripe',
  add column if not exists paypal_order_id text,
  add column if not exists paypal_capture_id text;

alter table public.orders
  drop constraint if exists orders_payment_provider_check;

alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('stripe', 'paypal'));

create unique index if not exists orders_paypal_order_id_idx
  on public.orders (paypal_order_id)
  where paypal_order_id is not null;

create unique index if not exists orders_paypal_capture_id_idx
  on public.orders (paypal_capture_id)
  where paypal_capture_id is not null;
