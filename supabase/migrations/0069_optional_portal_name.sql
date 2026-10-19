begin;

set local search_path = pg_catalog, public;

alter table public.tenant_settings
  alter column portal_name drop not null;

commit;
