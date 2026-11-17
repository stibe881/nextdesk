begin;

set local search_path = pg_catalog, public;

-- Pausieren in der Überwachung: Grund, Person und Zeitpunkt am Sensor und
-- ein Protokoll für «Letzte Ereignisse» (pausiert / fortgesetzt). Zugriff nur
-- über die Edge Function «monitoring-sensors» (service_role).
alter table public.monitoring_sensors
  add column if not exists paused_reason text
    check (paused_reason is null or char_length(paused_reason) between 1 and 300),
  add column if not exists paused_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists paused_at timestamptz;

create table if not exists public.monitoring_sensor_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  -- null: the whole device was paused or resumed.
  sensor_id uuid references public.monitoring_sensors(id) on delete set null,
  device_name text not null default '',
  sensor_name text,
  action text not null check (action in ('paused', 'resumed')),
  reason text check (reason is null or char_length(reason) between 1 and 300),
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists monitoring_sensor_activity_tenant_time_idx
  on public.monitoring_sensor_activity (tenant_id, created_at desc);

alter table public.monitoring_sensor_activity enable row level security;
revoke all on public.monitoring_sensor_activity from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_sensor_activity to service_role;

commit;
