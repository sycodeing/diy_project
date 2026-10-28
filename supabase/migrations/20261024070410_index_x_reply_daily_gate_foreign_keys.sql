create index if not exists x_reply_daily_gates_first_job_id_idx
  on public.x_reply_daily_gates (first_job_id)
  where first_job_id is not null;

create index if not exists x_reply_daily_gates_authorized_by_idx
  on public.x_reply_daily_gates (authorized_by)
  where authorized_by is not null;
