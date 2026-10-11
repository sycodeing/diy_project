create table if not exists public.x_lead_search_configs (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique default 'default'
    check (config_key ~ '^[a-z0-9_-]{1,40}$'),
  enabled boolean not null default false,
  segments text[] not null default array['new_adoption', 'pet_birthday']::text[]
    check (
      cardinality(segments) between 1 and 2
      and segments <@ array['new_adoption', 'pet_birthday']::text[]
    ),
  search_product text not null default 'Latest'
    check (search_product in ('Latest', 'Top', 'Media')),
  result_limit integer not null default 40 check (result_limit between 1 and 100),
  lookback_days integer not null default 30 check (lookback_days between 1 and 90),
  us_required boolean not null default true,
  us_min_confidence integer not null default 70 check (us_min_confidence between 0 and 100),
  interval_minutes integer not null default 1440
    check (interval_minutes in (60, 180, 360, 720, 1440)),
  next_run_at timestamptz,
  last_enqueued_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_lead_search_jobs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.x_lead_search_configs(id) on delete set null,
  trigger_type text not null check (trigger_type in ('manual', 'scheduled')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'blocked')),
  configuration jsonb not null,
  worker_id text,
  received_count integer not null default 0 check (received_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_leads (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid references public.x_lead_search_jobs(id) on delete set null,
  post_id text not null unique check (length(post_id) between 1 and 100),
  author_hash text not null check (author_hash ~ '^[a-f0-9]{64}$'),
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,50}$'),
  post_url text not null check (post_url ~ '^https://(www\.)?(x|twitter)\.com/'),
  media_url text not null check (media_url ~ '^https://'),
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  selection_status text not null default 'new'
    check (selection_status in (
      'new', 'location_review', 'targeting_review', 'rejected_targeting',
      'review', 'approved', 'rejected', 'contacted', 'suppressed'
    )),
  segment text not null check (segment in ('new_adoption', 'pet_birthday', 'custom')),
  occasion text,
  occasion_confidence integer check (occasion_confidence between 0 and 100),
  ownership_confidence integer check (ownership_confidence between 0 and 100),
  us_confidence integer check (us_confidence between 0 and 100),
  us_evidence text,
  lead_score integer check (lead_score between 0 and 100),
  like_count integer not null default 0 check (like_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  repost_count integer not null default 0 check (repost_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  followers_count integer not null default 0 check (followers_count >= 0),
  targeting_data jsonb not null default '{}'::jsonb,
  consent_copy text,
  public_copy text,
  direct_message_copy text,
  marketing_link_id uuid references public.marketing_links(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_lead_workers (
  worker_id text primary key check (length(worker_id) between 1 and 120),
  status text not null default 'online' check (status in ('online', 'busy', 'paused', 'error')),
  cookie_configured boolean not null default false,
  worker_version text,
  last_error text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_lead_search_jobs_queue_idx
  on public.x_lead_search_jobs (status, created_at);
create index if not exists x_lead_search_configs_due_idx
  on public.x_lead_search_configs (next_run_at) where enabled;
create index if not exists x_leads_review_idx
  on public.x_leads (selection_status, discovered_at desc);
create index if not exists x_leads_segment_score_idx
  on public.x_leads (segment, lead_score desc nulls last, discovered_at desc);
create index if not exists x_leads_marketing_link_idx
  on public.x_leads (marketing_link_id) where marketing_link_id is not null;

drop trigger if exists touch_x_lead_search_configs_updated_at on public.x_lead_search_configs;
create trigger touch_x_lead_search_configs_updated_at
before update on public.x_lead_search_configs
for each row execute function public.touch_updated_at();

drop trigger if exists touch_x_lead_search_jobs_updated_at on public.x_lead_search_jobs;
create trigger touch_x_lead_search_jobs_updated_at
before update on public.x_lead_search_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists touch_x_leads_updated_at on public.x_leads;
create trigger touch_x_leads_updated_at
before update on public.x_leads
for each row execute function public.touch_updated_at();

drop trigger if exists touch_x_lead_workers_updated_at on public.x_lead_workers;
create trigger touch_x_lead_workers_updated_at
before update on public.x_lead_workers
for each row execute function public.touch_updated_at();

alter table public.x_lead_search_configs enable row level security;
alter table public.x_lead_search_jobs enable row level security;
alter table public.x_leads enable row level security;
alter table public.x_lead_workers enable row level security;

revoke all on table
  public.x_lead_search_configs,
  public.x_lead_search_jobs,
  public.x_leads,
  public.x_lead_workers
from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.x_lead_search_configs,
  public.x_lead_search_jobs,
  public.x_leads,
  public.x_lead_workers
to service_role;

comment on table public.x_lead_search_configs is
  'Administrator-owned X lead search settings. X credentials never enter this table.';
comment on table public.x_lead_search_jobs is
  'Durable queue consumed by the local read-only X Lead Studio worker.';
comment on table public.x_leads is
  'Public X lead metadata and its marketing attribution link. No X cookies are stored.';
comment on table public.x_lead_workers is
  'Heartbeat only; never stores X cookies or decrypted credentials.';
