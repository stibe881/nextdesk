begin;

set local search_path = pg_catalog, public;

-- Own photos for a shop article (max. 5), stored in the private bucket
-- inventory-item-images below <tenantId>/shop/<itemId>/. The first photo is
-- the cover. Without own photos the shop shows the linked inventory photo.
alter table public.shop_catalog_items
  add column if not exists image_paths text[] not null default '{}'::text[]
    check (cardinality(image_paths) <= 5);

commit;
