begin;

-- Zu einem Artikel lassen sich Optionen hinterlegen (z. B. Ladestation zum
-- Headset). Die Optionen sind eigenständige Katalogartikel: Sie können auch
-- einzeln bestellt werden, beim Hauptartikel nur zusätzlich mit ausgewählt.
alter table public.shop_catalog_items
  add column if not exists option_item_ids uuid[] not null default '{}'::uuid[];

alter table public.shop_catalog_items
  drop constraint if exists shop_catalog_items_option_count_check;
alter table public.shop_catalog_items
  add constraint shop_catalog_items_option_count_check
  check (cardinality(option_item_ids) <= 10);

commit;
