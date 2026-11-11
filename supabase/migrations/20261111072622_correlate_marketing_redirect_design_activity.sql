alter table public.marketing_link_visits
  add column if not exists design_requested_at timestamptz,
  add column if not exists browser_confirmed_at timestamptz,
  add column if not exists first_interaction_at timestamptz;

comment on column public.marketing_link_visits.design_requested_at is
  'The matching visit cookie reached a server render of /design. This is not proof of a human or a delivered page.';
comment on column public.marketing_link_visits.browser_confirmed_at is
  'The matching visit cookie reached /api/activity with landing_confirmed from page JavaScript.';
comment on column public.marketing_link_visits.first_interaction_at is
  'The matching visit cookie reached /api/activity with an explicit user interaction.';

create or replace function public.record_marketing_link_click_v2(
  p_visit_id uuid,
  p_link_id uuid,
  p_device_class text,
  p_referrer_group text,
  p_suspected_bot boolean,
  p_is_internal boolean
)
returns void
language plpgsql
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
      id, marketing_link_id, device_class, referrer_group, suspected_bot, is_internal
    ) values (
      p_visit_id, p_link_id, p_device_class, p_referrer_group, p_suspected_bot, p_is_internal
    );

    insert into public.marketing_events (marketing_link_id, event_type, is_internal)
    values (p_link_id, 'link_clicked', p_is_internal)
    on conflict (marketing_link_id, event_type, is_internal) do nothing;
  end if;
end;
$$;

revoke all on function public.record_marketing_link_click_v2(uuid, uuid, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.record_marketing_link_click_v2(uuid, uuid, text, text, boolean, boolean)
  to service_role;
