alter type public.fulfillment_status add value if not exists 'ordered' before 'production';

alter table public.orders
  add column if not exists paid_at timestamptz;

alter table public.order_status_events
  add column if not exists external_event_id text;

create unique index if not exists order_status_events_external_event_id_idx
  on public.order_status_events (external_event_id);

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
      'configuration_required',
      'ready_for_payment',
      'in_progress',
      'login_required',
      'captcha_required',
      'payment_challenge',
      'address_review_required',
      'submit_uncertain',
      'temu_bound',
      'failed',
      'canceled'
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

drop trigger if exists touch_temu_purchase_jobs_updated_at on public.temu_purchase_jobs;
create trigger touch_temu_purchase_jobs_updated_at
before update on public.temu_purchase_jobs
for each row execute function public.touch_updated_at();

alter table public.temu_purchase_jobs enable row level security;

grant select, update on table public.temu_purchase_jobs to authenticated;
grant select, insert, update, delete on table public.temu_purchase_jobs to service_role;

drop policy if exists "Admins view Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins view Temu purchase jobs"
on public.temu_purchase_jobs for select
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = auth.uid()
  )
);

drop policy if exists "Admins update Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins update Temu purchase jobs"
on public.temu_purchase_jobs for update
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
