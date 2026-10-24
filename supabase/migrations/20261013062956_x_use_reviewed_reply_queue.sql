create table if not exists public.x_reply_accounts (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique
    check (account_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  display_name text not null check (length(display_name) between 1 and 80),
  positioning text not null check (length(positioning) between 1 and 500),
  audience text not null check (length(audience) between 1 and 500),
  voice text not null check (length(voice) between 1 and 500),
  topics text[] not null default '{}'::text[],
  prohibited_topics text not null default '',
  daily_limit integer not null default 5 check (daily_limit between 1 and 20),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.x_reply_accounts(id) on delete restrict,
  target_post_url text not null
    check (target_post_url ~ '^https://(www\.)?(x|twitter)\.com/'),
  reply_text text not null check (length(reply_text) between 1 and 270),
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'claimed', 'sent', 'failed', 'uncertain', 'rejected')),
  account_key_snapshot text,
  positioning_snapshot text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  worker_id text,
  xuse_draft_id text,
  action_id text,
  result_url text,
  error_code text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_reply_workers (
  worker_id text primary key check (length(worker_id) between 1 and 120),
  status text not null default 'paused'
    check (status in ('online', 'busy', 'paused', 'error')),
  xuse_available boolean not null default false,
  configured_accounts text[] not null default '{}'::text[],
  current_job_id uuid references public.x_reply_jobs(id) on delete set null,
  worker_version text,
  last_error text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_reply_jobs_queue_idx
  on public.x_reply_jobs (status, created_at);
create index if not exists x_reply_jobs_account_history_idx
  on public.x_reply_jobs (account_id, created_at desc);
create unique index if not exists x_reply_jobs_no_duplicate_active_target_idx
  on public.x_reply_jobs (account_id, target_post_url)
  where status in ('queued', 'claimed', 'sent', 'uncertain');

drop trigger if exists touch_x_reply_accounts_updated_at on public.x_reply_accounts;
create trigger touch_x_reply_accounts_updated_at
before update on public.x_reply_accounts
for each row execute function public.touch_updated_at();

drop trigger if exists touch_x_reply_jobs_updated_at on public.x_reply_jobs;
create trigger touch_x_reply_jobs_updated_at
before update on public.x_reply_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists touch_x_reply_workers_updated_at on public.x_reply_workers;
create trigger touch_x_reply_workers_updated_at
before update on public.x_reply_workers
for each row execute function public.touch_updated_at();

alter table public.x_reply_accounts enable row level security;
alter table public.x_reply_jobs enable row level security;
alter table public.x_reply_workers enable row level security;

revoke all on table
  public.x_reply_accounts,
  public.x_reply_jobs,
  public.x_reply_workers
from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.x_reply_accounts,
  public.x_reply_jobs,
  public.x_reply_workers
to service_role;

comment on table public.x_reply_accounts is
  'Public account positioning metadata only. X cookies and proxy credentials must remain on the local worker.';
comment on table public.x_reply_jobs is
  'Individually human-approved X replies. A claimed or uncertain write is never automatically retried.';
comment on table public.x_reply_workers is
  'Local x-use worker heartbeat and configured account keys; never stores X cookies.';
