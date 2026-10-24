alter table public.x_manual_posts
  add column if not exists preparation_status text not null default 'ready'
    check (preparation_status in ('pending', 'processing', 'ready', 'failed')),
  add column if not exists preparation_error text,
  add column if not exists prepared_at timestamptz;

alter table public.x_reply_jobs
  add column if not exists x_lead_id uuid references public.x_leads(id) on delete set null,
  add column if not exists preparation_status text not null default 'ready'
    check (preparation_status in ('pending', 'processing', 'ready', 'failed')),
  add column if not exists preparation_error text,
  add column if not exists prepared_at timestamptz;

create index if not exists x_manual_posts_preparation_idx
  on public.x_manual_posts (preparation_status, created_at desc)
  where preparation_status in ('pending', 'processing', 'failed');

create index if not exists x_reply_jobs_preparation_idx
  on public.x_reply_jobs (preparation_status, created_at desc)
  where preparation_status in ('pending', 'processing', 'failed');

create index if not exists x_reply_jobs_x_lead_idx
  on public.x_reply_jobs (x_lead_id, created_at desc)
  where x_lead_id is not null;

comment on column public.x_manual_posts.preparation_status is
  'Asynchronous marketing-link, reply-copy, and single-preview preparation state.';
comment on column public.x_reply_jobs.preparation_status is
  'Asynchronous marketing-link, reply-copy, and single-preview preparation state.';

update public.x_manual_posts as post
set post_text = left(lead.public_copy, 270),
    updated_at = now()
from public.x_leads as lead
where lead.id = post.x_lead_id
  and post.post_text like '%{link}%'
  and lead.public_copy like '%/go/%';
