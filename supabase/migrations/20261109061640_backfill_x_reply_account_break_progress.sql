with legacy_workers as (
  select executor_id, batch_sent_count
  from public.x_reply_workers
  where executor_id is not null
    and batch_sent_count > 0
),
recent_confirmed_sends as (
  select
    jobs.account_id,
    row_number() over (
      partition by jobs.worker_id
      order by jobs.completed_at desc nulls last, jobs.id desc
    ) as send_rank,
    workers.batch_sent_count
  from public.x_reply_jobs as jobs
  join legacy_workers as workers on workers.executor_id = jobs.worker_id
  where jobs.status = 'sent'
),
account_progress as (
  select account_id, count(*)::integer as batch_sent_count
  from recent_confirmed_sends
  where send_rank <= batch_sent_count
  group by account_id
)
update public.x_reply_accounts as accounts
set batch_sent_count = progress.batch_sent_count
from account_progress as progress
where accounts.id = progress.account_id
  and accounts.batch_sent_count = 0;
