begin;
set local search_path = pg_catalog, public;

-- IP-Adressverwaltung (IPAM): VRFs, Standorte, VLANs, Prefixe (Subnetze)
-- und einzelne Adressen; dazu Funde aus der Discovery, Verlauf und tägliche
-- Auslastungswerte für die Prognose.
--
-- Zugriff ausschliesslich über Edge Functions (service_role). Rechte:
-- ipam.read (lesen) und ipam.manage (ändern). Abteilungsbezug über
-- department_id an Prefix/VLAN/Standort (null = für alle Abteilungen).

insert into public.permissions (code, description, is_sensitive) values
  ('ipam.read', 'IP-Adressverwaltung ansehen', false),
  ('ipam.manage', 'IP-Adressen, Subnetze und VLANs verwalten', false)
on conflict (code) do nothing;

-- Wer Assets verwalten kann, darf auch das IPAM verwalten; wer Tickets
-- bearbeitet (asset.read), darf es lesen.
insert into public.role_permissions (role_id, permission_code)
select role_permission.role_id, 'ipam.manage'
from public.role_permissions role_permission
where role_permission.permission_code = 'asset.manage'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select role_permission.role_id, 'ipam.read'
from public.role_permissions role_permission
where role_permission.permission_code in ('asset.manage', 'asset.read', 'ipam.manage')
on conflict do nothing;

insert into public.feature_catalog (key, name, description, category, default_enabled)
values ('ipam.management', 'IP-Adressverwaltung', 'Subnetze, IP-Adressen, VLANs und Discovery verwalten.', 'assets', false)
on conflict (key) do nothing;

create table if not exists public.ipam_vrfs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  route_distinguisher text check (route_distinguisher is null or char_length(route_distinguisher) <= 40),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table if not exists public.ipam_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  code text check (code is null or char_length(code) <= 40),
  address text check (address is null or char_length(address) <= 300),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  unique (tenant_id, name),
  foreign key (department_id, tenant_id) references public.departments(id, tenant_id) on delete set null (department_id)
);

create table if not exists public.ipam_vlans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid,
  site_id uuid,
  vlan_number integer not null check (vlan_number between 1 and 4094),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  foreign key (site_id, tenant_id) references public.ipam_sites(id, tenant_id) on delete set null (site_id),
  foreign key (department_id, tenant_id) references public.departments(id, tenant_id) on delete set null (department_id)
);
create unique index if not exists ipam_vlans_site_number_unique
  on public.ipam_vlans (tenant_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), vlan_number);

create table if not exists public.ipam_prefixes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid,
  vrf_id uuid,
  site_id uuid,
  vlan_id uuid,
  prefix cidr not null,
  status text not null default 'active'
    check (status in ('container', 'active', 'reserved', 'deprecated')),
  security_zone text check (security_zone is null or char_length(security_zone) <= 60),
  gateway inet,
  gateway_device text check (gateway_device is null or char_length(gateway_device) <= 160),
  dhcp_helper text check (dhcp_helper is null or char_length(dhcp_helper) <= 200),
  dhcp_start inet,
  dhcp_end inet,
  description text check (description is null or char_length(description) <= 1000),
  utilization_warning_percent smallint not null default 85
    check (utilization_warning_percent between 50 and 100),
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  foreign key (vrf_id, tenant_id) references public.ipam_vrfs(id, tenant_id) on delete cascade,
  foreign key (site_id, tenant_id) references public.ipam_sites(id, tenant_id) on delete set null (site_id),
  foreign key (vlan_id, tenant_id) references public.ipam_vlans(id, tenant_id) on delete set null (vlan_id),
  foreign key (department_id, tenant_id) references public.departments(id, tenant_id) on delete set null (department_id),
  constraint ipam_prefixes_gateway_inside check (gateway is null or gateway << prefix or gateway = host(prefix)::inet),
  constraint ipam_prefixes_dhcp_range check (
    (dhcp_start is null and dhcp_end is null)
    or (dhcp_start is not null and dhcp_end is not null and dhcp_start <= dhcp_end
        and dhcp_start << prefix and dhcp_end << prefix)
  )
);
-- Gleicher Prefix nur einmal je VRF (null = globale Routing-Tabelle).
create unique index if not exists ipam_prefixes_unique
  on public.ipam_prefixes (tenant_id, coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid), prefix);
create index if not exists ipam_prefixes_lookup on public.ipam_prefixes using gist (prefix inet_ops);
create index if not exists ipam_prefixes_tenant on public.ipam_prefixes (tenant_id, vrf_id);

