alter table public.marketing_events
  add column if not exists activity_session_id uuid,
  add column if not exists is_internal boolean not null default false;

alter table public.marketing_events
  drop constraint if exists marketing_events_event_type_check,
  drop constraint if exists marketing_events_marketing_link_id_event_type_key;

alter table public.marketing_events
  add constraint marketing_events_event_type_check check (event_type in (
    'link_generated', 'link_clicked', 'landing_confirmed', 'design_opened',
    'preview_ready', 'checkout_started', 'payment_completed'
  )),
  add constraint marketing_events_link_event_internal_key
    unique (marketing_link_id, event_type, is_internal);

create index if not exists marketing_events_activity_session_idx
  on public.marketing_events (activity_session_id, created_at desc)
  where activity_session_id is not null;

alter table public.customer_activity_events
  add column if not exists marketing_link_id uuid
    references public.marketing_links(id) on delete set null;

alter table public.customer_activity_events
  drop constraint if exists customer_activity_events_event_type_check;

alter table public.customer_activity_events
  add constraint customer_activity_events_event_type_check check (event_type in (
    'page_view', 'page_exit', 'click', 'landing_confirmed', 'design_opened',
    'upload_started', 'crop_confirmed', 'preview_started', 'preview_cache_hit',
    'preview_ready', 'delivery_opened', 'delivery_canceled',
    'address_validation_failed', 'checkout_started', 'payment_redirected',
    'purchase_completed'
  ));

create index if not exists customer_activity_events_marketing_link_idx
  on public.customer_activity_events (marketing_link_id, created_at desc)
  where marketing_link_id is not null;

create or replace function public.record_marketing_link_generated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.marketing_events (marketing_link_id, event_type, is_internal)
  values (new.id, 'link_generated', false)
  on conflict (marketing_link_id, event_type, is_internal) do nothing;
  return new;
end;
$$;

create or replace function public.record_marketing_link_click(
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
  set click_count = click_count + 1,
      first_clicked_at = coalesce(first_clicked_at, now()),
      last_clicked_at = now()
  where id = p_link_id and expires_at > now();

  if found then
    insert into public.marketing_link_visits (
      marketing_link_id, device_class, referrer_group, suspected_bot, is_internal
    ) values (
      p_link_id, p_device_class, p_referrer_group, p_suspected_bot, p_is_internal
    );

    insert into public.marketing_events (marketing_link_id, event_type, is_internal)
    values (p_link_id, 'link_clicked', p_is_internal)
    on conflict (marketing_link_id, event_type, is_internal) do nothing;
  end if;
end;
$$;

update public.marketing_events as event
set is_internal = true
from public.marketing_links as link
where event.marketing_link_id = link.id
  and event.event_type in ('design_opened', 'preview_ready')
  and (
    link.campaign like 'system_verification_%'
    or link.campaign like 'manual_review_%'
    or link.campaign like 'cache_%_verification_%'
  );

comment on column public.marketing_events.is_internal is
  'True for browser-confirmed funnel milestones produced by an internal-test session.';
comment on column public.marketing_events.activity_session_id is
  'Privacy-minimized activity session used to connect browser-confirmed marketing stages to behavior events.';
comment on column public.customer_activity_events.marketing_link_id is
  'Active last-touch marketing link, when present, for joining behavior to acquisition without storing the raw token.';
