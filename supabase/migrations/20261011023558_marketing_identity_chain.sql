alter table public.marketing_links
  add column if not exists source_lead_id text,
  add column if not exists x_author_hash text,
  add column if not exists x_handle text,
  add column if not exists x_post_id text,
  add column if not exists x_post_url text,
  add column if not exists targeting_segment text,
  add column if not exists lead_score integer,
  add column if not exists account_user_id uuid references auth.users(id) on delete set null,
  add column if not exists account_linked_at timestamptz,
  add column if not exists account_was_created boolean;

alter table public.marketing_links
  drop constraint if exists marketing_links_x_author_hash_check,
  add constraint marketing_links_x_author_hash_check
    check (x_author_hash is null or x_author_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists marketing_links_x_handle_check,
  add constraint marketing_links_x_handle_check
    check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,50}$'),
  drop constraint if exists marketing_links_lead_score_check,
  add constraint marketing_links_lead_score_check
    check (lead_score is null or lead_score between 0 and 100),
  drop constraint if exists marketing_links_account_linked_check,
  add constraint marketing_links_account_linked_check
    check (account_user_id is not null or account_linked_at is null);

alter table public.marketing_events
  drop constraint if exists marketing_events_event_type_check;
alter table public.marketing_events
  add constraint marketing_events_event_type_check check (event_type in (
    'link_generated', 'link_clicked', 'design_opened', 'preview_ready',
    'account_linked', 'checkout_started', 'payment_completed'
  ));

create index if not exists marketing_links_source_lead_idx
  on public.marketing_links (source_lead_id) where source_lead_id is not null;
create index if not exists marketing_links_account_user_idx
  on public.marketing_links (account_user_id) where account_user_id is not null;
