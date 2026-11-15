alter table public.sales_promotions add column product_slug text references public.products(slug);
update public.sales_promotions set product_slug='custom-pillow' where key='first_order';
