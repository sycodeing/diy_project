alter table public.x_manual_posts
  alter column account_id drop not null;

comment on column public.x_manual_posts.account_id is
  'Optional legacy account association. Candidate-created manual tasks are intentionally account-agnostic.';
