create extension if not exists pg_cron with schema extensions;

create or replace function public.enqueue_due_x_lead_search_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enqueued integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  with due_configs as materialized (
    select config.*
    from public.x_lead_search_configs as config
    where config.enabled
      and config.next_run_at is not null
      and config.next_run_at <= v_now
    for update skip locked
  )
  insert into public.x_lead_search_jobs (
    config_id,
    trigger_type,
    status,
    configuration,
    created_by
  )
  select
    config.id,
    'scheduled',
    'queued',
    jsonb_build_object(
      'segments', config.segments,
      'searchProduct', config.search_product,
      'resultLimit', config.result_limit,
      'lookbackDays', config.lookback_days,
      'usRequired', config.us_required,
      'usMinConfidence', config.us_min_confidence,
      'intervalMinutes', config.interval_minutes
    ),
    config.created_by
  from due_configs as config
  where not exists (
    select 1
    from public.x_lead_search_jobs as active_job
    where active_job.config_id = config.id
      and active_job.status in ('queued', 'running')
  );

  get diagnostics v_enqueued = row_count;

  update public.x_lead_search_configs as config
  set last_enqueued_at = v_now,
      next_run_at = v_now + make_interval(mins => config.interval_minutes)
  where config.enabled
    and config.next_run_at is not null
    and config.next_run_at <= v_now;

  return v_enqueued;
end;
$$;

revoke all on function public.enqueue_due_x_lead_search_jobs() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'x-lead-search-queue';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'x-lead-search-queue',
    '0 * * * *',
    $schedule$select public.enqueue_due_x_lead_search_jobs();$schedule$
  );
end;
$$;

comment on function public.enqueue_due_x_lead_search_jobs() is
  'Queues due X lead searches. Called hourly by Supabase Cron so Vercel Hobby cron limits do not apply.';
