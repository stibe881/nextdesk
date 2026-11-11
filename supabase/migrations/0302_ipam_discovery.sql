begin;
set local search_path = pg_catalog, public;

-- IPAM Discovery: lokale Netzwerkagenten, Aufträge an die Agenten,
-- Microsoft DHCP (Bereiche, Leases) und DNS (Records), die letzte
-- Beobachtung je Adresse sowie der Standort je MAC (Switch-Port).
--
-- Die Agenten melden sich nur ausgehend über die Edge Function `ipam-agent`
-- (Token, als SHA-256 gespeichert). Verwaltung über `ipam-discovery`
-- (ipam.read / ipam.manage). Alle Tabellen nur für service_role.
--
-- Zugangsdaten (SNMP, Dienstkonto) liegen ausschliesslich in der lokalen
-- Konfigurationsdatei des Agenten, nie in nextDesk: `config` enthält nur
-- Ziele (Hostnamen), Protokolle und Zeitplan.

create table if not exists public.ipam_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text check (token_hint is null or char_length(token_hint) <= 24),
  token_rotated_at timestamptz not null default timezone('utc', now()),
  status text not null default 'active' check (status in ('active', 'disabled', 'revoked')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  version text check (version is null or char_length(version) <= 40),
  hostname text check (hostname is null or char_length(hostname) <= 253),
  platform text check (platform is null or char_length(platform) <= 40),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  last_seen_at timestamptz,
  last_report_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  rate_window_started_at timestamptz,
  rate_count integer not null default 0,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  revoked_by uuid references public.user_profiles(id) on delete set null,
  unique (tenant_id, id)
);
create unique index if not exists ipam_agents_name_unique
  on public.ipam_agents (tenant_id, lower(name)) where status <> 'revoked';

-- Ein Scan-Durchlauf eines Agenten (mehrere Berichte mit gleichem run_key).
create table if not exists public.ipam_agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null,
  run_key text not null check (char_length(run_key) between 1 and 80),
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual', 'startup')),
  job_id uuid,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  report_count integer not null default 0,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  unique (agent_id, run_key),
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete cascade
);
create index if not exists ipam_agent_runs_recent on public.ipam_agent_runs (tenant_id, started_at desc);

-- Aufträge an einen Agenten. Schreibende Aufträge (DHCP/DNS) brauchen die
-- Freigabe durch eine Person mit ipam.manage (Trigger unten).
create table if not exists public.ipam_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null,
  kind text not null check (kind in (
    'scan_now', 'dhcp_reserve', 'dhcp_release', 'dns_upsert_a', 'dns_upsert_ptr', 'dns_delete'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in (
    'pending_approval', 'queued', 'running', 'done', 'failed', 'cancelled'
  )),
  result jsonb,
  error text check (error is null or char_length(error) <= 1000),
  address_id uuid,
  created_by uuid references public.user_profiles(id) on delete set null,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  unique (tenant_id, id),
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete cascade,
  foreign key (address_id, tenant_id) references public.ipam_addresses(id, tenant_id) on delete set null (address_id),
  constraint ipam_agent_jobs_write_approved check (
    kind = 'scan_now' or status in ('pending_approval', 'cancelled') or approved_at is not null
  )
);
create index if not exists ipam_agent_jobs_agent_status on public.ipam_agent_jobs (agent_id, status, created_at);
create index if not exists ipam_agent_jobs_recent on public.ipam_agent_jobs (tenant_id, created_at desc);

create table if not exists public.ipam_dhcp_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid,
  server text not null check (char_length(server) between 1 and 253),
  scope_id inet not null,
  subnet_mask inet,
  name text check (name is null or char_length(name) <= 200),
  description text check (description is null or char_length(description) <= 500),
  state text check (state is null or char_length(state) <= 40),
  start_range inet,
  end_range inet,
  lease_duration_seconds integer check (lease_duration_seconds is null or lease_duration_seconds >= 0),
  addresses_in_use integer check (addresses_in_use is null or addresses_in_use >= 0),
  addresses_free integer check (addresses_free is null or addresses_free >= 0),
  addresses_reserved integer check (addresses_reserved is null or addresses_reserved >= 0),
  prefix_id uuid,
  seen_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  unique (tenant_id, server, scope_id),
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete set null (agent_id),
  foreign key (prefix_id, tenant_id) references public.ipam_prefixes(id, tenant_id) on delete set null (prefix_id)
);

