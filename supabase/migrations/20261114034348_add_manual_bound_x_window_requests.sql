alter table public.x_manual_posts
  add column if not exists bound_open_status text not null default 'idle',
  add column if not exists bound_open_target_url text,
  add column if not exists bound_open_executor_id text,
  add column if not exists bound_open_requested_at timestamptz,
  add column if not exists bound_open_started_at timestamptz,
  add column if not exists bound_open_completed_at timestamptz,
  add column if not exists bound_open_error text;

alter table public.x_manual_posts
  drop constraint if exists x_manual_posts_bound_open_status_check,
  add constraint x_manual_posts_bound_open_status_check
    check (bound_open_status in ('idle', 'pending', 'running', 'completed', 'failed')),
  drop constraint if exists x_manual_posts_bound_open_target_url_check,
  add constraint x_manual_posts_bound_open_target_url_check
    check (bound_open_target_url is null or bound_open_target_url ~ '^https://(www\.)?x\.com/'),
  drop constraint if exists x_manual_posts_bound_open_executor_id_check,
  add constraint x_manual_posts_bound_open_executor_id_check
    check (bound_open_executor_id is null or length(bound_open_executor_id) between 1 and 120),
  drop constraint if exists x_manual_posts_bound_open_error_check,
  add constraint x_manual_posts_bound_open_error_check
    check (bound_open_error is null or length(bound_open_error) <= 1000);

create index if not exists x_manual_posts_pending_bound_open_idx
  on public.x_manual_posts (bound_open_requested_at)
  where bound_open_status = 'pending';

comment on column public.x_manual_posts.bound_open_status is
  'Lifecycle for opening a visible, read-only Latte browser through its bound route for manual posting.';
comment on column public.x_manual_posts.bound_open_target_url is
  'X target or compose URL opened for the administrator; the worker never submits the manual post.';
