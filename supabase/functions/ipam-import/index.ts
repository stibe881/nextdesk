import { msg } from "../_shared/formality.ts";
import { withSupabase } from "@supabase/server";
import { json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  type DepartmentScope,
  departmentVisible,
  loadDepartmentScope,
  resolveRecordDepartment,
  scopeDepartmentOptions,
} from "../_shared/department-scope.ts";
import {
  type AddressRow,
  changedFields,
  containingPrefix,
  type DeviceRow,
  type ImportOptions,
  type Kind,
  matchUplink,
  normalizeAddress,
  normalizeMac,
  parseRequest,
  type PrefixRow,
  type RowFailure,
  type SiteRow,
  validateRows,
  type VlanRow,
} from "./validate.ts";

/**
 * IPAM import. The web wizard parses the file (IP lists, switch and access
 * point lists, phpIPAM, NetBox, any table) and sends the normalized rows in
 * chunks of up to 500, one kind at a time (sites → VLANs → prefixes →
 * addresses → devices).
 *
 * - context: VRFs, departments in scope, whether devices may be created.
 * - preview: compares rows with the stored data (new / changed / unchanged).
 * - apply: idempotent upserts by natural key (site name; VLAN site+number;
 *   prefix VRF+CIDR; address VRF+IP; device serial, MAC or name), writes
 *   address history (kind «imported») and returns counts and row errors.
 *
 * Needs ipam.manage and the feature ipam.management; records of other
 * departments are not touched. Devices additionally need asset.manage and
 * the feature assets.management.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 1_500_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RowState = "new" | "changed" | "unchanged" | "skipped" | "error";
export type RowResult = {
  key: string;
  state: RowState;
  changes?: string[];
  message?: string;
};

type Context = {
  admin: Admin;
  tenantId: string;
  actorId: string;
  scope: DepartmentScope;
  options: ImportOptions;
  source: string;
  dryRun: boolean;
};

const dbFailure = () =>
  new HttpError(
    500,
    "database_error",
    "Die Daten konnten nicht verarbeitet werden.",
  );
const lower = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();
const ipCompare = (value: unknown) =>
  typeof value === "string" ? (normalizeAddress(value) ?? value) : value;
const macCompare = (value: unknown) =>
  typeof value === "string" ? (normalizeMac(value) ?? value) : value;

type Page = { data: unknown[] | null; error: unknown };
const IN_BATCH = 100;
const PAGE_SIZE = 1000;

/** All rows of a query, page by page (PostgREST returns at most 1000). */
async function selectAll(
  build: (from: number, to: number) => PromiseLike<Page>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw dbFailure();
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** Rows matching a list of values, in batches that keep the URL short. */
async function selectIn(
  values: string[],
  build: (batch: string[]) => PromiseLike<Page>,
): Promise<Row[]> {
  const unique = [...new Set(values)];
  const rows: Row[] = [];
  for (let index = 0; index < unique.length; index += IN_BATCH) {
    const { data, error } = await build(unique.slice(index, index + IN_BATCH));
    if (error) throw dbFailure();
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (
    body === null ||
    new TextEncoder().encode(body).length > MAX_REQUEST_BYTES
  ) {
    throw new HttpError(
      413,
      "payload_too_large",
      msg(
        "Die Anfrage ist zu gross. Sende höchstens 500 Zeilen auf einmal.",
        "Die Anfrage ist zu gross. Senden Sie höchstens 500 Zeilen auf einmal.",
      ),
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function hasPermission(
  client: Client,
  tenantId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  if (error)
    throw new HttpError(
      503,
      "permission_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  return data === true;
}

/** Stores and records; collects per-row results. */
class Results {
  readonly rows: RowResult[] = [];
  add(
    key: string,
    state: RowState,
    extra: { changes?: string[]; message?: string } = {},
  ) {
    this.rows.push({ key, state, ...extra });
  }
  counts() {
    const count = (state: RowState) =>
      this.rows.filter((row) => row.state === state).length;
    return {
      created: count("new"),
      updated: count("changed"),
      unchanged: count("unchanged"),
      skipped: count("skipped"),
      errors: count("error"),
    };
  }
}

/** Insert many rows; when the batch fails, retry one by one to find the bad ones. */
async function insertRows(
  admin: Admin,
  table: string,
  entries: { key: string; values: Row }[],
  results: Results,
  select = "id",
): Promise<Map<string, Row>> {
  const created = new Map<string, Row>();
  if (!entries.length) return created;
  // Änderungsprotokoll: Herkunft «import», Person aus created_by.
  entries = entries.map((entry) => ({
    ...entry,
    values: {
      ...entry.values,
      change_source: "import",
      change_actor: entry.values.created_by ?? null,
    },
  }));
  const bulk = await admin
    .from(table)
    .insert(entries.map((entry) => entry.values))
    .select(select);
  if (
    !bulk.error &&
    Array.isArray(bulk.data) &&
    bulk.data.length === entries.length
  ) {
    entries.forEach((entry, index) => {
      created.set(entry.key, bulk.data[index]);
      results.add(entry.key, "new");
    });
    return created;
  }
  for (const entry of entries) {
    const single = await admin
      .from(table)
      .insert(entry.values)
      .select(select)
      .single();
    if (single.error || !single.data) {
      results.add(entry.key, "error", {
        message:
          "Konnte nicht gespeichert werden (Wert ungültig oder bereits vorhanden).",
      });
    } else {
      created.set(entry.key, single.data);
      results.add(entry.key, "new");
    }
  }
  return created;
}

async function updateRow(
  ctx: Context,
  table: string,
  id: string,
  key: string,
  changes: Row,
  results: Results,
): Promise<boolean> {
  const fields = Object.keys(changes);
  if (!fields.length) {
    results.add(key, "unchanged");
    return false;
  }
  if (ctx.options.mode === "skip") {
    results.add(key, "skipped", {
      changes: fields,
      message: "Besteht bereits – übersprungen.",
    });
    return false;
  }
  if (ctx.dryRun) {
    results.add(key, "changed", { changes: fields });
    return false;
  }
  const { error } = await ctx.admin
    .from(table)
    .update({
      ...changes,
      updated_at: new Date().toISOString(),
      change_source: "import",
      change_actor: ctx.actorId,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) {
    results.add(key, "error", {
      message: "Die Änderung konnte nicht gespeichert werden.",
    });
    return false;
  }
  results.add(key, "changed", { changes: fields });
  return true;
}

function newDepartment(ctx: Context): string | null {
  const resolved = resolveRecordDepartment(ctx.scope, ctx.options.departmentId);
  if ("error" in resolved)
    throw new HttpError(422, "department_required", resolved.error);
  return resolved.departmentId;
}

// ------------------------------------------------------------------ lookups

async function loadSites(ctx: Context) {
  const data = await selectAll((from, to) =>
    ctx.admin
      .from("ipam_sites")
      .select("id, name, description, department_id")
      .eq("tenant_id", ctx.tenantId)
      .order("id")
      .range(from, to),
  );
  return new Map<string, Row>(
    data.map((row) => [lower(String(row.name)), row]),
  );
}

async function loadVlans(ctx: Context) {
  const data = await selectAll((from, to) =>
    ctx.admin
      .from("ipam_vlans")
      .select("id, site_id, vlan_number, name, description, department_id")
      .eq("tenant_id", ctx.tenantId)
      .order("id")
      .range(from, to),
  );
  return new Map<string, Row>(
    data.map((row) => [`${row.site_id ?? ""}:${row.vlan_number}`, row]),
  );
}

/** VRF name → id (target VRF for rows without a name); creates missing VRFs on apply. */
async function vrfResolver(ctx: Context) {
  const data = await selectAll((from, to) =>
    ctx.admin
      .from("ipam_vrfs")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .order("id")
      .range(from, to),
  );
  const byName = new Map<string, string>(
    data.map((row) => [lower(String(row.name)), String(row.id)]),
  );
  const ids = new Set(byName.values());
  if (ctx.options.vrfId && !ids.has(ctx.options.vrfId)) {
    throw new HttpError(
      422,
      "vrf_invalid",
      "Das gewählte VRF ist nicht verfügbar.",
    );
  }
  return async (
    name: string | null,
  ): Promise<{ id: string | null; pending: boolean }> => {
    if (!name) return { id: ctx.options.vrfId, pending: false };
    const known = byName.get(lower(name));
    if (known) return { id: known, pending: false };
    if (ctx.dryRun) return { id: `new:${lower(name)}`, pending: true };
    const created = await ctx.admin
      .from("ipam_vrfs")
      .upsert(
        { tenant_id: ctx.tenantId, name: name.trim() },
        { onConflict: "tenant_id,name" },
      )
      .select("id")
      .single();
    if (created.error || !created.data) throw dbFailure();
    byName.set(lower(name), String(created.data.id));
    return { id: String(created.data.id), pending: false };
  };
}

// ------------------------------------------------------------------ kinds

async function importSites(ctx: Context, rows: SiteRow[], results: Results) {
  const sites = await loadSites(ctx);
  const inserts: { key: string; values: Row }[] = [];
  for (const row of rows) {
    const existing = sites.get(lower(row.name));
    if (existing) {
      if (!departmentVisible(ctx.scope, existing.department_id)) {
        results.add(row.key, "error", {
          message: `Der Standort «${row.name}» gehört zu einer anderen Abteilung.`,
        });
        continue;
      }
      await updateRow(
        ctx,
        "ipam_sites",
        String(existing.id),
        row.key,
        changedFields(existing, { description: row.description }),
        results,
      );
      continue;
    }
    if (ctx.dryRun) {
      results.add(row.key, "new");
      continue;
    }
    inserts.push({
      key: row.key,
      values: {
        tenant_id: ctx.tenantId,
        department_id: newDepartment(ctx),
        name: row.name,
        description: row.description,
      },
    });
  }
  await insertRows(ctx.admin, "ipam_sites", inserts, results);
}

async function importVlans(ctx: Context, rows: VlanRow[], results: Results) {
  const [sites, vlans] = await Promise.all([loadSites(ctx), loadVlans(ctx)]);
  const inserts: { key: string; values: Row }[] = [];
  for (const row of rows) {
    const site = row.site ? sites.get(lower(row.site)) : null;
    if (row.site && !site) {
      if (ctx.dryRun) {
        results.add(row.key, "new", {
          message: `Standort «${row.site}» wird neu angelegt.`,
        });
      } else {
        results.add(row.key, "error", {
          message: `Standort «${row.site}» ist nicht vorhanden.`,
        });
      }
      continue;
    }
    if (site && !departmentVisible(ctx.scope, site.department_id)) {
      results.add(row.key, "error", {
        message: `Der Standort «${row.site}» gehört zu einer anderen Abteilung.`,
      });
      continue;
    }
    const existing = vlans.get(`${site?.id ?? ""}:${row.number}`);
    if (existing) {
      if (!departmentVisible(ctx.scope, existing.department_id)) {
        results.add(row.key, "error", {
          message: `VLAN ${row.number} gehört zu einer anderen Abteilung.`,
        });
        continue;
      }
      await updateRow(
        ctx,
        "ipam_vlans",
        String(existing.id),
        row.key,
        changedFields(existing, {
          name: row.name,
          description: row.description,
        }),
        results,
      );
      continue;
    }
    if (ctx.dryRun) {
      results.add(row.key, "new");
      continue;
    }
    inserts.push({
      key: row.key,
      values: {
        tenant_id: ctx.tenantId,
        department_id: newDepartment(ctx),
        site_id: site?.id ?? null,
        vlan_number: row.number,
        name: row.name,
        description: row.description,
      },
    });
  }
  await insertRows(ctx.admin, "ipam_vlans", inserts, results);
}

const PREFIX_SELECT =
  "id, vrf_id, prefix, status, security_zone, gateway, gateway_device, dhcp_helper, dhcp_start, dhcp_end, description, tags, custom_fields, site_id, vlan_id, department_id";

async function importPrefixes(
  ctx: Context,
  rows: PrefixRow[],
  results: Results,
) {
  const [sites, vlans, vrf] = await Promise.all([
    loadSites(ctx),
    loadVlans(ctx),
    vrfResolver(ctx),
  ]);
  const existingRows = await selectIn(
    rows.map((row) => row.prefix),
    (batch) =>
      ctx.admin
        .from("ipam_prefixes")
        .select(PREFIX_SELECT)
        .eq("tenant_id", ctx.tenantId)
        .in("prefix", batch),
  );
  const inserts: { key: string; values: Row }[] = [];
  for (const row of rows) {
    const { id: vrfId, pending } = await vrf(row.vrf);
    const site = row.site ? sites.get(lower(row.site)) : null;
    if (site && !departmentVisible(ctx.scope, site.department_id)) {
      results.add(row.key, "error", {
        message: `Der Standort «${row.site}» gehört zu einer anderen Abteilung.`,
      });
      continue;
    }
    const vlan =
      row.vlanNumber === null
        ? null
        : (vlans.get(`${site?.id ?? ""}:${row.vlanNumber}`) ??
          vlans.get(`:${row.vlanNumber}`) ??
          null);
    const notes: string[] = [];
    if (row.site && !site)
      notes.push(
        `Standort «${row.site}» ${ctx.dryRun ? "wird neu angelegt" : "fehlt – ohne Standort übernommen"}.`,
      );
    if (row.vlanNumber !== null && !vlan) {
      notes.push(
        `VLAN ${row.vlanNumber} ${ctx.dryRun ? "wird neu angelegt" : "fehlt – ohne VLAN übernommen"}.`,
      );
    }
    const values: Row = {
      status: row.status,
      security_zone: row.securityZone,
      gateway: row.gateway,
      gateway_device: row.gatewayDevice,
      dhcp_helper: row.dhcpHelper,
      dhcp_start: row.dhcpStart,
      dhcp_end: row.dhcpEnd,
      description: row.description,
      tags: row.tags,
      custom_fields: row.customFields,
      site_id: site?.id ?? null,
      vlan_id: vlan?.id ?? null,
    };
    const existing = pending
      ? undefined
      : existingRows.find(
          (entry) =>
            (entry.vrf_id ?? null) === vrfId &&
            String(entry.prefix) === row.prefix,
        );
    if (existing) {
      if (!departmentVisible(ctx.scope, existing.department_id)) {
        results.add(row.key, "error", {
          message: `${row.prefix} gehört zu einer anderen Abteilung.`,
        });
        continue;
      }
      const changes = changedFields(existing, values, {
        gateway: ipCompare,
        dhcp_start: ipCompare,
        dhcp_end: ipCompare,
      });
      // DHCP range is written as a pair.
      if ("dhcp_start" in changes || "dhcp_end" in changes) {
        changes.dhcp_start = row.dhcpStart;
        changes.dhcp_end = row.dhcpEnd;
      }
      await updateRow(
        ctx,
        "ipam_prefixes",
        String(existing.id),
        row.key,
        changes,
        results,
      );
      continue;
    }
    if (ctx.dryRun) {
      results.add(
        row.key,
        "new",
        notes.length ? { message: notes.join(" ") } : {},
      );
      continue;
    }
    inserts.push({
      key: row.key,
      values: {
        ...values,
        tenant_id: ctx.tenantId,
        vrf_id: vrfId,
        prefix: row.prefix,
        department_id: newDepartment(ctx),
        created_by: ctx.actorId,
      },
    });
  }
  await insertRows(ctx.admin, "ipam_prefixes", inserts, results);
}

const ADDRESS_SELECT =
  "id, vrf_id, address, status, hostname, dns_name, mac_address, device_type, description, switch_name, switch_port, tags, custom_fields";

async function importAddresses(
  ctx: Context,
  rows: AddressRow[],
  results: Results,
) {
  const vrf = await vrfResolver(ctx);
  const [existingRows, prefixRows] = await Promise.all([
    selectIn(
      rows.map((row) => row.address),
      (batch) =>
        ctx.admin
          .from("ipam_addresses")
          .select(ADDRESS_SELECT)
          .eq("tenant_id", ctx.tenantId)
          .in("address", batch),
    ),
    selectAll((from, to) =>
      ctx.admin
        .from("ipam_prefixes")
        .select("id, vrf_id, prefix, department_id")
        .eq("tenant_id", ctx.tenantId)
        .order("id")
        .range(from, to),
    ),
  ]);
  const prefixes = prefixRows.map((row) => ({
    prefix: String(row.prefix),
    vrf_id: (row.vrf_id ?? null) as string | null,
    department_id: row.department_id ?? null,
  }));
  const inserts: { key: string; values: Row; changes: string[] }[] = [];
  const events: Row[] = [];
  for (const row of rows) {
    const { id: vrfId, pending } = await vrf(row.vrf);
    const parent = containingPrefix(
      prefixes.filter((prefix) => (prefix.vrf_id ?? null) === vrfId),
      row.address,
    );
    if (parent && !departmentVisible(ctx.scope, parent.department_id)) {
      results.add(row.key, "error", {
        message: `${row.address} liegt in einem Subnetz einer anderen Abteilung.`,
      });
      continue;
    }
    const values: Row = {
      status: row.status,
      hostname: row.hostname,
      dns_name: row.dnsName,
      mac_address: row.macAddress,
      device_type: row.deviceType,
      description: row.description,
      switch_name: row.switchName,
      switch_port: row.switchPort,
      tags: row.tags,
      custom_fields: row.customFields,
    };
    const existing = pending
      ? undefined
      : existingRows.find(
          (entry) =>
            (entry.vrf_id ?? null) === vrfId &&
            normalizeAddress(entry.address) === row.address,
        );
    if (existing) {
      const changes = changedFields(existing, values, {
        mac_address: macCompare,
      });
      const written = await updateRow(
        ctx,
        "ipam_addresses",
        String(existing.id),
        row.key,
        changes,
        results,
      );
      if (written) {
        events.push({
          tenant_id: ctx.tenantId,
          address_id: existing.id,
          actor_id: ctx.actorId,
          kind: "imported",
          details: {
            source: ctx.source,
            action: "updated",
            changes: Object.keys(changes),
          },
        });
      }
      continue;
    }
    if (ctx.dryRun) {
      results.add(
        row.key,
        "new",
        parent ? {} : { message: "Liegt in keinem bestehenden Subnetz." },
      );
      continue;
    }
    inserts.push({
      key: row.key,
      changes: [],
      values: {
        ...values,
        tenant_id: ctx.tenantId,
        vrf_id: vrfId,
        address: row.address,
        created_by: ctx.actorId,
      },
    });
  }
  const created = await insertRows(
    ctx.admin,
    "ipam_addresses",
    inserts,
    results,
    "id",
  );
  for (const [, record] of created) {
    events.push({
      tenant_id: ctx.tenantId,
      address_id: record.id,
      actor_id: ctx.actorId,
      kind: "imported",
      details: { source: ctx.source, action: "created" },
    });
  }
  if (events.length) {
    const { error } = await ctx.admin
      .from("ipam_address_events")
      .insert(events);
    if (error) console.error("ipam_import_events_failed", error.code);
  }
}

async function importDevices(
  ctx: Context,
  rows: DeviceRow[],
  results: Results,
) {
  const ASSET_SELECT =
    "id, name, serial_number, manufacturer, model, location_id, department_id";
  const [infra, locationRows] = await Promise.all([
    selectAll((from, to) =>
      ctx.admin
        .from("asset_infrastructure")
        .select(
          "asset_id, category, hostname, ip_address, mac_address, uplink_asset_id, uplink_port, notes",
        )
        .eq("tenant_id", ctx.tenantId)
        .order("asset_id")
        .range(from, to),
    ),
    selectAll((from, to) =>
      ctx.admin
        .from("asset_locations")
        .select("id, name")
        .eq("tenant_id", ctx.tenantId)
        .order("id")
        .range(from, to),
    ),
  ]);
  const infraIds = infra.map((row) => String(row.asset_id));
  const serials = rows
    .map((row) => row.serialNumber)
    .filter((serial): serial is string => !!serial);
  const [infraAssets, serialAssets] = await Promise.all([
    selectIn(infraIds, (batch) =>
      ctx.admin
        .from("assets")
        .select(ASSET_SELECT)
        .eq("tenant_id", ctx.tenantId)
        .in("id", batch),
    ),
    selectIn(serials, (batch) =>
      ctx.admin
        .from("assets")
        .select(ASSET_SELECT)
        .eq("tenant_id", ctx.tenantId)
        .in("serial_number", batch),
    ),
  ]);
  const assets = new Map<string, Row>();
  for (const row of [...infraAssets, ...serialAssets])
    assets.set(String(row.id), row);
  const infraById = new Map<string, Row>(
    infra.map((row) => [String(row.asset_id), row]),
  );
  const locations = new Map<string, string>(
    locationRows.map((row) => [lower(String(row.name)), String(row.id)]),
  );
  // Names of infrastructure devices for uplink matching (grows while importing).
  const names = new Map<string, string>();
  for (const id of infraIds) {
    const asset = assets.get(id);
    if (asset) names.set(lower(String(asset.name)), id);
    const hostname = infraById.get(id)?.hostname;
    if (typeof hostname === "string") names.set(lower(hostname), id);
  }

  const findExisting = (row: DeviceRow): Row | null => {
    if (row.serialNumber) {
      const match = [...assets.values()].find(
        (asset) =>
          lower(String(asset.serial_number ?? "")) === lower(row.serialNumber),
      );
      if (match) return match;
    }
    if (row.macAddress) {
      const match = infra.find(
        (entry) => normalizeMac(entry.mac_address) === row.macAddress,
      );
      if (match) return assets.get(String(match.asset_id)) ?? null;
    }
    const byName = infra.find(
      (entry) =>
        entry.category === row.category &&
        lower(String(assets.get(String(entry.asset_id))?.name ?? "")) ===
          lower(row.name),
    );
    return byName ? (assets.get(String(byName.asset_id)) ?? null) : null;
  };

  const locationId = async (name: string | null): Promise<string | null> => {
    if (!name) return null;
    const known = locations.get(lower(name));
    if (known) return known;
    if (!ctx.options.createLocations || ctx.dryRun) return null;
    const created = await ctx.admin
      .from("asset_locations")
      .upsert(
        { tenant_id: ctx.tenantId, name: name.trim(), active: true },
        { onConflict: "tenant_id,name" },
      )
      .select("id")
      .single();
    if (created.error || !created.data) return null;
    locations.set(lower(name), String(created.data.id));
    return String(created.data.id);
  };

  const pendingUplinks: { assetId: string; uplink: string }[] = [];
  const linkAddresses: { assetId: string; address: string }[] = [];
  for (const row of rows) {
    const existing = findExisting(row);
    if (existing && !departmentVisible(ctx.scope, existing.department_id)) {
      results.add(row.key, "error", {
        message: `Gerät «${row.name}» gehört zu einer anderen Abteilung.`,
      });
      continue;
    }
    const location = await locationId(row.location);
    const assetValues: Row = {
      name: row.name,
      serial_number: row.serialNumber,
      manufacturer: row.manufacturer,
      model: row.model,
      location_id: location,
    };
    const infraValues: Row = {
      hostname: row.hostname,
      ip_address: row.ipAddress,
      mac_address: row.macAddress,
      uplink_port: row.uplinkPort,
      notes: row.notes,
    };
    if (existing) {
      const assetId = String(existing.id);
      const current = infraById.get(assetId) ?? {};
      const assetChanges = changedFields(existing, assetValues);
      const infraChanges = changedFields(current, infraValues, {
        mac_address: macCompare,
        ip_address: ipCompare,
      });
      if (!infraById.has(assetId)) infraChanges.category = row.category;
      const fields = [
        ...Object.keys(assetChanges),
        ...Object.keys(infraChanges),
      ];
      if (!fields.length) {
        results.add(row.key, "unchanged");
      } else if (ctx.options.mode === "skip") {
        results.add(row.key, "skipped", {
          changes: fields,
          message: "Besteht bereits – übersprungen.",
        });
      } else if (ctx.dryRun) {
        results.add(row.key, "changed", { changes: fields });
      } else {
        const now = new Date().toISOString();
        const assetUpdate = Object.keys(assetChanges).length
          ? await ctx.admin
              .from("assets")
              .update(assetChanges)
              .eq("tenant_id", ctx.tenantId)
              .eq("id", assetId)
          : { error: null };
        const infraUpdate = await ctx.admin.from("asset_infrastructure").upsert(
          {
            ...current,
            ...infraChanges,
            asset_id: assetId,
            tenant_id: ctx.tenantId,
            category: current.category ?? row.category,
            updated_at: now,
          },
          { onConflict: "asset_id" },
        );
        if (assetUpdate.error || infraUpdate.error) {
          results.add(row.key, "error", {
            message:
              "Das Gerät konnte nicht aktualisiert werden (Seriennummer bereits vergeben?).",
          });
          continue;
        }
        results.add(row.key, "changed", { changes: fields });
      }
      if (!ctx.dryRun && row.uplink && !current.uplink_asset_id)
        pendingUplinks.push({ assetId, uplink: row.uplink });
      if (!ctx.dryRun && row.ipAddress)
        linkAddresses.push({ assetId, address: row.ipAddress });
      continue;
    }
    if (ctx.dryRun) {
      results.add(row.key, "new");
      continue;
    }
    const insertedAsset = await ctx.admin
      .from("assets")
      .insert({
        ...assetValues,
        tenant_id: ctx.tenantId,
        kind: row.category,
        lifecycle_state: row.lifecycleState,
        lifecycle_changed_at: new Date().toISOString(),
        ...(ctx.options.departmentId
          ? { department_id: ctx.options.departmentId }
          : {}),
      })
      .select(
        "id, name, serial_number, manufacturer, model, location_id, department_id",
      )
      .single();
    if (insertedAsset.error || !insertedAsset.data) {
      results.add(row.key, "error", {
        message:
          "Das Gerät konnte nicht angelegt werden (Seriennummer bereits vergeben?).",
      });
      continue;
    }
    const assetId = String(insertedAsset.data.id);
    const insertedInfra = await ctx.admin.from("asset_infrastructure").insert({
      ...infraValues,
      asset_id: assetId,
      tenant_id: ctx.tenantId,
      category: row.category,
    });
    if (insertedInfra.error) {
      results.add(row.key, "error", {
        message:
          "Die Netzwerkdaten des Geräts konnten nicht gespeichert werden.",
      });
      continue;
    }
    await ctx.admin
      .from("asset_lifecycle_events")
      .update({ actor_id: ctx.actorId, reason: "Import IP-Adressverwaltung" })
      .eq("tenant_id", ctx.tenantId)
      .eq("asset_id", assetId)
      .is("actor_id", null);
    assets.set(assetId, insertedAsset.data);
    infra.push({
      asset_id: assetId,
      category: row.category,
      mac_address: row.macAddress,
      hostname: row.hostname,
    });
    infraById.set(assetId, infra[infra.length - 1]!);
    names.set(lower(row.name), assetId);
    if (row.hostname) names.set(lower(row.hostname), assetId);
    results.add(row.key, "new");
    if (row.uplink) pendingUplinks.push({ assetId, uplink: row.uplink });
    if (row.ipAddress) linkAddresses.push({ assetId, address: row.ipAddress });
  }
  // Uplinks after all devices of the chunk exist (switches before APs).
  for (const { assetId, uplink } of pendingUplinks) {
    const uplinkId = matchUplink(uplink, names);
    if (!uplinkId || uplinkId === assetId) continue;
    await ctx.admin
      .from("asset_infrastructure")
      .update({ uplink_asset_id: uplinkId })
      .eq("tenant_id", ctx.tenantId)
      .eq("asset_id", assetId)
      .is("uplink_asset_id", null);
  }
  // Link IPAM addresses of the target VRF to the device.
  for (const { assetId, address } of linkAddresses) {
    let query = ctx.admin
      .from("ipam_addresses")
      .update({ asset_id: assetId })
      .eq("tenant_id", ctx.tenantId)
      .eq("address", address)
      .is("asset_id", null);
    query = ctx.options.vrfId
      ? query.eq("vrf_id", ctx.options.vrfId)
      : query.is("vrf_id", null);
    const { data } = await query.select("id");
    for (const linked of (data ?? []) as Row[]) {
      await ctx.admin.from("ipam_address_events").insert({
        tenant_id: ctx.tenantId,
        address_id: linked.id,
        actor_id: ctx.actorId,
        kind: "linked",
        details: { source: ctx.source, asset_id: assetId },
      });
    }
  }
}

async function runKind(ctx: Context, kind: Kind, rows: unknown[]) {
  const results = new Results();
  const { valid, failures } = validateRows(kind, rows);
  failures.forEach((failure: RowFailure) =>
    results.add(failure.key, "error", { message: failure.message }),
  );
  if (valid.length) {
    switch (kind) {
      case "sites":
        await importSites(ctx, valid as SiteRow[], results);
        break;
      case "vlans":
        await importVlans(ctx, valid as VlanRow[], results);
        break;
      case "prefixes":
        await importPrefixes(ctx, valid as PrefixRow[], results);
        break;
      case "addresses":
        await importAddresses(ctx, valid as AddressRow[], results);
        break;
      case "devices":
        await importDevices(ctx, valid as DeviceRow[], results);
        break;
    }
  }
  return results;
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST")
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (typeof actorId !== "string")
        return json(request, { error: { code: "unauthorized" } }, 401);
      const action = parseRequest(await readBody(request));
      if (!action) {
        throw new HttpError(
          422,
          "invalid_request",
          "Die Angaben sind unvollständig oder ungültig.",
        );
      }
      const admin = context.supabaseAdmin;
      const features = await resolveUserFeatureStates(
        admin,
        action.tenantId,
        actorId,
        ["ipam.management", "assets.management"],
      );
      if (features?.["ipam.management"] !== true) {
        throw new HttpError(
          403,
          "feature_disabled",
          msg(
            "Die IP-Adressverwaltung ist für dich nicht eingeschaltet.",
            "Die IP-Adressverwaltung ist für Sie nicht eingeschaltet.",
          ),
        );
      }
      if (
        !(await hasPermission(context.supabase, action.tenantId, "ipam.manage"))
      ) {
        throw new HttpError(
          403,
          "manage_denied",
          msg(
            "Für den Import fehlt dir die Berechtigung zur IP-Adressverwaltung.",
            "Für den Import fehlt Ihnen die Berechtigung zur IP-Adressverwaltung.",
          ),
        );
      }
      const scope = await loadDepartmentScope(
        admin,
        action.tenantId,
        actorId,
        "ipam.management",
      );
      if (!scope)
        throw new HttpError(
          503,
          "scope_failed",
          "Die Abteilungen konnten nicht geprüft werden.",
        );
      const canManageAssets =
        features?.["assets.management"] === true &&
        (await hasPermission(
          context.supabase,
          action.tenantId,
          "asset.manage",
        ));

      if (action.type === "context") {
        const [vrfs, departments] = await Promise.all([
          admin
            .from("ipam_vrfs")
            .select("id, name")
            .eq("tenant_id", action.tenantId)
            .order("name"),
          scopeDepartmentOptions(admin, action.tenantId, scope),
        ]);
        if (vrfs.error) throw dbFailure();
        return json(request, {
          data: { vrfs: vrfs.data ?? [], departments, canManageAssets },
        });
      }
      if (action.kind === "devices" && !canManageAssets) {
        throw new HttpError(
          403,
          "asset_manage_denied",
          "Geräte dürfen nur mit der Berechtigung zur Asset-Verwaltung angelegt werden.",
        );
      }
      if (
        action.options.departmentId &&
        !scope.departments.includes(action.options.departmentId)
      ) {
        throw new HttpError(
          422,
          "department_invalid",
          "Die Abteilung ist ungültig.",
        );
      }
      const ctx: Context = {
        admin,
        tenantId: action.tenantId,
        actorId,
        scope,
        options: action.options,
        source: action.source,
        dryRun: action.type === "preview",
      };
      const results = await runKind(ctx, action.kind, action.rows);
      const counts = results.counts();
      if (!ctx.dryRun && counts.created + counts.updated > 0) {
        await admin.from("audit_logs").insert({
          tenant_id: action.tenantId,
          actor_id: actorId,
          action: "ipam.import.applied",
          entity_type: "ipam_import",
          entity_id: null,
          severity: "info",
          metadata: { kind: action.kind, source: action.source, ...counts },
        });
      }
      return json(request, {
        data: { kind: action.kind, counts, results: results.rows },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("ipam_import_failed", error);
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
