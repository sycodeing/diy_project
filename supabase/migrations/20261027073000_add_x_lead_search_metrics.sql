alter table public.x_lead_search_jobs
  add column if not exists metrics jsonb not null default '{}'::jsonb;

comment on column public.x_lead_search_jobs.metrics is
  'Provider and discovery funnel counters reported by the local read-only worker.';
