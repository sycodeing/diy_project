create table if not exists public.customer_activity_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  event_type text not null check (event_type in ('page_view', 'page_exit', 'click', 'checkout_started', 'purchase_completed')),
  route text not null check (length(route) between 1 and 160 and left(route, 1) = '/'),
  target text check (target is null or length(target) <= 64),
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 3600),
  event_key text unique,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists activity_session_id uuid;

create index if not exists customer_activity_events_time_idx
  on public.customer_activity_events (created_at desc);
create index if not exists customer_activity_events_session_time_idx
  on public.customer_activity_events (session_id, created_at);
create index if not exists orders_activity_session_id_idx
  on public.orders (activity_session_id) where activity_session_id is not null;

alter table public.customer_activity_events enable row level security;
revoke all on public.customer_activity_events from anon, authenticated;
grant select on public.customer_activity_events to authenticated;
grant insert, select, update, delete on public.customer_activity_events to service_role;

drop policy if exists "Admins view customer activity" on public.customer_activity_events;
create policy "Admins view customer activity"
on public.customer_activity_events for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);
