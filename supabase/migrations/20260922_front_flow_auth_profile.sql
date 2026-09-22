grant select on table public.products to anon, authenticated;
grant select on table public.product_options to anon, authenticated;
grant select on table public.product_variants to anon, authenticated;
grant select, insert, update, delete on table public.custom_designs to authenticated;
grant select, insert, update on table public.orders to authenticated;
grant select, insert on table public.order_status_events to authenticated;
grant select on table public.admin_roles to authenticated;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Users delete own design assets" on storage.objects;
create policy "Users delete own design assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'design-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public"
on storage.objects for select
to public
using (bucket_id = 'avatars');

drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