create table if not exists public.ipam_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vrf_id uuid,
  prefix_id uuid,
  address inet not null check (masklen(address) = case when family(address) = 4 then 32 else 128 end),
  status text not null default 'active'
    check (status in ('active', 'reserved', 'dhcp', 'deprecated')),
  hostname text check (hostname is null or char_length(hostname) <= 253),
  dns_name text check (dns_name is null or char_length(dns_name) <= 253),
  mac_address macaddr,
  vendor text check (vendor is null or char_length(vendor) <= 160),
  device_type text check (device_type is null or device_type in (
    'server', 'vm', 'switch', 'router', 'firewall', 'access_point', 'printer',
    'voip', 'client', 'storage', 'camera', 'iot', 'gateway', 'other'
  )),
  description text check (description is null or char_length(description) <= 1000),
  switch_name text check (switch_name is null or char_length(switch_name) <= 160),
  switch_port text check (switch_port is null or char_length(switch_port) <= 80),
  owner_user_id uuid references public.user_profiles(id) on delete set null,
  team_id uuid,
  asset_id uuid,
  service_id uuid,
  intune_device_id text check (intune_device_id is null or char_length(intune_device_id) <= 80),
  prtg_device_id text check (prtg_device_id is null or char_length(prtg_device_id) <= 80),
  reserved_until date,
  last_seen_at timestamptz,
  last_seen_source text check (last_seen_source is null or char_length(last_seen_source) <= 40),
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, id),
  foreign key (vrf_id, tenant_id) references public.ipam_vrfs(id, tenant_id) on delete cascade,
  foreign key (prefix_id, tenant_id) references public.ipam_prefixes(id, tenant_id) on delete set null (prefix_id),
  foreign key (asset_id, tenant_id) references public.assets(id, tenant_id) on delete set null (asset_id),
  foreign key (team_id, tenant_id) references public.teams(id, tenant_id) on delete set null (team_id)
);
create unique index if not exists ipam_addresses_unique
  on public.ipam_addresses (tenant_id, coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid), address);
create index if not exists ipam_addresses_prefix on public.ipam_addresses (tenant_id, prefix_id);
create index if not exists ipam_addresses_mac on public.ipam_addresses (tenant_id, mac_address) where mac_address is not null;
create index if not exists ipam_addresses_hostname on public.ipam_addresses (tenant_id, lower(hostname)) where hostname is not null;
create index if not exists ipam_addresses_asset on public.ipam_addresses (tenant_id, asset_id) where asset_id is not null;

create table if not exists public.ipam_address_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  address_id uuid not null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  kind text not null check (kind in (
    'created', 'updated', 'reserved', 'released', 'status', 'seen', 'mac_changed',
    'dns', 'imported', 'linked'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (address_id, tenant_id) references public.ipam_addresses(id, tenant_id) on delete cascade
);
create index if not exists ipam_address_events_address on public.ipam_address_events (address_id, created_at desc);

create table if not exists public.ipam_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vrf_id uuid,
  address inet not null,
  address_id uuid,
  prefix_id uuid,
  kind text not null check (kind in (
    'ghost', 'conflict', 'foreign_mac', 'dns_mismatch', 'stale', 'utilization', 'outside_prefix'
  )),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  ticket_id uuid,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles(id) on delete set null,
  foreign key (address_id, tenant_id) references public.ipam_addresses(id, tenant_id) on delete set null (address_id),
  foreign key (prefix_id, tenant_id) references public.ipam_prefixes(id, tenant_id) on delete set null (prefix_id),
  foreign key (vrf_id, tenant_id) references public.ipam_vrfs(id, tenant_id) on delete cascade
);
-- Ein offener Fund je Art und Adresse.
create unique index if not exists ipam_findings_open_unique
  on public.ipam_findings (tenant_id, coalesce(vrf_id, '00000000-0000-0000-0000-000000000000'::uuid), address, kind)
  where status = 'open';

create table if not exists public.ipam_utilization_daily (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prefix_id uuid not null,
  day date not null,
  used integer not null check (used >= 0),
  dhcp_used integer not null default 0 check (dhcp_used >= 0),
  total numeric not null check (total >= 0),
  primary key (prefix_id, day),
  foreign key (prefix_id, tenant_id) references public.ipam_prefixes(id, tenant_id) on delete cascade
);

alter table public.ipam_vrfs enable row level security;
alter table public.ipam_sites enable row level security;
alter table public.ipam_vlans enable row level security;
alter table public.ipam_prefixes enable row level security;
alter table public.ipam_addresses enable row level security;
alter table public.ipam_address_events enable row level security;
alter table public.ipam_findings enable row level security;
alter table public.ipam_utilization_daily enable row level security;
revoke all on table public.ipam_vrfs, public.ipam_sites, public.ipam_vlans, public.ipam_prefixes,
  public.ipam_addresses, public.ipam_address_events, public.ipam_findings,
  public.ipam_utilization_daily from public, anon, authenticated;
