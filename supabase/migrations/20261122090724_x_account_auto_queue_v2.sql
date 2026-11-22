-- Account-first replies share the existing supervised sender, never the pet-preview gate.
-- Existing rows and their approval/send state remain V1.
alter table public.x_reply_jobs
  add column queue_version smallint not null default 1
    check (queue_version in (1, 2)),
  add column target_author_id text references public.x_lead_account_reviews(author_id),
  add column account_draft_author_id text references public.x_lead_account_drafts(author_id),
  add column marketing_link_id uuid references public.marketing_links(id),
  add column source_post_id text check (source_post_id is null or source_post_id ~ '^[0-9]{1,30}$'),
  add column draft_generated_at timestamptz;

alter table public.x_reply_jobs drop constraint if exists x_reply_jobs_content_mode_check;
alter table public.x_reply_jobs add constraint x_reply_jobs_content_mode_check
  check (content_mode in ('legacy_preview', 'first_contact_text', 'account_product_link'));

alter table public.x_reply_jobs drop constraint if exists x_reply_jobs_reply_text_check;
alter table public.x_reply_jobs add constraint x_reply_jobs_reply_text_check
  check (length(reply_text) between 1 and 280);

alter table public.x_reply_jobs add constraint x_reply_jobs_v2_identity_check check (
  queue_version = 1 and content_mode <> 'account_product_link'
  or queue_version = 2 and content_mode = 'account_product_link'
    and action_type = 'reply' and x_lead_id is null
    and target_author_id is not null and account_draft_author_id is not null
    and account_draft_author_id = target_author_id
    and marketing_link_id is not null and source_post_id is not null
    and draft_generated_at is not null
);

-- A prospect cannot be active in V2 on two sender accounts at once.
create unique index x_reply_jobs_v2_one_active_author_idx
  on public.x_reply_jobs(target_author_id)
  where queue_version = 2 and status in ('draft', 'queued', 'claimed', 'sent', 'uncertain');
create index x_reply_jobs_v2_list_idx on public.x_reply_jobs(queue_version, created_at desc);

comment on column public.x_reply_jobs.queue_version is
  'V1 keeps image/strict lead workflows; V2 is account-first product-link reply, independently reviewed.';
