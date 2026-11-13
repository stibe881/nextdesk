import { msg } from "../_shared/formality.ts";
import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  type DepartmentScope,
  departmentVisible,
  loadDepartmentScope,
  scopeDepartmentOptions,
} from "../_shared/department-scope.ts";
import {
  type Cidr,
  cidrCapacity,
  cidrContainsAddress,
  cidrContainsCidr,
  cidrLast,
  cidrRelation,
  cidrSize,
  compareAddressText,
  compareCidrText,
  containingPrefix,
  formatCidr,
  isGridPrefix,
  nestPrefixes,
  normalizeAddress,
  normalizeMac,
  parseAddress,
  parseCidrInput,
  splitCidr,
  utilizationPercent,
} from "../_shared/ipam-cidr.ts";
import {
  type Action,
  type AddressInput,
  changedFields,
  csvDocument,
  forecastUtilization,
  InputError,
  parseAction,
  type PrefixInput,
  READ_ACTIONS,
  type ReserveInput,
  type SiteInput,
  sophosCsv,
  sophosObjects,
  sophosXml,
  textMentionsAddress,
  type UtilizationPoint,
  type VlanInput,
  type VrfInput,
} from "./logic.ts";
import {
  addressSpaceLayout,
  agentState,
  type AgentState,
  betterAgentState,
  type ChangeSource,
  changeLogEntry,
  type ChildInput,
  cleanupPlans,
  compareObservedRows,
  firstUsable,
  forecastSummary,
  lengthText,
  type MatrixPrefix,
  type MatrixSite,
  type MatrixVlan,
  parseRedesignAction,
  planPlacement,
  type RedesignAction,
  redesignIsRead,
  suggestTemplate,
  type Template,
  templateFromRow,
  templateLayout,
  vlanMatrix,
} from "./redesign.ts";

/**
 * IP-Adressverwaltung (IPAM): VRFs, Standorte, VLANs, Subnetze (Prefixe) und
 * Adressen. Lesen braucht ipam.read, Ändern ipam.manage; das Modul
 * ipam.management muss für die Person eingeschaltet sein. Subnetze, VLANs und
 * Standorte mit Abteilung sind nur für diese Abteilungen sichtbar (null = alle);
 * Adressen folgen der Sichtbarkeit ihres Subnetzes. Daten werden nach diesen
 * Prüfungen mit der Service-Rolle gelesen und geschrieben.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const FEATURE = "ipam.management";
const MAX_REQUEST_BYTES = 256 * 1024;
const LIST_PAGE_SIZE = 200;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function dbFailure(): HttpError {
  return new HttpError(500, "database_error", "Die Daten konnten nicht verarbeitet werden.");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Postgres inet/cidr text → canonical text. */
function inetText(value: unknown): string | null {
  return typeof value === "string" ? (normalizeAddress(value) ?? value) : null;
}

function withVrf<Q extends { eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q }>(
  query: Q,
  vrfId: string | null,
): Q {
  return vrfId ? query.eq("vrf_id", vrfId) : query.is("vrf_id", null);
}

type Ctx = {
  request: Request;
  admin: Admin;
  client: Client;
  actorId: string;
  tenantId: string;
  scope: DepartmentScope;
  canManage: boolean;
};

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function permissions(client: Client, tenantId: string) {
  const [manage, read] = await Promise.all([
    client.rpc("has_tenant_permission", { p_tenant_id: tenantId, p_permission_code: "ipam.manage" }),
    client.rpc("has_tenant_permission", { p_tenant_id: tenantId, p_permission_code: "ipam.read" }),
  ]);
  if (manage.error || read.error) {
    throw new HttpError(503, "permission_check_failed", "Die Berechtigung konnte nicht geprüft werden.");
  }
  return { canManage: manage.data === true, canRead: manage.data === true || read.data === true };
}

async function audit(ctx: Ctx, action: string, entityType: string, entityId: string | null, metadata: Row) {
  await ctx.admin.from("audit_logs").insert({
    tenant_id: ctx.tenantId,
    actor_id: ctx.actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity: "info",
    metadata,
  });
}

async function addressEvent(ctx: Ctx, addressId: string, kind: string, details: Row) {
  const { error } = await ctx.admin.from("ipam_address_events").insert({
    tenant_id: ctx.tenantId,
    address_id: addressId,
    actor_id: ctx.actorId,
    kind,
    details,
  });
  if (error) console.error("ipam_event_failed", error.code);
}

/** Change log attribution for every write of this function (trigger 0304). */
function stamp(ctx: Ctx, source: ChangeSource = "user") {
  return { change_actor: ctx.actorId, change_source: source };
}

// ---------------------------------------------------------------------------
// DTOs

function vrfDto(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    routeDistinguisher: str(row.route_distinguisher),
    description: str(row.description),
  };
}

function siteDto(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    code: str(row.code),
    address: str(row.address),
    description: str(row.description),
    departmentId: str(row.department_id),
    assetLocationId: str(row.asset_location_id),
    vlanBase: row.vlan_base === null || row.vlan_base === undefined ? null : num(row.vlan_base),
    supernetPrefixId: str(row.supernet_prefix_id),
    templateId: str(row.template_id),
  };
}

function vlanDto(row: Row) {
  return {
    id: String(row.id),
    vlanNumber: num(row.vlan_number),
    name: String(row.name),
    siteId: str(row.site_id),
    departmentId: str(row.department_id),
    description: str(row.description),
    notes: str(row.notes),
    zone: str(row.zone),
    status: str(row.status) ?? "active",
  };
}

type Usage = { used: number; dhcpSize: number; capacity: string; percent: number };

function prefixDto(row: Row, usage: Usage | null) {
  return {
    id: String(row.id),
    prefix: String(row.prefix),
    vrfId: str(row.vrf_id),
    siteId: str(row.site_id),
    vlanId: str(row.vlan_id),
    status: String(row.status),
    securityZone: str(row.security_zone),
    gateway: inetText(row.gateway),
    gatewayDevice: str(row.gateway_device),
    dhcpHelper: str(row.dhcp_helper),
    dhcpStart: inetText(row.dhcp_start),
    dhcpEnd: inetText(row.dhcp_end),
    description: str(row.description),
    notes: str(row.notes),
    utilizationWarningPercent: num(row.utilization_warning_percent) || 85,
    tags: Array.isArray(row.tags) ? row.tags : [],
    customFields: row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {},
    departmentId: str(row.department_id),
    updatedAt: str(row.updated_at),
    usage,
  };
}

function addressDto(row: Row, names: Map<string, string>, teams: Map<string, string>) {
  const owner = str(row.owner_user_id);
  const team = str(row.team_id);
  return {
    id: String(row.id),
    address: inetText(row.address) ?? String(row.address),
    vrfId: str(row.vrf_id),
    prefixId: str(row.prefix_id),
    status: String(row.status),
    hostname: str(row.hostname),
    dnsName: str(row.dns_name),
    macAddress: str(row.mac_address),
    vendor: str(row.vendor),
    deviceType: str(row.device_type),
    description: str(row.description),
    switchName: str(row.switch_name),
    switchPort: str(row.switch_port),
    ownerUserId: owner,
    ownerName: owner ? (names.get(owner) ?? null) : null,
    teamId: team,
    teamName: team ? (teams.get(team) ?? null) : null,
    assetId: str(row.asset_id),
    serviceId: str(row.service_id),
    intuneDeviceId: str(row.intune_device_id),
    prtgDeviceId: str(row.prtg_device_id),
    reservedUntil: str(row.reserved_until),
    lastSeenAt: str(row.last_seen_at),
    lastSeenSource: str(row.last_seen_source),
    tags: Array.isArray(row.tags) ? row.tags : [],
    customFields: row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {},
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function findingDto(row: Row) {
  return {
    id: String(row.id),
    vrfId: str(row.vrf_id),
    address: inetText(row.address) ?? String(row.address),
    addressId: str(row.address_id),
    prefixId: str(row.prefix_id),
    kind: String(row.kind),
    severity: String(row.severity),
    details: row.details && typeof row.details === "object" ? row.details : {},
    status: String(row.status),
    ticketId: str(row.ticket_id),
    firstSeenAt: str(row.first_seen_at),
    lastSeenAt: str(row.last_seen_at),
    resolvedAt: str(row.resolved_at),
  };
}

const ADDRESS_COLUMNS =
  "id, address, vrf_id, prefix_id, status, hostname, dns_name, mac_address, vendor, device_type, description, switch_name, switch_port, owner_user_id, team_id, asset_id, service_id, intune_device_id, prtg_device_id, reserved_until, last_seen_at, last_seen_source, tags, custom_fields, created_at, updated_at";

async function profileNames(admin: Admin, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data } = await admin.from("user_profiles").select("id, display_name").in("id", unique);
  return new Map(
    ((data ?? []) as Row[]).map((row) => [String(row.id), str(row.display_name) ?? "Unbekannte Person"]),
  );
}

async function teamNames(admin: Admin, tenantId: string, ids: Iterable<string | null>) {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await admin.from("teams").select("id, name").eq("tenant_id", tenantId).in("id", unique);
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]));
}

async function addressDtos(ctx: Ctx, rows: Row[]) {
  const [names, teams] = await Promise.all([
    profileNames(ctx.admin, rows.map((row) => str(row.owner_user_id))),
    teamNames(ctx.admin, ctx.tenantId, rows.map((row) => str(row.team_id))),
  ]);
  return rows.map((row) => addressDto(row, names, teams));
}

// ---------------------------------------------------------------------------
// Loading with department scope

type Space = {
  vrfs: Row[];
  sites: Row[];
  vlans: Row[];
  prefixes: Row[];
  /** All prefixes of the tenant, also those outside the scope (for checks). */
  allPrefixes: Row[];
};

async function loadSpace(ctx: Ctx): Promise<Space> {
  const [vrfs, sites, vlans, prefixes] = await Promise.all([
    ctx.admin.from("ipam_vrfs").select("*").eq("tenant_id", ctx.tenantId).order("name").limit(500),
    ctx.admin.from("ipam_sites").select("*").eq("tenant_id", ctx.tenantId).order("name").limit(2000),
    ctx.admin.from("ipam_vlans").select("*").eq("tenant_id", ctx.tenantId).order("vlan_number").limit(5000),
    ctx.admin.from("ipam_prefixes").select("*").eq("tenant_id", ctx.tenantId).limit(10000),
  ]);
  if (vrfs.error || sites.error || vlans.error || prefixes.error) throw dbFailure();
  const visible = (row: Row) => departmentVisible(ctx.scope, row.department_id);
  const allPrefixes = (prefixes.data ?? []) as Row[];
  return {
    vrfs: (vrfs.data ?? []) as Row[],
    sites: ((sites.data ?? []) as Row[]).filter(visible),
    vlans: ((vlans.data ?? []) as Row[]).filter(visible),
    prefixes: allPrefixes.filter(visible).sort((a, b) => compareCidrText(String(a.prefix), String(b.prefix))),
    allPrefixes,
  };
}

async function loadPrefix(ctx: Ctx, prefixId: string): Promise<Row> {
  const { data, error } = await ctx.admin.from("ipam_prefixes").select("*")
    .eq("tenant_id", ctx.tenantId).eq("id", prefixId).maybeSingle();
  if (error) throw dbFailure();
  if (!data || !departmentVisible(ctx.scope, data.department_id)) {
    throw new HttpError(404, "prefix_not_found", "Das Subnetz ist nicht verfügbar.");
  }
  return data as Row;
}

async function loadAddress(ctx: Ctx, addressId: string): Promise<Row> {
  const { data, error } = await ctx.admin.from("ipam_addresses").select(ADDRESS_COLUMNS)
    .eq("tenant_id", ctx.tenantId).eq("id", addressId).maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "address_not_found", "Die Adresse ist nicht verfügbar.");
  if (data.prefix_id) await loadPrefix(ctx, String(data.prefix_id)).catch(() => {
    throw new HttpError(404, "address_not_found", "Die Adresse ist nicht verfügbar.");
  });
  return data as Row;
}

async function usageMap(ctx: Ctx): Promise<Map<string, Usage>> {
  const { data, error } = await ctx.admin.rpc("ipam_prefix_usage", { p_tenant_id: ctx.tenantId });
  if (error) throw dbFailure();
  const result = new Map<string, Usage>();
  for (const row of (data ?? []) as Row[]) {
    const used = num(row.used);
    const dhcpSize = num(row.dhcp_size);
    const capacityText = String(row.capacity ?? "0").split(".")[0] || "0";
    let capacity = 0n;
    try {
      capacity = BigInt(capacityText);
    } catch {
      capacity = 0n;
    }
    result.set(String(row.prefix_id), {
      used,
      dhcpSize,
      capacity: capacity.toString(),
      percent: Math.min(100, utilizationPercent(BigInt(used + dhcpSize), capacity)),
    });
  }
  return result;
}

/** Ids of the prefix and all prefixes nested in it (same VRF). */
function descendantIds(prefix: Row, all: Row[]): string[] {
  const outer = parseCidrInput(String(prefix.prefix))?.cidr;
  if (!outer) return [String(prefix.id)];
  return all.filter((row) => {
    if (str(row.vrf_id) !== str(prefix.vrf_id)) return false;
    const inner = parseCidrInput(String(row.prefix))?.cidr;
    return inner !== undefined && cidrContainsCidr(outer, inner);
  }).map((row) => String(row.id));
}

async function departmentOptions(ctx: Ctx) {
  return await scopeDepartmentOptions(ctx.admin, ctx.tenantId, ctx.scope);
}

// ---------------------------------------------------------------------------
// Read actions

async function overview(ctx: Ctx) {
  const [space, usage, findings, people, teams, services] = await Promise.all([
    loadSpace(ctx),
    usageMap(ctx),
    ctx.admin.from("ipam_findings").select("id, kind, severity, prefix_id")
      .eq("tenant_id", ctx.tenantId).eq("status", "open").limit(5000),
    ctx.admin.from("tenant_memberships").select("user_id")
      .eq("tenant_id", ctx.tenantId).eq("status", "active").limit(5000),
    ctx.admin.from("teams").select("id, name").eq("tenant_id", ctx.tenantId).eq("active", true).order("name"),
    ctx.admin.from("services").select("id, name").eq("tenant_id", ctx.tenantId).order("name").limit(1000),
  ]);
  if (findings.error || people.error || teams.error || services.error) throw dbFailure();
  const names = await profileNames(ctx.admin, ((people.data ?? []) as Row[]).map((row) => str(row.user_id)));
  const visibleIds = new Set(space.prefixes.map((row) => String(row.id)));
  const openFindings = ((findings.data ?? []) as Row[]).filter(
    (row) => !row.prefix_id || visibleIds.has(String(row.prefix_id)),
  );
  const prefixes = space.prefixes.map((row) => prefixDto(row, usage.get(String(row.id)) ?? null));
  // KPIs: IPv4 leaf prefixes (no visible child) that are not containers.
  const nested = nestPrefixes(prefixes);
  const hasChild = new Set(nested.map((entry) => entry.parentId).filter((id): id is string => !!id));
  let used = 0;
  let capacity = 0n;
  let overWarning = 0;
  for (const prefix of prefixes) {
    if (prefix.status === "deprecated" || prefix.status === "container") continue;
    const cidr = parseCidrInput(prefix.prefix)?.cidr;
    if (prefix.usage && prefix.usage.percent >= prefix.utilizationWarningPercent) overWarning++;
    if (!cidr || cidr.version !== 4 || hasChild.has(prefix.id)) continue;
    used += (prefix.usage?.used ?? 0) + (prefix.usage?.dhcpSize ?? 0);
    capacity += cidrCapacity(cidr);
  }
  return json(ctx.request, {
    data: {
      canManage: ctx.canManage,
      departments: await departmentOptions(ctx),
      vrfs: space.vrfs.map(vrfDto),
      sites: space.sites.map(siteDto),
      vlans: space.vlans.map(vlanDto),
      prefixes: nested.map((entry) => ({ ...entry.item, parentId: entry.parentId, depth: entry.depth })),
      people: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
      teams: ((teams.data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) })),
      services: ((services.data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) })),
      kpis: {
        prefixCount: prefixes.filter((prefix) => prefix.status !== "deprecated").length,
        vrfCount: space.vrfs.length,
        // Addresses inside the visible top-level prefixes (usage counts nested ones).
        addressCount: nested.filter((entry) => entry.parentId === null)
          .reduce((sum, entry) => sum + (entry.item.usage?.used ?? 0), 0),
        usedV4: used,
        capacityV4: capacity.toString(),
        overWarning,
        openFindings: openFindings.length,
        conflicts: openFindings.filter((row) => row.kind === "conflict" || row.kind === "foreign_mac").length,
      },
    },
  });
}

