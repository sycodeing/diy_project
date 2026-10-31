alter table public.x_reply_accounts
  add column if not exists executor_id text,
  add column if not exists network_mode text not null default 'vpn_direct',
  add column if not exists expected_egress_ip inet;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'x_reply_accounts_executor_id_check'
      and conrelid = 'public.x_reply_accounts'::regclass
  ) then
    alter table public.x_reply_accounts
      add constraint x_reply_accounts_executor_id_check
      check (executor_id is null or length(executor_id) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'x_reply_accounts_network_mode_check'
      and conrelid = 'public.x_reply_accounts'::regclass
  ) then
    alter table public.x_reply_accounts
      add constraint x_reply_accounts_network_mode_check
      check (network_mode in ('vpn_direct', 'fixed_proxy'));
  end if;
end $$;

alter table public.x_reply_workers
  add column if not exists executor_id text,
  add column if not exists execution_mode text not null default 'observe',
  add column if not exists device_label text,
  add column if not exists current_egress_ip inet,
  add column if not exists network_probe_status text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'x_reply_workers_executor_id_check'
      and conrelid = 'public.x_reply_workers'::regclass
  ) then
    alter table public.x_reply_workers
      add constraint x_reply_workers_executor_id_check
      check (executor_id is null or length(executor_id) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'x_reply_workers_execution_mode_check'
      and conrelid = 'public.x_reply_workers'::regclass
  ) then
    alter table public.x_reply_workers
      add constraint x_reply_workers_execution_mode_check
      check (execution_mode in ('observe', 'send'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'x_reply_workers_network_probe_status_check'
      and conrelid = 'public.x_reply_workers'::regclass
  ) then
    alter table public.x_reply_workers
      add constraint x_reply_workers_network_probe_status_check
      check (network_probe_status in ('unknown', 'healthy', 'mismatch', 'error'));
  end if;
end $$;

alter table public.x_reply_jobs
  add column if not exists egress_ip inet;

create index if not exists x_reply_accounts_executor_active_idx
  on public.x_reply_accounts (executor_id, id)
  where active = true and executor_id is not null;

create unique index if not exists x_reply_workers_executor_id_unique
  on public.x_reply_workers (executor_id)
  where executor_id is not null;

comment on column public.x_reply_accounts.executor_id is
  'Stable local executor binding. A worker cannot claim jobs for accounts bound to another executor.';
comment on column public.x_reply_accounts.network_mode is
  'Network policy: vpn_direct uses the macOS system VPN; fixed_proxy uses one non-rotating per-account proxy.';
comment on column public.x_reply_accounts.expected_egress_ip is
  'Administrator-confirmed VPN egress. Worker observations never replace this value automatically.';
comment on column public.x_reply_workers.execution_mode is
  'Fail-closed local mode. observe only reports health; send is required before any job can be claimed.';
comment on column public.x_reply_workers.current_egress_ip is
  'Cookie-free Patchright browser egress observation. Never sourced from a plain HTTP client.';
comment on column public.x_reply_jobs.egress_ip is
  'Browser route observed immediately before the single X write attempt.';
