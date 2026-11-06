alter table public.x_leads
  add column if not exists media_urls text[] not null default '{}';

update public.x_leads
set media_urls = array[media_url]
where cardinality(media_urls) = 0;

alter table public.x_leads
  add constraint x_leads_media_urls_count_check
  check (cardinality(media_urls) between 1 and 4);
