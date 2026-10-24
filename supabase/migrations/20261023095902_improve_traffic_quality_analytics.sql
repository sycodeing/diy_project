alter table public.customer_activity_events
  add column if not exists device_class text not null default 'unknown',
  add column if not exists referrer_group text not null default 'direct',
  add column if not exists suspected_bot boolean not null default false,
  add column if not exists is_internal boolean not null default false;

alter table public.customer_activity_events
  drop constraint if exists customer_activity_events_event_type_check,
  drop constraint if exists customer_activity_events_device_class_check,
  drop constraint if exists customer_activity_events_referrer_group_check;

alter table public.customer_activity_events
  add constraint customer_activity_events_event_type_check check (event_type in (
    'page_view', 'page_exit', 'click', 'design_opened', 'upload_started',
    'crop_confirmed', 'preview_started', 'preview_cache_hit', 'preview_ready',
    'delivery_opened', 'delivery_canceled', 'address_validation_failed',
    'checkout_started', 'payment_redirected', 'purchase_completed'
  )),
  add constraint customer_activity_events_device_class_check check (device_class in ('desktop', 'mobile', 'tablet', 'unknown')),
  add constraint customer_activity_events_referrer_group_check check (referrer_group in ('direct', 'internal', 'search', 'x', 'other'));

create index if not exists customer_activity_events_quality_time_idx
  on public.customer_activity_events (is_internal, suspected_bot, created_at desc);

alter table public.marketing_link_visits
  add column if not exists device_class text not null default 'unknown',
  add column if not exists referrer_group text not null default 'direct',
  add column if not exists suspected_bot boolean not null default false,
  add column if not exists is_internal boolean not null default false;

alter table public.marketing_link_visits
  drop constraint if exists marketing_link_visits_device_class_check,
  drop constraint if exists marketing_link_visits_referrer_group_check;

alter table public.marketing_link_visits
  add constraint marketing_link_visits_device_class_check check (device_class in ('desktop', 'mobile', 'tablet', 'unknown')),
  add constraint marketing_link_visits_referrer_group_check check (referrer_group in ('direct', 'internal', 'search', 'x', 'other'));

create index if not exists marketing_link_visits_quality_time_idx
  on public.marketing_link_visits (is_internal, suspected_bot, visited_at desc);

drop function if exists public.record_marketing_link_click(uuid);

create function public.record_marketing_link_click(
  p_link_id uuid,
  p_device_class text,
  p_referrer_group text,
  p_suspected_bot boolean,
  p_is_internal boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketing_links
  set
    click_count = click_count + 1,
    first_clicked_at = coalesce(first_clicked_at, now()),
    last_clicked_at = now()
  where id = p_link_id and expires_at > now();

  if found then
    insert into public.marketing_link_visits (
      marketing_link_id, device_class, referrer_group, suspected_bot, is_internal
    ) values (
      p_link_id, p_device_class, p_referrer_group, p_suspected_bot, p_is_internal
    );

    insert into public.marketing_events (marketing_link_id, event_type)
    values (p_link_id, 'link_clicked')
    on conflict (marketing_link_id, event_type) do nothing;
  end if;
end;
$$;

revoke all on function public.record_marketing_link_click(uuid, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_marketing_link_click(uuid, text, text, boolean, boolean) to service_role;
