begin;

set local search_path = pg_catalog, public;

-- A device can belong to several services: all of them follow the monitoring
-- (PRTG) status. assets.service_id stays as the primary (first) service for
-- the modules that only know one service.
create table if not exists public.asset_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (asset_id, service_id)
);
create index if not exists asset_services_tenant_service_idx
  on public.asset_services (tenant_id, service_id);

alter table public.asset_services enable row level security;
revoke all on table public.asset_services from public, anon, authenticated;
grant all on table public.asset_services to service_role;

comment on table public.asset_services is
  'All services of a device (system status follows monitoring). Written by the infrastructure Edge Function; service role only.';

insert into public.asset_services (tenant_id, asset_id, service_id)
select tenant_id, id, service_id
from public.assets
where service_id is not null
on conflict do nothing;

-- Alerts remember every affected service and the status monitoring applied
-- to each of them (service id -> degraded | partial_outage).
alter table public.monitoring_alerts
  add column if not exists service_ids uuid[] not null default '{}',
  add column if not exists service_statuses jsonb not null default '{}'::jsonb;

update public.monitoring_alerts
set service_ids = array[service_id]
where service_id is not null and service_ids = '{}';

update public.monitoring_alerts
set service_statuses = jsonb_build_object(service_id::text, service_status_applied)
where service_id is not null
  and service_status_applied is not null
  and service_statuses = '{}'::jsonb;

commit;
