-- Photos belong to the raw source post only; no pet/ownership verification is implied.
alter table public.x_lead_raw_reviews
  add column photo_urls text[] not null default '{}'::text[]
    check (cardinality(photo_urls) <= 4),
  add column photo_count integer generated always as (cardinality(photo_urls)) stored;

create index if not exists x_lead_raw_reviews_photo_count_idx
  on public.x_lead_raw_reviews (photo_count);

comment on column public.x_lead_raw_reviews.photo_urls is
  'Original-post photo URLs from trusted pbs.twimg.com/media metadata; unverified pet ownership.';
