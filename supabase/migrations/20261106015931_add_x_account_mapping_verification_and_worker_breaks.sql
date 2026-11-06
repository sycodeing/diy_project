alter table public.x_reply_accounts
  add column if not exists expected_x_handle text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_requested_at timestamptz,
  add column if not exists verification_started_at timestamptz,
  add column if not exists verification_completed_at timestamptz,
  add column if not exists verified_x_handle text,
  add column if not exists verified_egress_ip inet,
  add column if not exists verification_error text;

update public.x_reply_accounts
set expected_x_handle = account_key
where expected_x_handle is null
  and account_key ~ '^[A-Za-z0-9_]{1,15}$';

alter table public.x_reply_accounts
  add constraint x_reply_accounts_expected_x_handle_check
    check (expected_x_handle is null or expected_x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  add constraint x_reply_accounts_verification_status_check
    check (verification_status in ('unverified', 'pending', 'running', 'passed', 'failed')),
  add constraint x_reply_accounts_verified_x_handle_check
    check (verified_x_handle is null or verified_x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  add constraint x_reply_accounts_verification_error_check
    check (verification_error is null or length(verification_error) <= 1000);

alter table public.x_reply_workers
  add column if not exists batch_sent_count integer not null default 0,
  add column if not exists cooldown_until timestamptz;

alter table public.x_reply_workers
  add constraint x_reply_workers_batch_sent_count_check
    check (batch_sent_count between 0 and 11);

create index if not exists x_reply_accounts_pending_verification_idx
  on public.x_reply_accounts (executor_id, verification_requested_at)
  where verification_status = 'pending' and executor_id is not null;

comment on column public.x_reply_accounts.expected_x_handle is
  'Expected signed-in X handle. Mapping verification compares this with visible signed-in owner navigation.';
comment on column public.x_reply_accounts.verification_status is
  'Read-only account/IP mapping verification lifecycle executed by the bound Mac worker.';
comment on column public.x_reply_workers.batch_sent_count is
  'Confirmed sends since the last 45-minute rest; resets after the twelfth send.';
comment on column public.x_reply_workers.cooldown_until is
  'Worker cannot claim another write before this time.';
