begin;
set local search_path = pg_catalog, public;

-- IPAM-Integrationen (Teil D):
--  * Abgleich mit Intune (MAC/Hostname/Benutzer) und PRTG (überwachte Geräte,
--    Lücken in der Überwachung) mit Protokoll ipam_sync_runs und täglichem Cron.
--  * Netzwerk-Nachschlagen für Tickets, Assets (App) und den KI-Assistenten
--    (ipam_network_lookup, ipam_reserve_address).
--  * REST-API mit Mandanten-API-Schlüsseln (nur SHA-256-Hash gespeichert),
--    Ratenbegrenzung und Webhooks (Outbox mit Wiederholungen, HMAC-Signatur
--    durch die Edge Function ipam-api).
-- Alles nur für service_role; Rechte prüfen die Edge Functions ipam-sync und
-- ipam-api.

-- Freigeben über die API entfernt die Adresse (sie ist danach wieder frei).
grant delete on table public.ipam_addresses to service_role;

-- --------------------------------------------------------------- Hilfen

create or replace function public.ipam_try_inet(p_value text)
returns inet
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_value is null or btrim(p_value) = '' or char_length(p_value) > 64 then
    return null;
  end if;
  return btrim(p_value)::inet;
exception when others then
  return null;
end;
$$;

create or replace function public.ipam_try_macaddr(p_value text)
returns macaddr
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_value is null or btrim(p_value) = '' or char_length(p_value) > 32 then
    return null;
  end if;
  return btrim(p_value)::macaddr;
exception when others then
  return null;
end;
$$;

create or replace function public.ipam_feature_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.tenant_feature_flags flag
    where flag.tenant_id = p_tenant_id
      and flag.feature_key = 'ipam.management'
      and flag.enabled
      and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
  );
$$;

-- --------------------------------------------------------------- Abgleich

create table if not exists public.ipam_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source in ('intune', 'intune_graph', 'prtg')),
  trigger_kind text not null default 'cron' check (trigger_kind in ('manual', 'cron')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_by uuid references public.user_profiles(id) on delete set null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_code text check (error_code is null or char_length(error_code) <= 80)
);
create index if not exists ipam_sync_runs_tenant on public.ipam_sync_runs (tenant_id, started_at desc);

-- MAC-Adressen und Benutzer der Intune-Geräte (Graph: wiFiMacAddress,
-- ethernetMacAddress, userPrincipalName, managementState). Die bestehende
-- Inventar-Synchronisation (asset_intune_devices) liefert keine MACs.
create table if not exists public.ipam_intune_devices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_device_id text not null check (char_length(external_device_id) between 1 and 200),
  device_name text check (device_name is null or char_length(device_name) <= 240),
  wifi_mac macaddr,
  ethernet_mac macaddr,
  user_principal_name text check (user_principal_name is null or char_length(user_principal_name) <= 320),
  management_state text check (management_state is null or char_length(management_state) <= 40),
  last_sync_at timestamptz,
  present boolean not null default true,
  refreshed_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, external_device_id)
);
create index if not exists ipam_intune_devices_wifi on public.ipam_intune_devices (tenant_id, wifi_mac) where wifi_mac is not null;
create index if not exists ipam_intune_devices_ethernet on public.ipam_intune_devices (tenant_id, ethernet_mac) where ethernet_mac is not null;
create index if not exists ipam_intune_devices_name on public.ipam_intune_devices (tenant_id, lower(device_name)) where device_name is not null;

alter table public.ipam_sync_runs enable row level security;
alter table public.ipam_intune_devices enable row level security;
revoke all on table public.ipam_sync_runs, public.ipam_intune_devices from public, anon, authenticated;
grant select, insert, update on table public.ipam_sync_runs, public.ipam_intune_devices to service_role;