async function prefixForecast(ctx: Ctx, prefixIds: string[], warnings: Map<string, number>) {
  if (!prefixIds.length) return {};
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await ctx.admin.from("ipam_utilization_daily")
    .select("prefix_id, day, used, dhcp_used, total")
    .eq("tenant_id", ctx.tenantId).in("prefix_id", prefixIds.slice(0, 2000)).gte("day", since)
    .order("day").limit(50000);
  if (error) throw dbFailure();
  const series = new Map<string, UtilizationPoint[]>();
  for (const row of (data ?? []) as Row[]) {
    const key = String(row.prefix_id);
    const list = series.get(key) ?? [];
    list.push({ day: String(row.day), used: num(row.used) + num(row.dhcp_used), total: num(row.total) });
    series.set(key, list);
  }
  const result: Record<string, ReturnType<typeof forecastUtilization>> = {};
  for (const id of prefixIds) {
    result[id] = forecastUtilization(series.get(id) ?? [], warnings.get(id) ?? 85);
  }
  return result;
}

async function prefixDetail(ctx: Ctx, action: Extract<Action, { type: "prefixDetail" }>) {
  const prefix = await loadPrefix(ctx, action.prefixId);
  const cidr = parseCidrInput(String(prefix.prefix))?.cidr;
  if (!cidr) throw dbFailure();
  const [space, usage] = await Promise.all([loadSpace(ctx), usageMap(ctx)]);
  const grid = isGridPrefix(cidr);
  const descendants = descendantIds(prefix, space.allPrefixes);
  const children = nestPrefixes(
    space.prefixes.filter((row) => descendants.includes(String(row.id)) && row.id !== prefix.id)
      .map((row) => prefixDto(row, usage.get(String(row.id)) ?? null)),
  ).filter((entry) => entry.depth === 0).map((entry) => entry.item);
  let addressQuery = ctx.admin.from("ipam_addresses").select(ADDRESS_COLUMNS, { count: "exact" })
    .eq("tenant_id", ctx.tenantId);
  addressQuery = grid
    ? addressQuery.in("prefix_id", descendants.slice(0, 500))
    : addressQuery.eq("prefix_id", prefix.id);
  if (action.query) {
    const term = action.query.replace(/[%,()*"\\]/g, " ").trim();
    if (term) {
      addressQuery = addressQuery.or(
        `hostname.ilike.*${term}*,dns_name.ilike.*${term}*,description.ilike.*${term}*,vendor.ilike.*${term}*`,
      );
    }
  }
  addressQuery = addressQuery.order("address");
  addressQuery = grid
    ? addressQuery.limit(2000)
    : addressQuery.range(action.page * LIST_PAGE_SIZE, action.page * LIST_PAGE_SIZE + LIST_PAGE_SIZE - 1);
  const [addresses, findings, nextFree] = await Promise.all([
    addressQuery,
    ctx.admin.from("ipam_findings").select("*").eq("tenant_id", ctx.tenantId).eq("status", "open")
      .in("prefix_id", descendants.slice(0, 500)).limit(2000),
    prefix.status === "container"
      ? Promise.resolve({ data: null, error: null })
      : ctx.admin.rpc("ipam_next_free_address", { p_tenant_id: ctx.tenantId, p_prefix_id: prefix.id }),
  ]);
  if (addresses.error || findings.error) throw dbFailure();
  const forecast = await prefixForecast(
    ctx,
    [String(prefix.id)],
    new Map([[String(prefix.id), num(prefix.utilization_warning_percent) || 85]]),
  );
  const vlan = space.vlans.find((row) => row.id === prefix.vlan_id);
  const site = space.sites.find((row) => row.id === prefix.site_id);
  const vrf = space.vrfs.find((row) => row.id === prefix.vrf_id);
  return json(ctx.request, {
    data: {
      prefix: prefixDto(prefix, usage.get(String(prefix.id)) ?? null),
      vrf: vrf ? vrfDto(vrf) : null,
      vlan: vlan ? vlanDto(vlan) : null,
      site: site ? siteDto(site) : null,
      grid,
      size: (cidrLast(cidr) - cidr.network + 1n).toString(),
      addresses: await addressDtos(ctx, (addresses.data ?? []) as Row[]),
      total: addresses.count ?? 0,
      page: grid ? 0 : action.page,
      pageSize: grid ? null : LIST_PAGE_SIZE,
      children,
      findings: ((findings.data ?? []) as Row[]).map(findingDto),
      nextFree: inetText(nextFree.error ? null : nextFree.data),
      forecast: forecast[String(prefix.id)] ?? null,
    },
  });
}

async function addressDetail(ctx: Ctx, action: Extract<Action, { type: "addressDetail" }>) {
  let row: Row | null = null;
  if (action.addressId) {
    row = await loadAddress(ctx, action.addressId);
  } else if (action.address) {
    const { data, error } = await withVrf(
      ctx.admin.from("ipam_addresses").select(ADDRESS_COLUMNS).eq("tenant_id", ctx.tenantId)
        .eq("address", action.address),
      action.vrfId,
    ).maybeSingle();
    if (error) throw dbFailure();
    if (data) row = await loadAddress(ctx, String(data.id));
  }
  const addressText = row ? (inetText(row.address) ?? "") : (action.address ?? "");
  const vrfId = row ? str(row.vrf_id) : action.vrfId;
  const space = await loadSpace(ctx);
  const prefixRow = row?.prefix_id
    ? space.prefixes.find((prefix) => prefix.id === row!.prefix_id) ?? null
    : containingPrefix(space.prefixes.filter((prefix) => str(prefix.vrf_id) === vrfId), addressText);
  const vlan = prefixRow?.vlan_id ? space.vlans.find((vlanRow) => vlanRow.id === prefixRow.vlan_id) : null;
  const site = prefixRow?.site_id ? space.sites.find((siteRow) => siteRow.id === prefixRow.site_id) : null;
  const assetId = row ? str(row.asset_id) : null;
  const serviceId = row ? str(row.service_id) : null;
  const ip = addressText.replace(/"/g, "");
  const [events, devices, asset, service, findings] = await Promise.all([
    row
      ? ctx.admin.from("ipam_address_events").select("id, kind, details, actor_id, created_at")
        .eq("tenant_id", ctx.tenantId).eq("address_id", row.id)
        .order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    ctx.admin.from("asset_infrastructure").select("asset_id, category, hostname, ip_address, mac_address")
      .eq("tenant_id", ctx.tenantId)
      .or(assetId ? `ip_inet.eq."${ip}",asset_id.eq.${assetId}` : `ip_inet.eq."${ip}"`)
      .limit(10),
    assetId
      ? ctx.admin.from("assets").select("id, name, asset_tag").eq("tenant_id", ctx.tenantId).eq("id", assetId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    serviceId
      ? ctx.admin.from("services").select("id, name").eq("tenant_id", ctx.tenantId).eq("id", serviceId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    withVrf(
      ctx.admin.from("ipam_findings").select("*").eq("tenant_id", ctx.tenantId).eq("address", ip),
      vrfId,
    ).order("last_seen_at", { ascending: false }).limit(20),
  ]);
  if (events.error || devices.error || findings.error) throw dbFailure();
  const deviceRows = (devices.data ?? []) as Row[];
  const deviceAssets = deviceRows.length
    ? await ctx.admin.from("assets").select("id, name").eq("tenant_id", ctx.tenantId)
      .in("id", deviceRows.map((device) => String(device.asset_id)))
    : { data: [], error: null };
  const deviceNames = new Map(((deviceAssets.data ?? []) as Row[]).map((a) => [String(a.id), String(a.name)]));
  // Tickets are read with the person's own client so ticket visibility (RLS) applies.
  const tickets = await linkedTickets(ctx, ip, row ? str(row.hostname) : null, assetId, findings.data as Row[]);
  const actorNames = await profileNames(ctx.admin, ((events.data ?? []) as Row[]).map((e) => str(e.actor_id)));
  return json(ctx.request, {
    data: {
      address: row ? (await addressDtos(ctx, [row]))[0] : null,
      ip: addressText,
      vrfId,
      canManage: ctx.canManage,
      prefix: prefixRow ? prefixDto(prefixRow, null) : null,
      vlan: vlan ? vlanDto(vlan) : null,
      site: site ? siteDto(site) : null,
      asset: asset.data ? { id: String(asset.data.id), name: String(asset.data.name), assetTag: str(asset.data.asset_tag) } : null,
      service: service.data ? { id: String(service.data.id), name: String(service.data.name) } : null,
      devices: deviceRows.map((device) => ({
        id: String(device.asset_id),
        name: deviceNames.get(String(device.asset_id)) ?? "Gerät",
        category: str(device.category),
        hostname: str(device.hostname),
        ipAddress: str(device.ip_address),
        macAddress: str(device.mac_address),
      })),
      tickets,
      findings: ((findings.data ?? []) as Row[]).map(findingDto),
      events: ((events.data ?? []) as Row[]).map((event) => ({
        id: String(event.id),
        kind: String(event.kind),
        details: event.details ?? {},
        actorName: event.actor_id ? (actorNames.get(String(event.actor_id)) ?? null) : null,
        at: String(event.created_at),
      })),
    },
  });
}

async function linkedTickets(
  ctx: Ctx,
  ip: string,
  hostname: string | null,
  assetId: string | null,
  findings: Row[] | null,
) {
  const result = new Map<string, { id: string; ticketNumber: string; subject: string; updatedAt: string | null; reason: string }>();
  const add = (row: Row, reason: string) => {
    const id = String(row.id);
    if (!result.has(id)) {
      result.set(id, {
        id,
        ticketNumber: String(row.ticket_number ?? ""),
        subject: String(row.subject ?? ""),
        updatedAt: str(row.updated_at),
        reason,
      });
    }
  };
  try {
    // One query over the trigram indexes (0315), with the caller's rights.
    const safeIp = ip.replace(/[^0-9a-fA-F.:]/g, "");
    const host = hostname?.replace(/[^A-Za-z0-9._-]/g, "") ?? "";
    if (safeIp || host.length >= 3) {
      const { data } = await ctx.client.rpc("ipam_ticket_mentions", {
        p_tenant_id: ctx.tenantId,
        p_ip: safeIp || null,
        p_hostname: host.length >= 3 ? host : null,
        p_limit: 40,
      });
      for (const row of (data ?? []) as Row[]) {
        const text = `${row.subject ?? ""}\n${row.description ?? ""}`;
        if (safeIp && textMentionsAddress(text, safeIp)) add(row, "ip");
        else if (row.matched === "hostname") add(row, "hostname");
      }
    }
    const ids = new Set<string>();
    for (const finding of findings ?? []) if (finding.ticket_id) ids.add(String(finding.ticket_id));
    if (assetId) {
      const { data } = await ctx.client.from("ticket_assets").select("ticket_id")
        .eq("tenant_id", ctx.tenantId).eq("asset_id", assetId).limit(20);
      for (const row of (data ?? []) as Row[]) ids.add(String(row.ticket_id));
    }
    const missing = [...ids].filter((id) => !result.has(id));
    if (missing.length) {
      const { data } = await ctx.client.from("tickets").select("id, ticket_number, subject, updated_at")
        .eq("tenant_id", ctx.tenantId).in("id", missing);
      for (const row of (data ?? []) as Row[]) add(row, "linked");
    }
  } catch (error) {
    console.error("ipam_ticket_lookup_failed", error);
  }
  return [...result.values()].slice(0, 30);
}

async function search(ctx: Ctx, query: string) {
  const space = await loadSpace(ctx);
  const visible = new Set(space.prefixes.map((row) => String(row.id)));
  const term = query.replace(/[%,()*"\\]/g, " ").trim();
  const address = normalizeAddress(term);
  const filters = [`hostname.ilike.*${term}*`, `dns_name.ilike.*${term}*`, `description.ilike.*${term}*`];
  if (address) filters.push(`address.eq."${address}"`);
  const mac = term.replace(/[^0-9a-fA-F]/g, "");
  if (mac.length === 12) filters.push(`mac_address.eq."${mac.match(/../g)!.join(":").toLowerCase()}"`);
  const { data, error } = await ctx.admin.from("ipam_addresses").select(ADDRESS_COLUMNS)
    .eq("tenant_id", ctx.tenantId).or(filters.join(",")).limit(100);
  if (error) throw dbFailure();
  const rows = ((data ?? []) as Row[]).filter((row) => !row.prefix_id || visible.has(String(row.prefix_id)));
  const parsedTerm = parseCidrInput(term)?.cidr ?? null;
  const prefixes = space.prefixes.filter((row) => {
    const text = `${row.prefix} ${row.description ?? ""} ${row.security_zone ?? ""}`.toLowerCase();
    if (text.includes(term.toLowerCase())) return true;
    const cidr = parseCidrInput(String(row.prefix))?.cidr;
    return Boolean(parsedTerm && cidr && cidrRelation(cidr, parsedTerm) !== "disjoint");
  }).slice(0, 50);
  return json(ctx.request, {
    data: {
      addresses: (await addressDtos(ctx, rows)).sort((a, b) => compareAddressText(a.address, b.address)),
      prefixes: prefixes.map((row) => prefixDto(row, null)),
    },
  });
}

async function findings(ctx: Ctx, status: "open" | "resolved" | "ignored" | "all") {
  let query = ctx.admin.from("ipam_findings").select("*").eq("tenant_id", ctx.tenantId);
  if (status !== "all") query = query.eq("status", status);
  const [{ data, error }, space] = await Promise.all([
    query.order("last_seen_at", { ascending: false }).limit(1000),
    loadSpace(ctx),
  ]);
  if (error) throw dbFailure();
  const visible = new Set(space.prefixes.map((row) => String(row.id)));
  const rows = ((data ?? []) as Row[]).filter((row) => !row.prefix_id || visible.has(String(row.prefix_id)));
  const ticketIds = rows.map((row) => str(row.ticket_id)).filter((id): id is string => !!id);
  const tickets = ticketIds.length
    ? await ctx.admin.from("tickets").select("id, ticket_number").eq("tenant_id", ctx.tenantId).in("id", ticketIds)
    : { data: [] };
  const numbers = new Map(((tickets.data ?? []) as Row[]).map((row) => [String(row.id), String(row.ticket_number)]));
  return json(ctx.request, {
    data: {
      canManage: ctx.canManage,
      findings: rows.map((row) => ({
        ...findingDto(row),
        ticketNumber: row.ticket_id ? (numbers.get(String(row.ticket_id)) ?? null) : null,
        prefix: row.prefix_id ? (space.prefixes.find((prefix) => prefix.id === row.prefix_id)?.prefix ?? null) : null,
      })),
    },
  });
}

async function forecast(ctx: Ctx, prefixId: string | null) {
  const space = await loadSpace(ctx);
  const rows = prefixId
    ? space.prefixes.filter((row) => row.id === prefixId)
    : space.prefixes.filter((row) => row.status === "active" || row.status === "reserved");
  if (prefixId && !rows.length) throw new HttpError(404, "prefix_not_found", "Das Subnetz ist nicht verfügbar.");
  const result = await prefixForecast(
    ctx,
    rows.map((row) => String(row.id)),
    new Map(rows.map((row) => [String(row.id), num(row.utilization_warning_percent) || 85])),
  );
  return json(ctx.request, {
    data: {
      forecasts: rows.map((row) => ({ prefixId: String(row.id), prefix: String(row.prefix), ...result[String(row.id)] })),
    },
  });
}

async function networkMapOverlay(ctx: Ctx) {
  const space = await loadSpace(ctx);
  const vlans = new Map(space.vlans.map((row) => [String(row.id), row]));
  const sites = new Map(space.sites.map((row) => [String(row.id), row]));
  return json(ctx.request, {
    data: {
      prefixes: space.prefixes.filter((row) => row.status !== "deprecated").map((row) => {
        const vlan = row.vlan_id ? vlans.get(String(row.vlan_id)) : undefined;
        const site = row.site_id ? sites.get(String(row.site_id)) : undefined;
        return {
          id: String(row.id),
          prefix: String(row.prefix),
          vrfId: str(row.vrf_id),
          description: str(row.description),
          securityZone: str(row.security_zone),
          vlanId: vlan ? String(vlan.id) : null,
          vlanNumber: vlan ? num(vlan.vlan_number) : null,
          vlanName: vlan ? String(vlan.name) : null,
          siteName: site ? String(site.name) : null,
        };
      }),
      vlans: space.vlans.map(vlanDto),
    },
  });
}

/** Assets for the link picker of an address (name and tag only). */
async function lookups(ctx: Ctx) {
  const { data, error } = await ctx.admin.from("assets").select("id, name, asset_tag")
    .eq("tenant_id", ctx.tenantId).order("name").limit(3000);
  if (error) throw dbFailure();
  return json(ctx.request, {
    data: {
      assets: ((data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        assetTag: str(row.asset_tag),
      })),
    },
  });
}

async function exportData(ctx: Ctx, action: Extract<Action, { type: "export" }>) {
  const space = await loadSpace(ctx);
  const visible = new Set(space.prefixes.map((row) => String(row.id)));
  const vrfNames = new Map(space.vrfs.map((row) => [String(row.id), String(row.name)]));
  const vlanById = new Map(space.vlans.map((row) => [String(row.id), row]));
  const siteNames = new Map(space.sites.map((row) => [String(row.id), String(row.name)]));
  const prefixText = new Map(space.prefixes.map((row) => [String(row.id), String(row.prefix)]));
  const wantAddresses = action.scope === "all" || action.scope === "addresses";
  const addressRows: Row[] = [];
  if (wantAddresses) {
    for (let page = 0; page < 20; page++) {
      const { data, error } = await ctx.admin.from("ipam_addresses").select(ADDRESS_COLUMNS)
        .eq("tenant_id", ctx.tenantId).order("address").range(page * 5000, page * 5000 + 4999);
      if (error) throw dbFailure();
      const rows = (data ?? []) as Row[];
      addressRows.push(...rows.filter((row) => !row.prefix_id || visible.has(String(row.prefix_id))));
      if (rows.length < 5000) break;
    }
  }
  const addresses = wantAddresses ? await addressDtos(ctx, addressRows) : [];
  const prefixes = space.prefixes.map((row) => prefixDto(row, null));
  const vlans = space.vlans.map(vlanDto);
  const stamp = new Date().toISOString().slice(0, 10);
  await audit(ctx, "ipam.exported", "ipam", null, { format: action.format, scope: action.scope, addresses: addresses.length });
  if (action.format === "json") {
    const body: Row = { exportedAt: new Date().toISOString(), vrfs: space.vrfs.map(vrfDto) };
    if (action.scope === "all" || action.scope === "prefixes") body.prefixes = prefixes;
    if (action.scope === "all" || action.scope === "vlans") {
      body.vlans = vlans;
      body.sites = space.sites.map(siteDto);
    }
    if (wantAddresses) body.addresses = addresses;
    return json(ctx.request, {
      data: {
        filename: `ipam-${action.scope}-${stamp}.json`,
        mimeType: "application/json",
        content: JSON.stringify(body, null, 2),
      },
    });
  }
  const parts: string[] = [];
  if (action.scope === "all" || action.scope === "prefixes") {
    parts.push(csvDocument(
      ["Subnetz", "VRF", "Status", "Beschreibung", "VLAN", "Standort", "Sicherheitszone", "Gateway", "DHCP von", "DHCP bis", "Warnschwelle %", "Schlagwörter"],
      prefixes.map((prefix) => {
        const vlan = prefix.vlanId ? vlanById.get(prefix.vlanId) : undefined;
        return [
          prefix.prefix,
          prefix.vrfId ? vrfNames.get(prefix.vrfId) ?? "" : "Global",
          prefix.status,
          prefix.description,
          vlan ? `${vlan.vlan_number} ${vlan.name}` : "",
          prefix.siteId ? siteNames.get(prefix.siteId) ?? "" : "",
          prefix.securityZone,
          prefix.gateway,
          prefix.dhcpStart,
          prefix.dhcpEnd,
          prefix.utilizationWarningPercent,
          prefix.tags,
        ];
      }),
    ));
  }
  if (wantAddresses) {
    parts.push(csvDocument(
      ["Adresse", "VRF", "Subnetz", "Status", "Hostname", "DNS-Name", "MAC", "Hersteller", "Gerätetyp", "Switch", "Port", "Verantwortlich", "Team", "Reserviert bis", "Zuletzt gesehen", "Beschreibung"],
      addresses.map((address) => [
        address.address,
        address.vrfId ? vrfNames.get(address.vrfId) ?? "" : "Global",
        address.prefixId ? prefixText.get(address.prefixId) ?? "" : "",
        address.status,
        address.hostname,
        address.dnsName,
        address.macAddress,
        address.vendor,
        address.deviceType,
        address.switchName,
        address.switchPort,
        address.ownerName,
        address.teamName,
        address.reservedUntil,
        address.lastSeenAt,
        address.description,
      ]),
    ));
  }
  if (action.scope === "all" || action.scope === "vlans") {
    parts.push(csvDocument(
      ["VLAN-ID", "Name", "Standort", "Beschreibung"],
      vlans.map((vlan) => [vlan.vlanNumber, vlan.name, vlan.siteId ? siteNames.get(vlan.siteId) ?? "" : "", vlan.description]),
    ));
  }
  // Several tables in one CSV file are separated by an empty line.
  const content = parts.map((part, index) => (index === 0 ? part : part.replace(/^\uFEFF/, ""))).join("\r\n");
  return json(ctx.request, {
    data: { filename: `ipam-${action.scope}-${stamp}.csv`, mimeType: "text/csv;charset=utf-8", content },
  });
}

async function exportSophos(ctx: Ctx, action: Extract<Action, { type: "exportSophos" }>) {
  const space = await loadSpace(ctx);
  const vlanById = new Map(space.vlans.map((row) => [String(row.id), row]));
  const selected = space.prefixes.filter((row) =>
    row.status !== "deprecated" && (!action.prefixIds || action.prefixIds.includes(String(row.id)))
  );
  const selectedIds = selected.map((row) => String(row.id));
  const hosts: Row[] = [];
  if (action.includeHosts && selectedIds.length) {
    for (let index = 0; index < selectedIds.length; index += 200) {
      const { data, error } = await ctx.admin.from("ipam_addresses")
        .select("address, prefix_id, hostname, description, status")
        .eq("tenant_id", ctx.tenantId).in("prefix_id", selectedIds.slice(index, index + 200))
        .in("status", ["active", "reserved"]).order("address").limit(20000);
      if (error) throw dbFailure();
      hosts.push(...((data ?? []) as Row[]));
    }
  }
  const objects = sophosObjects(
    selected.map((row) => {
      const vlan = row.vlan_id ? vlanById.get(String(row.vlan_id)) : undefined;
      return {
        id: String(row.id),
        prefix: String(row.prefix),
        description: str(row.description),
        vlanNumber: vlan ? num(vlan.vlan_number) : null,
      };
    }),
    hosts.sort((a, b) => compareAddressText(String(a.address), String(b.address))).map((row) => ({
      prefixId: str(row.prefix_id),
      address: inetText(row.address) ?? String(row.address),
      hostname: str(row.hostname),
      description: str(row.description),
    })),
    { includeHosts: action.includeHosts, includeGroups: action.includeGroups },
  );
  const stamp = new Date().toISOString().slice(0, 10);
  await audit(ctx, "ipam.exported", "ipam", null, { format: `sophos-${action.format}`, objects: objects.length });
  return json(ctx.request, {
    data: action.format === "xml"
      ? { filename: `sophos-ip-hosts-${stamp}.xml`, mimeType: "application/xml", content: sophosXml(objects), count: objects.length }
      : { filename: `sophos-ip-hosts-${stamp}.csv`, mimeType: "text/csv;charset=utf-8", content: sophosCsv(objects), count: objects.length },
  });
}

// ---------------------------------------------------------------------------
// Write actions

/** null = all departments; otherwise one of the person's departments. */
function departmentFor(ctx: Ctx, requested: string | null): string | null {
  if (requested === null) return null;
  if (!ctx.scope.departments.includes(requested)) {
    throw new HttpError(422, "department_invalid", "Die Abteilung ist ungültig.");
  }
  return requested;
}

async function ensureRow(ctx: Ctx, table: string, id: string | null, message: string, scoped = false) {
  if (!id) return null;
  const { data, error } = await ctx.admin.from(table).select(scoped ? "id, department_id" : "id")
    .eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  if (error) throw dbFailure();
  if (!data || (scoped && !departmentVisible(ctx.scope, data.department_id))) {
    throw new HttpError(422, "reference_invalid", message);
  }
  return data as Row;
}

function conflict(error: { code?: string } | null, message: string): HttpError {
  if (error?.code === "23505") return new HttpError(409, "duplicate", message);
  if (error?.code === "23514" || error?.code === "23503") {
    return new HttpError(422, "constraint_failed", msg("Die Angaben passen nicht zusammen. Bitte prüfe die Eingaben.", "Die Angaben passen nicht zusammen. Bitte prüfen Sie die Eingaben."));
  }
  return dbFailure();
}

async function saveVrf(ctx: Ctx, vrf: VrfInput) {
  const values = {
    name: vrf.name,
    route_distinguisher: vrf.routeDistinguisher,
    description: vrf.description,
    updated_at: new Date().toISOString(),
  };
  const result = vrf.id
    ? await ctx.admin.from("ipam_vrfs").update(values).eq("tenant_id", ctx.tenantId).eq("id", vrf.id)
      .select("id").maybeSingle()
    : await ctx.admin.from("ipam_vrfs").insert({ ...values, tenant_id: ctx.tenantId }).select("id").single();
  if (result.error) throw conflict(result.error, "Ein VRF mit diesem Namen gibt es bereits.");
  if (!result.data) throw new HttpError(404, "vrf_not_found", "Das VRF ist nicht verfügbar.");
  await audit(ctx, vrf.id ? "ipam.vrf.updated" : "ipam.vrf.created", "ipam_vrf", String(result.data.id), { name: vrf.name });
  return json(ctx.request, { data: { id: String(result.data.id) } }, vrf.id ? 200 : 201);
}

async function existingScoped(ctx: Ctx, table: string, id: string, message: string): Promise<Row> {
  const { data, error } = await ctx.admin.from(table).select("*").eq("tenant_id", ctx.tenantId).eq("id", id)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data || !departmentVisible(ctx.scope, data.department_id)) throw new HttpError(404, "not_found", message);
  return data as Row;
}

async function saveSite(ctx: Ctx, site: SiteInput) {
  if (site.id) await existingScoped(ctx, "ipam_sites", site.id, "Der Standort ist nicht verfügbar.");
  await Promise.all([
    ensureRow(ctx, "asset_locations", site.assetLocationId ?? null, "Der Asset-Standort ist nicht verfügbar."),
    ensureRow(ctx, "ipam_prefixes", site.supernetPrefixId ?? null, "Das Supernetz ist nicht verfügbar.", true),
    ensureRow(ctx, "ipam_site_templates", site.templateId ?? null, "Die Vorlage ist nicht verfügbar."),
  ]);
  if (site.assetLocationId) await ensureAssetLocationFree(ctx, site.assetLocationId, site.id);
  const values: Row = {
    name: site.name,
    code: site.code,
    address: site.address,
    description: site.description,
    department_id: departmentFor(ctx, site.departmentId),
    updated_at: new Date().toISOString(),
    ...stamp(ctx),
  };
  if (site.assetLocationId !== undefined) values.asset_location_id = site.assetLocationId;
  if (site.vlanBase !== undefined) values.vlan_base = site.vlanBase;
  if (site.supernetPrefixId !== undefined) values.supernet_prefix_id = site.supernetPrefixId;
  if (site.templateId !== undefined) values.template_id = site.templateId;
  const result = site.id
    ? await ctx.admin.from("ipam_sites").update(values).eq("tenant_id", ctx.tenantId).eq("id", site.id)
      .select("id").single()
    : await ctx.admin.from("ipam_sites").insert({ ...values, tenant_id: ctx.tenantId }).select("id").single();
  if (result.error) throw conflict(result.error, "Einen Standort mit diesem Namen gibt es bereits.");
  await audit(ctx, site.id ? "ipam.site.updated" : "ipam.site.created", "ipam_site", String(result.data.id), { name: site.name });
  return json(ctx.request, { data: { id: String(result.data.id) } }, site.id ? 200 : 201);
}

async function saveVlan(ctx: Ctx, vlan: VlanInput) {
  if (vlan.id) await existingScoped(ctx, "ipam_vlans", vlan.id, "Das VLAN ist nicht verfügbar.");
  await ensureRow(ctx, "ipam_sites", vlan.siteId, "Der Standort ist nicht verfügbar.", true);
  const values = {
    vlan_number: vlan.vlanNumber,
    name: vlan.name,
    site_id: vlan.siteId,
    description: vlan.description,
    department_id: departmentFor(ctx, vlan.departmentId),
    updated_at: new Date().toISOString(),
    ...stamp(ctx),
  } as Row;
  if (vlan.notes !== undefined) values.notes = vlan.notes;
  if (vlan.zone !== undefined) values.zone = vlan.zone;
  if (vlan.status !== undefined) values.status = vlan.status;
  const result = vlan.id
    ? await ctx.admin.from("ipam_vlans").update(values).eq("tenant_id", ctx.tenantId).eq("id", vlan.id)
      .select("id").single()
    : await ctx.admin.from("ipam_vlans").insert({ ...values, tenant_id: ctx.tenantId }).select("id").single();
  if (result.error) {
    throw conflict(result.error, `VLAN ${vlan.vlanNumber} gibt es an diesem Standort bereits.`);
  }
  await audit(ctx, vlan.id ? "ipam.vlan.updated" : "ipam.vlan.created", "ipam_vlan", String(result.data.id), {
    vlanNumber: vlan.vlanNumber,
  });
  return json(ctx.request, { data: { id: String(result.data.id) } }, vlan.id ? 200 : 201);
}

/** Same VRF: identical prefixes are rejected, nesting is allowed. */
async function checkPrefixOverlap(ctx: Ctx, cidr: Cidr, vrfId: string | null, ownId: string | null) {
  const { data, error } = await withVrf(
    ctx.admin.from("ipam_prefixes").select("id, prefix, status").eq("tenant_id", ctx.tenantId),
    vrfId,
  ).limit(10000);
  if (error) throw dbFailure();
  for (const row of (data ?? []) as Row[]) {
    if (row.id === ownId) continue;
    const other = parseCidrInput(String(row.prefix))?.cidr;
    if (!other) continue;
    const relation = cidrRelation(cidr, other);
    if (relation === "equal") {
      throw new HttpError(
        409,
        "prefix_exists",
        row.status === "deprecated"
          ? msg(
              `${formatCidr(cidr)} ist bereits als veraltetes Subnetz erfasst. Bitte reaktiviere es.`,
              `${formatCidr(cidr)} ist bereits als veraltetes Subnetz erfasst. Bitte reaktivieren Sie es.`,
            )
          : `${formatCidr(cidr)} ist in diesem VRF bereits erfasst.`,
      );
    }
  }
}

async function savePrefix(ctx: Ctx, input: PrefixInput) {
  const before = input.id
    ? await existingScoped(ctx, "ipam_prefixes", input.id, "Das Subnetz ist nicht verfügbar.")
    : null;
  await Promise.all([
    ensureRow(ctx, "ipam_vrfs", input.vrfId, "Das VRF ist nicht verfügbar."),
    ensureRow(ctx, "ipam_sites", input.siteId, "Der Standort ist nicht verfügbar.", true),
    ensureRow(ctx, "ipam_vlans", input.vlanId, "Das VLAN ist nicht verfügbar.", true),
  ]);
  const cidr = parseCidrInput(input.prefix)!.cidr;
  await checkPrefixOverlap(ctx, cidr, input.vrfId, input.id);
  const values = {
    prefix: input.prefix,
    vrf_id: input.vrfId,
    site_id: input.siteId,
    vlan_id: input.vlanId,
    status: input.status,
    security_zone: input.securityZone,
    gateway: input.gateway,
    gateway_device: input.gatewayDevice,
    dhcp_helper: input.dhcpHelper,
    dhcp_start: input.dhcpStart,
    dhcp_end: input.dhcpEnd,
    description: input.description,
    utilization_warning_percent: input.utilizationWarningPercent,
    tags: input.tags,
    custom_fields: input.customFields,
    department_id: departmentFor(ctx, input.departmentId),
    updated_at: new Date().toISOString(),
  } as Row;
  if (input.notes !== undefined) values.notes = input.notes;
  const result = input.id
    ? await ctx.admin.from("ipam_prefixes").update({ ...values, ...stamp(ctx) }).eq("tenant_id", ctx.tenantId).eq("id", input.id)
      .select("id").single()
    : await ctx.admin.from("ipam_prefixes").insert({
      ...values,
      ...stamp(ctx),
      tenant_id: ctx.tenantId,
      created_by: ctx.actorId,
    }).select("id").single();
  if (result.error) throw conflict(result.error, `${input.prefix} ist in diesem VRF bereits erfasst.`);
  await audit(ctx, input.id ? "ipam.prefix.updated" : "ipam.prefix.created", "ipam_prefix", String(result.data.id), {
    prefix: input.prefix,
    status: input.status,
    ...(before ? { changes: changedFields(before, values) } : {}),
  });
  return json(ctx.request, { data: { id: String(result.data.id), prefix: input.prefix } }, input.id ? 200 : 201);
}

/** Visible containing prefix of an address, or null; rejects network/broadcast. */
async function checkAddressPlacement(ctx: Ctx, address: string, vrfId: string | null) {
  const { data, error } = await withVrf(
    ctx.admin.from("ipam_prefixes").select("id, prefix, department_id, gateway").eq("tenant_id", ctx.tenantId),
    vrfId,
  ).limit(10000);
  if (error) throw dbFailure();
  const prefix = containingPrefix((data ?? []) as Row[], address);
  if (!prefix) return null;
  if (!departmentVisible(ctx.scope, prefix.department_id)) {
    throw new HttpError(403, "prefix_forbidden", "Das Subnetz dieser Adresse gehört einer anderen Abteilung.");
  }
  const cidr = parseCidrInput(String(prefix.prefix))!.cidr;
  const parsed = parseAddress(address)!;
  if (cidr.version === 4 && cidr.length <= 30 && (parsed.value === cidr.network || parsed.value === cidrLast(cidr))) {
    throw new HttpError(422, "address_reserved_by_network", "Netz- und Broadcastadresse können nicht vergeben werden.");
  }
  return prefix;
}

async function validateAddressReferences(ctx: Ctx, input: {
  vrfId: string | null;
  ownerUserId: string | null;
  teamId: string | null;
  assetId?: string | null;
  serviceId?: string | null;
}) {
  const checks: Promise<unknown>[] = [
    ensureRow(ctx, "ipam_vrfs", input.vrfId, "Das VRF ist nicht verfügbar."),
    ensureRow(ctx, "teams", input.teamId, "Das Team ist nicht verfügbar."),
    ensureRow(ctx, "assets", input.assetId ?? null, "Das Asset ist nicht verfügbar."),
    ensureRow(ctx, "services", input.serviceId ?? null, "Der Dienst ist nicht verfügbar."),
  ];
  if (input.ownerUserId) {
    checks.push((async () => {
      const { data, error } = await ctx.admin.from("tenant_memberships").select("user_id")
        .eq("tenant_id", ctx.tenantId).eq("user_id", input.ownerUserId).eq("status", "active").maybeSingle();
      if (error) throw dbFailure();
      if (!data) throw new HttpError(422, "owner_invalid", "Die verantwortliche Person ist nicht verfügbar.");
    })());
  }
  await Promise.all(checks);
}

function addressValues(input: AddressInput) {
  return {
    address: input.address,
    vrf_id: input.vrfId,
    status: input.status,
    hostname: input.hostname,
    dns_name: input.dnsName,
    mac_address: input.macAddress,
    vendor: input.vendor,
    device_type: input.deviceType,
    description: input.description,
    switch_name: input.switchName,
    switch_port: input.switchPort,
    owner_user_id: input.ownerUserId,
    team_id: input.teamId,
    asset_id: input.assetId,
    service_id: input.serviceId,
    reserved_until: input.reservedUntil,
    tags: input.tags,
    custom_fields: input.customFields,
  };
}

async function saveAddress(ctx: Ctx, input: AddressInput) {
  const before = input.id ? await loadAddress(ctx, input.id) : null;
  await validateAddressReferences(ctx, input);
  await checkAddressPlacement(ctx, input.address, input.vrfId);
  const values = addressValues(input);
  const result = input.id
    ? await ctx.admin.from("ipam_addresses").update({ ...values, ...stamp(ctx) }).eq("tenant_id", ctx.tenantId).eq("id", input.id)
      .select("id, prefix_id").single()
    : await ctx.admin.from("ipam_addresses").insert({
      ...values,
      ...stamp(ctx),
      tenant_id: ctx.tenantId,
      created_by: ctx.actorId,
    }).select("id, prefix_id").single();
  if (result.error) throw conflict(result.error, `${input.address} ist in diesem VRF bereits erfasst.`);
  const id = String(result.data.id);
  if (before) {
    const beforeValues: Row = {
      ...before,
      address: inetText(before.address),
    };
    const changes = changedFields(beforeValues, values);
    if (Object.keys(changes).length) {
      const kind = changes.status
        ? "status"
        : changes.mac_address
        ? "mac_changed"
        : changes.dns_name
        ? "dns"
        : changes.asset_id || changes.service_id
        ? "linked"
        : "updated";
      await addressEvent(ctx, id, kind, { changes });
    }
  } else {
    await addressEvent(ctx, id, "created", { status: input.status, hostname: input.hostname });
  }
  await audit(ctx, input.id ? "ipam.address.updated" : "ipam.address.created", "ipam_address", id, {
    address: input.address,
    status: input.status,
  });
  return json(ctx.request, { data: { id, prefixId: str(result.data.prefix_id) } }, input.id ? 200 : 201);
}

async function reserveAddress(ctx: Ctx, input: ReserveInput) {
  let vrfId = input.vrfId;
  if (input.prefixId) {
    const prefix = await loadPrefix(ctx, input.prefixId);
    vrfId = str(prefix.vrf_id);
    const cidr = parseCidrInput(String(prefix.prefix))!.cidr;
    if (!cidrContainsAddress(cidr, parseAddress(input.address)!)) {
      throw new HttpError(422, "address_outside", `${input.address} liegt nicht im Subnetz ${prefix.prefix}.`);
    }
    if (prefix.gateway && inetText(prefix.gateway) === input.address) {
      throw new HttpError(422, "address_is_gateway", "Diese Adresse ist das Gateway des Subnetzes.");
    }
  }
  await validateAddressReferences(ctx, { vrfId, ownerUserId: input.ownerUserId, teamId: input.teamId });
  await checkAddressPlacement(ctx, input.address, vrfId);
  const { data: existing, error } = await withVrf(
    ctx.admin.from("ipam_addresses").select("id, status").eq("tenant_id", ctx.tenantId).eq("address", input.address),
    vrfId,
  ).maybeSingle();
  if (error) throw dbFailure();
  if (existing && existing.status !== "deprecated") {
    throw new HttpError(409, "address_taken", msg(`${input.address} ist bereits vergeben. Bitte hole einen neuen Vorschlag.`, `${input.address} ist bereits vergeben. Bitte holen Sie einen neuen Vorschlag.`));
  }
  const values = {
    status: "reserved",
    hostname: input.hostname,
    description: input.description,
    owner_user_id: input.ownerUserId,
    team_id: input.teamId,
    reserved_until: input.reservedUntil,
    device_type: input.deviceType,
    ...stamp(ctx),
  };
  const result = existing
    ? await ctx.admin.from("ipam_addresses").update(values).eq("tenant_id", ctx.tenantId).eq("id", existing.id)
      .select("id, prefix_id").single()
    : await ctx.admin.from("ipam_addresses").insert({
      ...values,
      tenant_id: ctx.tenantId,
      vrf_id: vrfId,
      address: input.address,
      created_by: ctx.actorId,
    }).select("id, prefix_id").single();
  if (result.error) {
    throw conflict(result.error, msg(`${input.address} wurde soeben vergeben. Bitte hole einen neuen Vorschlag.`, `${input.address} wurde soeben vergeben. Bitte holen Sie einen neuen Vorschlag.`));
  }
  const id = String(result.data.id);
  await addressEvent(ctx, id, "reserved", {
    hostname: input.hostname,
    description: input.description,
    reservedUntil: input.reservedUntil,
  });
  await audit(ctx, "ipam.address.reserved", "ipam_address", id, { address: input.address });
  return json(ctx.request, { data: { id, address: input.address, prefixId: str(result.data.prefix_id) } }, 201);
}

async function releaseAddress(ctx: Ctx, addressId: string, note: string | null) {
  const before = await loadAddress(ctx, addressId);
  const { error } = await ctx.admin.from("ipam_addresses").update({
    status: "deprecated",
    reserved_until: null,
    owner_user_id: null,
    team_id: null,
    ...stamp(ctx),
  }).eq("tenant_id", ctx.tenantId).eq("id", addressId);
  if (error) throw dbFailure();
  await addressEvent(ctx, addressId, "released", {
    previousStatus: before.status,
    hostname: before.hostname ?? null,
    note,
  });
  await audit(ctx, "ipam.address.released", "ipam_address", addressId, { address: inetText(before.address) });
  return json(ctx.request, { data: { id: addressId } });
}

async function remove(ctx: Ctx, action: Extract<Action, { type: "delete" }>) {
  const message = "Der Eintrag ist nicht verfügbar.";
  if (action.entity === "address") return await releaseAddress(ctx, action.id, null);
  if (action.entity === "prefix") {
    await existingScoped(ctx, "ipam_prefixes", action.id, "Das Subnetz ist nicht verfügbar.");
    const { error } = await ctx.admin.from("ipam_prefixes")
      .update({ status: "deprecated", updated_at: new Date().toISOString(), ...stamp(ctx) })
      .eq("tenant_id", ctx.tenantId).eq("id", action.id);
    if (error) throw dbFailure();
    await audit(ctx, "ipam.prefix.archived", "ipam_prefix", action.id, {});
    return json(ctx.request, { data: { id: action.id, archived: true } });
  }
  const table = action.entity === "vrf" ? "ipam_vrfs" : action.entity === "site" ? "ipam_sites" : "ipam_vlans";
  if (action.entity === "vrf") {
    await ensureRow(ctx, table, action.id, message);
  } else {
    await existingScoped(ctx, table, action.id, message);
  }
  // VRFs and VLANs/sites in use stay; a VRF delete would cascade to its prefixes.
  const column = action.entity === "vrf" ? "vrf_id" : action.entity === "site" ? "site_id" : "vlan_id";
  const usage = await ctx.admin.from("ipam_prefixes").select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId).eq(column, action.id);
  const vlanUsage = action.entity === "site"
    ? await ctx.admin.from("ipam_vlans").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId).eq("site_id", action.id)
    : { count: 0, error: null };
  const addressUsage = action.entity === "vrf"
    ? await ctx.admin.from("ipam_addresses").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId).eq("vrf_id", action.id)
    : { count: 0, error: null };
  if (usage.error || vlanUsage.error || addressUsage.error) throw dbFailure();
  if ((usage.count ?? 0) + (vlanUsage.count ?? 0) + (addressUsage.count ?? 0) > 0) {
    throw new HttpError(
      409,
      "in_use",
      "Der Eintrag wird noch von Subnetzen, VLANs oder Adressen verwendet und kann nicht entfernt werden.",
    );
  }
  const { error } = action.entity === "vrf"
    ? await ctx.admin.from(table).delete().eq("tenant_id", ctx.tenantId).eq("id", action.id)
    : await ctx.admin.rpc("ipam_delete_logged", {
      p_tenant_id: ctx.tenantId,
      p_object_type: action.entity,
      p_object_id: action.id,
      p_actor_id: ctx.actorId,
      p_source: "user",
    });
  if (error) throw dbFailure();
  await audit(ctx, `ipam.${action.entity}.deleted`, `ipam_${action.entity}`, action.id, {});
  return json(ctx.request, { data: { id: action.id, deleted: true } });
}

async function nextFreeAddress(ctx: Ctx, prefixId: string, after: string | null) {
  const prefix = await loadPrefix(ctx, prefixId);
  const { data, error } = await ctx.admin.rpc("ipam_next_free_address", {
    p_tenant_id: ctx.tenantId,
    p_prefix_id: prefixId,
    p_after: after,
  });
  if (error) throw dbFailure();
  return json(ctx.request, {
    data: { address: inetText(data), prefixId, prefix: String(prefix.prefix), vrfId: str(prefix.vrf_id) },
  });
}

async function nextFreePrefix(ctx: Ctx, parentId: string, length: number) {
  const parent = await loadPrefix(ctx, parentId);
  const cidr = parseCidrInput(String(parent.prefix))!.cidr;
  if (length <= cidr.length || length > (cidr.version === 4 ? 32 : 128)) {
    throw new HttpError(422, "length_invalid", `Die Grösse muss kleiner als /${cidr.length} sein.`);
  }
  const { data, error } = await ctx.admin.rpc("ipam_next_free_prefix", {
    p_tenant_id: ctx.tenantId,
    p_parent_id: parentId,
    p_length: length,
  });
  if (error) {
    if (error.code === "22023") {
      throw new HttpError(422, "length_invalid", "Für diese Grösse ist keine automatische Suche möglich.");
    }
    throw dbFailure();
  }
  return json(ctx.request, { data: { prefix: typeof data === "string" ? data : null, parentId } });
}

async function createPrefix(ctx: Ctx, action: Extract<Action, { type: "createPrefix" }>) {
  const parent = await loadPrefix(ctx, action.parentId);
  await ensureRow(ctx, "ipam_vlans", action.vlanId, "Das VLAN ist nicht verfügbar.", true);
  const { data, error } = await ctx.admin.rpc("ipam_next_free_prefix", {
    p_tenant_id: ctx.tenantId,
    p_parent_id: action.parentId,
    p_length: action.length,
  });
  if (error) {
    if (error.code === "22023") throw new HttpError(422, "length_invalid", "Die Grösse ist ungültig.");
    throw dbFailure();
  }
  if (typeof data !== "string") {
    throw new HttpError(409, "prefix_full", `Im Subnetz ${parent.prefix} ist kein /${action.length} mehr frei.`);
  }
  const result = await ctx.admin.from("ipam_prefixes").insert({
    tenant_id: ctx.tenantId,
    prefix: data,
    vrf_id: parent.vrf_id ?? null,
    site_id: parent.site_id ?? null,
    vlan_id: action.vlanId,
    department_id: parent.department_id ?? null,
    status: action.status,
    description: action.description,
    security_zone: parent.security_zone ?? null,
    utilization_warning_percent: parent.utilization_warning_percent ?? 85,
    created_by: ctx.actorId,
    ...stamp(ctx),
  }).select("id, prefix").single();
  if (result.error) throw conflict(result.error, msg(`${data} wurde soeben angelegt. Bitte versuche es erneut.`, `${data} wurde soeben angelegt. Bitte versuchen Sie es erneut.`));
  await audit(ctx, "ipam.prefix.created", "ipam_prefix", String(result.data.id), { prefix: data, parentId: action.parentId });
  return json(ctx.request, { data: { id: String(result.data.id), prefix: String(result.data.prefix) } }, 201);
}

async function splitPrefix(ctx: Ctx, prefixId: string, length: number) {
  const prefix = await loadPrefix(ctx, prefixId);
  const cidr = parseCidrInput(String(prefix.prefix))!.cidr;
  const children = splitCidr(cidr, length, 256);
  if (!children) {
    throw new HttpError(422, "split_invalid", `Aufteilen in /${length} ist nicht möglich (höchstens 256 Teilnetze).`);
  }
  const { data, error } = await withVrf(
    ctx.admin.from("ipam_prefixes").select("prefix").eq("tenant_id", ctx.tenantId),
    str(prefix.vrf_id),
  ).limit(10000);
  if (error) throw dbFailure();
  const existing = ((data ?? []) as Row[]).map((row) => parseCidrInput(String(row.prefix))?.cidr)
    .filter((value): value is Cidr => !!value);
  // Children that collide with an existing smaller/equal prefix are skipped.
  const fresh = children.filter((child) =>
    !existing.some((other) => {
      const relation = cidrRelation(child, other);
      return relation === "equal" || relation === "contains";
    })
  );
  if (fresh.length) {
    const insert = await ctx.admin.from("ipam_prefixes").insert(fresh.map((child) => ({
      tenant_id: ctx.tenantId,
      prefix: formatCidr(child),
      vrf_id: prefix.vrf_id ?? null,
      site_id: prefix.site_id ?? null,
      department_id: prefix.department_id ?? null,
      status: "active",
      security_zone: prefix.security_zone ?? null,
      utilization_warning_percent: prefix.utilization_warning_percent ?? 85,
      created_by: ctx.actorId,
      ...stamp(ctx),
    })));
    if (insert.error) throw conflict(insert.error, "Ein Teilnetz ist bereits erfasst.");
  }
  if (prefix.status === "active") {
    await ctx.admin.from("ipam_prefixes")
      .update({ status: "container", updated_at: new Date().toISOString(), ...stamp(ctx) })
      .eq("tenant_id", ctx.tenantId).eq("id", prefixId);
  }
  await audit(ctx, "ipam.prefix.split", "ipam_prefix", prefixId, { length, created: fresh.length });
  return json(ctx.request, {
    data: { created: fresh.map(formatCidr), skipped: children.length - fresh.length },
  }, 201);
}

async function loadFinding(ctx: Ctx, findingId: string): Promise<Row> {
  const { data, error } = await ctx.admin.from("ipam_findings").select("*")
    .eq("tenant_id", ctx.tenantId).eq("id", findingId).maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "finding_not_found", "Der Fund ist nicht verfügbar.");
  if (data.prefix_id) {
    await loadPrefix(ctx, String(data.prefix_id)).catch(() => {
      throw new HttpError(404, "finding_not_found", "Der Fund ist nicht verfügbar.");
    });
  }
  return data as Row;
}

async function resolveFinding(ctx: Ctx, findingId: string, status: "resolved" | "ignored" | "open") {
  await loadFinding(ctx, findingId);
  const { error } = await ctx.admin.from("ipam_findings").update({
    status,
    resolved_at: status === "open" ? null : new Date().toISOString(),
    resolved_by: status === "open" ? null : ctx.actorId,
  }).eq("tenant_id", ctx.tenantId).eq("id", findingId);
  if (error) {
    throw conflict(error, "Für diese Adresse gibt es bereits einen offenen Fund derselben Art.");
  }
  await audit(ctx, `ipam.finding.${status}`, "ipam_finding", findingId, {});
  return json(ctx.request, { data: { id: findingId, status } });
}

/** Ghost IP → documented address with the data the discovery found. */
async function adoptFinding(ctx: Ctx, findingId: string) {
  const finding = await loadFinding(ctx, findingId);
  const details = (finding.details && typeof finding.details === "object" ? finding.details : {}) as Row;
  const address = inetText(finding.address)!;
  const vrfId = str(finding.vrf_id);
  await checkAddressPlacement(ctx, address, vrfId);
  const { data: existing, error } = await withVrf(
    ctx.admin.from("ipam_addresses").select("id, status").eq("tenant_id", ctx.tenantId).eq("address", address),
    vrfId,
  ).maybeSingle();
  if (error) throw dbFailure();
  const mac = typeof details.mac === "string"
    ? details.mac
    : typeof details.macAddress === "string"
    ? details.macAddress
    : null;
  const values: Row = {
    status: "active",
    hostname: str(details.hostname) ?? str(details.dnsName),
    dns_name: str(details.dnsName),
    vendor: str(details.vendor),
    switch_name: str(details.switchName),
    switch_port: str(details.switchPort),
    last_seen_at: str(finding.last_seen_at),
    last_seen_source: str(details.source) ?? "discovery",
    ...stamp(ctx),
  };
  if (mac) values.mac_address = normalizeMac(mac);
  for (const key of Object.keys(values)) if (values[key] === null) delete values[key];
  const result = existing
    ? await ctx.admin.from("ipam_addresses").update(values).eq("tenant_id", ctx.tenantId).eq("id", existing.id)
      .select("id").single()
    : await ctx.admin.from("ipam_addresses").insert({
      ...values,
      tenant_id: ctx.tenantId,
      vrf_id: vrfId,
      address,
      created_by: ctx.actorId,
    }).select("id").single();
  if (result.error) throw conflict(result.error, "Die Adresse ist bereits erfasst.");
  const id = String(result.data.id);
  await addressEvent(ctx, id, existing ? "updated" : "created", { fromFinding: findingId, kind: finding.kind });
  await ctx.admin.from("ipam_findings").update({
    status: "resolved",
    address_id: id,
    resolved_at: new Date().toISOString(),
    resolved_by: ctx.actorId,
  }).eq("tenant_id", ctx.tenantId).eq("id", findingId);
  await audit(ctx, "ipam.finding.adopted", "ipam_finding", findingId, { address, addressId: id });
  return json(ctx.request, { data: { id, address } }, existing ? 200 : 201);
}

const FINDING_LABELS: Record<string, string> = {
  ghost: "Ghost-IP: aktiv, aber nicht dokumentiert",
  conflict: "Adresskonflikt",
  foreign_mac: "Fremde MAC auf reservierter IP",
  dns_mismatch: "DNS stimmt nicht",
  stale: "Lange nicht gesehen",
  utilization: "Subnetz oder DHCP-Bereich fast voll",
  outside_prefix: "Adresse ausserhalb der Subnetze",
  coverage: "Wichtiges Gerät ohne PRTG-Überwachung",
};

type TicketDraft = {
  departmentId: string | null;
  severity: string;
  subject: string;
  description: string;
  assetId: string | null;
  payload: Row;
};

/** Creates a ticket in the name of the acting person (requester). */
async function createIpamTicket(ctx: Ctx, draft: TicketDraft): Promise<{ id: string; number: string }> {
  let department: Row | null = null;
  for (const id of [draft.departmentId, ...ctx.scope.departments]) {
    if (!id) continue;
    const { data } = await ctx.admin.from("departments").select("id, key").eq("tenant_id", ctx.tenantId)
      .eq("id", id).eq("active", true).maybeSingle();
    if (data) {
      department = data;
      break;
    }
  }
  if (!department) {
    const { data } = await ctx.admin.from("departments").select("id, key").eq("tenant_id", ctx.tenantId)
      .eq("active", true).order("key").limit(1).maybeSingle();
    department = data;
  }
  const [status, priorities] = await Promise.all([
    ctx.admin.from("ticket_statuses").select("id").eq("tenant_id", ctx.tenantId).eq("key", "new").maybeSingle(),
    ctx.admin.from("ticket_priorities").select("id, key").eq("tenant_id", ctx.tenantId),
  ]);
  const preferred = draft.severity === "critical"
    ? ["urgent", "high", "normal"]
    : draft.severity === "warning"
    ? ["high", "normal"]
    : ["normal", "low"];
  const priorityRows = (priorities.data ?? []) as Row[];
  const priority = preferred.map((key) => priorityRows.find((row) => row.key === key)).find(Boolean) ??
    priorityRows[0];
  if (!department || !status.data || !priority) {
    throw new HttpError(422, "ticket_defaults_unavailable", "Für Tickets fehlen Abteilung, Status oder Priorität.");
  }
  const number = await ctx.admin.rpc("reserve_ticket_number", {
    p_tenant_id: ctx.tenantId,
    p_department_id: department.id,
    p_prefix: String(department.key).slice(0, 8),
  });
  if (number.error || typeof number.data !== "string") throw dbFailure();
  await ctx.admin.from("user_profiles").upsert({ id: ctx.actorId });
  const ticket = await ctx.admin.from("tickets").insert({
    tenant_id: ctx.tenantId,
    department_id: department.id,
    ticket_number: number.data,
    subject: draft.subject.slice(0, 240),
    description: draft.description.slice(0, 50_000),
    status_id: status.data.id,
    priority_id: priority.id,
    requester_id: ctx.actorId,
  }).select("id, ticket_number").single().setHeader("x-nextdesk-actor-id", ctx.actorId);
  if (ticket.error || !ticket.data) {
    throw new HttpError(422, "ticket_create_failed", "Das Ticket konnte nicht erstellt werden.");
  }
  const ticketId = String(ticket.data.id);
  await ctx.admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: ctx.actorId,
    event_type: "ticket.created",
    payload: { source: "ipam", ...draft.payload },
  });
  if (draft.assetId) {
    await ctx.admin.from("ticket_assets").insert({
      tenant_id: ctx.tenantId,
      ticket_id: ticketId,
      asset_id: draft.assetId,
      linked_by: ctx.actorId,
    });
  }
  return { id: ticketId, number: String(ticket.data.ticket_number) };
}

