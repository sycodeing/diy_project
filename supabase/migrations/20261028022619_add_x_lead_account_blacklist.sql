create table if not exists public.x_lead_account_blacklist (
  author_hash text primary key check (author_hash ~ '^[a-f0-9]{64}$'),
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,50}$'),
  reason text not null default 'manual_review' check (length(reason) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_lead_account_blacklist_handle_idx
  on public.x_lead_account_blacklist (lower(x_handle));
create index if not exists x_lead_account_blacklist_created_by_idx
  on public.x_lead_account_blacklist (created_by) where created_by is not null;

drop trigger if exists touch_x_lead_account_blacklist_updated_at on public.x_lead_account_blacklist;
create trigger touch_x_lead_account_blacklist_updated_at
before update on public.x_lead_account_blacklist
for each row execute function public.touch_updated_at();

alter table public.x_lead_account_blacklist enable row level security;
revoke all on table public.x_lead_account_blacklist from anon, authenticated;
grant select, insert, update, delete on table public.x_lead_account_blacklist to service_role;

comment on table public.x_lead_account_blacklist is
  'X accounts excluded from future lead discovery. The hash is the normalized lowercase handle SHA-256 used by x_leads.';