create table if not exists public.ipam_dhcp_leases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope_ref uuid not null,
  server text not null check (char_length(server) between 1 and 253),
  address inet not null,
  mac macaddr,
  client_id text check (client_id is null or char_length(client_id) <= 120),
  hostname text check (hostname is null or char_length(hostname) <= 253),
  state text check (state is null or char_length(state) <= 40),
  expires_at timestamptz,
  reservation boolean not null default false,
  reservation_name text check (reservation_name is null or char_length(reservation_name) <= 200),
  seen_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, server, address),
  foreign key (scope_ref, tenant_id) references public.ipam_dhcp_scopes(id, tenant_id) on delete cascade
);
create index if not exists ipam_dhcp_leases_address on public.ipam_dhcp_leases (tenant_id, address);
create index if not exists ipam_dhcp_leases_scope on public.ipam_dhcp_leases (scope_ref, seen_at);

create table if not exists public.ipam_dns_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid,
  server text not null check (char_length(server) between 1 and 253),
  zone text not null check (char_length(zone) between 1 and 253),
  name text not null check (char_length(name) between 1 and 253),
  type text not null check (type in ('A', 'AAAA', 'PTR', 'CNAME')),
  value text not null check (char_length(value) between 1 and 253),
  -- A/AAAA: Zieladresse; PTR: aus dem Reverse-Namen abgeleitete Adresse.
  address inet,
  ttl integer check (ttl is null or ttl >= 0),
  seen_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, server, zone, name, type, value),
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete set null (agent_id)
);
create index if not exists ipam_dns_records_address on public.ipam_dns_records (tenant_id, address) where address is not null;
create index if not exists ipam_dns_records_name on public.ipam_dns_records (tenant_id, name);
create index if not exists ipam_dns_records_zone on public.ipam_dns_records (tenant_id, server, zone, seen_at);

-- Letzte Beobachtung je Adresse (roh, unabhängig von der Dokumentation).
create table if not exists public.ipam_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vrf_id uuid,
  address inet not null check (masklen(address) = case when family(address) = 4 then 32 else 128 end),
  mac macaddr,
  source text not null check (source in ('ping', 'arp', 'snmp', 'dhcp', 'ndp')),
  sources text[] not null default '{}'
    check (sources <@ array['ping', 'arp', 'snmp', 'dhcp', 'ndp']::text[]),
  switch_name text check (switch_name is null or char_length(switch_name) <= 160),
  switch_port text check (switch_port is null or char_length(switch_port) <= 80),
  vlan integer check (vlan is null or vlan between 1 and 4094),
  hostname text check (hostname is null or char_length(hostname) <= 253),
  vendor text check (vendor is null or char_length(vendor) <= 160),
  agent_id uuid,
  -- MACs, die im selben Scan-Durchlauf für diese Adresse gesehen wurden.
  run_key text check (run_key is null or char_length(run_key) <= 80),
  run_macs macaddr[] not null default '{}',
  first_seen_at timestamptz not null default timezone('utc', now()),
  seen_at timestamptz not null default timezone('utc', now()),
  foreign key (vrf_id, tenant_id) references public.ipam_vrfs(id, tenant_id) on delete cascade,
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete set null (agent_id)
);
create unique index if not exists ipam_observations_unique
  on public.ipam_observations (tenant_id, coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid), address);
create index if not exists ipam_observations_mac on public.ipam_observations (tenant_id, mac) where mac is not null;