async function prefixInfo(ctx: Ctx, prefixId: unknown): Promise<Row | null> {
  if (!prefixId) return null;
  const { data } = await ctx.admin.from("ipam_prefixes").select("prefix, department_id, description")
    .eq("tenant_id", ctx.tenantId).eq("id", prefixId).maybeSingle();
  return (data as Row | null) ?? null;
}

async function findingTicket(ctx: Ctx, findingId: string) {
  const finding = await loadFinding(ctx, findingId);
  if (finding.ticket_id) {
    const { data } = await ctx.admin.from("tickets").select("id, ticket_number").eq("tenant_id", ctx.tenantId)
      .eq("id", finding.ticket_id).maybeSingle();
    if (data) {
      return json(ctx.request, {
        data: { ticketId: String(data.id), ticketNumber: String(data.ticket_number), existing: true },
      });
    }
  }
  const prefix = await prefixInfo(ctx, finding.prefix_id);
  const address = inetText(finding.address) ?? String(finding.address);
  const label = FINDING_LABELS[String(finding.kind)] ?? "IPAM-Fund";
  const details = (finding.details && typeof finding.details === "object" ? finding.details : {}) as Row;
  const detailLines = Object.entries(details)
    .filter(([, value]) => value !== null && value !== "" && typeof value !== "object")
    .slice(0, 20)
    .map(([key, value]) => `- ${key}: ${String(value).slice(0, 200)}`);
  const linked = finding.address_id
    ? (await ctx.admin.from("ipam_addresses").select("asset_id").eq("tenant_id", ctx.tenantId)
      .eq("id", finding.address_id).maybeSingle()).data as Row | null
    : null;
  const ticket = await createIpamTicket(ctx, {
    departmentId: str(prefix?.department_id),
    severity: String(finding.severity),
    subject: `${label}: ${address}`,
    description: [
      `${label} für ${address}.`,
      prefix ? `Subnetz: ${prefix.prefix}${prefix.description ? ` (${prefix.description})` : ""}` : null,
      `Zuerst gesehen: ${finding.first_seen_at}, zuletzt: ${finding.last_seen_at}`,
      detailLines.length ? `\nDetails:\n${detailLines.join("\n")}` : null,
      "\nErstellt aus der IP-Adressverwaltung (Funde).",
    ].filter(Boolean).join("\n"),
    assetId: str(linked?.asset_id),
    payload: { findingId, kind: finding.kind },
  });
  await ctx.admin.from("ipam_findings").update({ ticket_id: ticket.id }).eq("tenant_id", ctx.tenantId)
    .eq("id", findingId);
  await audit(ctx, "ipam.finding.ticket_created", "ticket", ticket.id, {
    findingId,
    ticketNumber: ticket.number,
    address,
  });
  return json(ctx.request, { data: { ticketId: ticket.id, ticketNumber: ticket.number, existing: false } }, 201);
}

