alter table public.marketing_links
  add column if not exists product_slug text
  check (product_slug is null or product_slug ~ '^[a-z0-9-]{1,80}$');
alter table public.marketing_links
  add column if not exists x_post_id text check (x_post_id is null or x_post_id ~ '^[0-9]{1,30}$'),
  add column if not exists x_post_url text,
  add column if not exists x_author_hash text check (x_author_hash is null or length(x_author_hash) = 64);

create table if not exists public.x_lead_account_drafts (
  author_id text primary key references public.x_lead_account_reviews(author_id) on delete cascade,
  status text not null check (status in ('draft_ready', 'no_match', 'evidence_pending', 'blocked')),
  reason text not null,
  evidence_coverage text not null check (evidence_coverage in ('full', 'partial')),
  selected_post_id text check (selected_post_id ~ '^[0-9]{1,30}$'),
  selected_post_created_at timestamptz,
  selected_post_excerpt text,
  product_slug text check (product_slug is null or product_slug in ('custom-pillow', 'face-towel')),
  product_match_reason text,
  reply_text text,
  marketing_link_id uuid references public.marketing_links(id),
  marketing_url text,
  marketing_expires_at timestamptz,
  generation_version text not null,
  generated_at timestamptz not null default now(),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  check ((status = 'draft_ready' and selected_post_id is not null and product_slug is not null
    and reply_text is not null and marketing_link_id is not null and marketing_url is not null
    and marketing_expires_at is not null)
    or (status <> 'draft_ready' and reply_text is null and marketing_link_id is null
      and marketing_url is null and marketing_expires_at is null))
);

create index if not exists x_lead_account_drafts_status_idx
  on public.x_lead_account_drafts(status, generated_at desc);
alter table public.x_lead_account_drafts enable row level security;
revoke all on public.x_lead_account_drafts from public, anon, authenticated;
grant select, insert, update on public.x_lead_account_drafts to service_role;
