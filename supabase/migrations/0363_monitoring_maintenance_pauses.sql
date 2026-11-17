begin;

set local search_path = pg_catalog, public;

-- Wartungsfenster pausieren die Sensoren ihrer Geräte automatisch und setzen
-- sie am Ende fort. Hier steht, welche Sensoren ein Fenster pausiert hat, damit
-- nur diese fortgesetzt werden (vorher manuell pausierte bleiben pausiert).
-- Ausgeführt im Minuten-Job über die Edge Function «ipam-agent».
create table if not exists public.monitoring_maintenance_pauses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- null: the window was deleted; its sensors are resumed on the next run.
  maintenance_id uuid references public.service_status_maintenances(id) on delete set null,
  sensor_id uuid not null references public.monitoring_sensors(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 300),
  paused_at timestamptz not null default timezone('utc', now()),
  resumed_at timestamptz,
  unique (maintenance_id, sensor_id)
);

create index if not exists monitoring_maintenance_pauses_open_idx
  on public.monitoring_maintenance_pauses (maintenance_id)
  where resumed_at is null;

alter table public.monitoring_maintenance_pauses enable row level security;
revoke all on public.monitoring_maintenance_pauses from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_maintenance_pauses to service_role;

-- Gibt es etwas zu pausieren oder fortzusetzen?
create or replace function public.monitoring_maintenance_pauses_due()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
    from public.service_status_maintenances maintenance
    join public.service_status_maintenance_assets link
      on link.maintenance_id = maintenance.id and link.tenant_id = maintenance.tenant_id
    join public.monitoring_sensors sensor
      on sensor.asset_id = link.asset_id and sensor.tenant_id = link.tenant_id
    where maintenance.state in ('scheduled', 'active')
      and maintenance.starts_at <= now() and maintenance.ends_at > now()
      and not sensor.paused
      and not exists (
        select 1 from public.monitoring_maintenance_pauses pause
        where pause.maintenance_id = maintenance.id and pause.sensor_id = sensor.id
      )
  ) or exists (
    select 1
    from public.monitoring_maintenance_pauses pause
    left join public.service_status_maintenances maintenance on maintenance.id = pause.maintenance_id
    where pause.resumed_at is null
      and (maintenance.id is null or maintenance.state in ('completed', 'cancelled') or maintenance.ends_at <= now())
  );
$function$;

revoke all on function public.monitoring_maintenance_pauses_due() from public, anon, authenticated;
grant execute on function public.monitoring_maintenance_pauses_due() to service_role;

-- Der Minuten-Job weckt «ipam-agent» auch, wenn Wartungspausen fällig sind.
do $migration$
declare
  v_definition text;
  v_old text := 'and jsonb_array_length(public.monitoring_cloud_checks_due(1)) = 0 then';
  v_new text := 'and jsonb_array_length(public.monitoring_cloud_checks_due(1)) = 0
     and not public.monitoring_maintenance_pauses_due() then';
begin
  v_definition := pg_get_functiondef('public.monitoring_probe_watchdog_wake()'::regprocedure);
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

commit;
