// Datenbankabfragen für ipam-sync (Ticket, Asset, Assistent). Alle Treffer
// werden nach dem Abteilungsbezug gefiltert (department_id null = alle).

import {
  type DepartmentScope,
  departmentVisible,
} from "../_shared/department-scope.ts";
import { portMatches, searchText } from "./assistant.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export class LookupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const dbFailure = () =>
  new LookupError(
    500,
    "database_error",
    "Die IPAM-Daten konnten nicht gelesen werden.",
  );

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Row => typeof entry === "object" && entry !== null,
      )
    : [];

export type LookupResult = { addresses: Row[]; prefixes: Row[] };

export async function networkLookup(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  terms: {
    ips?: string[];
    macs?: string[];
    hostnames?: string[];
    assetId?: string | null;
  },
): Promise<LookupResult> {
  const { data, error } = await admin.rpc("ipam_network_lookup", {
    p_tenant_id: tenantId,
    p_ips: (terms.ips ?? []).slice(0, 60),
    p_macs: (terms.macs ?? []).slice(0, 40),
    p_hostnames: (terms.hostnames ?? []).slice(0, 40),
    p_asset_id: terms.assetId ?? null,
  });
  if (error || typeof data !== "object" || data === null) throw dbFailure();
  const result = data as Row;
  const visible = (entry: Row) => departmentVisible(scope, entry.department_id);
  const strip = (entry: Row) => {
    const { department_id: _department, ...rest } = entry;
    return rest;
  };
  return {
    addresses: rows(result.addresses).filter(visible).map(strip),
    prefixes: rows(result.prefixes).filter(visible).map(strip),
  };
}

/** Freie Adressen in den Subnetzen eines VLAN (Nummer oder Name, optional Standort). */
export async function freeAddresses(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  filter: { vlan: number | null; vlanName: string | null; site: string | null },
): Promise<Row[]> {
  const sitesResult = await admin
    .from("ipam_sites")
    .select("id, name, code, department_id")
    .eq("tenant_id", tenantId);
  if (sitesResult.error) throw dbFailure();
  const sites = rows(sitesResult.data).filter((site) =>
    departmentVisible(scope, site.department_id),
  );
  const siteNeedle = filter.site
    ? searchText(filter.site).toLocaleLowerCase("de-CH")
    : "";
  const siteNeedleShort = siteNeedle.replace(/^haus\s+/, "");
  const matchingSites = siteNeedle
    ? sites.filter((site) => {
        const name = String(site.name ?? "").toLocaleLowerCase("de-CH");
        const code = String(site.code ?? "").toLocaleLowerCase("de-CH");
        return (
          name.includes(siteNeedle) ||
          code === siteNeedle ||
          code === siteNeedleShort ||
          name === siteNeedleShort ||
          name.endsWith(` ${siteNeedleShort}`)
        );
      })
    : [];
  if (siteNeedle && matchingSites.length === 0) return [];
  const siteIds = new Set(matchingSites.map((site) => String(site.id)));

  let vlanQuery = admin
    .from("ipam_vlans")
    .select("id, vlan_number, name, site_id, department_id")
    .eq("tenant_id", tenantId);
  if (filter.vlan !== null)
    vlanQuery = vlanQuery.eq("vlan_number", filter.vlan);
  if (filter.vlanName)
    vlanQuery = vlanQuery.ilike("name", `%${searchText(filter.vlanName, 30)}%`);
  const vlansResult =
    filter.vlan !== null || filter.vlanName
      ? await vlanQuery.limit(200)
      : { data: [], error: null };
  if (vlansResult.error) throw dbFailure();
  const vlans = rows(vlansResult.data)
    .filter((vlan) => departmentVisible(scope, vlan.department_id))
    .filter(
      (vlan) =>
        !siteNeedle ||
        vlan.site_id === null ||
        siteIds.has(String(vlan.site_id)),
    );
  if ((filter.vlan !== null || filter.vlanName) && vlans.length === 0)
    return [];

  let prefixQuery = admin
    .from("ipam_prefixes")
    .select(
      "id, prefix, description, status, vlan_id, site_id, department_id, gateway",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["active", "reserved"]);
  if (vlans.length)
    prefixQuery = prefixQuery.in(
      "vlan_id",
      vlans.map((vlan) => vlan.id),
    );
  else if (siteIds.size) prefixQuery = prefixQuery.in("site_id", [...siteIds]);
  else return [];
  const prefixesResult = await prefixQuery.order("prefix").limit(50);
  if (prefixesResult.error) throw dbFailure();
  const vlanById = new Map(vlans.map((vlan) => [String(vlan.id), vlan]));
  const siteById = new Map(sites.map((site) => [String(site.id), site]));
  const candidates = rows(prefixesResult.data)
    .filter((prefix) => departmentVisible(scope, prefix.department_id))
    .filter((prefix) => {
      if (!siteNeedle) return true;
      const vlan = vlanById.get(String(prefix.vlan_id));
      const siteId = prefix.site_id ?? vlan?.site_id ?? null;
      return siteId !== null && siteIds.has(String(siteId));
    });

  const free: Row[] = [];
  for (const prefix of candidates.slice(0, 8)) {
    const next = await admin.rpc("ipam_next_free_address", {
      p_tenant_id: tenantId,
      p_prefix_id: prefix.id,
      p_after: null,
    });
    if (next.error || typeof next.data !== "string") continue;
    const vlan = vlanById.get(String(prefix.vlan_id));
    const site = siteById.get(String(prefix.site_id ?? vlan?.site_id ?? ""));
    free.push({
      address: String(next.data).replace(/\/\d+$/, ""),
      prefix_id: prefix.id,
      prefix: prefix.prefix,
      description: prefix.description ?? null,
      gateway:
        typeof prefix.gateway === "string"
          ? prefix.gateway.replace(/\/\d+$/, "")
          : null,
      vlan: vlan
        ? { id: vlan.id, number: vlan.vlan_number, name: vlan.name }
        : null,
      site: site ? { id: site.id, name: site.name } : null,
    });
    if (free.length >= 5) break;
  }
  return free;
}

