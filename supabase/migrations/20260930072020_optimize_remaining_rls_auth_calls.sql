alter policy "Users manage own designs" on public.custom_designs
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Users view own orders" on public.orders
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

alter policy "Users create own orders" on public.orders
with check ((select auth.uid()) = user_id);

alter policy "Admins update orders" on public.orders
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

alter policy "Users view own order events" on public.order_status_events
using (
  exists (
    select 1 from public.orders
    where orders.id = order_status_events.order_id
      and (
        orders.user_id = (select auth.uid())
        or exists (
          select 1 from public.admin_roles
          where admin_roles.user_id = (select auth.uid())
        )
      )
  )
);

alter policy "Admins create order events" on public.order_status_events
with check (
  exists (
    select 1 from public.admin_roles
    where admin_roles.user_id = (select auth.uid())
  )
);

alter policy "Users view own admin role" on public.admin_roles
using ((select auth.uid()) = user_id);

alter policy "Users upload own design assets" on storage.objects
with check (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users read own design assets" on storage.objects
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users update own design assets" on storage.objects
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users delete own design assets" on storage.objects
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users upload own avatar" on storage.objects
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users update own avatar" on storage.objects
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter policy "Users delete own avatar" on storage.objects
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
