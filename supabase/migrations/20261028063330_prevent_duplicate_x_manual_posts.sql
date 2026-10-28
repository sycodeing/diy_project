create unique index if not exists x_manual_posts_one_task_per_lead_idx
  on public.x_manual_posts (x_lead_id)
  where x_lead_id is not null;

comment on index public.x_manual_posts_one_task_per_lead_idx is
  'Makes manual queue creation idempotent: each X lead can have at most one manual task.';
