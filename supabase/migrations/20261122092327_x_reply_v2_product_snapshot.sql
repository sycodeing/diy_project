-- Preserve the reviewed product decision on the queue row even if the account
-- draft is later regenerated. V1 rows retain NULL snapshots.
alter table public.x_reply_jobs
  add column product_slug_snapshot text,
  add column product_match_reason_snapshot text;
