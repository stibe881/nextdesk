begin;
set local search_path = pg_catalog, public;

-- IPAM: eine einzige Zählung der Auslastung.
--
-- Bisher lieferte ipam_prefix_usage used = alle nicht veralteten Adressen und
-- dhcp_size = Grösse des DHCP-Bereichs; alle Verbraucher rechneten
-- (used + dhcp_size) / capacity. Damit galt der ganze Pool als belegt und
-- erfasste Adressen im Pool wurden doppelt gezählt.
--
-- Neu (wie ipam_prefix_utilization_breakdown aus 0347):
--   belegt  = Adressen ausserhalb des Pools + belegte Adressen im Pool
--             (erfasst oder aktive Lease, jede Adresse einmal)
--   Prozent = belegt / Kapazität
--
-- Die Signatur bleibt gleich, damit alle Verbraucher (0303
-- ipam_network_lookup, 0315 ipam_utilization_findings, Edge Functions
-- ipam-sync, ipam-api, ipam) ohne Umbau richtig rechnen:
--   used      = belegt (occupied_total)
--   dhcp_size = 0 (kompatibel: wer noch used + dhcp_size rechnet, zählt den
--               Pool nicht mehr dazu). Die Poolgrösse für die Anzeige liefert
--               ipam_prefix_utilization_breakdown (pool_size).
create or replace function public.ipam_prefix_usage(p_tenant_id uuid)
returns table (prefix_id uuid, used bigint, dhcp_size numeric, capacity numeric)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select breakdown.prefix_id,
         breakdown.occupied_total,
         0::numeric,
         breakdown.capacity
    from public.ipam_prefix_utilization_breakdown(p_tenant_id, null) breakdown;
$$;

revoke all on function public.ipam_prefix_usage(uuid) from public, anon, authenticated;
grant execute on function public.ipam_prefix_usage(uuid) to service_role;

-- Tage vor 0347 haben keine Aufschlüsselung. used enthält dort alle erfassten
-- Adressen (innerhalb und ausserhalb des Pools, jede einmal) und entspricht
-- der neuen Zählung, solange keine Leases vorliegen. Näherung: belegt = used.
-- Die Aufteilung statisch / Pool lässt sich nicht exakt rekonstruieren und
-- bleibt null (daran erkennt der Verlauf die Näherung).
update public.ipam_utilization_daily
   set occupied_total = used
 where occupied_total is null
   and used is not null;

commit;
