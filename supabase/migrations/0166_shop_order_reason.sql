begin;

-- Jede Bestellung nennt einen Grund (Pflichtfeld beim Bestellen). Ältere
-- Bestellungen haben keinen Grund.
alter table public.shop_orders
  add column if not exists reason text
    check (reason is null or char_length(btrim(reason)) between 3 and 500);

commit;
