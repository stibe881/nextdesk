-- Überwachung: Verbindungen eines Geräts (welcher Port führt wohin).
--
-- Die Sonde liest per SNMP die Ports, die LLDP-Nachbarn und die MAC-Tabelle
-- eines überwachten Geräts aus (Auftrag «snmp_topology», nur lesend) und
-- meldet das Ergebnis. Gespeichert wird je Port eine Zeile; wer am Port
-- hängt, wird beim Anzeigen aus Infrastruktur und IP-Adressverwaltung
-- aufgelöst. Ein Zeitplan stellt die Aufträge alle sechs Stunden ein.

create table if not exists public.monitoring_device_ports (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  port text not null check (char_length(port) between 1 and 80),
  if_index integer,
  alias text check (alias is null or char_length(alias) <= 80),
  up boolean,
  speed_mbps bigint check (speed_mbps is null or speed_mbps >= 0),
  -- LLDP-Nachbar an diesem Port.
  neighbor_name text check (neighbor_name is null or char_length(neighbor_name) <= 160),
  neighbor_port text check (neighbor_port is null or char_length(neighbor_port) <= 160),
  neighbor_address text check (neighbor_address is null or char_length(neighbor_address) <= 64),
  neighbor_mac text check (neighbor_mac is null or char_length(neighbor_mac) <= 32),
  -- An diesem Port gelernte MAC-Adressen (höchstens acht; Anzahl gesamt in mac_count).
  macs text[] not null default '{}'::text[] check (cardinality(macs) <= 16),
  mac_count integer not null default 0 check (mac_count >= 0),
  position integer not null default 0,
  seen_at timestamptz not null default timezone('utc', now()),
  primary key (asset_id, port),
  constraint monitoring_device_ports_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists monitoring_device_ports_tenant_idx
  on public.monitoring_device_ports (tenant_id);
create index if not exists monitoring_device_ports_macs_idx
  on public.monitoring_device_ports using gin (macs);

create table if not exists public.monitoring_topology_status (
  asset_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.ipam_agents(id) on delete set null,
  sys_name text check (sys_name is null or char_length(sys_name) <= 160),
  requested_at timestamptz,
  scanned_at timestamptz,
  error text check (error is null or char_length(error) <= 1000),
  constraint monitoring_topology_status_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists monitoring_topology_status_tenant_idx
  on public.monitoring_topology_status (tenant_id);

alter table public.monitoring_device_ports enable row level security;
alter table public.monitoring_topology_status enable row level security;
revoke all on public.monitoring_device_ports, public.monitoring_topology_status
  from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_device_ports,
  public.monitoring_topology_status to service_role;

comment on table public.monitoring_device_ports is
  'Ports of a monitored device with LLDP neighbour and learned MAC addresses (read by the probe via SNMP). Service role only.';
comment on table public.monitoring_topology_status is
  'When the connections of a device were last requested and read, and the last error. Service role only.';

-- ---------------------------------------------------------------------------
-- Auftrag «snmp_topology» (nur lesend, braucht keine Freigabe).

alter table public.ipam_agent_jobs
  drop constraint if exists ipam_agent_jobs_kind_check,
  drop constraint if exists ipam_agent_jobs_write_approved;
alter table public.ipam_agent_jobs
  add constraint ipam_agent_jobs_kind_check check (kind in (
    'scan_now', 'dhcp_reserve', 'dhcp_release', 'dns_upsert_a', 'dns_upsert_ptr', 'dns_delete',
    'snmp_interfaces', 'snmp_topology'
  )),
  add constraint ipam_agent_jobs_write_approved check (
    kind in ('scan_now', 'snmp_interfaces', 'snmp_topology')
    or status in ('pending_approval', 'cancelled')
    or approved_at is not null
  );

create or replace function public.ipam_agent_jobs_check_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.kind not in ('scan_now', 'snmp_interfaces', 'snmp_topology')
     and new.status in ('queued', 'running', 'done', 'failed')
     and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by
          or old.status in ('pending_approval', 'cancelled')) then
    if new.approved_by is null
       or not public.user_has_tenant_permission(new.approved_by, new.tenant_id, 'ipam.manage') then
      raise exception 'IPAM agent job requires approval by an ipam.manage user'
        using errcode = '42501';
    end if;
    new.approved_at := coalesce(new.approved_at, timezone('utc', now()));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ergebnis speichern: ersetzt alle Ports des Geräts in einem Schritt.
-- p_ports: [{port, index, alias, up, speedMbps, lldpName, lldpPort,
-- lldpAddress, lldpMac, macs[], macCount}] (von der Edge Function geprüft).

create or replace function public.monitoring_store_topology(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_agent_id uuid,
  p_sys_name text,
  p_ports jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_count integer;
begin
  if not exists (
    select 1 from public.assets where id = p_asset_id and tenant_id = p_tenant_id
  ) then
    return 0;
  end if;
  delete from public.monitoring_device_ports
   where tenant_id = p_tenant_id and asset_id = p_asset_id;
  insert into public.monitoring_device_ports (
    tenant_id, asset_id, port, if_index, alias, up, speed_mbps,
    neighbor_name, neighbor_port, neighbor_address, neighbor_mac,
    macs, mac_count, position, seen_at
  )
  select distinct on (left(item.value->>'port', 80))
         p_tenant_id, p_asset_id, left(item.value->>'port', 80),
         (item.value->>'index')::integer,
         left(item.value->>'alias', 80),
         (item.value->>'up')::boolean,
         (item.value->>'speedMbps')::bigint,
         left(item.value->>'lldpName', 160),
         left(item.value->>'lldpPort', 160),
         left(item.value->>'lldpAddress', 64),
         left(item.value->>'lldpMac', 32),
         coalesce((
           select array_agg(mac.value) from jsonb_array_elements_text(
             case when jsonb_typeof(item.value->'macs') = 'array' then item.value->'macs' else '[]'::jsonb end
           ) with ordinality as mac(value, n) where mac.n <= 16
         ), '{}'::text[]),
         greatest(coalesce((item.value->>'macCount')::integer, 0), 0),
         item.ordinality::integer,
         v_now
    from jsonb_array_elements(
           case when jsonb_typeof(p_ports) = 'array' then p_ports else '[]'::jsonb end
         ) with ordinality as item
   where coalesce(btrim(item.value->>'port'), '') <> ''
   order by left(item.value->>'port', 80), item.ordinality;
  get diagnostics v_count = row_count;
  insert into public.monitoring_topology_status as status
    (asset_id, tenant_id, agent_id, sys_name, scanned_at, error)
  values (p_asset_id, p_tenant_id, p_agent_id, left(p_sys_name, 160), v_now, null)
  on conflict (asset_id) do update
    set agent_id = excluded.agent_id,
        sys_name = excluded.sys_name,
        scanned_at = excluded.scanned_at,
        error = null;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aufträge einstellen: Geräte mit SNMP-Sensor sowie Switches, Firewalls und
-- Router, die von einer aktiven Sonde überwacht werden und seit sechs Stunden
-- nicht mehr angefragt wurden. Höchstens 25 je Lauf. Alte Aufträge dieser Art
-- werden nach einem Tag gelöscht (das Ergebnis steht in den Tabellen oben).

create or replace function public.monitoring_topology_enqueue(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_count integer := 0;
  v_row record;
begin
  delete from public.ipam_agent_jobs
   where kind = 'snmp_topology'
     and status in ('done', 'failed', 'cancelled')
     and created_at < v_now - interval '1 day';
  -- Aufträge, die eine Sonde nie abgeholt hat, verfallen.
  update public.ipam_agent_jobs
     set status = 'cancelled', finished_at = v_now
   where kind = 'snmp_topology' and status = 'queued'
     and created_at < v_now - interval '2 hours';

  for v_row in
    select distinct on (infra.asset_id)
           infra.tenant_id, infra.asset_id, sensor.agent_id,
           lower(btrim(coalesce(nullif(btrim(infra.ip_address), ''), infra.hostname))) as host
      from public.asset_infrastructure infra
      join public.monitoring_sensors sensor
        on sensor.asset_id = infra.asset_id and sensor.tenant_id = infra.tenant_id
       and sensor.agent_id is not null and not sensor.cloud
      join public.ipam_agents agent
        on agent.id = sensor.agent_id and agent.status = 'active'
       and agent.last_seen_at > v_now - interval '10 minutes'
      join public.tenant_feature_flags flag
        on flag.tenant_id = infra.tenant_id and flag.feature_key = 'monitoring.native'
       and flag.enabled
      left join public.monitoring_topology_status status on status.asset_id = infra.asset_id
     where coalesce(nullif(btrim(infra.ip_address), ''), nullif(btrim(infra.hostname), '')) is not null
       and (infra.category in ('switch', 'firewall', 'router')
            or exists (
              select 1 from public.monitoring_sensors snmp
               where snmp.asset_id = infra.asset_id and snmp.kind = 'snmp'
            ))
       and (status.requested_at is null or status.requested_at < v_now - interval '6 hours')
     order by infra.asset_id, (sensor.kind = 'snmp') desc, sensor.created_at
     limit greatest(least(coalesce(p_limit, 25), 200), 1)
  loop
    insert into public.ipam_agent_jobs (tenant_id, agent_id, kind, payload, status)
    values (v_row.tenant_id, v_row.agent_id, 'snmp_topology',
            jsonb_build_object('host', v_row.host, 'assetId', v_row.asset_id), 'queued');
    insert into public.monitoring_topology_status as status (asset_id, tenant_id, agent_id, requested_at)
    values (v_row.asset_id, v_row.tenant_id, v_row.agent_id, v_now)
    on conflict (asset_id) do update set requested_at = excluded.requested_at;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.monitoring_store_topology(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.monitoring_topology_enqueue(integer)
  from public, anon, authenticated;
grant execute on function public.monitoring_store_topology(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.monitoring_topology_enqueue(integer) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-monitoring-topology');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-monitoring-topology',
    '*/15 * * * *',
    'select public.monitoring_topology_enqueue();'
  );
exception when others then
  null;
end;
$$;
