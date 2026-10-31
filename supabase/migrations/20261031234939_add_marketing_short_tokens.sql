alter table public.marketing_links
  add column if not exists short_token_hash text
  check (short_token_hash is null or length(short_token_hash) = 64);

create unique index if not exists marketing_links_short_token_hash_unique
  on public.marketing_links (short_token_hash)
  where short_token_hash is not null;

comment on column public.marketing_links.short_token_hash is
  'SHA-256 hash of the current 12-character /g/ alias; legacy /go/ tokens remain in token_hash.';
