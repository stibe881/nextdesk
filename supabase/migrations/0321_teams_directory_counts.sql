begin;

set local search_path = pg_catalog, public;

-- Menü «Teams»: Zahl der Mitglieder und Gäste pro Team (beim Abgleich mit
-- Microsoft gelesen), damit die Liste ohne weitere Abfragen auskommt.
alter table public.teams_directory
  add column if not exists member_count integer check (member_count is null or member_count >= 0),
  add column if not exists guest_count integer check (guest_count is null or guest_count >= 0);

commit;