async function addressTicket(ctx: Ctx, action: Extract<Action, { type: "addressTicket" }>) {
  const row = await loadAddress(ctx, action.addressId);
  const prefix = await prefixInfo(ctx, row.prefix_id);
  const address = inetText(row.address) ?? String(row.address);
  const name = str(row.hostname);
  const ticket = await createIpamTicket(ctx, {
    departmentId: str(prefix?.department_id),
    severity: "info",
    subject: action.subject ?? `IP-Adresse ${address}${name ? ` (${name})` : ""}`,
    description: [
      action.description,
      `IP-Adresse: ${address}${name ? `, Hostname: ${name}` : ""}`,
      prefix ? `Subnetz: ${prefix.prefix}${prefix.description ? ` (${prefix.description})` : ""}` : null,
      row.mac_address ? `MAC: ${row.mac_address}` : null,
      row.switch_name ? `Switch-Port: ${row.switch_name}${row.switch_port ? ` · ${row.switch_port}` : ""}` : null,
      "\nErstellt aus der IP-Adressverwaltung.",
    ].filter(Boolean).join("\n"),
    assetId: str(row.asset_id),
    payload: { addressId: action.addressId },
  });
  await addressEvent(ctx, action.addressId, "linked", { ticketId: ticket.id, ticketNumber: ticket.number });
  await audit(ctx, "ipam.address.ticket_created", "ticket", ticket.id, { addressId: action.addressId, address });
  return json(ctx.request, { data: { ticketId: ticket.id, ticketNumber: ticket.number, existing: false } }, 201);
}

