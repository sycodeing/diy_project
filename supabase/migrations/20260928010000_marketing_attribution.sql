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
  set
    click_count = click_count + 1,
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
