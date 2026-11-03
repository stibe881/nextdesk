begin;

-- Bei Artikeln zum Ausleihen ohne Lageranbindung: wie viele Stück es gibt.
-- Verfügbar ist der Bestand abzüglich der aktuell ausgeliehenen und
-- reservierten Stücke aus den Bestellpositionen.
alter table public.shop_catalog_items
  add column if not exists loan_quantity integer
    check (loan_quantity is null or loan_quantity between 0 and 10000);

commit;
