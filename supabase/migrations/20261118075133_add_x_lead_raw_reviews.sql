-- Raw search evidence is deliberately separate from x_leads and all outreach queues.
create table if not exists public.x_lead_raw_reviews (
  post_id text primary key,
  author_id text not null default '',
  x_handle text not null default '',
  post_url text not null,
  post_text text not null,
  posted_at timestamptz,
  source_archive text not null,
  source_stage text not null,
  source_job_id uuid references public.x_lead_search_jobs(id) on delete set null,
  classifier_version text not null,
  classifier_tier text not null check (classifier_tier in ('excluded', 'exploratory', 'explicit_request')),
  exclusion_reasons text[] not null default '{}',
  intent jsonb not null default '{}'::jsonb,
  body_topic_match boolean not null default false,
  is_reply boolean not null default false,
  parent_post_id text,
  parent_evidence text,
  parent_source_archive text,
  parent_status text not null default 'not_applicable'
    check (parent_status in ('not_applicable', 'unresolved', 'resolved_product_mismatch')),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists x_lead_raw_reviews_recent_idx
  on public.x_lead_raw_reviews (first_seen_at desc, post_id desc);
create index if not exists x_lead_raw_reviews_filter_idx
  on public.x_lead_raw_reviews (review_status, classifier_tier, body_topic_match);

alter table public.x_lead_raw_reviews enable row level security;
revoke all on public.x_lead_raw_reviews from anon, authenticated;
grant select, insert, update on public.x_lead_raw_reviews to service_role;
comment on table public.x_lead_raw_reviews is
  'Unqualified raw X search posts for admin review only. Never an x_leads candidate or outreach authorization.';