-- Wo eine MAC zuletzt am Switch gesehen wurde (LLDP oder MAC-Tabelle,
-- Uplinks ausgefiltert).
create table if not exists public.ipam_mac_locations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mac macaddr not null,
  switch_name text not null check (char_length(switch_name) between 1 and 160),
  switch_port text not null check (char_length(switch_port) between 1 and 80),
  vlan integer check (vlan is null or vlan between 1 and 4094),
  source text not null check (source in ('lldp', 'fdb')),
  agent_id uuid,
  seen_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, mac),
  foreign key (agent_id, tenant_id) references public.ipam_agents(id, tenant_id) on delete set null (agent_id)
);

alter table public.ipam_agents enable row level security;
alter table public.ipam_agent_runs enable row level security;
alter table public.ipam_agent_jobs enable row level security;
alter table public.ipam_dhcp_scopes enable row level security;
alter table public.ipam_dhcp_leases enable row level security;
alter table public.ipam_dns_records enable row level security;
alter table public.ipam_observations enable row level security;
alter table public.ipam_mac_locations enable row level security;
revoke all on table public.ipam_agents, public.ipam_agent_runs, public.ipam_agent_jobs,
  public.ipam_dhcp_scopes, public.ipam_dhcp_leases, public.ipam_dns_records,
  public.ipam_observations, public.ipam_mac_locations from public, anon, authenticated;
grant select, insert, update, delete on table public.ipam_agents, public.ipam_agent_runs,
  public.ipam_agent_jobs, public.ipam_dhcp_scopes, public.ipam_dhcp_leases,
  public.ipam_dns_records, public.ipam_observations, public.ipam_mac_locations to service_role;

-- Schreibende Aufträge: Freigabe nur durch Personen mit ipam.manage.
create or replace function public.ipam_agent_jobs_check_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.kind <> 'scan_now'
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
create or replace trigger ipam_agent_jobs_check_approval
  before insert or update on public.ipam_agent_jobs
  for each row execute function public.ipam_agent_jobs_check_approval();

-- DHCP-Bereich dem passenden Prefix (globales VRF) zuordnen.
create or replace function public.ipam_dhcp_scopes_assign_prefix()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.prefix_id := public.ipam_containing_prefix(new.tenant_id, null, new.scope_id);
  return new;
end;
$$;
create or replace trigger ipam_dhcp_scopes_assign_prefix
  before insert or update of scope_id on public.ipam_dhcp_scopes
  for each row execute function public.ipam_dhcp_scopes_assign_prefix();

