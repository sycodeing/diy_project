alter table public.x_leads
  add column if not exists pet_type text
    check (pet_type is null or pet_type in ('cat', 'dog'));

alter table public.x_manual_posts
  add column if not exists x_lead_id uuid
    references public.x_leads(id) on delete set null;

create index if not exists x_manual_posts_x_lead_idx
  on public.x_manual_posts (x_lead_id, created_at desc)
  where x_lead_id is not null;

comment on column public.x_leads.pet_type is
  'First-phase eligible species. Only cat and dog candidates may enter a send queue.';
comment on column public.x_manual_posts.x_lead_id is
  'Source X lead used to retrieve the original pet image and generated marketing previews.';
