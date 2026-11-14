alter table public.x_reply_jobs
  add column if not exists inspection_status text not null default 'idle',
  add column if not exists inspection_target_url text,
  add column if not exists inspection_executor_id text,
  add column if not exists inspection_requested_at timestamptz,
  add column if not exists inspection_started_at timestamptz,
  add column if not exists inspection_completed_at timestamptz,
  add column if not exists inspection_error text;

alter table public.x_reply_jobs
  drop constraint if exists x_reply_jobs_inspection_status_check,
  add constraint x_reply_jobs_inspection_status_check
    check (inspection_status in ('idle', 'pending', 'running', 'completed', 'failed')),
  drop constraint if exists x_reply_jobs_inspection_target_url_check,
  add constraint x_reply_jobs_inspection_target_url_check
    check (
      inspection_target_url is null
      or inspection_target_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+'
    ),
  drop constraint if exists x_reply_jobs_inspection_executor_id_check,
  add constraint x_reply_jobs_inspection_executor_id_check
    check (inspection_executor_id is null or length(inspection_executor_id) between 1 and 120),
  drop constraint if exists x_reply_jobs_inspection_error_check,
  add constraint x_reply_jobs_inspection_error_check
    check (inspection_error is null or length(inspection_error) <= 1000);

create index if not exists x_reply_jobs_pending_inspection_idx
  on public.x_reply_jobs (inspection_requested_at)
  where inspection_status = 'pending';

comment on column public.x_reply_jobs.inspection_status is
  'Lifecycle for a read-only X post inspection opened by the bound Mac worker through the job account route.';
comment on column public.x_reply_jobs.inspection_target_url is
  'X status URL captured when an administrator requests a bound-route inspection.';