-- Speichert den Graph-Abzug: alle bisherigen Geräte gelten als nicht mehr
-- vorhanden, die gelieferten werden (wieder) als vorhanden eingetragen.
create or replace function public.ipam_intune_store(p_tenant_id uuid, p_devices jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  if jsonb_typeof(p_devices) is distinct from 'array' then
    raise exception 'devices must be an array' using errcode = '22023';
  end if;
  update public.ipam_intune_devices set present = false
   where tenant_id = p_tenant_id and present;
  insert into public.ipam_intune_devices as device (
    tenant_id, external_device_id, device_name, wifi_mac, ethernet_mac,
    user_principal_name, management_state, last_sync_at, present, refreshed_at
  )
  select p_tenant_id,
         lower(left(btrim(item.id), 200)),
         nullif(left(btrim(item.device_name), 240), ''),
         public.ipam_try_macaddr(item.wifi_mac),
         public.ipam_try_macaddr(item.ethernet_mac),
         nullif(left(btrim(item.user_principal_name), 320), ''),
         nullif(left(btrim(item.management_state), 40), ''),
         item.last_sync_at,
         true,
         timezone('utc', now())
  from jsonb_to_recordset(p_devices) as item(
    id text, device_name text, wifi_mac text, ethernet_mac text,
    user_principal_name text, management_state text, last_sync_at timestamptz
  )
  where item.id is not null and btrim(item.id) <> ''
  on conflict (tenant_id, external_device_id) do update
    set device_name = excluded.device_name,
        wifi_mac = excluded.wifi_mac,
        ethernet_mac = excluded.ethernet_mac,
        user_principal_name = excluded.user_principal_name,
        management_state = excluded.management_state,
        last_sync_at = excluded.last_sync_at,
        present = true,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Intune-Geräte: MAC-Daten aus dem Graph-Abzug, sonst die Inventar-Synchronisation.
create or replace function public.ipam_intune_device_candidates(p_tenant_id uuid)
returns table (
  external_device_id text,
  device_name text,
  wifi_mac macaddr,
  ethernet_mac macaddr,
  user_principal_name text,
  management_state text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select device.external_device_id, device.device_name, device.wifi_mac, device.ethernet_mac,
         device.user_principal_name, device.management_state
  from public.ipam_intune_devices device
  where device.tenant_id = p_tenant_id and device.present
  union all
  select lower(inventory.external_device_id), coalesce(inventory.managed_device_name, inventory.device_name),
         null::macaddr, null::macaddr, inventory.user_principal_name, null::text
  from public.asset_intune_devices inventory
  where inventory.tenant_id = p_tenant_id
    and not exists (
      select 1 from public.ipam_intune_devices device
      where device.tenant_id = p_tenant_id and device.present
        and device.external_device_id = lower(inventory.external_device_id)
    );
$$;

-- Von PRTG überwachte Infrastrukturgeräte (mit PRTG-Objekt-ID).
create or replace function public.ipam_prtg_devices(p_tenant_id uuid)
returns table (
  asset_id uuid,
  prtg_object_id text,
  category text,
  ip inet,
  name text,
  display_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select infra.asset_id, infra.prtg_object_id, infra.category,
         public.ipam_try_inet(infra.ip_address),
         lower(split_part(coalesce(nullif(infra.hostname, ''), asset.name), '.', 1)),
         coalesce(nullif(infra.hostname, ''), asset.name)
  from public.asset_infrastructure infra
  join public.assets asset on asset.id = infra.asset_id and asset.tenant_id = infra.tenant_id
  where infra.tenant_id = p_tenant_id and infra.prtg_object_id is not null;
$$;

-- Intune: Adressen über MAC, sonst eindeutigen Hostnamen zuordnen,
-- Ghost-Funde verwalteter Geräte erklären, «veraltet» vorschlagen, wenn
-- Intune das Gerät ausmustert oder das verknüpfte Asset ausgemustert ist.
create or replace function public.ipam_reconcile_intune(
  p_tenant_id uuid,
  p_actor_id uuid default null,
  p_trigger text default 'cron'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run uuid;
  v_mac integer := 0;
  v_host integer := 0;
  v_ghost integer := 0;
  v_stale integer := 0;
  v_summary jsonb;
begin
  insert into public.ipam_sync_runs (tenant_id, source, trigger_kind, started_by)
  values (p_tenant_id, 'intune', case when p_trigger = 'manual' then 'manual' else 'cron' end, p_actor_id)
  returning id into v_run;

  begin
    -- 1. MAC
    with matched as (
      select distinct on (address.id)
             address.id as address_id, device.external_device_id, device.device_name,
             device.user_principal_name
      from public.ipam_addresses address
      join public.ipam_intune_device_candidates(p_tenant_id) device
        on address.mac_address is not null
       and (address.mac_address = device.wifi_mac or address.mac_address = device.ethernet_mac)
      where address.tenant_id = p_tenant_id
      order by address.id, device.external_device_id
    )
    update public.ipam_addresses address
       set intune_device_id = left(matched.external_device_id, 80),
           hostname = coalesce(address.hostname, left(matched.device_name, 253)),
           custom_fields = case when matched.user_principal_name is null then address.custom_fields
                                else address.custom_fields || jsonb_build_object('intune_user', matched.user_principal_name) end
      from matched
     where address.id = matched.address_id
       and (address.intune_device_id is distinct from left(matched.external_device_id, 80)
            or address.hostname is null
            or (matched.user_principal_name is not null
                and address.custom_fields ->> 'intune_user' is distinct from matched.user_principal_name));
    get diagnostics v_mac = row_count;

    -- 2. Hostname (nur eindeutige Gerätenamen, nur ohne MAC-Treffer)
    with names as (
      select lower(device.device_name) as name, min(device.external_device_id) as external_device_id,
             min(device.user_principal_name) as user_principal_name
      from public.ipam_intune_device_candidates(p_tenant_id) device
      where device.device_name is not null
      group by lower(device.device_name)
      having count(*) = 1
    )
    update public.ipam_addresses address
       set intune_device_id = left(names.external_device_id, 80),
           custom_fields = case when names.user_principal_name is null then address.custom_fields
                                else address.custom_fields || jsonb_build_object('intune_user', names.user_principal_name) end
      from names
     where address.tenant_id = p_tenant_id
       and address.intune_device_id is null
       and address.hostname is not null
       and lower(split_part(address.hostname, '.', 1)) = names.name;
    get diagnostics v_host = row_count;

    -- Verknüpfte Assets und Besitzer (UPN = E-Mail eines aktiven Mitglieds).
    update public.ipam_addresses address
       set asset_id = inventory.asset_id
      from public.asset_intune_devices inventory
     where address.tenant_id = p_tenant_id
       and address.asset_id is null
       and address.intune_device_id is not null
       and inventory.tenant_id = p_tenant_id
       and inventory.asset_id is not null
       and lower(inventory.external_device_id) = lower(address.intune_device_id);
    update public.ipam_addresses address
       set owner_user_id = member.user_id
      from public.tenant_memberships member
      join auth.users account on account.id = member.user_id
     where address.tenant_id = p_tenant_id
       and address.owner_user_id is null
       and address.custom_fields ? 'intune_user'
       and member.tenant_id = p_tenant_id
       and member.status = 'active'
       and lower(account.email) = lower(address.custom_fields ->> 'intune_user');

    -- 3. Ghost-Funde mit der MAC eines verwalteten Geräts sind erklärt.
    with explained as (
      select finding.id, device.external_device_id, device.device_name
      from public.ipam_findings finding
      join public.ipam_intune_device_candidates(p_tenant_id) device
        on public.ipam_try_macaddr(coalesce(finding.details ->> 'mac', finding.details ->> 'mac_address')) in (device.wifi_mac, device.ethernet_mac)
      where finding.tenant_id = p_tenant_id
        and finding.kind = 'ghost'
        and finding.status = 'open'
    )
    update public.ipam_findings finding
       set status = 'resolved',
           resolved_at = timezone('utc', now()),
           details = finding.details || jsonb_build_object(
             'explained_by', 'intune',
             'intune_device_id', explained.external_device_id,
             'intune_device_name', explained.device_name)
      from explained
     where finding.id = explained.id;
    get diagnostics v_ghost = row_count;

    -- 4. Veraltet vorschlagen (Fund «stale», nur Vorschlag).
    insert into public.ipam_findings (tenant_id, vrf_id, address, address_id, prefix_id, kind, severity, details)
    select address.tenant_id, address.vrf_id, address.address, address.id, address.prefix_id, 'stale', 'info',
           jsonb_build_object(
             'source', 'intune',
             'reason', case when device.management_state ilike 'retire%' or device.management_state ilike 'wipe%'
                            then 'intune_retired' else 'asset_retired' end,
             'suggestion', 'deprecated',
             'intune_device_id', address.intune_device_id,
             'device_name', coalesce(device.device_name, asset.name))
    from public.ipam_addresses address
    left join public.ipam_intune_devices device
      on device.tenant_id = address.tenant_id and device.external_device_id = lower(address.intune_device_id)
    left join public.assets asset
      on asset.tenant_id = address.tenant_id and asset.id = address.asset_id
    where address.tenant_id = p_tenant_id
      and address.intune_device_id is not null
      and address.status <> 'deprecated'
      and (device.management_state ilike 'retire%' or device.management_state ilike 'wipe%'
           or asset.lifecycle_state in ('retired', 'disposed'))
    on conflict do nothing;
    get diagnostics v_stale = row_count;

    v_summary := jsonb_build_object(
      'devices', (select count(*) from public.ipam_intune_device_candidates(p_tenant_id)),
      'matched_by_mac', v_mac,
      'matched_by_hostname', v_host,
      'ghosts_explained', v_ghost,
      'stale_suggested', v_stale);
    update public.ipam_sync_runs
       set status = 'succeeded', finished_at = timezone('utc', now()), summary = v_summary
     where id = v_run;
    return v_summary || jsonb_build_object('run_id', v_run);
  exception when others then
    update public.ipam_sync_runs
       set status = 'failed', finished_at = timezone('utc', now()), error_code = left(sqlstate, 80)
     where id = v_run;
    return jsonb_build_object('run_id', v_run, 'error', sqlstate, 'message', left(sqlerrm, 300));
  end;
end;
$$;

-- Dokumentierte Server/Switches/Firewalls/Router ohne PRTG-Überwachung.
create or replace function public.ipam_prtg_coverage(p_tenant_id uuid)
returns table (
  address_id uuid,
  address inet,
  hostname text,
  device_type text,
  prefix_id uuid,
  asset_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select address.id, address.address, address.hostname, address.device_type, address.prefix_id, address.asset_id
  from public.ipam_addresses address
  where address.tenant_id = p_tenant_id
    and address.device_type in ('server', 'switch', 'firewall', 'router')
    and address.status in ('active', 'reserved')
    and address.prtg_device_id is null
    and not exists (
      select 1 from public.asset_infrastructure infra
      where infra.tenant_id = p_tenant_id
        and infra.prtg_object_id is not null
        and infra.asset_id = address.asset_id
    )
    and not exists (
      select 1 from public.monitoring_alerts alert
      where alert.tenant_id = p_tenant_id
        and alert.device_name is not null
        and lower(alert.device_name) in (
          lower(coalesce(address.hostname, '')),
          lower(split_part(coalesce(address.hostname, ''), '.', 1)),
          host(address.address))
    )
  order by address.address;
$$;

-- PRTG: überwachte Geräte (Infrastruktur mit PRTG-Objekt-ID) den Adressen
-- zuordnen und fehlende Adressen in bestehenden Subnetzen dokumentieren.
create or replace function public.ipam_reconcile_prtg(
  p_tenant_id uuid,
  p_actor_id uuid default null,
  p_trigger text default 'cron'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run uuid;
  v_linked integer := 0;
  v_created integer := 0;
  v_gaps integer := 0;
  v_summary jsonb;
begin
  insert into public.ipam_sync_runs (tenant_id, source, trigger_kind, started_by)
  values (p_tenant_id, 'prtg', case when p_trigger = 'manual' then 'manual' else 'cron' end, p_actor_id)
  returning id into v_run;
  begin
    with matched as (
      select distinct on (address.id) address.id as address_id, device.prtg_object_id, device.asset_id
      from public.ipam_addresses address
      join public.ipam_prtg_devices(p_tenant_id) device
        on device.asset_id = address.asset_id
        or (device.ip is not null and host(device.ip) = host(address.address))
        or (address.hostname is not null and device.name = lower(split_part(address.hostname, '.', 1)))
      where address.tenant_id = p_tenant_id
      order by address.id,
               (device.asset_id = address.asset_id) desc nulls last,
               (device.ip is not null and host(device.ip) = host(address.address)) desc
    )
    update public.ipam_addresses address
       set prtg_device_id = matched.prtg_object_id,
           asset_id = coalesce(address.asset_id, matched.asset_id)
      from matched
     where address.id = matched.address_id
       and (address.prtg_device_id is distinct from matched.prtg_object_id or address.asset_id is null);
    get diagnostics v_linked = row_count;

    insert into public.ipam_addresses (
      tenant_id, address, status, hostname, device_type, asset_id, prtg_device_id,
      last_seen_source, description
    )
    select p_tenant_id, set_masklen(device.ip, case when family(device.ip) = 4 then 32 else 128 end), 'active',
           left(device.display_name, 253),
           case device.category
             when 'server' then 'server' when 'virtual_host' then 'server'
             when 'switch' then 'switch' when 'access_point' then 'access_point'
             when 'firewall' then 'firewall' when 'router' then 'router'
             when 'storage' then 'storage' else 'other' end,
           device.asset_id, device.prtg_object_id, 'prtg', 'Aus PRTG übernommen'
    from public.ipam_prtg_devices(p_tenant_id) device
    where device.ip is not null
      and public.ipam_containing_prefix(p_tenant_id, null, device.ip) is not null
      and not exists (
        select 1 from public.ipam_addresses address
        where address.tenant_id = p_tenant_id and address.vrf_id is null
          and host(address.address) = host(device.ip)
      )
    on conflict do nothing;
    get diagnostics v_created = row_count;

    select count(*) into v_gaps from public.ipam_prtg_coverage(p_tenant_id);
    v_summary := jsonb_build_object(
      'devices', (select count(*) from public.ipam_prtg_devices(p_tenant_id)),
      'linked', v_linked,
      'documented', v_created,
      'coverage_gaps', v_gaps);
    update public.ipam_sync_runs
       set status = 'succeeded', finished_at = timezone('utc', now()), summary = v_summary
     where id = v_run;
    return v_summary || jsonb_build_object('run_id', v_run);
  exception when others then
    update public.ipam_sync_runs
       set status = 'failed', finished_at = timezone('utc', now()), error_code = left(sqlstate, 80)
     where id = v_run;
    return jsonb_build_object('run_id', v_run, 'error', sqlstate, 'message', left(sqlerrm, 300));
  end;
end;
$$;

-- Täglicher Abgleich aller Mandanten mit eingeschaltetem IPAM.
create or replace function public.ipam_sync_daily()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_count integer := 0;
begin
  for v_tenant in
    select tenant.id from public.tenants tenant
    where public.ipam_feature_enabled(tenant.id)
      and exists (select 1 from public.ipam_addresses address where address.tenant_id = tenant.id)
  loop
    perform public.ipam_reconcile_intune(v_tenant, null, 'cron');
    perform public.ipam_reconcile_prtg(v_tenant, null, 'cron');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- --------------------------------------------------------------- Nachschlagen

-- Sucht dokumentierte Adressen (IP, MAC, Hostname, Asset) und die Subnetze
-- zu IPs/CIDRs. Liefert die Abteilung je Treffer; die Edge Function filtert
-- danach den Abteilungsbezug.
create or replace function public.ipam_network_lookup(
  p_tenant_id uuid,
  p_ips text[] default '{}',
  p_macs text[] default '{}',
  p_hostnames text[] default '{}',
  p_asset_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ips inet[];
  v_cidrs cidr[];
  v_macs macaddr[];
  v_names text[];
  v_addresses jsonb;
  v_prefixes jsonb;
begin
  select coalesce(array_agg(distinct public.ipam_try_inet(value)) filter (
           where public.ipam_try_inet(value) is not null
             and masklen(public.ipam_try_inet(value)) = case when family(public.ipam_try_inet(value)) = 4 then 32 else 128 end), '{}'),
         coalesce(array_agg(distinct network(public.ipam_try_inet(value))::cidr) filter (
           where public.ipam_try_inet(value) is not null
             and masklen(public.ipam_try_inet(value)) < case when family(public.ipam_try_inet(value)) = 4 then 32 else 128 end), '{}')
    into v_ips, v_cidrs
  from unnest(coalesce(p_ips, '{}'::text[])) as value;
  select coalesce(array_agg(distinct public.ipam_try_macaddr(value)) filter (where public.ipam_try_macaddr(value) is not null), '{}')
    into v_macs
  from unnest(coalesce(p_macs, '{}'::text[])) as value;
  select coalesce(array_agg(distinct lower(split_part(btrim(value), '.', 1))) filter (where btrim(value) <> ''), '{}')
    into v_names
  from unnest(coalesce(p_hostnames, '{}'::text[])) as value;

  -- Asset: eigene Adressen plus MAC/Hostname/IP aus Infrastruktur und Intune.
  if p_asset_id is not null then
    select v_macs || coalesce(array_agg(distinct mac) filter (where mac is not null), '{}')
      into v_macs
    from (
      select public.ipam_try_macaddr(infra.mac_address) as mac
      from public.asset_infrastructure infra
      where infra.tenant_id = p_tenant_id and infra.asset_id = p_asset_id
      union all
      select unnest(array[device.wifi_mac, device.ethernet_mac])
      from public.asset_intune_devices inventory
      join public.ipam_intune_devices device
        on device.tenant_id = inventory.tenant_id and device.external_device_id = lower(inventory.external_device_id)
      where inventory.tenant_id = p_tenant_id and inventory.asset_id = p_asset_id
    ) macs;
    select v_names || coalesce(array_agg(distinct name) filter (where name is not null and name <> ''), '{}')
      into v_names
    from (
      select lower(split_part(infra.hostname, '.', 1)) as name
      from public.asset_infrastructure infra
      where infra.tenant_id = p_tenant_id and infra.asset_id = p_asset_id
      union all
      select lower(split_part(asset.name, '.', 1))
      from public.assets asset
      where asset.tenant_id = p_tenant_id and asset.id = p_asset_id and asset.name !~ '\s'
    ) names;
    select v_ips || coalesce(array_agg(distinct public.ipam_try_inet(infra.ip_address))
                     filter (where public.ipam_try_inet(infra.ip_address) is not null), '{}')
      into v_ips
    from public.asset_infrastructure infra
    where infra.tenant_id = p_tenant_id and infra.asset_id = p_asset_id;
  end if;

  with hits as (
    select address.*,
           array_remove(array[
             case when host(address.address) = any (select host(ip) from unnest(v_ips) ip) then 'ip' end,
             case when address.mac_address = any (v_macs) then 'mac' end,
             case when address.hostname is not null and lower(split_part(address.hostname, '.', 1)) = any (v_names) then 'hostname'
                  when address.dns_name is not null and lower(split_part(address.dns_name, '.', 1)) = any (v_names) then 'hostname' end,
             case when p_asset_id is not null and address.asset_id = p_asset_id then 'asset' end
           ], null) as matched_by
    from public.ipam_addresses address
    where address.tenant_id = p_tenant_id
      and (
        host(address.address) = any (select host(ip) from unnest(v_ips) ip)
        or address.mac_address = any (v_macs)
        or (address.hostname is not null and lower(split_part(address.hostname, '.', 1)) = any (v_names))
        or (address.dns_name is not null and lower(split_part(address.dns_name, '.', 1)) = any (v_names))
        or (p_asset_id is not null and address.asset_id = p_asset_id)
      )
    order by address.address
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', hit.id,
           'address', host(hit.address),
           'vrf', case when vrf.id is null then null else jsonb_build_object('id', vrf.id, 'name', vrf.name) end,
           'status', hit.status,
           'hostname', hit.hostname,
           'dns_name', hit.dns_name,
           'mac_address', hit.mac_address::text,
           'vendor', hit.vendor,
           'device_type', hit.device_type,
           'description', hit.description,
           'switch_name', hit.switch_name,
           'switch_port', hit.switch_port,
           'last_seen_at', hit.last_seen_at,
           'last_seen_source', hit.last_seen_source,
           'reserved_until', hit.reserved_until,
           'intune_device_id', hit.intune_device_id,
           'prtg_device_id', hit.prtg_device_id,
           'owner', case when hit.owner_user_id is null then null
                         else jsonb_build_object('id', hit.owner_user_id, 'name', owner.display_name) end,
           'intune_user', hit.custom_fields ->> 'intune_user',
           'asset', case when asset.id is null then null
                         else jsonb_build_object('id', asset.id, 'name', asset.name, 'asset_tag', asset.asset_tag) end,
           'prefix', case when prefix.id is null then null
                          else jsonb_build_object('id', prefix.id, 'prefix', prefix.prefix::text,
                                                  'description', prefix.description, 'gateway', host(prefix.gateway)) end,
           'vlan', case when vlan.id is null then null
                        else jsonb_build_object('id', vlan.id, 'number', vlan.vlan_number, 'name', vlan.name) end,
           'site', case when site.id is null then null else jsonb_build_object('id', site.id, 'name', site.name) end,
           'department_id', coalesce(prefix.department_id, vlan.department_id, site.department_id),
           'matched_by', to_jsonb(hit.matched_by),
           'findings', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', finding.id, 'kind', finding.kind, 'severity', finding.severity,
                      'first_seen_at', finding.first_seen_at, 'last_seen_at', finding.last_seen_at,
                      'details', finding.details) order by finding.first_seen_at desc)
             from public.ipam_findings finding
             where finding.tenant_id = p_tenant_id and finding.status = 'open'
               and (finding.address_id = hit.id
                    or (finding.address = hit.address and finding.vrf_id is not distinct from hit.vrf_id))
           ), '[]'::jsonb)
         ) order by hit.address), '[]'::jsonb)
    into v_addresses
  from hits hit
  left join public.ipam_vrfs vrf on vrf.id = hit.vrf_id
  left join public.ipam_prefixes prefix on prefix.id = hit.prefix_id
  left join public.ipam_vlans vlan on vlan.id = prefix.vlan_id
  left join public.ipam_sites site on site.id = coalesce(prefix.site_id, vlan.site_id)
  left join public.assets asset on asset.id = hit.asset_id
  left join public.user_profiles owner on owner.id = hit.owner_user_id;

  -- Subnetze: spezifischstes Prefix je IP und VRF, dazu exakte CIDR-Treffer.
  with matches as (
    select distinct on (ip, prefix.vrf_id) host(ip) as matched, prefix.*
    from unnest(v_ips) ip
    join public.ipam_prefixes prefix on prefix.tenant_id = p_tenant_id and prefix.prefix >>= ip
    order by ip, prefix.vrf_id, masklen(prefix.prefix) desc
  ), exact as (
    select prefix.prefix::text as matched, prefix.*
    from public.ipam_prefixes prefix
    where prefix.tenant_id = p_tenant_id and prefix.prefix = any (v_cidrs)
  ), combined as (
    select * from matches union all select * from exact
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', item.id,
           'prefix', item.prefix::text,
           'matched', item.matched,
           'status', item.status,
           'description', item.description,
           'gateway', host(item.gateway),
           'security_zone', item.security_zone,
           'vrf', case when vrf.id is null then null else jsonb_build_object('id', vrf.id, 'name', vrf.name) end,
           'vlan', case when vlan.id is null then null
                        else jsonb_build_object('id', vlan.id, 'number', vlan.vlan_number, 'name', vlan.name) end,
           'site', case when site.id is null then null else jsonb_build_object('id', site.id, 'name', site.name) end,
           'department_id', coalesce(item.department_id, vlan.department_id, site.department_id),
           'used', usage.used,
           'capacity', usage.capacity,
           'dhcp_size', usage.dhcp_size
         ) order by item.prefix), '[]'::jsonb)
    into v_prefixes
  from (select * from combined limit 50) item
  left join public.ipam_vrfs vrf on vrf.id = item.vrf_id
  left join public.ipam_vlans vlan on vlan.id = item.vlan_id
  left join public.ipam_sites site on site.id = coalesce(item.site_id, vlan.site_id)
  left join lateral (
    select u.used, u.capacity, u.dhcp_size from public.ipam_prefix_usage(p_tenant_id) u where u.prefix_id = item.id
  ) usage on true;

  return jsonb_build_object('addresses', v_addresses, 'prefixes', v_prefixes);
