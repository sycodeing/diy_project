create index if not exists x_reply_accounts_created_by_idx
  on public.x_reply_accounts (created_by) where created_by is not null;
create index if not exists x_reply_jobs_approved_by_idx
  on public.x_reply_jobs (approved_by) where approved_by is not null;
create index if not exists x_reply_jobs_created_by_idx
  on public.x_reply_jobs (created_by) where created_by is not null;
create index if not exists x_reply_workers_current_job_id_idx
  on public.x_reply_workers (current_job_id) where current_job_id is not null;
