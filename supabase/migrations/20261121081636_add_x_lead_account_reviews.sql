create table if not exists public.x_lead_account_reviews (
  author_id text primary key check (author_id ~ '^[0-9]{1,30}$'),
  x_handle text check (x_handle ~ '^[A-Za-z0-9_]{1,50}$'),
  account_status text not null check (account_status in ('potential', 'watch', 'insufficient', 'excluded')),
  entry_status text not null check (entry_status in ('ready', 'no_entry', 'context_pending', 'hold')),
  account_evidence jsonb not null default '{}'::jsonb,
  entry_evidence jsonb not null default '{}'::jsonb,
  source_history jsonb not null default '[]'::jsonb,
  latest_source_job_id uuid references public.x_lead_search_jobs(id),
  latest_job_created_at timestamptz not null,
  latest_source_archive text not null,
  classifier_version text not null,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists x_lead_account_reviews_status_seen_idx
  on public.x_lead_account_reviews (account_status, entry_status, last_seen_at desc, author_id);
create index if not exists x_lead_account_reviews_job_idx
  on public.x_lead_account_reviews (latest_source_job_id, last_seen_at desc);

alter table public.x_lead_account_reviews enable row level security;
revoke all on public.x_lead_account_reviews from public, anon, authenticated;
grant select, insert, update on public.x_lead_account_reviews to service_role;

create or replace function public.upsert_x_lead_account_reviews(
  p_rows jsonb, p_job_id uuid, p_job_created_at timestamptz
) returns integer
language plpgsql security definer set search_path = public
as $$
declare item jsonb; touched integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'Invalid account-review batch';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    insert into public.x_lead_account_reviews (
      author_id, x_handle, account_status, entry_status, account_evidence,
      entry_evidence, source_history, latest_source_job_id, latest_job_created_at,
      latest_source_archive, classifier_version
    ) values (
      item->>'author_id', item->>'x_handle', item->>'account_status', item->>'entry_status',
      item->'account_evidence', item->'entry_evidence', item->'source_history',
      p_job_id, p_job_created_at, item->>'latest_source_archive', item->>'classifier_version'
    ) on conflict (author_id) do update set
      account_status = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.account_status else x_lead_account_reviews.account_status end,
      entry_status = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.entry_status else x_lead_account_reviews.entry_status end,
      account_evidence = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.account_evidence else x_lead_account_reviews.account_evidence end,
      entry_evidence = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.entry_evidence else x_lead_account_reviews.entry_evidence end,
      x_handle = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.x_handle else x_lead_account_reviews.x_handle end,
      latest_source_job_id = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.latest_source_job_id else x_lead_account_reviews.latest_source_job_id end,
      latest_source_archive = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.latest_source_archive else x_lead_account_reviews.latest_source_archive end,
      latest_job_created_at = greatest(excluded.latest_job_created_at, x_lead_account_reviews.latest_job_created_at),
      classifier_version = case when excluded.latest_job_created_at >= x_lead_account_reviews.latest_job_created_at then excluded.classifier_version else x_lead_account_reviews.classifier_version end,
      source_history = case when x_lead_account_reviews.source_history @> excluded.source_history then x_lead_account_reviews.source_history else x_lead_account_reviews.source_history || excluded.source_history end,
      last_seen_at = now();
    touched := touched + 1;
  end loop;
  return touched;
end;
$$;
revoke all on function public.upsert_x_lead_account_reviews(jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_x_lead_account_reviews(jsonb, uuid, timestamptz) to service_role;
