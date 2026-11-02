begin;

set local search_path = pg_catalog, public;

-- Own photo for a shop article, stored in the private bucket
-- inventory-item-images below <tenantId>/shop/<itemId>/. Without it the shop
-- shows the photo of the linked inventory item.
alter table public.shop_catalog_items
  add column if not exists image_path text
    check (image_path is null or char_length(image_path) between 10 and 300);

commit;
