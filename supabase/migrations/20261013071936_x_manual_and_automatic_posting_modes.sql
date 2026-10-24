alter table public.x_reply_jobs
  add column if not exists action_type text not null default 'reply'
    check (action_type in ('post', 'reply')),
  add column if not exists scheduled_for timestamptz not null default now();

alter table public.x_reply_jobs
  alter column target_post_url drop not null;

alter table public.x_reply_jobs
  drop constraint if exists x_reply_jobs_target_post_url_check;

alter table public.x_reply_jobs
  drop constraint if exists x_reply_jobs_action_target_check;

alter table public.x_reply_jobs
  add constraint x_reply_jobs_action_target_check check (
    (action_type = 'post' and target_post_url is null)
    or
    (action_type = 'reply' and target_post_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+')
  );

drop index if exists public.x_reply_jobs_no_duplicate_active_target_idx;
create unique index x_reply_jobs_no_duplicate_active_target_idx
  on public.x_reply_jobs (account_id, target_post_url)
  where action_type = 'reply'
    and status in ('queued', 'claimed', 'sent', 'uncertain');

create index if not exists x_reply_jobs_due_queue_idx
  on public.x_reply_jobs (scheduled_for, created_at)
  where status = 'queued' and attempt_count = 0;

create table if not exists public.x_manual_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.x_reply_accounts(id) on delete restrict,
  action_type text not null check (action_type in ('post', 'reply')),
  target_post_url text,
  post_text text not null check (length(post_text) between 1 and 270),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'discarded')),
  result_url text check (
    result_url is null
    or result_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+'
  ),
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_manual_posts_action_target_check check (
    (action_type = 'post' and target_post_url is null)
    or
    (action_type = 'reply' and target_post_url ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]+/status/[0-9]+')
  )
);

create index if not exists x_manual_posts_account_history_idx
  on public.x_manual_posts (account_id, created_at desc);
create index if not exists x_manual_posts_created_by_idx
  on public.x_manual_posts (created_by) where created_by is not null;

drop trigger if exists touch_x_manual_posts_updated_at on public.x_manual_posts;
create trigger touch_x_manual_posts_updated_at
before update on public.x_manual_posts
for each row execute function public.touch_updated_at();

alter table public.x_manual_posts enable row level security;
revoke all on table public.x_manual_posts from anon, authenticated;
grant select, insert, update, delete on table public.x_manual_posts to service_role;

comment on table public.x_reply_jobs is
  'Individually human-approved scheduled X posts or replies. A claimed or uncertain write is never automatically retried.';
comment on table public.x_manual_posts is
  'Manual-only X post and reply records. This table is never consumed by the x-use worker.';
