create table if not exists public.marketing_link_visits (
  id uuid primary key default gen_random_uuid(),
  marketing_link_id uuid not null references public.marketing_links(id) on delete cascade,
  visited_at timestamptz not null default now()
);

comment on table public.marketing_link_visits is
  'One privacy-minimized row per valid marketing-link redirect. Funnel milestones remain deduplicated in marketing_events.';

create index if not exists marketing_link_visits_link_time_idx
  on public.marketing_link_visits (marketing_link_id, visited_at desc);

create or replace function public.record_marketing_link_click(p_link_id uuid)
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
    insert into public.marketing_link_visits (marketing_link_id)
    values (p_link_id);

    insert into public.marketing_events (marketing_link_id, event_type)
    values (p_link_id, 'link_clicked')
    on conflict (marketing_link_id, event_type) do nothing;
  end if;
end;
$$;

revoke all on function public.record_marketing_link_click(uuid) from public, anon, authenticated;
grant execute on function public.record_marketing_link_click(uuid) to service_role;

alter table public.marketing_link_visits enable row level security;

grant select on table public.marketing_link_visits to authenticated;
grant select, insert, update, delete on table public.marketing_link_visits to service_role;

drop policy if exists "Admins view marketing link visits" on public.marketing_link_visits;
create policy "Admins view marketing link visits"
on public.marketing_link_visits for select to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);