-- Lebenszeichen und Ratenbegrenzung je Agent (Anfragen pro Minute).
create or replace function public.ipam_agent_touch(p_agent_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.ipam_agents
     set rate_count = case
           when rate_window_started_at is null
             or rate_window_started_at < timezone('utc', now()) - interval '1 minute' then 1
           else rate_count + 1 end,
         rate_window_started_at = case
           when rate_window_started_at is null
             or rate_window_started_at < timezone('utc', now()) - interval '1 minute'
             then timezone('utc', now())
           else rate_window_started_at end,
         last_seen_at = timezone('utc', now())
   where id = p_agent_id and status = 'active'
   returning rate_count into v_count;
  return v_count is not null and v_count <= greatest(p_limit, 1);
end;
$$;

-- Wartende Aufträge übernehmen; hängengebliebene (30 Min.) als fehlgeschlagen.
create or replace function public.ipam_agent_claim_jobs(p_agent_id uuid, p_limit integer)
returns setof public.ipam_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.ipam_agent_jobs
     set status = 'failed', error = 'Zeitüberschreitung: keine Rückmeldung des Agenten.',
         finished_at = timezone('utc', now())
   where agent_id = p_agent_id and status = 'running'
     and started_at < timezone('utc', now()) - interval '30 minutes';
  return query
  update public.ipam_agent_jobs job
     set status = 'running', started_at = timezone('utc', now())
   where job.id in (
     select pending.id from public.ipam_agent_jobs pending
      where pending.agent_id = p_agent_id and pending.status = 'queued'
      order by pending.created_at
      limit greatest(least(p_limit, 50), 1)
      for update skip locked
   )
  returning job.*;
end;
$$;

-- Kontext für die Auswertung einer Beobachtungsmenge: dokumentierte Adresse,
-- Prefix, DHCP-Lease, letzte Beobachtung und Switch-Standort der MACs.
create or replace function public.ipam_discovery_context(
  p_tenant_id uuid,
  p_vrf_id uuid,
  p_addresses text[],
  p_macs text[]
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'address', host(item.address),
        'addressId', address.id,
        'status', address.status,
        'mac', address.mac_address::text,
        'hostname', address.hostname,
        'vendor', address.vendor,
        'switchName', address.switch_name,
        'switchPort', address.switch_port,
        'lastSeenAt', address.last_seen_at,
        'prefixId', prefix.id,
        'inDhcpRange', coalesce(prefix.dhcp_start is not null
          and item.address >= prefix.dhcp_start and item.address <= prefix.dhcp_end, false),
        'lease', case when lease.id is null then null else jsonb_build_object(
          'mac', lease.mac::text,
          'hostname', lease.hostname,
          'reservation', lease.reservation,
          'active', lease.reservation
            or lease.expires_at is null
            or lease.expires_at > timezone('utc', now())
        ) end,
        'observation', case when observation.id is null then null else jsonb_build_object(
          'mac', observation.mac::text,
          'runKey', observation.run_key,
          'runMacs', to_jsonb(observation.run_macs::text[])
        ) end
      ))
      from (select distinct set_masklen(raw::inet, case when family(raw::inet) = 4 then 32 else 128 end) as address
              from unnest(p_addresses) raw) item
      left join public.ipam_addresses address
        on address.tenant_id = p_tenant_id
       and address.vrf_id is not distinct from p_vrf_id
       and address.address = item.address
      left join lateral (
        select candidate.id, candidate.dhcp_start, candidate.dhcp_end
        from public.ipam_prefixes candidate
        where candidate.tenant_id = p_tenant_id
          and candidate.vrf_id is not distinct from p_vrf_id
          and candidate.prefix >>= item.address
        order by masklen(candidate.prefix) desc
        limit 1
      ) prefix on true
      left join lateral (
        select candidate.id, candidate.mac, candidate.hostname, candidate.reservation, candidate.expires_at
        from public.ipam_dhcp_leases candidate
        where candidate.tenant_id = p_tenant_id and candidate.address = item.address
        order by candidate.reservation desc, candidate.seen_at desc
        limit 1
      ) lease on p_vrf_id is null
      left join public.ipam_observations observation
        on observation.tenant_id = p_tenant_id
       and observation.vrf_id is not distinct from p_vrf_id
       and observation.address = item.address
    ), '[]'::jsonb),
    'macLocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mac', location.mac::text,
        'switchName', location.switch_name,
        'switchPort', location.switch_port,
        'vlan', location.vlan,
        'source', location.source
      ))
      from public.ipam_mac_locations location
      where location.tenant_id = p_tenant_id
        and location.mac = any(p_macs::macaddr[])
    ), '[]'::jsonb)
  );
$$;

