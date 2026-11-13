-- Existing jobs keep their approved legacy image/link behavior.
-- No task is approved, rescheduled, retried or sent by this migration.
alter table public.x_reply_jobs
  add column content_mode text not null default 'legacy_preview'
    check (content_mode in ('legacy_preview', 'first_contact_text')),
  add column copy_variant text;
