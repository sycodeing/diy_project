-- Brand-created, account-specific artwork is separate from prospect media and V1 pet previews.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('account-design-previews', 'account-design-previews', false, 10485760,
        array['image/png', 'image/webp'])
on conflict (id) do nothing;

alter table public.x_lead_account_drafts
  add column design_source text check (design_source is null or design_source = 'brand_created'),
  add column design_brief text,
  add column artwork_path text,
  add column artwork_hash text check (artwork_hash is null or artwork_hash ~ '^[a-f0-9]{64}$'),
  add column preview_path text,
  add column preview_hash text check (preview_hash is null or preview_hash ~ '^[a-f0-9]{64}$'),
  add column preview_template_id text,
  add column preview_status text not null default 'text_only'
    check (preview_status in ('text_only', 'ready', 'failed'));

alter table public.x_lead_account_drafts add constraint x_account_draft_preview_complete_check
  check (preview_status <> 'ready' or (status = 'draft_ready' and design_source is not null and design_source = 'brand_created'
    and design_brief is not null and artwork_path is not null and artwork_hash is not null
    and preview_path is not null and preview_hash is not null and preview_template_id is not null));

alter table public.marketing_links
  add column account_artwork_path text,
  add column account_artwork_hash text check (account_artwork_hash is null or account_artwork_hash ~ '^[a-f0-9]{64}$'),
  add column account_preview_path text,
  add column account_preview_hash text check (account_preview_hash is null or account_preview_hash ~ '^[a-f0-9]{64}$'),
  add column account_preview_template_id text;

alter table public.marketing_links add constraint x_marketing_account_preview_complete_check check (
  (account_artwork_path is null and account_artwork_hash is null and account_preview_path is null
   and account_preview_hash is null and account_preview_template_id is null)
  or (account_artwork_path is not null and account_artwork_hash is not null and account_preview_path is not null
   and account_preview_hash is not null and account_preview_template_id is not null));

alter table public.x_reply_jobs
  add column account_artwork_path text,
  add column account_artwork_hash text check (account_artwork_hash is null or account_artwork_hash ~ '^[a-f0-9]{64}$'),
  add column account_preview_path text,
  add column account_preview_hash text check (account_preview_hash is null or account_preview_hash ~ '^[a-f0-9]{64}$'),
  add column account_preview_template_id text;

alter table public.x_reply_jobs add constraint x_reply_account_preview_complete_check check (
  (account_artwork_path is null and account_artwork_hash is null and account_preview_path is null
   and account_preview_hash is null and account_preview_template_id is null)
  or (account_artwork_path is not null and account_artwork_hash is not null and account_preview_path is not null
   and account_preview_hash is not null and account_preview_template_id is not null));

alter table public.x_reply_jobs drop constraint x_reply_jobs_content_mode_check;
alter table public.x_reply_jobs add constraint x_reply_jobs_content_mode_check
  check (content_mode in ('legacy_preview', 'first_contact_text', 'account_product_link', 'account_product_preview'));

alter table public.x_reply_jobs drop constraint x_reply_jobs_v2_identity_check;
alter table public.x_reply_jobs add constraint x_reply_jobs_v2_identity_check check (
  queue_version = 1 and content_mode not in ('account_product_link', 'account_product_preview')
  or queue_version = 2 and content_mode in ('account_product_link', 'account_product_preview')
    and action_type = 'reply' and x_lead_id is null
    and target_author_id is not null and account_draft_author_id is not null
    and account_draft_author_id = target_author_id
    and marketing_link_id is not null and source_post_id is not null
    and draft_generated_at is not null
    and (content_mode <> 'account_product_preview' or (
      account_artwork_path is not null and account_artwork_hash is not null
      and account_preview_path is not null and account_preview_hash is not null
      and account_preview_template_id is not null))
);

comment on column public.x_lead_account_drafts.preview_status is
  'A ready preview is a brand-created artwork composited onto a product template; it is not the prospect photo.';