-- Benachrichtigung über neue Funde (Push/Mail-Kategorie «Störungen» über
-- die Art 'monitoring.ipam_finding'). Empfänger: Team der Adresse, sonst alle
-- Personen mit ipam.manage.
create or replace function public.ipam_findings_notify(p_tenant_id uuid, p_finding_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_finding record;
  v_count integer := 0;
  v_rows integer;
  v_critical integer := 0;
  v_warning_ids uuid[] := '{}';
  v_payload jsonb;
  v_label text;
begin
  for v_finding in
    select finding.*, address.team_id
    from public.ipam_findings finding
    left join public.ipam_addresses address on address.id = finding.address_id
    where finding.tenant_id = p_tenant_id
      and finding.id = any(p_finding_ids)
      and finding.status = 'open'
      and finding.severity in ('critical', 'warning')
    order by case finding.severity when 'critical' then 0 else 1 end, finding.address
  loop
    if v_finding.severity = 'warning' then
      v_warning_ids := v_warning_ids || v_finding.id;
      continue;
    end if;
    v_critical := v_critical + 1;
    if v_critical > 10 then
      v_warning_ids := v_warning_ids || v_finding.id;
      continue;
    end if;
    v_label := case v_finding.kind
      when 'conflict' then 'IP-Konflikt: zwei MAC-Adressen'
      when 'foreign_mac' then 'Fremde MAC auf reservierter IP'
      when 'ghost' then 'Ghost-IP: aktiv, aber nicht dokumentiert'
      when 'dns_mismatch' then 'DNS stimmt nicht'
      when 'outside_prefix' then 'Adresse ausserhalb aller Subnetze'
      when 'stale' then 'Seit 90 Tagen nicht gesehen'
      else 'IPAM-Fund' end;
    v_payload := jsonb_build_object(
      'findingId', v_finding.id,
      'kind', v_finding.kind,
      'address', host(v_finding.address),
      'number', host(v_finding.address),
      'title', v_label,
      'severity', v_finding.severity,
      'reason', 'opened'
    );
    v_rows := 0;
    if v_finding.team_id is not null then
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      select p_tenant_id, member.user_id, null, 'monitoring.ipam_finding', v_payload
      from public.team_memberships member
      join public.tenant_memberships membership
        on membership.tenant_id = p_tenant_id
       and membership.user_id = member.user_id and membership.status = 'active'
      where member.team_id = v_finding.team_id;
      get diagnostics v_rows = row_count;
    end if;
    if v_rows = 0 then
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      select p_tenant_id, membership.user_id, null, 'monitoring.ipam_finding', v_payload
      from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.status = 'active'
        and public.user_has_tenant_permission(membership.user_id, p_tenant_id, 'ipam.manage');
      get diagnostics v_rows = row_count;
    end if;
    v_count := v_count + v_rows;
  end loop;

  -- Warnungen (Ghost-IPs, DNS …) gebündelt in einer Meldung je Bericht.
  if coalesce(array_length(v_warning_ids, 1), 0) > 0 then
    v_payload := jsonb_build_object(
      'findingIds', to_jsonb(v_warning_ids[1:50]),
      'count', array_length(v_warning_ids, 1),
      'number', 'IP-Adressen',
      'title', case when array_length(v_warning_ids, 1) = 1
        then '1 neuer Fund aus der Netzwerk-Discovery'
        else array_length(v_warning_ids, 1)::text || ' neue Funde aus der Netzwerk-Discovery' end,
      'severity', 'warning',
      'reason', 'opened'
    );
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, membership.user_id, null, 'monitoring.ipam_finding', v_payload
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.status = 'active'
      and public.user_has_tenant_permission(membership.user_id, p_tenant_id, 'ipam.manage');
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end if;
  return v_count;
end;
$$;

-- Ergebnis einer Auswertung schreiben (Beobachtungen, Adressen, Verlauf,
-- Funde) und neue Funde melden. Plan-Format siehe _shared/ipam-discovery.ts.
create or replace function public.ipam_discovery_apply(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_vrf_id uuid := nullif(p_plan->>'vrfId', '')::uuid;
  v_now timestamptz := timezone('utc', now());
  v_new uuid[] := '{}';
  v_opened integer := 0;
  v_resolved integer := 0;
  v_rows integer;
  v_notified integer := 0;
  v_item jsonb;
  v_id uuid;
  v_inserted boolean;
  v_item_vrf uuid;
begin
  if v_vrf_id is not null and not exists (
    select 1 from public.ipam_vrfs where id = v_vrf_id and tenant_id = p_tenant_id
  ) then
    raise exception 'VRF not found' using errcode = 'P0002';
  end if;

  insert into public.ipam_observations as observation (
    tenant_id, vrf_id, address, mac, source, sources, switch_name, switch_port, vlan,
    hostname, vendor, agent_id, run_key, run_macs, first_seen_at, seen_at
  )
  select p_tenant_id, v_vrf_id, item.address::inet, nullif(item.mac, '')::macaddr,
         item.source, coalesce(item.sources, array[item.source]),
         left(item.switch_name, 160), left(item.switch_port, 80), item.vlan,
         left(item.hostname, 253), left(item.vendor, 160), p_agent_id,
         left(p_plan->>'runKey', 80), coalesce(item.run_macs::macaddr[], '{}'), v_now, v_now
  from jsonb_to_recordset(coalesce(p_plan->'observations', '[]'::jsonb)) as item(
    address text, mac text, source text, sources text[], switch_name text, switch_port text,
    vlan integer, hostname text, vendor text, run_macs text[]
  )
  on conflict (tenant_id, (coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid)), address)
  do update set
    mac = coalesce(excluded.mac, observation.mac),
    source = excluded.source,
    sources = excluded.sources,
    switch_name = coalesce(excluded.switch_name, observation.switch_name),
    switch_port = coalesce(excluded.switch_port, observation.switch_port),
    vlan = coalesce(excluded.vlan, observation.vlan),
    hostname = coalesce(excluded.hostname, observation.hostname),
    vendor = coalesce(excluded.vendor, observation.vendor),
    agent_id = excluded.agent_id,
    run_key = excluded.run_key,
    run_macs = excluded.run_macs,
    seen_at = excluded.seen_at;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'addressUpdates', '[]'::jsonb))
  loop
    v_id := (v_item->>'addressId')::uuid;
    update public.ipam_addresses address
       set last_seen_at = v_now,
           last_seen_source = left(coalesce(v_item->>'source', address.last_seen_source), 40),
           mac_address = case when v_item ? 'mac' then nullif(v_item->>'mac', '')::macaddr else address.mac_address end,
           vendor = case when v_item ? 'vendor' then left(v_item->>'vendor', 160) else address.vendor end,
           switch_name = case when v_item ? 'switchName' then left(v_item->>'switchName', 160) else address.switch_name end,
           switch_port = case when v_item ? 'switchPort' then left(v_item->>'switchPort', 80) else address.switch_port end
     where address.id = v_id and address.tenant_id = p_tenant_id;
    if found and jsonb_typeof(v_item->'event') = 'object' then
      insert into public.ipam_address_events (tenant_id, address_id, actor_id, kind, details)
      values (p_tenant_id, v_id, null,
              case when v_item->'event'->>'kind' = 'mac_changed' then 'mac_changed' else 'seen' end,
              coalesce(v_item->'event'->'details', '{}'::jsonb));
    end if;
  end loop;

  -- Funde öffnen oder auffrischen (ignorierte bleiben ignoriert).
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'open', '[]'::jsonb))
  loop
    v_item_vrf := coalesce(nullif(v_item->>'vrfId', '')::uuid, v_vrf_id);
    if exists (
      select 1 from public.ipam_findings ignored
      where ignored.tenant_id = p_tenant_id
        and ignored.vrf_id is not distinct from v_item_vrf
        and ignored.address = (v_item->>'address')::inet
        and ignored.kind = v_item->>'kind'
        and ignored.status = 'ignored'
    ) then
      update public.ipam_findings
         set last_seen_at = v_now
       where tenant_id = p_tenant_id
         and vrf_id is not distinct from v_item_vrf
         and address = (v_item->>'address')::inet
         and kind = v_item->>'kind'
         and status = 'ignored';
      continue;
    end if;
    insert into public.ipam_findings as finding (
      tenant_id, vrf_id, address, address_id, prefix_id, kind, severity, details,
      first_seen_at, last_seen_at
    ) values (
      p_tenant_id, v_item_vrf, (v_item->>'address')::inet,
      nullif(v_item->>'addressId', '')::uuid, nullif(v_item->>'prefixId', '')::uuid,
      v_item->>'kind', coalesce(v_item->>'severity', 'warning'),
      coalesce(v_item->'details', '{}'::jsonb), v_now, v_now
    )
    on conflict (tenant_id, (coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid)), address, kind)
      where status = 'open'
    do update set
      last_seen_at = excluded.last_seen_at,
      severity = excluded.severity,
      details = excluded.details,
      address_id = coalesce(excluded.address_id, finding.address_id),
      prefix_id = coalesce(excluded.prefix_id, finding.prefix_id)
    returning finding.id, (xmax = 0) into v_id, v_inserted;
    if v_inserted then
      v_new := v_new || v_id;
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Funde, die nicht mehr zutreffen, automatisch erledigen.
  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now, resolved_by = null
    from jsonb_to_recordset(coalesce(p_plan->'resolve', '[]'::jsonb)) as item(address text, kinds text[])
   where finding.tenant_id = p_tenant_id
     and finding.vrf_id is not distinct from v_vrf_id
     and finding.status = 'open'
     and finding.address = item.address::inet
     and finding.kind = any(item.kinds);
  get diagnostics v_rows = row_count;
  v_resolved := v_resolved + v_rows;

  -- Vollständige Auswertung einer Art (z. B. DNS): alle anderen offenen
  -- Funde dieser Art erledigen.
  if jsonb_typeof(p_plan->'resolveOtherKinds') = 'array' then
    update public.ipam_findings finding
       set status = 'resolved', resolved_at = v_now, resolved_by = null
     where finding.tenant_id = p_tenant_id
       and finding.status = 'open'
       and finding.kind in (select jsonb_array_elements_text(p_plan->'resolveOtherKinds'))
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_plan->'open', '[]'::jsonb)) open_item
         where (open_item->>'address')::inet = finding.address
           and open_item->>'kind' = finding.kind
           and coalesce(nullif(open_item->>'vrfId', '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(finding.vrf_id, '00000000-0000-0000-0000-000000000000'::uuid)
       );
    get diagnostics v_rows = row_count;
    v_resolved := v_resolved + v_rows;
  end if;

  if coalesce(array_length(v_new, 1), 0) > 0 then
    v_notified := public.ipam_findings_notify(p_tenant_id, v_new);
  end if;

  return jsonb_build_object('opened', v_opened, 'resolved', v_resolved, 'notified', v_notified);
end;
$$;

-- Wartung nach einem Durchlauf: «stale» (aktiv, seit 90 Tagen nicht gesehen)
-- als Vorschlag, Ghost-IPs mit DHCP-Lease erledigen, verschwundene Ghost-IPs
-- und Adressen ausserhalb aller Subnetze nach 14 Tagen erledigen.
create or replace function public.ipam_discovery_housekeeping(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_opened integer;
  v_resolved integer := 0;
  v_rows integer;
begin
  insert into public.ipam_findings (tenant_id, vrf_id, address, address_id, prefix_id, kind, severity, details)
  select address.tenant_id, address.vrf_id, address.address, address.id, address.prefix_id,
         'stale', 'info',
         jsonb_build_object('lastSeenAt', address.last_seen_at, 'hostname', address.hostname,
                            'suggestion', 'deprecated')
  from public.ipam_addresses address
  where address.tenant_id = p_tenant_id
    and address.status = 'active'
    and address.last_seen_at < v_now - interval '90 days'
    and not exists (
      select 1 from public.ipam_findings existing
      where existing.tenant_id = address.tenant_id
        and existing.vrf_id is not distinct from address.vrf_id
        and existing.address = address.address
        and existing.kind = 'stale'
        and existing.status in ('open', 'ignored')
    )
  on conflict do nothing;
  get diagnostics v_opened = row_count;

  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'stale'
     and finding.status = 'open'
     and not exists (
       select 1 from public.ipam_addresses address
       where address.id = finding.address_id
         and address.status = 'active'
         and address.last_seen_at < v_now - interval '90 days'
     );
  get diagnostics v_rows = row_count;
  v_resolved := v_resolved + v_rows;

  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'ghost'
     and finding.status = 'open'
     and finding.vrf_id is null
     and exists (
       select 1 from public.ipam_dhcp_leases lease
       where lease.tenant_id = p_tenant_id
         and lease.address = finding.address
         and (lease.reservation or lease.expires_at is null or lease.expires_at > v_now)
     );
  get diagnostics v_rows = row_count;
  v_resolved := v_resolved + v_rows;

  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind in ('ghost', 'outside_prefix')
     and finding.status = 'open'
     and finding.last_seen_at < v_now - interval '14 days';
  get diagnostics v_rows = row_count;
  v_resolved := v_resolved + v_rows;

  return jsonb_build_object('opened', v_opened, 'resolved', v_resolved);
end;
$$;

-- DNS-Abgleich: je dokumentierter Adresse mit Namen die A-Records, die auf
-- sie zeigen, die PTR-Ziele und die Adressen, auf die ihr Name zeigt.
create or replace function public.ipam_dns_context(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'addressId', address.id,
    'address', host(address.address),
    'vrfId', address.vrf_id,
    'status', address.status,
    'hostname', address.hostname,
    'dnsName', address.dns_name,
    'aNames', coalesce((
      select jsonb_agg(distinct record.name) from public.ipam_dns_records record
      where record.tenant_id = p_tenant_id and record.type in ('A', 'AAAA')
        and record.address = address.address
    ), '[]'::jsonb),
    'ptrTargets', coalesce((
      select jsonb_agg(distinct record.value) from public.ipam_dns_records record
      where record.tenant_id = p_tenant_id and record.type = 'PTR'
        and record.address = address.address
    ), '[]'::jsonb),
    'nameTargets', coalesce((
      select jsonb_agg(distinct host(record.address)) from public.ipam_dns_records record
      where record.tenant_id = p_tenant_id and record.type in ('A', 'AAAA')
        and record.address is not null
        and family(record.address) = family(address.address)
        and (record.name = lower(coalesce(address.dns_name, address.hostname))
             or (strpos(coalesce(address.dns_name, address.hostname), '.') = 0
                 and split_part(record.name, '.', 1) = lower(address.hostname)))
    ), '[]'::jsonb)
  ) order by address.address), '[]'::jsonb)
  from public.ipam_addresses address
  where address.tenant_id = p_tenant_id
    and address.status <> 'deprecated'
    and (address.hostname is not null or address.dns_name is not null
         or exists (select 1 from public.ipam_dns_records record
                    where record.tenant_id = p_tenant_id and record.address = address.address));
