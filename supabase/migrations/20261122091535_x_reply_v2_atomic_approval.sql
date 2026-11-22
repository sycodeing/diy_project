-- Both queues share one account row lock and daily-limit counter. Application
-- verification of the selected draft, worker, and marketing link precedes this RPC.
create or replace function public.approve_x_reply_job(p_job_id uuid, p_admin_id uuid, p_queue_version smallint)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job public.x_reply_jobs%rowtype;
  v_account public.x_reply_accounts%rowtype;
  v_now timestamptz := now();
  v_start timestamptz;
  v_count integer;
begin
  select * into v_job from public.x_reply_jobs
  where id = p_job_id and queue_version = p_queue_version and status = 'draft'
    and preparation_status = 'ready' and approved_at is null and attempt_count = 0
  for update;
  if not found then return false; end if;
  select * into v_account from public.x_reply_accounts
    where id = v_job.account_id and active = true for update;
  if not found then return false; end if;
  v_start := date_trunc('day', v_now at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  select count(*) into v_count from public.x_reply_jobs
  where account_id = v_job.account_id
    and status in ('queued', 'claimed', 'sent', 'uncertain')
    and scheduled_for >= v_start and scheduled_for < v_start + interval '1 day';
  if v_count >= v_account.daily_limit then return false; end if;
  update public.x_reply_jobs set
    status = 'queued', approved_by = p_admin_id, approved_at = v_now,
    scheduled_for = v_now,
    account_key_snapshot = v_account.account_key,
    positioning_snapshot = v_account.positioning
  where id = v_job.id and queue_version = p_queue_version and status = 'draft'
    and preparation_status = 'ready' and approved_at is null and attempt_count = 0;
  return found;
end;
$$;

revoke all on function public.approve_x_reply_job(uuid, uuid, smallint) from public, anon, authenticated;
grant execute on function public.approve_x_reply_job(uuid, uuid, smallint) to service_role;