grant select, insert, update on table public.ipam_vrfs, public.ipam_sites, public.ipam_vlans,
  public.ipam_prefixes, public.ipam_addresses, public.ipam_address_events, public.ipam_findings,
  public.ipam_utilization_daily to service_role;

-- Adressen dem spezifischsten Prefix ihres VRF zuordnen.
create or replace function public.ipam_containing_prefix(
  p_tenant_id uuid,
  p_vrf_id uuid,
  p_address inet
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select prefix.id
  from public.ipam_prefixes prefix
  where prefix.tenant_id = p_tenant_id
    and prefix.vrf_id is not distinct from p_vrf_id
    and prefix.prefix >>= p_address
  order by masklen(prefix.prefix) desc
  limit 1;
$$;

create or replace function public.ipam_addresses_assign_prefix()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.address := set_masklen(new.address, case when family(new.address) = 4 then 32 else 128 end);
  if new.prefix_id is null or tg_op = 'INSERT' or new.address is distinct from old.address
     or new.vrf_id is distinct from old.vrf_id then
    new.prefix_id := public.ipam_containing_prefix(new.tenant_id, new.vrf_id, new.address);
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;
create or replace trigger ipam_addresses_assign_prefix
  before insert or update on public.ipam_addresses
  for each row execute function public.ipam_addresses_assign_prefix();

-- Nach dem Anlegen/Ändern eines Prefix die Adressen neu zuordnen.
create or replace function public.ipam_prefixes_reassign_addresses()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.ipam_addresses address
     set prefix_id = public.ipam_containing_prefix(address.tenant_id, address.vrf_id, address.address)
   where address.tenant_id = new.tenant_id
     and address.vrf_id is not distinct from new.vrf_id
     and (address.address << new.prefix or address.prefix_id = new.id);
  return null;
end;
$$;
create or replace trigger ipam_prefixes_reassign_addresses
  after insert or update of prefix, vrf_id on public.ipam_prefixes
  for each row execute function public.ipam_prefixes_reassign_addresses();

-- Anzahl nutzbarer Adressen (IPv4 ohne Netz- und Broadcastadresse ab /30).
create or replace function public.ipam_prefix_capacity(p_prefix cidr)
returns numeric
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when family(p_prefix) = 4 and masklen(p_prefix) <= 30 then power(2::numeric, 32 - masklen(p_prefix)) - 2
    when family(p_prefix) = 4 then power(2::numeric, 32 - masklen(p_prefix))
    else power(2::numeric, 128 - masklen(p_prefix))
  end;
$$;

-- Nächste freie Adresse im Prefix: weder als Adresse erfasst noch im
-- DHCP-Bereich, nicht Netz-/Broadcastadresse, nicht Gateway.
create or replace function public.ipam_next_free_address(
  p_tenant_id uuid,
  p_prefix_id uuid,
  p_after inet default null
)
returns inet
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix public.ipam_prefixes;
  v_candidate inet;
  v_last inet;
  v_steps integer := 0;
begin
  select * into v_prefix from public.ipam_prefixes
   where id = p_prefix_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Prefix not found' using errcode = 'P0002';
  end if;
  if family(v_prefix.prefix) = 4 and masklen(v_prefix.prefix) <= 30 then
    v_candidate := host(v_prefix.prefix)::inet + 1;
    v_last := host(broadcast(v_prefix.prefix))::inet - 1;
  else
    v_candidate := host(v_prefix.prefix)::inet + (case when family(v_prefix.prefix) = 6 then 1 else 0 end);
    v_last := host(broadcast(v_prefix.prefix))::inet;
  end if;
  if p_after is not null and p_after >= v_candidate then
    v_candidate := set_masklen(p_after, masklen(v_candidate)) + 1;
  end if;
  while v_candidate <= v_last and v_steps < 70000 loop
    v_steps := v_steps + 1;
    if (v_prefix.gateway is null or host(v_prefix.gateway) <> host(v_candidate))
       and not (v_prefix.dhcp_start is not null
                and v_candidate >= v_prefix.dhcp_start and v_candidate <= v_prefix.dhcp_end)
       and not exists (
         select 1 from public.ipam_addresses address
         where address.tenant_id = p_tenant_id
           and address.vrf_id is not distinct from v_prefix.vrf_id
           and address.address = v_candidate
       ) then
      return v_candidate;
    end if;
    v_candidate := v_candidate + 1;
  end loop;
  return null;
end;
$$;

-- Nächstes freies Subnetz der gewünschten Grösse innerhalb eines Prefix,
-- das sich mit keinem vorhandenen Prefix desselben VRF überschneidet.
create or replace function public.ipam_next_free_prefix(
  p_tenant_id uuid,
  p_parent_id uuid,
  p_length integer
)
returns cidr
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent public.ipam_prefixes;
  v_bits integer;
  v_candidate cidr;
  v_step numeric;
  v_count numeric;
  v_index numeric := 0;
begin
  select * into v_parent from public.ipam_prefixes
   where id = p_parent_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Prefix not found' using errcode = 'P0002';
  end if;
  v_bits := case when family(v_parent.prefix) = 4 then 32 else 128 end;
  if p_length is null or p_length <= masklen(v_parent.prefix) or p_length > v_bits then
    raise exception 'Invalid prefix length' using errcode = '22023';
  end if;
  v_count := power(2::numeric, p_length - masklen(v_parent.prefix));
  v_step := power(2::numeric, v_bits - p_length);
  if v_step * least(v_count, 65536) > 9000000000000000000 then
    raise exception 'Prefix range too large for automatic search' using errcode = '22023';
  end if;
  while v_index < v_count and v_index < 65536 loop
    v_candidate := set_masklen((host(v_parent.prefix)::inet + (v_index * v_step)::bigint), p_length)::cidr;
    if not exists (
      select 1 from public.ipam_prefixes other
      where other.tenant_id = p_tenant_id
        and other.vrf_id is not distinct from v_parent.vrf_id
        and other.id <> v_parent.id
        and (other.prefix && v_candidate)
    ) then
      return v_candidate;
    end if;
    v_index := v_index + 1;
  end loop;
  return null;
end;
$$;

-- Belegung je Prefix (direkte Adressen + DHCP-Bereich).
create or replace function public.ipam_prefix_usage(p_tenant_id uuid)
returns table (prefix_id uuid, used bigint, dhcp_size numeric, capacity numeric)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    prefix.id,
    (select count(*) from public.ipam_addresses address
      where address.tenant_id = prefix.tenant_id
        and address.vrf_id is not distinct from prefix.vrf_id
        and address.address << prefix.prefix
        and address.status <> 'deprecated'),
    case when prefix.dhcp_start is not null
      then (prefix.dhcp_end - prefix.dhcp_start) + 1
      else 0 end,
    public.ipam_prefix_capacity(prefix.prefix)
  from public.ipam_prefixes prefix
  where prefix.tenant_id = p_tenant_id;
$$;

-- Tägliche Auslastung für die Prognose (Cron).
create or replace function public.ipam_record_utilization()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  insert into public.ipam_utilization_daily (tenant_id, prefix_id, day, used, dhcp_used, total)
  select prefix.tenant_id, prefix.id, (timezone('Europe/Zurich', now()))::date,
         usage.used, usage.dhcp_size::integer, usage.capacity
  from public.ipam_prefixes prefix
  cross join lateral (
    select * from public.ipam_prefix_usage(prefix.tenant_id) u where u.prefix_id = prefix.id
  ) usage
  where prefix.status in ('active', 'reserved')
  on conflict (prefix_id, day) do update
    set used = excluded.used, dhcp_used = excluded.dhcp_used, total = excluded.total;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-ipam-utilization');
  exception when others then
    null;
  end;
  perform cron.schedule('nextdesk-ipam-utilization', '17 1 * * *', 'select public.ipam_record_utilization();');
exception when others then
  null;
end;
$$;

revoke all on function public.ipam_containing_prefix(uuid, uuid, inet) from public, anon, authenticated;
revoke all on function public.ipam_addresses_assign_prefix() from public, anon, authenticated;
revoke all on function public.ipam_prefixes_reassign_addresses() from public, anon, authenticated;
revoke all on function public.ipam_prefix_capacity(cidr) from public, anon, authenticated;
revoke all on function public.ipam_next_free_address(uuid, uuid, inet) from public, anon, authenticated;
revoke all on function public.ipam_next_free_prefix(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.ipam_prefix_usage(uuid) from public, anon, authenticated;
revoke all on function public.ipam_record_utilization() from public, anon, authenticated;
grant execute on function public.ipam_containing_prefix(uuid, uuid, inet) to service_role;
grant execute on function public.ipam_prefix_capacity(cidr) to service_role;
grant execute on function public.ipam_next_free_address(uuid, uuid, inet) to service_role;
grant execute on function public.ipam_next_free_prefix(uuid, uuid, integer) to service_role;
grant execute on function public.ipam_prefix_usage(uuid) to service_role;
grant execute on function public.ipam_record_utilization() to service_role;

commit;
