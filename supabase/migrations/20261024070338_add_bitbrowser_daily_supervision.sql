alter table public.x_reply_accounts
  add column if not exists bitbrowser_window_id text,
  add column if not exists bitbrowser_window_name text not null default '',
  add column if not exists require_daily_first_confirmation boolean not null default true;

create unique index if not exists x_reply_accounts_bitbrowser_window_id_unique
  on public.x_reply_accounts (bitbrowser_window_id)
  where bitbrowser_window_id is not null;

create table if not exists public.x_reply_daily_gates (
  account_id uuid not null references public.x_reply_accounts(id) on delete cascade,
  gate_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'awaiting_confirmation', 'authorized', 'paused')),
  first_job_id uuid references public.x_reply_jobs(id) on delete set null,
  first_sent_at timestamptz,
  authorized_at timestamptz,
  authorized_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, gate_date)
);

create index if not exists x_reply_daily_gates_date_status_idx
  on public.x_reply_daily_gates (gate_date, status);

drop trigger if exists touch_x_reply_daily_gates_updated_at on public.x_reply_daily_gates;
create trigger touch_x_reply_daily_gates_updated_at
before update on public.x_reply_daily_gates
for each row execute function public.touch_updated_at();

alter table public.x_reply_workers
  add column if not exists bitbrowser_available boolean not null default false,
  add column if not exists bitbrowser_version text,
  add column if not exists bitbrowser_windows jsonb not null default '[]'::jsonb;

alter table public.x_reply_daily_gates enable row level security;
revoke all on table public.x_reply_daily_gates from anon, authenticated;
grant select, insert, update, delete on table public.x_reply_daily_gates to service_role;

comment on column public.x_reply_accounts.bitbrowser_window_id is
  'BitBrowser local API browser environment id. One X account must map to exactly one environment.';
comment on table public.x_reply_daily_gates is
  'Daily first-post supervision gate in Asia/Shanghai. The first successful send waits for an admin release before later jobs can run.';
