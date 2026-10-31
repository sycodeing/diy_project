alter table public.x_lead_search_configs
  drop constraint if exists x_lead_search_configs_segments_check;

alter table public.x_lead_search_configs
  add constraint x_lead_search_configs_segments_check
  check (
    cardinality(segments) between 1 and 5
    and segments <@ array[
      'new_adoption',
      'pet_birthday',
      'pet_adventure',
      'pet_costume',
      'pet_portrait'
    ]::text[]
  );

alter table public.x_leads
  drop constraint if exists x_leads_segment_check;

alter table public.x_leads
  add constraint x_leads_segment_check
  check (
    segment = any (array[
      'new_adoption',
      'pet_birthday',
      'pet_adventure',
      'pet_costume',
      'pet_portrait',
      'custom'
    ]::text[])
  );
