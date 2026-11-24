-- Reporting records a supplied result URL, without asserting an attachment upload.
-- Keep historical preview_uploaded_by_user declarations and all report identity checks.
alter table public.x_account_manual_posts
  drop constraint manual_result_report,
  add constraint manual_result_report check (
    (status = 'reported' and reported_at is not null and reported_by is not null
     and result_url ~ '^https://x[.]com/Le6wCummeratawi/status/[0-9]{5,30}$')
    or (status <> 'reported' and reported_at is null and reported_by is null and result_url is null)
  );
