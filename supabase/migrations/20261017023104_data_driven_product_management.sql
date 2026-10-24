alter table public.products
  add column if not exists card_image_url text,
  add column if not exists customization jsonb not null default '{}'::jsonb;

alter table public.products alter column active set default false;

alter table public.product_variants
  add column if not exists procurement jsonb not null default '{}'::jsonb;

update public.products
set
  card_image_url = coalesce(card_image_url, '/showcase/wood-chair.webp'),
  customization = jsonb_build_object(
    'printSides', jsonb_build_array('front'),
    'outputWidth', 1200,
    'outputHeight', 1200,
    'frameLabel', 'Square pillow artwork',
    'previewMode', 'reuse',
    'mockupTemplateIds', jsonb_build_array(
      'pillow-psd-03-grey-sofa',
      'pillow-psd-04-size',
      'pillow-psd-06-wood-chair',
      'pillow-psd-01'
    )
  )
where slug = 'custom-pillow'
  and (customization = '{}'::jsonb or card_image_url is null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-catalog-assets',
  'product-catalog-assets',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product catalog images are public" on storage.objects;
create policy "Product catalog images are public"
on storage.objects for select
to public
using (bucket_id = 'product-catalog-assets');

create index if not exists products_active_created_idx
  on public.products (active, created_at desc);