$$;

-- Bekannte DNS-Zonen je Server (für Aufträge und die Übersicht).
create or replace function public.ipam_dns_zones(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'server', zone.server, 'zone', zone.zone, 'records', zone.records, 'seenAt', zone.seen_at
  ) order by zone.zone, zone.server), '[]'::jsonb)
  from (
    select record.server, record.zone, count(*) as records, max(record.seen_at) as seen_at
    from public.ipam_dns_records record
    where record.tenant_id = p_tenant_id
    group by record.server, record.zone
  ) zone;
$$;

revoke all on function public.ipam_agent_jobs_check_approval() from public, anon, authenticated;
revoke all on function public.ipam_dhcp_scopes_assign_prefix() from public, anon, authenticated;
revoke all on function public.ipam_agent_touch(uuid, integer) from public, anon, authenticated;
revoke all on function public.ipam_agent_claim_jobs(uuid, integer) from public, anon, authenticated;
revoke all on function public.ipam_discovery_context(uuid, uuid, text[], text[]) from public, anon, authenticated;
revoke all on function public.ipam_findings_notify(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.ipam_discovery_apply(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ipam_discovery_housekeeping(uuid) from public, anon, authenticated;
revoke all on function public.ipam_dns_context(uuid) from public, anon, authenticated;
revoke all on function public.ipam_dns_zones(uuid) from public, anon, authenticated;
grant execute on function public.ipam_agent_touch(uuid, integer) to service_role;
grant execute on function public.ipam_agent_claim_jobs(uuid, integer) to service_role;
grant execute on function public.ipam_discovery_context(uuid, uuid, text[], text[]) to service_role;
grant execute on function public.ipam_findings_notify(uuid, uuid[]) to service_role;
grant execute on function public.ipam_discovery_apply(uuid, uuid, jsonb) to service_role;
grant execute on function public.ipam_discovery_housekeeping(uuid) to service_role;
grant execute on function public.ipam_dns_context(uuid) to service_role;
grant execute on function public.ipam_dns_zones(uuid) to service_role;

commit;
