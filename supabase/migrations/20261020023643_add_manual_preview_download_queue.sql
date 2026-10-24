alter table public.x_manual_posts
  add column if not exists preview_download_status text not null default 'idle'
    check (preview_download_status in ('idle', 'pending', 'processing', 'completed', 'failed')),
  add column if not exists preview_download_worker_id text,
  add column if not exists preview_download_path text,
  add column if not exists preview_download_error text,
  add column if not exists preview_download_requested_at timestamptz,
  add column if not exists preview_downloaded_at timestamptz;

create index if not exists x_manual_posts_preview_download_queue_idx
  on public.x_manual_posts (preview_download_requested_at, created_at)
  where preview_download_status in ('pending', 'processing');

comment on column public.x_manual_posts.preview_download_status is
  'Queue state for downloading a prepared preview image to the operator computer.';
comment on column public.x_manual_posts.preview_download_path is
  'Absolute operator-computer path reported by the authenticated local worker.';
