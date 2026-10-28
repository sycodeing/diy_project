alter table public.x_reply_accounts
  add column if not exists copy_style text not null default 'warm'
    check (copy_style in ('warm', 'playful', 'concise')),
  add column if not exists copy_variation_notes text not null default ''
    check (length(copy_variation_notes) <= 500);

create table if not exists public.x_reply_account_proxies (
  account_id uuid primary key references public.x_reply_accounts(id) on delete cascade,
  encrypted_url text not null check (length(encrypted_url) between 32 and 4096),
  display_host text not null check (length(display_host) between 1 and 255),
  expected_country text not null default 'US' check (expected_country ~ '^[A-Z]{2}$'),
  expected_region text not null default '' check (length(expected_region) <= 100),
  status text not null default 'pending'
    check (status in ('pending', 'healthy', 'error')),
  egress_ip inet,
  last_tested_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists touch_x_reply_account_proxies_updated_at on public.x_reply_account_proxies;
create trigger touch_x_reply_account_proxies_updated_at
before update on public.x_reply_account_proxies
for each row execute function public.touch_updated_at();

create index if not exists x_reply_account_proxies_status_idx
  on public.x_reply_account_proxies (status, last_tested_at desc);
create unique index if not exists x_reply_account_proxies_unique_egress_idx
  on public.x_reply_account_proxies (egress_ip) where egress_ip is not null;

alter table public.x_reply_account_proxies enable row level security;
revoke all on table public.x_reply_account_proxies from anon, authenticated;
grant select, insert, update, delete on table public.x_reply_account_proxies to service_role;

comment on column public.x_reply_accounts.copy_style is
  'Deterministic per-account copy profile used to vary approved outreach drafts.';
comment on column public.x_reply_accounts.copy_variation_notes is
  'Operator guidance for the account voice; never interpreted as permission to auto-send.';
comment on table public.x_reply_account_proxies is
  'Application-encrypted per-account proxy routes. Plaintext credentials are only released to the authenticated local worker.';
