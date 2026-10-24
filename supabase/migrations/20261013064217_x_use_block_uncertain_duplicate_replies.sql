drop index if exists public.x_reply_jobs_no_duplicate_active_target_idx;
create unique index x_reply_jobs_no_duplicate_active_target_idx
  on public.x_reply_jobs (account_id, target_post_url)
  where status in ('queued', 'claimed', 'sent', 'uncertain');