end;
$$;

-- Reserviert eine bestimmte oder die nächste freie Adresse eines Prefix
-- (Assistent nach Bestätigung, REST-API). Gibt die Adresse als JSON zurück.
create or replace function public.ipam_reserve_address(
  p_tenant_id uuid,
  p_prefix_id uuid,
  p_address inet default null,
  p_hostname text default null,
  p_description text default null,
  p_mac text default null,
  p_dns_name text default null,
  p_actor_id uuid default null,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix public.ipam_prefixes;
  v_candidate inet;
  v_id uuid;
  v_attempt integer := 0;
  v_mac macaddr;
begin
  select * into v_prefix from public.ipam_prefixes where id = p_prefix_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Prefix not found' using errcode = 'P0002';
  end if;
  if v_prefix.status not in ('active', 'reserved') then
    raise exception 'Prefix not usable' using errcode = '22023';
  end if;
  if p_mac is not null and btrim(p_mac) <> '' then
    v_mac := public.ipam_try_macaddr(p_mac);
    if v_mac is null then
      raise exception 'Invalid MAC address' using errcode = '22023';
    end if;
  end if;
  if p_address is not null then
    v_candidate := set_masklen(p_address, case when family(p_address) = 4 then 32 else 128 end);
    if not (v_candidate << v_prefix.prefix)
       or (family(v_candidate) = 4 and masklen(v_prefix.prefix) <= 30
           and (host(v_candidate) = host(network(v_prefix.prefix)) or host(v_candidate) = host(broadcast(v_prefix.prefix))))
       or (v_prefix.gateway is not null and host(v_prefix.gateway) = host(v_candidate))
       or (v_prefix.dhcp_start is not null and v_candidate >= v_prefix.dhcp_start and v_candidate <= v_prefix.dhcp_end) then
      raise exception 'Address not available in prefix' using errcode = '22023';
    end if;
  end if;
  loop
    v_attempt := v_attempt + 1;
    if p_address is null then
      v_candidate := public.ipam_next_free_address(p_tenant_id, p_prefix_id, null);
      if v_candidate is null then
        raise exception 'Prefix is full' using errcode = '53400';
      end if;
    end if;
    -- Freigegebene (veraltete) Adresse wiederverwenden: Zeile aktualisieren.
    update public.ipam_addresses address
       set status = 'reserved',
           hostname = nullif(left(btrim(p_hostname), 253), ''),
           description = nullif(left(btrim(p_description), 1000), ''),
           mac_address = v_mac,
           dns_name = nullif(left(btrim(p_dns_name), 253), ''),
           owner_user_id = null,
           asset_id = null,
           reserved_until = null,
           last_seen_at = null,
           last_seen_source = null
     where address.tenant_id = p_tenant_id
       and address.vrf_id is not distinct from v_prefix.vrf_id
       and address.address = v_candidate
       and address.status = 'deprecated'
    returning address.id into v_id;
    exit when v_id is not null;
    begin
      insert into public.ipam_addresses (
        tenant_id, vrf_id, address, status, hostname, description, mac_address, dns_name, created_by
      ) values (
        p_tenant_id, v_prefix.vrf_id, v_candidate, 'reserved',
        nullif(left(btrim(p_hostname), 253), ''), nullif(left(btrim(p_description), 1000), ''),
        v_mac, nullif(left(btrim(p_dns_name), 253), ''), p_actor_id
      ) returning id into v_id;
      exit;
    exception when unique_violation then
      if p_address is not null or v_attempt >= 5 then
        raise exception 'Address already taken' using errcode = '23505';
      end if;
    end;
  end loop;
  insert into public.ipam_address_events (tenant_id, address_id, actor_id, kind, details)
  values (p_tenant_id, v_id, p_actor_id, 'reserved', jsonb_build_object('source', left(coalesce(p_source, 'manual'), 40)));
  return jsonb_build_object('id', v_id, 'address', host(v_candidate), 'prefix_id', p_prefix_id,
                            'prefix', v_prefix.prefix::text, 'status', 'reserved');
end;
$$;

-- --------------------------------------------------------------- REST-API

create table if not exists public.ipam_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  key_prefix text not null check (key_prefix ~ '^ndk_ipam_[A-Za-z0-9_-]{4,12}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{read}'
    check (cardinality(scopes) between 1 and 2 and scopes <@ array['read', 'write']::text[]),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.user_profiles(id) on delete set null,
  unique (tenant_id, id)
);
create unique index if not exists ipam_api_keys_hash on public.ipam_api_keys (key_hash);
create index if not exists ipam_api_keys_tenant on public.ipam_api_keys (tenant_id, created_at desc);

-- Ein Zähler je Schlüssel und Minute (die Zeile wird je Minute zurückgesetzt).
create table if not exists public.ipam_api_rate_limits (
  key_id uuid primary key references public.ipam_api_keys(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);

create table if not exists public.ipam_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  url text not null check (char_length(url) between 12 and 500 and url ~ '^https://[^\s/?#]+'),
  events text[] not null
    check (cardinality(events) between 1 and 5 and events <@ array[
      'address.reserved', 'address.released', 'address.updated', 'prefix.created', 'finding.opened'
    ]::text[]),
  secret text not null check (char_length(secret) between 32 and 128),
  active boolean not null default true,
  last_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  last_delivery_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id)
);
create index if not exists ipam_webhooks_tenant on public.ipam_webhooks (tenant_id) where active;

