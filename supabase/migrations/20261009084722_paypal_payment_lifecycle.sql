alter type public.payment_status add value if not exists 'payment_pending' after 'pending_payment';
alter type public.payment_status add value if not exists 'partially_refunded' after 'paid';
alter type public.payment_status add value if not exists 'refunded' after 'partially_refunded';
alter type public.payment_status add value if not exists 'reversed' after 'refunded';
alter type public.payment_status add value if not exists 'disputed' after 'reversed';

alter table public.orders
  add column if not exists paypal_dispute_id text,
  add column if not exists paypal_refunded_amount_cents integer not null default 0,
  add column if not exists payment_attention_required boolean not null default false;

alter table public.orders
  drop constraint if exists orders_paypal_refunded_amount_cents_check;
alter table public.orders
  add constraint orders_paypal_refunded_amount_cents_check
  check (paypal_refunded_amount_cents >= 0);

create index if not exists orders_paypal_dispute_id_idx
  on public.orders (paypal_dispute_id)
  where paypal_dispute_id is not null;

create index if not exists orders_payment_attention_required_idx
  on public.orders (updated_at desc)
  where payment_attention_required;

create table if not exists public.paypal_payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  paypal_event_id text not null unique,
  event_type text not null,
  resource_id text,
  resource_status text,
  paypal_order_id text,
  paypal_capture_id text,
  paypal_dispute_id text,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  currency text,
  summary text,
  occurred_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed')),
  last_error text,
  event_metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paypal_payment_events_order_time_idx
  on public.paypal_payment_events (order_id, created_at desc);
create index if not exists paypal_payment_events_capture_idx
  on public.paypal_payment_events (paypal_capture_id)
  where paypal_capture_id is not null;
create index if not exists paypal_payment_events_dispute_idx
  on public.paypal_payment_events (paypal_dispute_id)
  where paypal_dispute_id is not null;

drop trigger if exists touch_paypal_payment_events_updated_at
  on public.paypal_payment_events;
create trigger touch_paypal_payment_events_updated_at
before update on public.paypal_payment_events
for each row execute function public.touch_updated_at();

alter table public.paypal_payment_events enable row level security;

revoke all on table public.paypal_payment_events from public, anon, authenticated;
grant select on table public.paypal_payment_events to authenticated;
grant select, insert, update, delete on table public.paypal_payment_events to service_role;

drop policy if exists "Admins view PayPal payment events"
  on public.paypal_payment_events;
create policy "Admins view PayPal payment events"
on public.paypal_payment_events for select
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);
