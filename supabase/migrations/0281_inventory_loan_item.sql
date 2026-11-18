begin;

set local search_path = pg_catalog, public;

-- Lagerartikel, die ausgeliehen und zurückgegeben werden (z. B. Presenter,
-- Adapter). «Im Shop anbieten» übernimmt sie als Ausleihartikel statt als
-- Bestellartikel; Ausgabe und Rückgabe buchen den Lagerbestand wie bisher.
alter table public.inventory_items
  add column if not exists loan_item boolean not null default false;

commit;