create table if not exists public.ipam_webhook_outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_id uuid not null,
  event text not null check (event in (
    'address.reserved', 'address.released', 'address.updated', 'prefix.created', 'finding.opened', 'ping'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default timezone('utc', now()),
  delivered_at timestamptz,
  foreign key (webhook_id, tenant_id) references public.ipam_webhooks(id, tenant_id) on delete cascade
);
create index if not exists ipam_webhook_outbox_due on public.ipam_webhook_outbox (next_attempt_at) where status = 'pending';
create index if not exists ipam_webhook_outbox_webhook on public.ipam_webhook_outbox (webhook_id, created_at desc);

alter table public.ipam_api_keys enable row level security;
alter table public.ipam_api_rate_limits enable row level security;
alter table public.ipam_webhooks enable row level security;
alter table public.ipam_webhook_outbox enable row level security;
revoke all on table public.ipam_api_keys, public.ipam_api_rate_limits, public.ipam_webhooks,
  public.ipam_webhook_outbox from public, anon, authenticated;
grant select, insert, update on table public.ipam_api_keys, public.ipam_api_rate_limits,
  public.ipam_webhooks, public.ipam_webhook_outbox to service_role;

-- Zählt eine Anfrage; true solange das Limit pro Minute nicht überschritten ist.
create or replace function public.ipam_api_consume(p_key_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_window timestamptz := date_trunc('minute', timezone('utc', now()));
  v_count integer;
begin
  insert into public.ipam_api_rate_limits as rate (key_id, window_start, request_count)
  values (p_key_id, v_window, 1)
  on conflict (key_id) do update
    set request_count = case when rate.window_start = v_window then rate.request_count + 1 else 1 end,
        window_start = v_window
  returning request_count into v_count;
  update public.ipam_api_keys set last_used_at = timezone('utc', now())
   where id = p_key_id and (last_used_at is null or last_used_at < timezone('utc', now()) - interval '1 minute');
  return v_count <= p_limit;
end;
$$;

-- Ereignis für alle aktiven Webhooks des Mandanten einreihen.
create or replace function public.ipam_webhook_enqueue(p_tenant_id uuid, p_event text, p_data jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  insert into public.ipam_webhook_outbox (tenant_id, webhook_id, event, payload)
  select hook.tenant_id, hook.id, p_event,
         jsonb_build_object('id', gen_random_uuid(), 'event', p_event,
                            'occurred_at', timezone('utc', now()), 'tenant_id', p_tenant_id, 'data', p_data)
  from public.ipam_webhooks hook
  where hook.tenant_id = p_tenant_id and hook.active and p_event = any (hook.events);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.ipam_webhook_address_payload(p_row public.ipam_addresses)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_row.id, 'address', host(p_row.address), 'vrf_id', p_row.vrf_id, 'prefix_id', p_row.prefix_id,
    'status', p_row.status, 'hostname', p_row.hostname, 'dns_name', p_row.dns_name,
    'mac_address', p_row.mac_address::text, 'device_type', p_row.device_type,
    'description', p_row.description, 'reserved_until', p_row.reserved_until);
$$;

create or replace function public.ipam_addresses_webhook()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if not exists (select 1 from public.ipam_webhooks hook where hook.tenant_id = v_tenant and hook.active) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.ipam_webhook_enqueue(v_tenant, 'address.reserved', public.ipam_webhook_address_payload(new));
  elsif tg_op = 'DELETE' then
    perform public.ipam_webhook_enqueue(v_tenant, 'address.released', public.ipam_webhook_address_payload(old));
  elsif new.status = 'reserved' and old.status is distinct from 'reserved' then
    perform public.ipam_webhook_enqueue(v_tenant, 'address.reserved', public.ipam_webhook_address_payload(new));
  elsif (new.address, new.status, new.hostname, new.dns_name, new.mac_address, new.device_type,
         new.description, new.owner_user_id, new.switch_name, new.switch_port, new.reserved_until, new.asset_id)
        is distinct from
        (old.address, old.status, old.hostname, old.dns_name, old.mac_address, old.device_type,
         old.description, old.owner_user_id, old.switch_name, old.switch_port, old.reserved_until, old.asset_id) then
    perform public.ipam_webhook_enqueue(
      v_tenant,
      case when new.status = 'deprecated' and old.status <> 'deprecated' then 'address.released' else 'address.updated' end,
      public.ipam_webhook_address_payload(new));
  end if;
  return null;
end;
$$;
create or replace trigger ipam_addresses_webhook
  after insert or update or delete on public.ipam_addresses
  for each row execute function public.ipam_addresses_webhook();

create or replace function public.ipam_prefixes_webhook()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (select 1 from public.ipam_webhooks hook where hook.tenant_id = new.tenant_id and hook.active) then
    perform public.ipam_webhook_enqueue(new.tenant_id, 'prefix.created', jsonb_build_object(
      'id', new.id, 'prefix', new.prefix::text, 'vrf_id', new.vrf_id, 'status', new.status,
      'vlan_id', new.vlan_id, 'site_id', new.site_id, 'description', new.description,
      'gateway', host(new.gateway)));
  end if;
  return null;
end;
$$;
create or replace trigger ipam_prefixes_webhook
  after insert on public.ipam_prefixes
  for each row execute function public.ipam_prefixes_webhook();

create or replace function public.ipam_findings_webhook()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'open'
     and exists (select 1 from public.ipam_webhooks hook where hook.tenant_id = new.tenant_id and hook.active) then
    perform public.ipam_webhook_enqueue(new.tenant_id, 'finding.opened', jsonb_build_object(
      'id', new.id, 'kind', new.kind, 'severity', new.severity, 'address', host(new.address),
      'address_id', new.address_id, 'prefix_id', new.prefix_id, 'vrf_id', new.vrf_id, 'details', new.details));
  end if;
  return null;
end;
$$;
create or replace trigger ipam_findings_webhook
  after insert on public.ipam_findings
  for each row execute function public.ipam_findings_webhook();

-- Fällige Zustellungen holen (Lease 5 Minuten, max. 8 Versuche).
create or replace function public.ipam_webhook_claim(p_limit integer default 50)
returns table (
  id bigint,
  tenant_id uuid,
  webhook_id uuid,
  event text,
  payload jsonb,
  attempts integer,
  url text,
  secret text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return query
  with due as (
    select outbox.id
    from public.ipam_webhook_outbox outbox
    where outbox.status = 'pending' and outbox.next_attempt_at <= timezone('utc', now())
    order by outbox.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), claimed as (
    update public.ipam_webhook_outbox outbox
       set attempts = outbox.attempts + 1,
           next_attempt_at = timezone('utc', now()) + interval '5 minutes'
      from due
     where outbox.id = due.id
    returning outbox.id, outbox.tenant_id, outbox.webhook_id, outbox.event, outbox.payload, outbox.attempts
  )
  select claimed.id, claimed.tenant_id, claimed.webhook_id, claimed.event, claimed.payload, claimed.attempts,
         hook.url, hook.secret
  from claimed
  join public.ipam_webhooks hook on hook.id = claimed.webhook_id and hook.tenant_id = claimed.tenant_id;
end;
$$;

create or replace function public.ipam_webhook_complete(
  p_id bigint,
  p_ok boolean,
  p_status integer,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.ipam_webhook_outbox;
  v_state text;
begin
  select * into v_row from public.ipam_webhook_outbox where id = p_id for update;
  if not found then
    return null;
  end if;
  v_state := case when p_ok then 'delivered' when v_row.attempts >= 8 then 'failed' else 'pending' end;
  update public.ipam_webhook_outbox
     set status = v_state,
         last_status = p_status,
         last_error = left(p_error, 300),
         delivered_at = case when p_ok then timezone('utc', now()) else null end,
         -- 1, 5, 15, 60, 120, 240, 480 Minuten
         next_attempt_at = case when v_state = 'pending' then timezone('utc', now()) +
           (case v_row.attempts when 1 then 1 when 2 then 5 when 3 then 15 when 4 then 60
                                when 5 then 120 when 6 then 240 else 480 end) * interval '1 minute'
           else next_attempt_at end
   where id = p_id;
  update public.ipam_webhooks
     set last_status = p_status,
         last_error = case when p_ok then null else left(p_error, 300) end,
         last_delivery_at = timezone('utc', now())
   where id = v_row.webhook_id;
  return v_state;
end;
$$;

-- Weckt ipam-api, wenn Zustellungen fällig sind (jede Minute) bzw. für den
-- täglichen Intune-Abzug. Nutzt die Dispatch-Konfiguration aus 0234.
create or replace function public.ipam_wake(p_job text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_base text;
  v_secret text;
begin
  if p_job = 'webhooks' then
    if not exists (
      select 1 from public.ipam_webhook_outbox outbox
      where outbox.status = 'pending' and outbox.next_attempt_at <= timezone('utc', now())
    ) then
      return;
    end if;
  elsif p_job = 'intune' then
    if not exists (
      select 1 from public.asset_intune_connections connection
      where connection.enabled and connection.directory_tenant_id is not null
        and public.ipam_feature_enabled(connection.tenant_id)
    ) then
      return;
    end if;
  else
    return;
  end if;
  if to_regclass('monitoring_automation_private.dispatch_config') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select functions_base_url, dispatch_secret from monitoring_automation_private.dispatch_config where singleton'
    into v_base, v_secret;
  if v_base is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using rtrim(v_base, '/') || '/ipam-api',
          jsonb_build_object('type', 'cron', 'job', p_job),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          30000;
exception when others then
  return;
end;
$$;

-- --------------------------------------------------------------- Rechte

revoke all on function public.ipam_try_inet(text) from public, anon, authenticated;
revoke all on function public.ipam_try_macaddr(text) from public, anon, authenticated;
revoke all on function public.ipam_feature_enabled(uuid) from public, anon, authenticated;
revoke all on function public.ipam_intune_store(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ipam_intune_device_candidates(uuid) from public, anon, authenticated;
revoke all on function public.ipam_prtg_devices(uuid) from public, anon, authenticated;
revoke all on function public.ipam_reconcile_intune(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ipam_prtg_coverage(uuid) from public, anon, authenticated;
revoke all on function public.ipam_reconcile_prtg(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ipam_sync_daily() from public, anon, authenticated;
revoke all on function public.ipam_network_lookup(uuid, text[], text[], text[], uuid) from public, anon, authenticated;
revoke all on function public.ipam_reserve_address(uuid, uuid, inet, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.ipam_api_consume(uuid, integer) from public, anon, authenticated;
revoke all on function public.ipam_webhook_enqueue(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.ipam_webhook_address_payload(public.ipam_addresses) from public, anon, authenticated;
revoke all on function public.ipam_addresses_webhook() from public, anon, authenticated;
revoke all on function public.ipam_prefixes_webhook() from public, anon, authenticated;
revoke all on function public.ipam_findings_webhook() from public, anon, authenticated;
revoke all on function public.ipam_webhook_claim(integer) from public, anon, authenticated;
revoke all on function public.ipam_webhook_complete(bigint, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.ipam_wake(text) from public, anon, authenticated;

grant execute on function public.ipam_try_inet(text) to service_role;
grant execute on function public.ipam_try_macaddr(text) to service_role;
grant execute on function public.ipam_feature_enabled(uuid) to service_role;
grant execute on function public.ipam_intune_store(uuid, jsonb) to service_role;
grant execute on function public.ipam_intune_device_candidates(uuid) to service_role;
grant execute on function public.ipam_prtg_devices(uuid) to service_role;
grant execute on function public.ipam_reconcile_intune(uuid, uuid, text) to service_role;
grant execute on function public.ipam_prtg_coverage(uuid) to service_role;
grant execute on function public.ipam_reconcile_prtg(uuid, uuid, text) to service_role;
grant execute on function public.ipam_sync_daily() to service_role;
grant execute on function public.ipam_network_lookup(uuid, text[], text[], text[], uuid) to service_role;
grant execute on function public.ipam_reserve_address(uuid, uuid, inet, text, text, text, text, uuid, text) to service_role;
grant execute on function public.ipam_api_consume(uuid, integer) to service_role;
grant execute on function public.ipam_webhook_enqueue(uuid, text, jsonb) to service_role;
grant execute on function public.ipam_webhook_claim(integer) to service_role;
grant execute on function public.ipam_webhook_complete(bigint, boolean, integer, text) to service_role;

-- --------------------------------------------------------------- Cron

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-ipam-webhooks');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('nextdesk-ipam-intune-refresh');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('nextdesk-ipam-sync');
  exception when others then null;
  end;
  perform cron.schedule('nextdesk-ipam-webhooks', '* * * * *', $cron$select public.ipam_wake('webhooks');$cron$);
  perform cron.schedule('nextdesk-ipam-intune-refresh', '23 2 * * *', $cron$select public.ipam_wake('intune');$cron$);
  perform cron.schedule('nextdesk-ipam-sync', '47 2 * * *', $cron$select public.ipam_sync_daily();$cron$);
exception when others then
  null;
end;
$$;

commit;
