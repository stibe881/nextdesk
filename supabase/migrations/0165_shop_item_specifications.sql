begin;

-- Technische Angaben zu einem Artikel: Lieferumfang, Anwendungsbereich,
-- Kompatibilität, Ausstattung, Konnektivität und Eigenschaften.
alter table public.shop_catalog_items
  add column if not exists specifications jsonb not null default '{}'::jsonb;

alter table public.shop_catalog_items
  drop constraint if exists shop_catalog_items_specifications_check;
alter table public.shop_catalog_items
  add constraint shop_catalog_items_specifications_check
  check (jsonb_typeof(specifications) = 'object'
         and pg_column_size(specifications) <= 20000);

commit;