// ---------------------------------------------------------------------------
// Redesign (0304): dashboard, change log, cleanup, address space, planner,
// site templates, VLAN matrix, sites and target/actual comparison.

/** Today in Zurich (same day boundary as ipam_record_utilization). */
function zurichToday(offsetDays = 0): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (!offsetDays) return day;
  return new Date(Date.parse(`${day}T00:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function cidrOf(row: Row): Cidr | null {
  return parseCidrInput(String(row.prefix ?? ""))?.cidr ?? null;
}

/** Ids of prefixes that contain at least one active (or any) nested prefix of the same VRF. */
function prefixesWithChildren(rows: Row[], onlyActive: boolean): Set<string> {
  const nested = nestPrefixes(rows.map((row) => ({ id: String(row.id), prefix: String(row.prefix), vrfId: str(row.vrf_id) })));
  const parents = new Map(nested.map((entry) => [entry.item.id, entry.parentId]));
  const status = new Map(rows.map((row) => [String(row.id), String(row.status)]));
  const result = new Set<string>();
  for (const entry of nested) {
    if (onlyActive && status.get(entry.item.id) !== "active") continue;
    let parent = entry.parentId;
    while (parent && !result.has(parent)) {
      result.add(parent);
      parent = parents.get(parent) ?? null;
    }
  }
  return result;
}

/**
 * Existing prefixes (same VRF) that overlap `cidr`. Allowed are only the
 * container the new prefix goes into and prefixes containing that container
 * (without container: any strict supernet of `cidr`). Same rule as
 * public.ipam_apply_layout.
 */
function overlapConflicts(rows: Row[], cidr: Cidr, vrfId: string | null, container: Cidr | null = null): string[] {
  const conflicts: string[] = [];
  for (const row of rows) {
    if (str(row.vrf_id) !== vrfId) continue;
    const other = cidrOf(row);
    if (!other || cidrRelation(other, cidr) === "disjoint") continue;
    if (container ? cidrContainsCidr(other, container) : cidrRelation(other, cidr) === "contains") continue;
    conflicts.push(formatCidr(other));
  }
  return conflicts;
}

function layoutError(error: { code?: string; message?: string } | null): HttpError {
  if (error?.code === "P0001" && String(error.message ?? "").startsWith("ipam_layout_conflict")) {
    const list = String(error.message).replace(/^ipam_layout_conflict:\s*/, "");
    return new HttpError(409, "prefix_conflict", `Überschneidung mit bestehenden Subnetzen: ${list}.`);
  }
  if (error?.code === "23505") {
    return new HttpError(409, "duplicate", "Ein Standort, VLAN oder Subnetz mit diesen Angaben gibt es bereits.");
  }
  return conflict(error, "Die Angaben passen nicht zusammen.");
}

async function ensureAssetLocationFree(ctx: Ctx, locationId: string, ownSiteId: string | null) {
  const { data, error } = await ctx.admin.from("ipam_sites").select("id, name")
    .eq("tenant_id", ctx.tenantId).eq("asset_location_id", locationId).limit(1);
  if (error) throw dbFailure();
  const other = ((data ?? []) as Row[]).find((row) => row.id !== ownSiteId);
  if (other) {
    throw new HttpError(
      409,
      "asset_location_linked",
      `Der Asset-Standort ist bereits mit dem Standort «${other.name}» verknüpft.`,
    );
  }
}

// ----------------------------------------------------------- change log

type ChangeFilter = {
  objectType?: string | null;
  objectId?: string | null;
  source?: string | null;
  since?: string | null;
  before?: number | null;
  limit: number;
};

const RESOLVE_TABLES: Record<string, { table: string; columns: string; label: (row: Row) => string; tenant: boolean }> = {
  site_id: { table: "ipam_sites", columns: "id, name", label: (row) => String(row.name), tenant: true },
  vlan_id: {
    table: "ipam_vlans",
    columns: "id, vlan_number, name",
    label: (row) => `VLAN ${row.vlan_number} ${row.name}`,
    tenant: true,
  },
  vrf_id: { table: "ipam_vrfs", columns: "id, name", label: (row) => String(row.name), tenant: true },
  department_id: { table: "departments", columns: "id, name", label: (row) => String(row.name), tenant: true },
  supernet_prefix_id: { table: "ipam_prefixes", columns: "id, prefix", label: (row) => String(row.prefix), tenant: true },
  template_id: { table: "ipam_site_templates", columns: "id, name", label: (row) => String(row.name), tenant: true },
  asset_location_id: { table: "asset_locations", columns: "id, name", label: (row) => String(row.name), tenant: true },
  team_id: { table: "teams", columns: "id, name", label: (row) => String(row.name), tenant: true },
  asset_id: { table: "assets", columns: "id, name", label: (row) => String(row.name), tenant: true },
  service_id: { table: "services", columns: "id, name", label: (row) => String(row.name), tenant: true },
  owner_user_id: {
    table: "user_profiles",
    columns: "id, display_name",
    label: (row) => str(row.display_name) ?? "Unbekannte Person",
    tenant: false,
  },
};

/** Names for the ids in the changed fields of the given entries. */
async function changeResolver(ctx: Ctx, rows: Row[]) {
  const wanted = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const side of [row.before, row.after]) {
      if (!side || typeof side !== "object") continue;
      for (const [field, value] of Object.entries(side as Row)) {
        if (!RESOLVE_TABLES[field] || typeof value !== "string" || !isUuid(value)) continue;
        const set = wanted.get(field) ?? new Set<string>();
        set.add(value);
        wanted.set(field, set);
      }
    }
  }
  const names = new Map<string, string>();
  await Promise.all([...wanted].map(async ([field, ids]) => {
    const spec = RESOLVE_TABLES[field]!;
    let query = ctx.admin.from(spec.table).select(spec.columns).in("id", [...ids].slice(0, 200));
    if (spec.tenant) query = query.eq("tenant_id", ctx.tenantId);
    const { data } = await query;
    for (const row of (data ?? []) as Row[]) names.set(`${field}:${row.id}`, spec.label(row));
  }));
  return (field: string, id: string) => names.get(`${field}:${id}`) ?? null;
}

async function changeEntries(ctx: Ctx, filter: ChangeFilter) {
  const { data, error } = await ctx.admin.rpc("ipam_change_log_page", {
    p_tenant_id: ctx.tenantId,
    p_departments: ctx.scope.scoped ? ctx.scope.departments : null,
    p_object_type: filter.objectType ?? null,
    p_object_id: filter.objectId ?? null,
    p_source: filter.source ?? null,
    p_since: filter.since ?? null,
    p_before: filter.before ?? null,
    p_limit: filter.limit + 1,
  });
  if (error) throw dbFailure();
  const all = (data ?? []) as Row[];
  const rows = all.slice(0, filter.limit);
  const [actors, resolve] = await Promise.all([
    profileNames(ctx.admin, rows.map((row) => str(row.actor_id))),
    changeResolver(ctx, rows),
  ]);
  const entries = rows.map((row) =>
    changeLogEntry(row, {
      actorName: row.actor_id ? (actors.get(String(row.actor_id)) ?? null) : null,
      canManage: ctx.canManage,
      resolve,
    })
  );
  return {
    entries,
    nextBefore: all.length > filter.limit && rows.length ? Number(rows[rows.length - 1]!.id) : null,
  };
}

async function changeLog(ctx: Ctx, action: Extract<RedesignAction, { type: "changeLog" }>) {
  return json(ctx.request, { data: await changeEntries(ctx, action) });
}

async function undoChange(ctx: Ctx, entryId: number) {
  const { data: entry, error } = await ctx.admin.from("ipam_change_log")
    .select("id, object_type, object_id, department_id, action")
    .eq("tenant_id", ctx.tenantId).eq("id", entryId).maybeSingle();
  if (error) throw dbFailure();
  if (!entry || !departmentVisible(ctx.scope, entry.department_id)) {
    throw new HttpError(404, "entry_not_found", "Der Eintrag ist nicht verfügbar.");
  }
  // The object as it is now must be visible as well.
  const type = String(entry.object_type);
  const objectId = String(entry.object_id);
  if (type === "address") {
    const current = await ctx.admin.from("ipam_addresses").select("prefix_id").eq("tenant_id", ctx.tenantId)
      .eq("id", objectId).maybeSingle();
    if (current.error) throw dbFailure();
    if (current.data?.prefix_id) {
      await loadPrefix(ctx, String(current.data.prefix_id)).catch(() => {
        throw new HttpError(404, "entry_not_found", "Der Eintrag ist nicht verfügbar.");
      });
    }
  } else if (type !== "template") {
    const table = type === "prefix" ? "ipam_prefixes" : type === "vlan" ? "ipam_vlans" : "ipam_sites";
    const current = await ctx.admin.from(table).select("department_id").eq("tenant_id", ctx.tenantId)
      .eq("id", objectId).maybeSingle();
    if (current.error) throw dbFailure();
    if (current.data && !departmentVisible(ctx.scope, current.data.department_id)) {
      throw new HttpError(404, "entry_not_found", "Der Eintrag ist nicht verfügbar.");
    }
  }
  const result = await ctx.admin.rpc("ipam_change_undo", {
    p_tenant_id: ctx.tenantId,
    p_entry_id: entryId,
    p_actor_id: ctx.actorId,
  });
  if (result.error) {
    throw conflict(result.error, "Der frühere Wert ist inzwischen anderweitig vergeben.");
  }
  if (result.data === "changed_since") {
    throw new HttpError(409, "changed_since", "Der Eintrag wurde seither erneut geändert.");
  }
  if (result.data === "not_found") throw new HttpError(404, "entry_not_found", "Der Eintrag ist nicht verfügbar.");
  if (result.data !== "ok") {
    throw new HttpError(422, "not_undoable", "Diese Änderung kann nicht rückgängig gemacht werden.");
  }
  await audit(ctx, "ipam.change.undone", `ipam_${type}`, objectId, { entryId });
  return json(ctx.request, { data: { ok: true } });
}

// ----------------------------------------------------------- dashboard

async function dashboard(ctx: Ctx) {
  const today = zurichToday();
  const [space, usage, findingsResult, reservations, agentsResult, recent] = await Promise.all([
    loadSpace(ctx),
    usageMap(ctx),
    ctx.admin.from("ipam_findings").select("kind, prefix_id").eq("tenant_id", ctx.tenantId).eq("status", "open")
      .limit(10000),
    ctx.admin.from("ipam_addresses").select("prefix_id").eq("tenant_id", ctx.tenantId).eq("status", "reserved")
      .gte("reserved_until", today).lte("reserved_until", zurichToday(30)).limit(10000),
    ctx.admin.from("ipam_agents").select("id, name, platform, status, last_seen_at").eq("tenant_id", ctx.tenantId)
      .neq("status", "revoked").order("name").limit(200),
    changeEntries(ctx, { limit: 8 }),
  ]);
  if (findingsResult.error || reservations.error || agentsResult.error) throw dbFailure();
  const visible = new Set(space.prefixes.map((row) => String(row.id)));
  const withActiveChild = prefixesWithChildren(space.prefixes, true);
  const leaves = space.prefixes.filter((row) =>
    row.status === "active" && cidrOf(row)?.version === 4 && !withActiveChild.has(String(row.id))
  );
  const warnings = new Map(leaves.map((row) => [String(row.id), num(row.utilization_warning_percent) || 85]));
  const forecasts = await prefixForecast(ctx, leaves.map((row) => String(row.id)).slice(0, 2000), warnings);
  let free = 0n;
  let overThreshold = 0;
  let fullSoon = 0;
  const summaries = new Map<string, ReturnType<typeof forecastSummary>>();
  for (const row of leaves) {
    const id = String(row.id);
    const item = usage.get(id);
    const cidr = cidrOf(row)!;
    const taken = BigInt((item?.used ?? 0) + (item?.dhcpSize ?? 0));
    const capacity = cidrCapacity(cidr);
    if (capacity > taken) free += capacity - taken;
    if (item && item.percent >= (warnings.get(id) ?? 85)) overThreshold++;
    const summary = forecastSummary(forecasts[id] ?? null, today);
    summaries.set(id, summary);
    if (summary.daysToFull !== null && summary.daysToFull <= 30) fullSoon++;
  }
  const openFindings = ((findingsResult.data ?? []) as Row[]).filter(
    (row) => !row.prefix_id || visible.has(String(row.prefix_id)),
  );
  const byKind: Record<string, number> = {};
  for (const row of openFindings) byKind[String(row.kind)] = (byKind[String(row.kind)] ?? 0) + 1;
  const vlans = new Map(space.vlans.map((row) => [String(row.id), row]));
  const sites = new Map(space.sites.map((row) => [String(row.id), row]));
  const top = [...leaves]
    .sort((a, b) => (usage.get(String(b.id))?.percent ?? 0) - (usage.get(String(a.id))?.percent ?? 0))
    .slice(0, 8)
    .map((row) => {
      const vlan = row.vlan_id ? vlans.get(String(row.vlan_id)) : undefined;
      const site = row.site_id ? sites.get(String(row.site_id)) : undefined;
      return {
        prefixId: String(row.id),
        prefix: String(row.prefix),
        name: str(row.description),
        vlanNumber: vlan ? num(vlan.vlan_number) : null,
        vlanName: vlan ? String(vlan.name) : null,
        siteName: site ? String(site.name) : null,
        percent: usage.get(String(row.id))?.percent ?? 0,
        forecast: summaries.get(String(row.id)) ?? forecastSummary(null, today),
      };
    });
  return json(ctx.request, {
    data: {
      kpis: {
        freeIpv4: Number(free),
        activePrefixes: space.prefixes.filter((row) => row.status === "active").length,
        overThreshold,
        fullWithin30Days: fullSoon,
        openFindings: openFindings.length,
        findingsByKind: byKind,
        expiringReservations30Days: ((reservations.data ?? []) as Row[]).filter(
          (row) => !row.prefix_id || visible.has(String(row.prefix_id)),
        ).length,
      },
      topUtilization: top,
      agents: ((agentsResult.data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        platform: str(row.platform),
        status: agentState(String(row.status), str(row.last_seen_at)),
        lastSeenAt: str(row.last_seen_at),
      })),
      recentChanges: recent.entries,
    },
  });
}

// ----------------------------------------------------------- bulk edit

async function bulkUpdatePrefixes(ctx: Ctx, action: Extract<RedesignAction, { type: "bulkUpdatePrefixes" }>) {
  const { data, error } = await ctx.admin.from("ipam_prefixes").select("id, department_id")
    .eq("tenant_id", ctx.tenantId).in("id", action.prefixIds);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  if (rows.length !== action.prefixIds.length || rows.some((row) => !departmentVisible(ctx.scope, row.department_id))) {
    throw new HttpError(404, "prefix_not_found", "Mindestens ein Subnetz ist nicht verfügbar.");
  }
  const values: Row = { updated_at: new Date().toISOString(), ...stamp(ctx) };
  const patch = action.patch;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.departmentId !== undefined) values.department_id = departmentFor(ctx, patch.departmentId);
  if (patch.securityZone !== undefined) values.security_zone = patch.securityZone;
  if (patch.siteId !== undefined) {
    await ensureRow(ctx, "ipam_sites", patch.siteId, "Der Standort ist nicht verfügbar.", true);
    values.site_id = patch.siteId;
  }
  const result = await ctx.admin.from("ipam_prefixes").update(values).eq("tenant_id", ctx.tenantId)
    .in("id", action.prefixIds).select("id");
  if (result.error) throw conflict(result.error, "Die Änderung ist nicht möglich.");
  const updated = ((result.data ?? []) as Row[]).length;
  await audit(ctx, "ipam.prefix.bulk_updated", "ipam_prefix", null, {
    count: updated,
    fields: Object.keys(patch),
  });
  return json(ctx.request, { data: { updated } });
}

// ----------------------------------------------------------- cleanup

async function loadCleanupPlans(ctx: Ctx) {
  const [space, usage] = await Promise.all([loadSpace(ctx), usageMap(ctx)]);
  const sites = new Map(space.sites.map((row) => [String(row.id), row]));
  return cleanupPlans(
    space.prefixes.map((row) => ({
      id: String(row.id),
      prefix: String(row.prefix),
      vrfId: str(row.vrf_id),
      status: String(row.status),
      description: str(row.description),
      notes: str(row.notes),
      gateway: inetText(row.gateway),
      dhcpStart: inetText(row.dhcp_start),
      dhcpEnd: inetText(row.dhcp_end),
      used: usage.get(String(row.id))?.used ?? 0,
    })),
    space.vlans.map((row) => {
      const site = row.site_id ? sites.get(String(row.site_id)) : undefined;
      return {
        id: String(row.id),
        vlanNumber: num(row.vlan_number),
        name: String(row.name),
        siteId: str(row.site_id),
        siteName: site ? String(site.name) : null,
        siteCode: site ? str(site.code) : null,
        status: str(row.status) ?? "active",
        description: str(row.description),
        notes: str(row.notes),
      };
    }),
  );
}

async function cleanupSuggestions(ctx: Ctx) {
  const plans = await loadCleanupPlans(ctx);
  return json(ctx.request, { data: { suggestions: plans.map((plan) => plan.suggestion) } });
}

async function applyCleanup(ctx: Ctx, keys: string[]) {
  const plans = new Map((await loadCleanupPlans(ctx)).map((plan) => [plan.suggestion.key, plan]));
  let applied = 0;
  const failed: { key: string; message: string }[] = [];
  for (const key of keys) {
    const plan = plans.get(key);
    if (!plan) {
      failed.push({ key, message: "Der Vorschlag trifft nicht mehr zu." });
      continue;
    }
    if (!plan.patch) {
      failed.push({ key, message: "Dieser Hinweis hat keine automatische Korrektur." });
      continue;
    }
    const table = plan.suggestion.objectType === "vlan" ? "ipam_vlans" : "ipam_prefixes";
    const { error } = await ctx.admin.from(table)
      .update({ ...plan.patch, updated_at: new Date().toISOString(), ...stamp(ctx, "cleanup") })
      .eq("tenant_id", ctx.tenantId).eq("id", plan.suggestion.objectId);
    if (error) {
      failed.push({ key, message: "Die Korrektur konnte nicht gespeichert werden." });
      continue;
    }
    applied++;
  }
  await audit(ctx, "ipam.cleanup.applied", "ipam_prefix", null, { applied, failed: failed.length });
  return json(ctx.request, { data: { applied, failed } });
}

// ----------------------------------------------------------- address space

async function addressSpace(ctx: Ctx, prefixId: string) {
  const prefix = await loadPrefix(ctx, prefixId);
  const cidr = cidrOf(prefix);
  if (!cidr) throw dbFailure();
  const [space, usage] = await Promise.all([loadSpace(ctx), usageMap(ctx)]);
  const visible = new Set(space.prefixes.map((row) => String(row.id)));
  const sites = new Map(space.sites.map((row) => [String(row.id), String(row.name)]));
  type Meta = { prefixId: string; name: string | null; siteName: string | null; percent: number; status: string };
  const children: ChildInput<Meta | null>[] = [];
  for (const row of space.allPrefixes) {
    if (row.id === prefix.id || str(row.vrf_id) !== str(prefix.vrf_id)) continue;
    const child = cidrOf(row);
    if (!child) continue;
    children.push({
      cidr: child,
      meta: visible.has(String(row.id))
        ? {
          prefixId: String(row.id),
          name: str(row.description),
          siteName: row.site_id ? (sites.get(String(row.site_id)) ?? null) : null,
          percent: usage.get(String(row.id))?.percent ?? 0,
          status: String(row.status),
        }
        : null,
    });
  }
  const layout = addressSpaceLayout(cidr, children, 512);
  return json(ctx.request, {
    data: {
      prefixId: String(prefix.id),
      prefix: formatCidr(cidr),
      capacity: layout.capacity.toString(),
      allocatedPercent: layout.allocatedPercent,
      freeTotal: layout.freeTotal.toString(),
      largestFree: lengthText(layout.largestFree),
      childCount: layout.childCount,
      truncated: layout.truncated,
      segments: layout.segments.map((segment) => {
        const base = { kind: segment.kind, cidr: formatCidr(segment.cidr), size: cidrSize(segment.cidr).toString() };
        if (segment.kind === "free" || !segment.meta) return base;
        return { ...base, ...segment.meta };
      }),
    },
  });
}

async function utilizationHistory(ctx: Ctx, prefixId: string, days: number) {
  const prefix = await loadPrefix(ctx, prefixId);
  const warningPercent = num(prefix.utilization_warning_percent) || 85;
  const [history, forecasts] = await Promise.all([
    ctx.admin.from("ipam_utilization_daily").select("day, used, dhcp_used, total")
      .eq("tenant_id", ctx.tenantId).eq("prefix_id", prefixId).gte("day", zurichToday(-days))
      .order("day").limit(400),
    prefixForecast(ctx, [prefixId], new Map([[prefixId, warningPercent]])),
  ]);
  if (history.error) throw dbFailure();
  return json(ctx.request, {
    data: {
      points: ((history.data ?? []) as Row[]).map((row) => {
        const used = num(row.used) + num(row.dhcp_used);
        const total = num(row.total);
        return { day: String(row.day), used, total, percent: total > 0 ? round1(Math.min(100, (used / total) * 100)) : 0 };
      }),
      forecast: forecastSummary(forecasts[prefixId] ?? null, zurichToday()),
      warningPercent,
    },
  });
}

// ----------------------------------------------------------- planner

async function planPrefixes(ctx: Ctx, action: Extract<RedesignAction, { type: "planPrefixes" }>) {
  const parent = await loadPrefix(ctx, action.parentPrefixId);
  const cidr = cidrOf(parent);
  if (!cidr) throw dbFailure();
  const space = await loadSpace(ctx);
  const occupied = space.allPrefixes
    .filter((row) => row.id !== parent.id && str(row.vrf_id) === str(parent.vrf_id))
    .map(cidrOf)
    .filter((value): value is Cidr => value !== null);
  const plan = planPlacement(cidr, occupied, action.items);
  const items = plan.items.map((item) => ({
    name: item.name,
    cidr: item.cidr ? formatCidr(item.cidr) : null,
    hosts: item.cidr ? cidrCapacity(item.cidr).toString() : null,
    error: item.error,
  }));
  if (action.dryRun) {
    return json(ctx.request, { data: { items, freeAfter: plan.freeAfter.toString() } });
  }
  const failed = items.filter((item) => item.error);
  if (failed.length) {
    throw new HttpError(
      422,
      "plan_invalid",
      `Nicht alle Teilnetze passen: ${failed.map((item) => `${item.name} (${item.error})`).join("; ")}`,
    );
  }
  const vlans = new Map<number, Row>();
  action.items.forEach((item) => {
    if (item.vlanNumber !== null && !vlans.has(item.vlanNumber)) {
      vlans.set(item.vlanNumber, { vlanNumber: item.vlanNumber, name: item.name, zone: item.securityZone });
    }
  });
  const { data, error } = await ctx.admin.rpc("ipam_apply_layout", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.actorId,
    p_source: "planner",
    p_layout: {
      vrfId: str(parent.vrf_id),
      departmentId: str(parent.department_id),
      siteId: str(parent.site_id),
      parentPrefix: formatCidr(cidr),
      vlans: [...vlans.values()],
      prefixes: plan.items.map((item, index) => ({
        prefix: formatCidr(item.cidr!),
        description: item.name,
        status: "active",
        securityZone: action.items[index]!.securityZone ?? str(parent.security_zone),
        gateway: firstUsable(item.cidr!),
        vlanNumber: action.items[index]!.vlanNumber,
        warningPercent: num(parent.utilization_warning_percent) || 85,
      })),
    },
  });
  if (error) throw layoutError(error);
  await audit(ctx, "ipam.prefix.planned", "ipam_prefix", String(parent.id), {
    created: items.map((item) => item.cidr),
  });
  return json(ctx.request, {
    data: { items, freeAfter: plan.freeAfter.toString(), prefixIds: (data as Row | null)?.prefixIds ?? [] },
  }, 201);
}

// ----------------------------------------------------------- templates

function templateDto(template: Template) {
  // Contract: `id?: string` – the derived suggestion has no id.
  return {
    ...(template.id ? { id: template.id } : {}),
    name: template.name,
    description: template.description,
    prefixLength: template.prefixLength,
    entries: template.entries,
  };
}

async function loadTemplates(ctx: Ctx): Promise<Template[]> {
  const { data, error } = await ctx.admin.from("ipam_site_templates").select("*").eq("tenant_id", ctx.tenantId)
    .order("name").limit(200);
  if (error) throw dbFailure();
  return ((data ?? []) as Row[]).map(templateFromRow);
}

async function loadTemplate(ctx: Ctx, id: string): Promise<Template> {
  const { data, error } = await ctx.admin.from("ipam_site_templates").select("*").eq("tenant_id", ctx.tenantId)
    .eq("id", id).maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "template_not_found", "Die Vorlage ist nicht verfügbar.");
  return templateFromRow(data as Row);
}

function matrixSites(space: Space): MatrixSite[] {
  const prefixes = new Map(space.allPrefixes.map((row) => [String(row.id), String(row.prefix)]));
  return space.sites.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: str(row.code),
    vlanBase: row.vlan_base === null || row.vlan_base === undefined ? null : num(row.vlan_base),
    supernet: row.supernet_prefix_id ? (prefixes.get(String(row.supernet_prefix_id)) ?? null) : null,
  })).sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
}

function matrixVlans(space: Space): MatrixVlan[] {
  return space.vlans.filter((row) => (str(row.status) ?? "active") !== "deprecated").map((row) => ({
    id: String(row.id),
    siteId: str(row.site_id),
    vlanNumber: num(row.vlan_number),
    name: String(row.name),
    zone: str(row.zone),
  }));
}

async function listTemplates(ctx: Ctx) {
  const templates = await loadTemplates(ctx);
  let suggested: ReturnType<typeof templateDto> | null = null;
  if (!templates.length) {
    const space = await loadSpace(ctx);
    const template = suggestTemplate(
      matrixSites(space),
      matrixVlans(space),
      space.prefixes.map((row) => ({
        id: String(row.id),
        prefix: String(row.prefix),
        vlanId: str(row.vlan_id),
        securityZone: str(row.security_zone),
        dhcp: !!row.dhcp_start,
      })),
    );
    suggested = template ? templateDto(template) : null;
  }
  return json(ctx.request, { data: { templates: templates.map(templateDto), suggested } });
}

async function saveTemplate(ctx: Ctx, template: Template) {
  const values = {
    name: template.name,
    description: template.description,
    prefix_length: template.prefixLength,
    entries: template.entries,
    updated_at: new Date().toISOString(),
    ...stamp(ctx),
  };
  const result = template.id
    ? await ctx.admin.from("ipam_site_templates").update(values).eq("tenant_id", ctx.tenantId).eq("id", template.id)
      .select("id").maybeSingle()
    : await ctx.admin.from("ipam_site_templates").insert({ ...values, tenant_id: ctx.tenantId, created_by: ctx.actorId })
      .select("id").single();
  if (result.error) throw conflict(result.error, "Eine Vorlage mit diesem Namen gibt es bereits.");
  if (!result.data) throw new HttpError(404, "template_not_found", "Die Vorlage ist nicht verfügbar.");
  const id = String(result.data.id);
  await audit(ctx, template.id ? "ipam.template.updated" : "ipam.template.created", "ipam_site_template", id, {
    name: template.name,
  });
  return json(ctx.request, { data: { id } }, template.id ? 200 : 201);
}

async function deleteTemplate(ctx: Ctx, id: string) {
  const { data, error } = await ctx.admin.rpc("ipam_delete_logged", {
    p_tenant_id: ctx.tenantId,
    p_object_type: "template",
    p_object_id: id,
    p_actor_id: ctx.actorId,
    p_source: "user",
  });
  if (error) throw dbFailure();
  if (data !== true) throw new HttpError(404, "template_not_found", "Die Vorlage ist nicht verfügbar.");
  await audit(ctx, "ipam.template.deleted", "ipam_site_template", id, {});
  return json(ctx.request, { data: { id, deleted: true } });
}

async function vlanMatrixAction(ctx: Ctx, templateId: string | null) {
  const [space, usage, templates] = await Promise.all([loadSpace(ctx), usageMap(ctx), loadTemplates(ctx)]);
  const template = templateId
    ? (templates.find((item) => item.id === templateId) ??
      (() => {
        throw new HttpError(404, "template_not_found", "Die Vorlage ist nicht verfügbar.");
      })())
    : (templates[0] ?? null);
  const sites = matrixSites(space);
  const prefixes: MatrixPrefix[] = space.prefixes.map((row) => ({
    id: String(row.id),
    prefix: String(row.prefix),
    vlanId: str(row.vlan_id),
    percent: usage.get(String(row.id))?.percent ?? null,
  }));
  const result = vlanMatrix(template, sites, matrixVlans(space), prefixes);
  return json(ctx.request, {
    data: {
      template: template ? templateDto(template) : null,
      sites: sites.map((site) => ({ id: site.id, name: site.name })),
      rows: result.rows,
      otherVlans: result.otherVlans,
    },
  });
}

async function createFromTemplate(ctx: Ctx, action: Extract<RedesignAction, { type: "createFromTemplate" }>) {
  const [site, template, space] = await Promise.all([
    existingScoped(ctx, "ipam_sites", action.siteId, "Der Standort ist nicht verfügbar."),
    loadTemplate(ctx, action.templateId),
    loadSpace(ctx),
  ]);
  const entry = template.entries.find((item) => item.function.toLowerCase() === action.function.toLowerCase());
  if (!entry) throw new HttpError(422, "function_unknown", `Die Funktion «${action.function}» gibt es in der Vorlage nicht.`);
  const supernetRow = site.supernet_prefix_id
    ? space.allPrefixes.find((row) => row.id === site.supernet_prefix_id)
    : undefined;
  const supernet = supernetRow ? cidrOf(supernetRow) : null;
  if (site.vlan_base === null || site.vlan_base === undefined || !supernet) {
    throw new HttpError(
      422,
      "site_layout_missing",
      "Für diesen Standort sind keine VLAN-Basis und kein Supernetz erfasst.",
    );
  }
  const layout = templateLayout(template, supernet, num(site.vlan_base), [entry.function]);
  const item = layout.items[0];
  if (!item) throw new HttpError(422, "template_invalid", layout.errors.join(" ") || "Die Vorlage passt nicht.");
  const vrfId = str(supernetRow!.vrf_id);
  const cidr = parseCidrInput(item.prefix)!.cidr;
  const exists = space.allPrefixes.some((row) => str(row.vrf_id) === vrfId && String(row.prefix) === item.prefix);
  const vlanExists = space.vlans.some((row) =>
    row.site_id === site.id && num(row.vlan_number) === item.vlanNumber
  );
  if (exists && vlanExists) {
    throw new HttpError(409, "already_exists", `VLAN ${item.vlanNumber} und ${item.prefix} sind bereits vorhanden.`);
  }
  if (!exists) {
    const conflicts = overlapConflicts(space.allPrefixes, cidr, vrfId, supernet);
    if (conflicts.length) {
      throw new HttpError(409, "prefix_conflict", `Überschneidung mit bestehenden Subnetzen: ${conflicts.join(", ")}.`);
    }
  }
  const { data, error } = await ctx.admin.rpc("ipam_apply_layout", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.actorId,
    p_source: "template",
    p_layout: {
      vrfId,
      departmentId: str(site.department_id),
      siteId: String(site.id),
      parentPrefix: formatCidr(supernet),
      vlans: [{ vlanNumber: item.vlanNumber, name: item.function, zone: item.zone, description: item.description }],
      prefixes: exists ? [] : [{
        prefix: item.prefix,
        description: item.function,
        status: "active",
        securityZone: item.zone,
        gateway: item.gateway,
        vlanNumber: item.vlanNumber,
      }],
    },
  });
  if (error) throw layoutError(error);
  await audit(ctx, "ipam.template.applied", "ipam_site", String(site.id), {
    function: item.function,
    vlanNumber: item.vlanNumber,
    prefix: item.prefix,
  });
  const result = (data ?? {}) as Row;
  return json(ctx.request, {
    data: {
      siteId: String(site.id),
      vlanNumber: item.vlanNumber,
      prefix: item.prefix,
      prefixIds: result.prefixIds ?? [],
      vlanIds: result.vlanIds ?? [],
    },
  }, 201);
}

async function createSiteFromTemplate(
  ctx: Ctx,
  action: Extract<RedesignAction, { type: "createSiteFromTemplate" }>,
) {
  const [template, space] = await Promise.all([loadTemplate(ctx, action.templateId), loadSpace(ctx)]);
  const supernet = parseCidrInput(action.supernet)!.cidr;
  const layout = templateLayout(template, supernet, action.vlanBase, action.functions);
  if (layout.errors.length) throw new HttpError(422, "template_invalid", layout.errors.join(" "));
  const preview = layout.items.map((item) => ({
    function: item.function,
    vlanNumber: item.vlanNumber,
    prefix: item.prefix,
    gateway: item.gateway,
  }));
  // Conflicts in the global routing table (vrf null).
  const conflicts = new Set<string>();
  const existingSupernet = space.allPrefixes.find((row) => !row.vrf_id && String(row.prefix) === action.supernet);
  if (!existingSupernet) overlapConflicts(space.allPrefixes, supernet, null).forEach((item) => conflicts.add(item));
  for (const item of layout.items) {
    overlapConflicts(space.allPrefixes, parseCidrInput(item.prefix)!.cidr, null, supernet)
      .forEach((value) => conflicts.add(value));
  }
  const { data: sameName, error: nameError } = await ctx.admin.from("ipam_sites").select("id")
    .eq("tenant_id", ctx.tenantId).eq("name", action.name).limit(1);
  if (nameError) throw dbFailure();
  if ((sameName ?? []).length) throw new HttpError(409, "duplicate", "Einen Standort mit diesem Namen gibt es bereits.");
  let assetLocationId: string | null = null;
  if (action.assetLocation.mode === "existing") {
    await ensureRow(ctx, "asset_locations", action.assetLocation.id, "Der Asset-Standort ist nicht verfügbar.");
    await ensureAssetLocationFree(ctx, action.assetLocation.id, null);
    assetLocationId = action.assetLocation.id;
  } else if (action.assetLocation.mode === "new") {
    const { data: location, error } = await ctx.admin.from("asset_locations").select("id")
      .eq("tenant_id", ctx.tenantId).eq("name", action.name).maybeSingle();
    if (error) throw dbFailure();
    if (location) await ensureAssetLocationFree(ctx, String(location.id), null);
  }
  const conflictList = [...conflicts].sort();
  if (action.dryRun) {
    return json(ctx.request, { data: { preview, conflicts: conflictList } });
  }
  if (conflictList.length) {
    return json(ctx.request, {
      error: {
        code: "prefix_conflict",
        message: `Überschneidung mit bestehenden Subnetzen: ${conflictList.join(", ")}.`,
        conflicts: conflictList,
      },
    }, 422);
  }
  const { data, error } = await ctx.admin.rpc("ipam_apply_layout", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.actorId,
    p_source: "template",
    p_layout: {
      vrfId: null,
      departmentId: null,
      site: {
        name: action.name,
        code: action.code,
        address: action.address,
        vlanBase: action.vlanBase,
        templateId: template.id,
        assetLocationId,
        newAssetLocationName: action.assetLocation.mode === "new" ? action.name : null,
      },
      supernet: { prefix: action.supernet, description: action.name },
      vlans: layout.items.map((item) => ({
        vlanNumber: item.vlanNumber,
        name: item.function,
        zone: item.zone,
        description: item.description,
      })),
      prefixes: layout.items.map((item) => ({
        prefix: item.prefix,
        description: item.function,
        status: "active",
        securityZone: item.zone,
        gateway: item.gateway,
        vlanNumber: item.vlanNumber,
      })),
    },
  });
  if (error) throw layoutError(error);
  const siteId = String((data as Row).siteId);
  await audit(ctx, "ipam.site.created_from_template", "ipam_site", siteId, {
    name: action.name,
    templateId: template.id,
    supernet: action.supernet,
    functions: layout.items.length,
  });
  return json(ctx.request, { data: { preview, siteId } }, 201);
}

// ----------------------------------------------------------- sites

type SiteContext = {
  space: Space;
  usage: Map<string, Usage>;
  locations: Row[];
  infra: Row[];
  assets: Map<string, Row>;
  agents: Row[];
};

async function loadSiteContext(ctx: Ctx): Promise<SiteContext> {
  const [space, usage, locations, infra, agents] = await Promise.all([
    loadSpace(ctx),
    usageMap(ctx),
    ctx.admin.from("asset_locations").select("id, name, active").eq("tenant_id", ctx.tenantId).order("name")
      .limit(2000),
    ctx.admin.from("asset_infrastructure")
      .select("asset_id, category, ip_address, uplink_asset_id, rack, rack_unit")
      .eq("tenant_id", ctx.tenantId).limit(5000),
    ctx.admin.from("ipam_agents").select("id, name, status, last_seen_at, config").eq("tenant_id", ctx.tenantId)
      .neq("status", "revoked").limit(200),
  ]);
  if (locations.error || infra.error || agents.error) throw dbFailure();
  const infraRows = (infra.data ?? []) as Row[];
  const ids = [
    ...new Set(infraRows.flatMap((row) => [str(row.asset_id), str(row.uplink_asset_id)]).filter((id): id is string => !!id)),
  ];
  const assets = new Map<string, Row>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await ctx.admin.from("assets")
      .select("id, name, location_id, model, manufacturer, serial_number, active")
      .eq("tenant_id", ctx.tenantId).in("id", ids.slice(index, index + 150));
    if (error) throw dbFailure();
    for (const row of (data ?? []) as Row[]) assets.set(String(row.id), row);
  }
  return {
    space,
    usage,
    locations: (locations.data ?? []) as Row[],
    infra: infraRows.filter((row) => assets.get(String(row.asset_id))?.active !== false),
    assets,
    agents: (agents.data ?? []) as Row[],
  };
}

function siteSummary(context: SiteContext, site: Row, withActiveChild: Set<string>) {
  const { space, usage } = context;
  const siteId = String(site.id);
  const prefixes = space.prefixes.filter((row) => row.site_id === siteId);
  const cidrs = prefixes.map((row) => ({ row, cidr: cidrOf(row) }))
    .filter((entry): entry is { row: Row; cidr: Cidr } => entry.cidr !== null);
  const devices = context.infra.filter((row) => {
    const asset = context.assets.get(String(row.asset_id));
    if (site.asset_location_id && asset?.location_id === site.asset_location_id) return true;
    const ip = typeof row.ip_address === "string" ? parseAddress(row.ip_address.split("/")[0]!.trim()) : null;
    return !!ip && cidrs.some((entry) => cidrContainsAddress(entry.cidr, ip));
  });
  let used = 0n;
  let capacity = 0n;
  for (const { row, cidr } of cidrs) {
    if (row.status !== "active" || cidr.version !== 4 || withActiveChild.has(String(row.id))) continue;
    const item = usage.get(String(row.id));
    used += BigInt((item?.used ?? 0) + (item?.dhcpSize ?? 0));
    capacity += cidrCapacity(cidr);
  }
  // Agents whose configured subnets overlap a subnet of the site.
  let best: { state: AgentState; name: string } | null = null;
  for (const agent of context.agents) {
    const config = (agent.config && typeof agent.config === "object" ? agent.config : {}) as Row;
    const agentVrf = str(config.vrfId);
    const configured = Array.isArray(config.prefixIds) ? config.prefixIds.map(String) : [];
    // Without explicit configuration an agent scans all active subnets (DEFAULT_AGENT_CONFIG).
    const covered = config.scanAllActive !== false
      ? cidrs.some((entry) => entry.row.status === "active" && str(entry.row.vrf_id) === agentVrf)
      : space.allPrefixes.filter((row) => configured.includes(String(row.id))).some((row) => {
        const target = cidrOf(row);
        return !!target && cidrs.some((entry) =>
          str(entry.row.vrf_id) === str(row.vrf_id) && cidrRelation(entry.cidr, target) !== "disjoint"
        );
      });
    if (!covered) continue;
    const state = agentState(String(agent.status), str(agent.last_seen_at));
    const better = betterAgentState(best?.state ?? null, state);
    if (!best || better !== best.state) best = { state, name: String(agent.name) };
  }
  const location = site.asset_location_id
    ? context.locations.find((row) => row.id === site.asset_location_id)
    : undefined;
  const supernet = site.supernet_prefix_id
    ? space.allPrefixes.find((row) => row.id === site.supernet_prefix_id)
    : undefined;
  return {
    entry: {
      id: siteId,
      name: String(site.name),
      code: str(site.code),
      address: str(site.address),
      assetLocation: location ? { id: String(location.id), name: String(location.name) } : null,
      supernet: supernet ? String(supernet.prefix) : null,
      vlanCount: space.vlans.filter((row) => row.site_id === siteId).length,
      prefixCount: prefixes.filter((row) => row.status !== "deprecated").length,
      switchCount: devices.filter((row) => row.category === "switch").length,
      apCount: devices.filter((row) => row.category === "access_point").length,
      deviceCount: devices.length,
      percent: capacity > 0n ? utilizationPercent(used, capacity) : null,
      agent: best ? { status: best.state, name: best.name } : null,
    },
    prefixes,
    devices,
  };
}

async function siteOverview(ctx: Ctx) {
  const context = await loadSiteContext(ctx);
  const withActiveChild = prefixesWithChildren(context.space.prefixes, true);
  const linked = new Map<string, string>();
  for (const site of context.space.sites) {
    if (site.asset_location_id) linked.set(String(site.asset_location_id), String(site.id));
  }
  // Locations linked to sites outside the scope still count as linked.
  const { data: allLinks } = await ctx.admin.from("ipam_sites").select("id, asset_location_id")
    .eq("tenant_id", ctx.tenantId).not("asset_location_id", "is", null);
  for (const row of (allLinks ?? []) as Row[]) {
    if (!linked.has(String(row.asset_location_id))) linked.set(String(row.asset_location_id), String(row.id));
  }
  return json(ctx.request, {
    data: {
      sites: context.space.sites.map((site) => siteSummary(context, site, withActiveChild).entry),
      assetLocations: context.locations.filter((row) => row.active !== false || linked.has(String(row.id)))
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          linkedSiteId: linked.get(String(row.id)) ?? null,
        })),
    },
  });
}

async function siteDetail(ctx: Ctx, siteId: string) {
  const site = await existingScoped(ctx, "ipam_sites", siteId, "Der Standort ist nicht verfügbar.");
  const context = await loadSiteContext(ctx);
  const withActiveChild = prefixesWithChildren(context.space.prefixes, true);
  const summary = siteSummary(context, site, withActiveChild);
  const percent = (row: Row) => context.usage.get(String(row.id))?.percent ?? 0;
  const prefixItem = (row: Row) => ({
    id: String(row.id),
    prefix: String(row.prefix),
    gateway: inetText(row.gateway),
    dhcpStart: inetText(row.dhcp_start),
    dhcpEnd: inetText(row.dhcp_end),
    percent: percent(row),
  });
  const sorted = [...summary.prefixes].sort((a, b) => compareCidrText(String(a.prefix), String(b.prefix)));
  const vlans = context.space.vlans.filter((row) => row.site_id === siteId)
    .sort((a, b) => num(a.vlan_number) - num(b.vlan_number))
    .map((row) => ({
      id: String(row.id),
      vlanNumber: num(row.vlan_number),
      name: String(row.name),
      description: str(row.description),
      zone: str(row.zone),
      status: str(row.status) ?? "active",
      notes: str(row.notes),
      prefixes: sorted.filter((prefix) => prefix.vlan_id === row.id).map(prefixItem),
    }));
  const devices = summary.devices.map((row) => {
    const asset = context.assets.get(String(row.asset_id));
    const uplink = row.uplink_asset_id ? context.assets.get(String(row.uplink_asset_id)) : undefined;
    const rack = [str(row.rack) ? `Rack ${row.rack}` : null, str(row.rack_unit) ? `HE ${row.rack_unit}` : null]
      .filter(Boolean).join(" · ");
    return {
      assetId: String(row.asset_id),
      name: asset ? String(asset.name) : "Unbekanntes Gerät",
      category: String(row.category),
      ipAddress: str(row.ip_address),
      model: asset ? str(asset.model) : null,
      manufacturer: asset ? str(asset.manufacturer) : null,
      serialNumber: asset ? str(asset.serial_number) : null,
      locationNote: rack || null,
      uplinkAssetId: str(row.uplink_asset_id),
      uplinkName: uplink ? String(uplink.name) : null,
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "de-CH"));
  return json(ctx.request, {
    data: {
      site: {
        ...summary.entry,
        description: str(site.description),
        departmentId: str(site.department_id),
        vlanBase: site.vlan_base === null || site.vlan_base === undefined ? null : num(site.vlan_base),
        supernetPrefixId: str(site.supernet_prefix_id),
        templateId: str(site.template_id),
      },
      vlans,
      prefixesWithoutVlan: sorted
        .filter((row) => !row.vlan_id && row.id !== site.supernet_prefix_id)
        .map((row) => ({ id: String(row.id), prefix: String(row.prefix), name: str(row.description), percent: percent(row) })),
      devices,
    },
  });
}

// ----------------------------------------------------------- target/actual

async function compareObserved(ctx: Ctx, siteId: string | null) {
  if (siteId) await existingScoped(ctx, "ipam_sites", siteId, "Der Standort ist nicht verfügbar.");
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [space, documented, seen, lastRun, lastSeen] = await Promise.all([
    loadSpace(ctx),
    ctx.admin.from("ipam_addresses").select("address, vrf_id").eq("tenant_id", ctx.tenantId)
      .neq("status", "deprecated").limit(50000),
    ctx.admin.from("ipam_observations").select("address, vrf_id").eq("tenant_id", ctx.tenantId)
      .gte("seen_at", since).limit(50000),
    ctx.admin.from("ipam_agent_runs").select("started_at").eq("tenant_id", ctx.tenantId)
      .order("started_at", { ascending: false }).limit(1),
    ctx.admin.from("ipam_observations").select("seen_at").eq("tenant_id", ctx.tenantId)
      .order("seen_at", { ascending: false }).limit(1),
  ]);
  if (documented.error || seen.error || lastRun.error || lastSeen.error) throw dbFailure();
  const withChild = prefixesWithChildren(space.prefixes, false);
  const leaves = space.prefixes.filter((row) =>
    cidrOf(row)?.version === 4 && !withChild.has(String(row.id)) && row.status !== "container" &&
    row.status !== "deprecated" && (!siteId || row.site_id === siteId)
  );
  const rows = compareObservedRows(
    leaves.map((row) => ({ id: String(row.id), prefix: String(row.prefix), name: str(row.description), vrfId: str(row.vrf_id) })),
    ((documented.data ?? []) as Row[]).map((row) => ({ address: String(row.address), vrfId: str(row.vrf_id) })),
    ((seen.data ?? []) as Row[]).map((row) => ({ address: String(row.address), vrfId: str(row.vrf_id) })),
  );
  const lastScanAt = str(((lastRun.data ?? []) as Row[])[0]?.started_at) ??
    str(((lastSeen.data ?? []) as Row[])[0]?.seen_at);
  return json(ctx.request, { data: { lastScanAt, rows } });
}

async function dispatchRedesign(ctx: Ctx, action: RedesignAction): Promise<Response> {
  switch (action.type) {
    case "dashboard":
      return await dashboard(ctx);
    case "changeLog":
      return await changeLog(ctx, action);
    case "undoChange":
      return await undoChange(ctx, action.entryId);
    case "bulkUpdatePrefixes":
      return await bulkUpdatePrefixes(ctx, action);
    case "cleanupSuggestions":
      return await cleanupSuggestions(ctx);
    case "applyCleanup":
      return await applyCleanup(ctx, action.keys);
    case "addressSpace":
      return await addressSpace(ctx, action.prefixId);
    case "utilizationHistory":
      return await utilizationHistory(ctx, action.prefixId, action.days);
    case "planPrefixes":
      return await planPrefixes(ctx, action);
    case "listTemplates":
      return await listTemplates(ctx);
    case "saveTemplate":
      return await saveTemplate(ctx, action.template);
    case "deleteTemplate":
      return await deleteTemplate(ctx, action.id);
    case "vlanMatrix":
      return await vlanMatrixAction(ctx, action.templateId);
    case "createFromTemplate":
      return await createFromTemplate(ctx, action);
    case "createSiteFromTemplate":
      return await createSiteFromTemplate(ctx, action);
    case "siteOverview":
      return await siteOverview(ctx);
    case "siteDetail":
      return await siteDetail(ctx, action.siteId);
    case "compareObserved":
      return await compareObserved(ctx, action.siteId);
  }
}

// ---------------------------------------------------------------------------

async function dispatch(ctx: Ctx, action: Action): Promise<Response> {
  switch (action.type) {
    case "overview":
      return await overview(ctx);
    case "prefixDetail":
      return await prefixDetail(ctx, action);
    case "addressDetail":
      return await addressDetail(ctx, action);
    case "search":
      return await search(ctx, action.query);
    case "findings":
      return await findings(ctx, action.status);
    case "forecast":
      return await forecast(ctx, action.prefixId);
    case "networkMapOverlay":
      return await networkMapOverlay(ctx);
    case "lookups":
      return await lookups(ctx);
    case "export":
      return await exportData(ctx, action);
    case "exportSophos":
      return await exportSophos(ctx, action);
    case "nextFreeAddress":
      return await nextFreeAddress(ctx, action.prefixId, action.after);
    case "nextFreePrefix":
      return await nextFreePrefix(ctx, action.parentId, action.length);
    case "saveVrf":
      return await saveVrf(ctx, action.vrf);
    case "saveSite":
      return await saveSite(ctx, action.site);
    case "saveVlan":
      return await saveVlan(ctx, action.vlan);
    case "savePrefix":
      return await savePrefix(ctx, action.prefix);
    case "saveAddress":
      return await saveAddress(ctx, action.address);
    case "delete":
      return await remove(ctx, action);
    case "reserveAddress":
      return await reserveAddress(ctx, action.reservation);
    case "releaseAddress":
      return await releaseAddress(ctx, action.addressId, action.note);
    case "createPrefix":
      return await createPrefix(ctx, action);
    case "splitPrefix":
      return await splitPrefix(ctx, action.prefixId, action.length);
    case "resolveFinding":
      return await resolveFinding(ctx, action.findingId, action.status);
    case "adoptFinding":
      return await adoptFinding(ctx, action.findingId);
    case "findingTicket":
      return await findingTicket(ctx, action.findingId);
    case "addressTicket":
      return await addressTicket(ctx, action);
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      let action: Action | RedesignAction;
      let redesign: RedesignAction | null = null;
      try {
        const body = await readBody(request);
        redesign = parseRedesignAction(body);
        action = redesign ?? parseAction(body);
      } catch (error) {
        if (error instanceof InputError) {
          return json(request, { error: { code: "invalid_request", message: error.message } }, 422);
        }
        throw error;
      }
      const admin = context.supabaseAdmin;
      const features = await resolveUserFeatureStates(admin, action.tenantId, actorId, [FEATURE]);
      if (features?.[FEATURE] !== true) {
        throw new HttpError(403, "feature_disabled", msg("Die IP-Adressverwaltung ist für dich nicht eingeschaltet.", "Die IP-Adressverwaltung ist für Sie nicht eingeschaltet."));
      }
      const access = await permissions(context.supabase, action.tenantId);
      if (!access.canRead) {
        throw new HttpError(403, "access_denied", msg("Für die IP-Adressverwaltung fehlt dir die Berechtigung.", "Für die IP-Adressverwaltung fehlt Ihnen die Berechtigung."));
      }
      const readOnly = redesign ? redesignIsRead(redesign) : READ_ACTIONS.has((action as Action).type);
      if (!readOnly && !access.canManage) {
        throw new HttpError(403, "manage_denied", "Änderungen erfordern die Berechtigung «IP-Adressen verwalten».");
      }
      const scope = await loadDepartmentScope(admin, action.tenantId, actorId, FEATURE);
      if (!scope) {
        throw new HttpError(503, "scope_failed", "Die Abteilungen konnten nicht geprüft werden.");
      }
      const ctx: Ctx = {
        request,
        admin,
        client: context.supabase,
        actorId,
        tenantId: action.tenantId,
        scope,
        canManage: access.canManage,
      };
      return redesign ? await dispatchRedesign(ctx, redesign) : await dispatch(ctx, action as Action);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      if (error instanceof InputError) {
        return json(request, { error: { code: "invalid_request", message: error.message } }, 422);
      }
      console.error("ipam_failed", error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
