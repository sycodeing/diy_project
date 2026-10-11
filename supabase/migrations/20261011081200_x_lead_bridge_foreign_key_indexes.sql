create index if not exists x_lead_search_configs_created_by_idx
  on public.x_lead_search_configs (created_by);

create index if not exists x_lead_search_jobs_config_id_idx
  on public.x_lead_search_jobs (config_id);

create index if not exists x_lead_search_jobs_created_by_idx
  on public.x_lead_search_jobs (created_by);

create index if not exists x_leads_source_job_id_idx
  on public.x_leads (source_job_id);
