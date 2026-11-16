begin;
set local search_path = pg_catalog, public;

-- Verlauf & Prognose: Auslastung getrennt nach statischem Teil und
-- DHCP-Pool. Die bisherigen Spalten (used = alle nicht veralteten Adressen im
-- Prefix, dhcp_used = Grösse des DHCP-Bereichs, total = Kapazität) bleiben
-- unverändert befüllt, damit bestehende Auswertungen gleich bleiben.
-- Neue Spalten (null für Tage vor dieser Migration):
--   static_used    nicht veraltete Adressen ausserhalb des DHCP-Pools
--   static_total   Kapazität ohne DHCP-Pool
--   pool_used      belegte Adressen im Pool (dokumentiert oder aktive Lease)
--   pool_size      Grösse des Pools (nur IPv4, sonst 0)
--   occupied_total static_used + pool_used (ohne Doppelzählung)
alter table public.ipam_utilization_daily
  add column if not exists static_used integer check (static_used is null or static_used >= 0),
  add column if not exists static_total numeric check (static_total is null or static_total >= 0),
  add column if not exists pool_used integer check (pool_used is null or pool_used >= 0),
  add column if not exists pool_size bigint check (pool_size is null or pool_size >= 0),
  add column if not exists occupied_total integer check (occupied_total is null or occupied_total >= 0);

-- Aufschlüsselung je Prefix (alle Prefixe des Mandanten oder nur eines).
-- Pool nur für IPv4. Leases zählen nur im globalen VRF (Leases haben kein
-- VRF, gleiche Regel wie in ipam_discovery_apply). Aktive Lease =
-- Reservierung oder nicht abgelaufen.
create or replace function public.ipam_prefix_utilization_breakdown(
  p_tenant_id uuid,
  p_prefix_id uuid default null
)
returns table (
  prefix_id uuid,
  used bigint,
  dhcp_size numeric,
  capacity numeric,
  static_used bigint,
  static_total numeric,
  pool_used bigint,
  pool_size numeric,
  occupied_total bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with base as (
    select
      prefix.id,
      prefix.tenant_id,
      prefix.vrf_id,
      prefix.prefix,
      (family(prefix.prefix) = 4 and prefix.dhcp_start is not null and prefix.dhcp_end is not null) as has_pool,
      host(prefix.dhcp_start)::inet as pool_start,
      host(prefix.dhcp_end)::inet as pool_end,
      (case when prefix.dhcp_start is not null
        then (prefix.dhcp_end - prefix.dhcp_start) + 1
        else 0 end)::numeric as legacy_pool,
      public.ipam_prefix_capacity(prefix.prefix) as capacity
    from public.ipam_prefixes prefix
    where prefix.tenant_id = p_tenant_id
      and (p_prefix_id is null or prefix.id = p_prefix_id)
  )
  select
    base.id,
    counts.all_used,
    base.legacy_pool,
    base.capacity,
    counts.static_used,
    greatest(base.capacity - pool.size, 0),
    pool_counts.occupied,
    pool.size,
    counts.static_used + pool_counts.occupied
  from base
  cross join lateral (
    select (case when base.has_pool then (base.pool_end - base.pool_start) + 1 else 0 end)::numeric as size
  ) pool
  cross join lateral (
    select
      count(*) as all_used,
      count(*) filter (
        where not (base.has_pool
                   and host(address.address)::inet between base.pool_start and base.pool_end)
      ) as static_used
    from public.ipam_addresses address
    where address.tenant_id = base.tenant_id
      and address.vrf_id is not distinct from base.vrf_id
      and address.address << base.prefix
      and address.status <> 'deprecated'
  ) counts
  cross join lateral (
    select count(distinct occupied.address) as occupied
    from (
      select host(address.address)::inet as address
      from public.ipam_addresses address
      where base.has_pool
        and address.tenant_id = base.tenant_id
        and address.vrf_id is not distinct from base.vrf_id
        and address.status <> 'deprecated'
        and address.address << base.prefix
        and host(address.address)::inet between base.pool_start and base.pool_end
      union
      select host(lease.address)::inet
      from public.ipam_dhcp_leases lease
      where base.has_pool
        and base.vrf_id is null
        and lease.tenant_id = base.tenant_id
        and family(lease.address) = 4
        and host(lease.address)::inet between base.pool_start and base.pool_end
        and (lease.reservation or lease.expires_at is null or lease.expires_at > now())
    ) occupied
  ) pool_counts;
$$;

-- Tägliche Auslastung (Cron 01:17): bisherige und neue Spalten.
create or replace function public.ipam_record_utilization()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  insert into public.ipam_utilization_daily (
    tenant_id, prefix_id, day, used, dhcp_used, total,
    static_used, static_total, pool_used, pool_size, occupied_total
  )
  select prefix.tenant_id, prefix.id, (timezone('Europe/Zurich', now()))::date,
         usage.used, usage.dhcp_size::integer, usage.capacity,
         usage.static_used::integer, usage.static_total, usage.pool_used::integer,
         usage.pool_size::bigint, usage.occupied_total::integer
  from public.ipam_prefixes prefix
  cross join lateral public.ipam_prefix_utilization_breakdown(prefix.tenant_id, prefix.id) usage
  where prefix.status in ('active', 'reserved')
  on conflict (prefix_id, day) do update
    set used = excluded.used,
        dhcp_used = excluded.dhcp_used,
        total = excluded.total,
        static_used = excluded.static_used,
        static_total = excluded.static_total,
        pool_used = excluded.pool_used,
        pool_size = excluded.pool_size,
        occupied_total = excluded.occupied_total;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.ipam_prefix_utilization_breakdown(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ipam_record_utilization() from public, anon, authenticated;
grant execute on function public.ipam_prefix_utilization_breakdown(uuid, uuid) to service_role;
grant execute on function public.ipam_record_utilization() to service_role;

-- Heutigen Messpunkt sofort mit Aufschlüsselung schreiben.
select public.ipam_record_utilization();

commit;
