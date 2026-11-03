begin;

-- Ein Artikel kann mehreren Kategorien angehören. `category_id` bleibt die
-- Hauptkategorie (erste der Liste), `category_ids` enthält alle.
alter table public.shop_catalog_items
  add column if not exists category_ids uuid[] not null default '{}'::uuid[];

alter table public.shop_catalog_items
  drop constraint if exists shop_catalog_items_category_count_check;
alter table public.shop_catalog_items
  add constraint shop_catalog_items_category_count_check
  check (cardinality(category_ids) <= 10);

update public.shop_catalog_items
set category_ids = array[category_id]
where category_id is not null and cardinality(category_ids) = 0;

create index if not exists shop_catalog_items_category_ids_idx
  on public.shop_catalog_items using gin (category_ids);

commit;