/** Adressen an einem Switch-Port (Hostname des Switches, Port tolerant). */
export async function switchPortAddresses(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  switchName: string,
  port: string,
): Promise<Row[]> {
  const name = searchText(switchName, 120);
  if (!name) return [];
  const { data, error } = await admin
    .from("ipam_addresses")
    .select("address, switch_name, switch_port")
    .eq("tenant_id", tenantId)
    .or(`switch_name.ilike.${name},switch_name.ilike.${name}.*`)
    .limit(1000);
  if (error) throw dbFailure();
  const matching = rows(data).filter((row) =>
    portMatches(row.switch_port, port),
  );
  if (!matching.length) return [];
  const result = await networkLookup(admin, tenantId, scope, {
    ips: matching.map((row) => String(row.address).replace(/\/\d+$/, "")),
  });
  return result.addresses.filter((entry) =>
    portMatches(entry.switch_port, port),
  );
}

/** Host nach Name (exakt, sonst Teilstring), IP oder MAC. */
export async function hostLookup(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  query: { name?: string; ip?: string; mac?: string },
): Promise<LookupResult> {
  if (query.ip)
    return await networkLookup(admin, tenantId, scope, { ips: [query.ip] });
  if (query.mac)
    return await networkLookup(admin, tenantId, scope, { macs: [query.mac] });
  const name = searchText(query.name ?? "", 120);
  if (!name) return { addresses: [], prefixes: [] };
  const exact = await networkLookup(admin, tenantId, scope, {
    hostnames: [name],
  });
  if (exact.addresses.length) return exact;
  const { data, error } = await admin
    .from("ipam_addresses")
    .select("address")
    .eq("tenant_id", tenantId)
    .or(`hostname.ilike.*${name}*,dns_name.ilike.*${name}*`)
    .limit(10);
  if (error) throw dbFailure();
  const ips = rows(data).map((row) =>
    String(row.address).replace(/\/\d+$/, ""),
  );
  return ips.length
    ? await networkLookup(admin, tenantId, scope, { ips })
    : exact;
}

/** Subnetze über der Warnschwelle (oder der angegebenen Schwelle). */
export async function fullPrefixes(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  threshold: number | null,
): Promise<Row[]> {
  const [usage, prefixes, vlans, sites] = await Promise.all([
    admin.rpc("ipam_prefix_usage", { p_tenant_id: tenantId }),
    admin
      .from("ipam_prefixes")
      .select(
        "id, prefix, description, status, utilization_warning_percent, department_id, vlan_id, site_id",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .limit(5000),
    admin
      .from("ipam_vlans")
      .select("id, vlan_number, name")
      .eq("tenant_id", tenantId)
      .limit(5000),
    admin
      .from("ipam_sites")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .limit(1000),
  ]);
  if (usage.error || prefixes.error || vlans.error || sites.error)
    throw dbFailure();
  const usageById = new Map(
    rows(usage.data).map((row) => [String(row.prefix_id), row]),
  );
  const vlanById = new Map(
    rows(vlans.data).map((row) => [String(row.id), row]),
  );
  const siteById = new Map(
    rows(sites.data).map((row) => [String(row.id), row]),
  );
  const result: Row[] = [];
  for (const prefix of rows(prefixes.data)) {
    if (!departmentVisible(scope, prefix.department_id)) continue;
    const entry = usageById.get(String(prefix.id));
    const capacity = Number(entry?.capacity ?? 0);
    if (!entry || capacity <= 0) continue;
    const used = Number(entry.used ?? 0) + Number(entry.dhcp_size ?? 0);
    const percent = Math.min(100, Math.round((used / capacity) * 1000) / 10);
    const limit = threshold ?? Number(prefix.utilization_warning_percent ?? 85);
    if (percent < limit) continue;
    const vlan = vlanById.get(String(prefix.vlan_id));
    const site = siteById.get(String(prefix.site_id));
    result.push({
      id: prefix.id,
      prefix: prefix.prefix,
      description: prefix.description ?? null,
      used,
      capacity,
      percent,
      warning_percent: prefix.utilization_warning_percent,
      vlan: vlan
        ? { id: vlan.id, number: vlan.vlan_number, name: vlan.name }
        : null,
      site: site ? { id: site.id, name: site.name } : null,
    });
  }
  return result
    .sort((a, b) => Number(b.percent) - Number(a.percent))
    .slice(0, 50);
}
