begin;

set local search_path = pg_catalog, public;

-- Maintenance entries can carry a time of day next to the date (optional;
-- older entries and the ones from workflows have the date only).
alter table public.asset_maintenance_log
  add column if not exists performed_time time without time zone;

comment on column public.asset_maintenance_log.performed_time is
  'Optional local time of day of the maintenance on performed_on.';

commit;
