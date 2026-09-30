drop policy if exists "Admins view Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins view Temu purchase jobs"
on public.temu_purchase_jobs for select
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins update Temu purchase jobs" on public.temu_purchase_jobs;
create policy "Admins update Temu purchase jobs"
on public.temu_purchase_jobs for update
to authenticated
using (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);
