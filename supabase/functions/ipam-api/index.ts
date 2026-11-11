import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import { verifyDispatchSecret } from "../_shared/monitoring-admin.ts";
import {
  deliverDueWebhooks,
  normalizeMac,
  refreshIntuneDevices,
  sha256Hex,
} from "../_shared/ipam-integrations.ts";
import {
  addressOut,
  API_VERSION,
  extractApiKey,
  isCidr,
  isIpAddress,
  MAX_BODY_BYTES,
  matchRoute,
  type Pagination,
  paginationOut,
  parseAddressPatch,
  parseNextPrefixBody,
  parsePagination,
  parseReserveBody,
  parseVrf,
  plainAddress,
  prefixOut,
  RATE_LIMIT_PER_MINUTE,
  requiredScope,
  reserveError,
  type Route,
  vlanOut,
} from "./logic.ts";

/**
 * IPAM-REST-API (verify_jwt = false). Authentifizierung mit einem
 * Mandanten-API-Schlüssel («Authorization: Bearer ndk_ipam_…» oder
 * «X-API-Key»), Bereiche read/write, 120 Anfragen pro Minute und Schlüssel.
 * Schreibende Aufrufe landen im Audit-Log und im Adressverlauf.
 *
 * Zusätzlich weckt der Cron die Funktion mit dem Dispatch-Geheimnis
 * (x-nextdesk-dispatch-secret): Webhook-Zustellung (jede Minute, mit
 * Wiederholungen) und der tägliche Intune-Abzug (MAC-Adressen).
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;
type ApiKey = {
  id: string;
  tenant_id: string;
  key_prefix: string;
  scopes: string[];
  created_by: string | null;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: HeadersInit = {},
  ) {
    super(message);
  }
}

const ADDRESS_COLUMNS =
  "id, address, vrf_id, prefix_id, status, hostname, dns_name, mac_address, vendor, device_type, description, switch_name, switch_port, asset_id, reserved_until, last_seen_at, last_seen_source, tags, custom_fields, created_at, updated_at";
const PREFIX_COLUMNS =
  "id, prefix, vrf_id, status, description, site_id, vlan_id, gateway, dhcp_start, dhcp_end, security_zone, tags, department_id, created_at, updated_at";

const dbFailure = () =>
  new ApiError(
    500,
    "database_error",
    "Die Daten konnten nicht verarbeitet werden.",
  );

function respond(
  status: number,
  body: Row | null,
  headers: HeadersInit = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-NextDesk-Api-Version": API_VERSION,
      ...headers,
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (text === null || new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError(
      413,
      "payload_too_large",
      "Der Body ist zu gross (max. 16 KB).",
    );
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Der Body ist kein gültiges JSON.");
  }
}

function pageOrFail(url: URL): Pagination {
  const page = parsePagination(url.searchParams);
  if (!page)
    throw new ApiError(
      400,
      "invalid_pagination",
      "limit (1–500) oder offset ist ungültig.",
    );
  return page;
}

async function authenticate(admin: Admin, request: Request): Promise<ApiKey> {
  const key = extractApiKey(request.headers);
  if (!key) {
    throw new ApiError(
      401,
      "unauthorized",
      "API-Schlüssel fehlt oder ist ungültig.",
      {
        "WWW-Authenticate": 'Bearer realm="nextDesk IPAM"',
      },
    );
  }
  const { data, error } = await admin
    .from("ipam_api_keys")
    .select("id, tenant_id, key_prefix, scopes, created_by, revoked_at")
    .eq("key_hash", await sha256Hex(key))
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data || data.revoked_at) {
    throw new ApiError(
      401,
      "unauthorized",
      "API-Schlüssel fehlt oder ist ungültig.",
      {
        "WWW-Authenticate": 'Bearer realm="nextDesk IPAM"',
      },
    );
  }
  const features = await resolveTenantFeatureStates(admin, data.tenant_id, [
    "ipam.management",
  ]);
  if (features?.["ipam.management"] !== true) {
    throw new ApiError(
      403,
      "feature_disabled",
      "Die IP-Adressverwaltung ist für diesen Mandanten nicht eingeschaltet.",
    );
  }
  const allowed = await admin.rpc("ipam_api_consume", {
    p_key_id: data.id,
    p_limit: RATE_LIMIT_PER_MINUTE,
  });
  if (allowed.error) throw dbFailure();
  if (allowed.data !== true) {
    const retry = 60 - new Date().getUTCSeconds();
    throw new ApiError(
      429,
      "rate_limited",
      `Zu viele Anfragen. Bitte in ${retry} Sekunden erneut versuchen.`,
      {
        "Retry-After": String(retry),
      },
    );
  }
  return data as ApiKey;
}

async function audit(
  admin: Admin,
  key: ApiKey,
  action: string,
  entityType: string,
  entityId: unknown,
  metadata: Row,
) {
  await admin.from("audit_logs").insert({
    tenant_id: key.tenant_id,
    actor_id: key.created_by,
    action,
    entity_type: entityType,
    entity_id: typeof entityId === "string" ? entityId : null,
    metadata: {
      ...metadata,
      api_key_id: key.id,
      api_key_prefix: key.key_prefix,
      source: "ipam-api",
    },
  });
}

async function usageMap(
  admin: Admin,
  tenantId: string,
): Promise<Map<string, Row>> {
  const { data, error } = await admin.rpc("ipam_prefix_usage", {
    p_tenant_id: tenantId,
  });
  if (error) throw dbFailure();
  return new Map(
    ((data ?? []) as Row[]).map((row) => [String(row.prefix_id), row]),
  );
}

async function loadPrefix(
  admin: Admin,
  tenantId: string,
  prefixId: string,
): Promise<Row> {
  const { data, error } = await admin
    .from("ipam_prefixes")
    .select(PREFIX_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", prefixId)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data)
    throw new ApiError(404, "prefix_not_found", "Das Subnetz existiert nicht.");
  return data;
}

async function loadAddress(
  admin: Admin,
  tenantId: string,
  address: string,
  url: URL,
): Promise<Row> {
  const vrf = parseVrf(url.searchParams);
  if (!vrf)
    throw new ApiError(
      400,
      "invalid_vrf",
      "vrf muss «global» oder eine VRF-ID sein.",
    );
  let query = admin
    .from("ipam_addresses")
    .select(ADDRESS_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("address", address);
  query = vrf.vrfId ? query.eq("vrf_id", vrf.vrfId) : query.is("vrf_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw dbFailure();
  if (!data)
    throw new ApiError(
      404,
      "address_not_found",
      "Die Adresse ist nicht dokumentiert.",
    );
  return data;
}

// ---------------------------------------------------------------- Routen

async function listPrefixes(
  admin: Admin,
  key: ApiKey,
  url: URL,
): Promise<Response> {
  const page = pageOrFail(url);
  let query = admin
    .from("ipam_prefixes")
    .select(PREFIX_COLUMNS, { count: "exact" })
    .eq("tenant_id", key.tenant_id);
  const vrf = url.searchParams.get("vrf");
  if (vrf !== null) {
    const parsed = parseVrf(url.searchParams);
    if (!parsed)
      throw new ApiError(
        400,
        "invalid_vrf",
        "vrf muss «global» oder eine VRF-ID sein.",
      );
    query = parsed.vrfId
      ? query.eq("vrf_id", parsed.vrfId)
      : query.is("vrf_id", null);
  }
  for (const field of ["status", "site_id", "vlan_id"]) {
    const value = url.searchParams.get(field);
    if (value !== null) {
      if (!/^[\w-]{1,40}$/.test(value))
        throw new ApiError(
          400,
          "invalid_filter",
          `Filter ${field} ist ungültig.`,
        );
      query = query.eq(field, value);
    }
  }
  const { data, error, count } = await query
    .order("prefix")
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw dbFailure();
  const usage = await usageMap(admin, key.tenant_id);
  const rows = (data ?? []) as Row[];
  return respond(200, {
    data: rows.map((row) => prefixOut(row, usage.get(String(row.id)))),
    pagination: paginationOut(page, count ?? null, rows.length),
  });
}

async function prefixAddresses(
  admin: Admin,
  key: ApiKey,
  route: Route,
  url: URL,
): Promise<Response> {
  const page = pageOrFail(url);
  await loadPrefix(admin, key.tenant_id, route.prefixId!);
  let query = admin
    .from("ipam_addresses")
    .select(ADDRESS_COLUMNS, { count: "exact" })
    .eq("tenant_id", key.tenant_id)
    .eq("prefix_id", route.prefixId);
  const status = url.searchParams.get("status");
  if (status !== null) {
    if (!/^[a-z]{1,20}$/.test(status))
      throw new ApiError(400, "invalid_filter", "Filter status ist ungültig.");
    query = query.eq("status", status);
  }
  const { data, error, count } = await query
    .order("address")
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  return respond(200, {
    data: rows.map(addressOut),
    pagination: paginationOut(page, count ?? null, rows.length),
  });
}

async function nextAddress(
  admin: Admin,
  key: ApiKey,
  route: Route,
  request: Request,
): Promise<Response> {
  const input = parseReserveBody(await readJson(request));
  if (!input.ok) throw new ApiError(422, "invalid_request", input.message);
  const { data, error } = await admin.rpc("ipam_reserve_address", {
    p_tenant_id: key.tenant_id,
    p_prefix_id: route.prefixId,
    p_address: null,
    p_hostname: input.value.hostname,
    p_description: input.value.description,
    p_mac: input.value.mac,
    p_dns_name: input.value.dnsName,
    p_actor_id: null,
    p_source: "api",
  });
  if (error) {
    const mapped = reserveError(error.code);
    throw new ApiError(mapped.status, mapped.code, mapped.message);
  }
  const reserved = data as Row;
  const { data: row, error: loadError } = await admin
    .from("ipam_addresses")
    .select(ADDRESS_COLUMNS)
    .eq("tenant_id", key.tenant_id)
    .eq("id", reserved.id)
    .single();
  if (loadError) throw dbFailure();
  await audit(
    admin,
    key,
    "ipam.api.address_reserved",
    "ipam_address",
    reserved.id,
    {
      address: reserved.address,
      prefix_id: route.prefixId,
    },
  );
  return respond(201, { data: addressOut(row) });
}

async function nextPrefix(
  admin: Admin,
  key: ApiKey,
  route: Route,
  request: Request,
): Promise<Response> {
  const input = parseNextPrefixBody(await readJson(request));
  if (!input.ok) throw new ApiError(422, "invalid_request", input.message);
  const parent = await loadPrefix(admin, key.tenant_id, route.prefixId!);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const free = await admin.rpc("ipam_next_free_prefix", {
      p_tenant_id: key.tenant_id,
      p_parent_id: route.prefixId,
      p_length: input.value.length,
    });
    if (free.error) {
      const mapped = reserveError(free.error.code);
      throw new ApiError(
        mapped.status,
        mapped.code === "invalid_request" ? "invalid_length" : mapped.code,
        mapped.code === "invalid_request"
          ? "Die Präfixlänge passt nicht zum Subnetz."
          : mapped.message,
      );
    }
    if (typeof free.data !== "string") {
      throw new ApiError(
        409,
        "no_free_prefix",
        "Im Subnetz ist kein Bereich dieser Grösse mehr frei.",
      );
    }
    const { data, error } = await admin
      .from("ipam_prefixes")
      .insert({
        tenant_id: key.tenant_id,
        vrf_id: parent.vrf_id ?? null,
        site_id: parent.site_id ?? null,
        department_id: parent.department_id ?? null,
        prefix: free.data,
        status: input.value.status,
        description: input.value.description,
        change_source: "api",
      })
      .select(PREFIX_COLUMNS)
      .single();
    if (error?.code === "23505") continue;
    if (error) throw dbFailure();
    await audit(admin, key, "ipam.api.prefix_created", "ipam_prefix", data.id, {
      prefix: data.prefix,
      parent_id: route.prefixId,
    });
    return respond(201, {
      data: prefixOut(
        data,
        (await usageMap(admin, key.tenant_id)).get(String(data.id)),
      ),
    });
  }
  throw new ApiError(
    409,
    "conflict",
    "Das Subnetz wurde gleichzeitig vergeben. Bitte erneut versuchen.",
  );
}

async function updateAddress(
  admin: Admin,
  key: ApiKey,
  route: Route,
  request: Request,
  url: URL,
) {
  const input = parseAddressPatch(await readJson(request));
  if (!input.ok) throw new ApiError(422, "invalid_request", input.message);
  const current = await loadAddress(admin, key.tenant_id, route.address!, url);
  const { data, error } = await admin
    .from("ipam_addresses")
    .update({ ...input.value, change_source: "api" })
    .eq("tenant_id", key.tenant_id)
    .eq("id", current.id)
    .select(ADDRESS_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23514" || error.code === "22P02") {
      throw new ApiError(
        422,
        "invalid_request",
        "Die Werte sind für diese Adresse nicht zulässig.",
      );
    }
    throw dbFailure();
  }
  const changed = Object.keys(input.value);
  await admin.from("ipam_address_events").insert({
    tenant_id: key.tenant_id,
    address_id: current.id,
    actor_id: null,
    kind:
      changed.length === 1 && changed[0] === "status" ? "status" : "updated",
    details: { source: "api", api_key_prefix: key.key_prefix, fields: changed },
  });
  await audit(
    admin,
    key,
    "ipam.api.address_updated",
    "ipam_address",
    current.id,
    {
      address: plainAddress(current.address),
      fields: changed,
    },
  );
  return respond(200, { data: addressOut(data) });
}

async function releaseAddress(
  admin: Admin,
  key: ApiKey,
  route: Route,
  url: URL,
): Promise<Response> {
  const current = await loadAddress(admin, key.tenant_id, route.address!, url);
  const { error } = await admin
    .from("ipam_addresses")
    .delete()
    .eq("tenant_id", key.tenant_id)
    .eq("id", current.id);
  if (error) throw dbFailure();
  await audit(
    admin,
    key,
    "ipam.api.address_released",
    "ipam_address",
    current.id,
    {
      address: plainAddress(current.address),
      hostname: current.hostname ?? null,
    },
  );
  return respond(200, {
    data: {
      released: true,
      address: plainAddress(current.address),
      id: current.id,
    },
  });
}

async function listVlans(
  admin: Admin,
  key: ApiKey,
  url: URL,
): Promise<Response> {
  const page = pageOrFail(url);
  let query = admin
    .from("ipam_vlans")
    .select(
      "id, vlan_number, name, description, site_id, created_at, updated_at",
      {
        count: "exact",
      },
    )
    .eq("tenant_id", key.tenant_id);
  const site = url.searchParams.get("site_id");
  if (site !== null) {
    if (!/^[0-9a-f-]{36}$/i.test(site))
      throw new ApiError(400, "invalid_filter", "Filter site_id ist ungültig.");
    query = query.eq("site_id", site);
  }
  const { data, error, count } = await query
    .order("vlan_number")
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  return respond(200, {
    data: rows.map(vlanOut),
    pagination: paginationOut(page, count ?? null, rows.length),
  });
}

async function search(admin: Admin, key: ApiKey, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 100 || /[\u0000-\u001f]/.test(q)) {
    throw new ApiError(
      400,
      "invalid_query",
      "q muss 2 bis 100 Zeichen lang sein.",
    );
  }
  const mac = normalizeMac(q);
  const ip = isIpAddress(q) || isCidr(q);
  const safe = q.replace(/[,()*%_\\"'`;]/g, " ").trim();
  const lookup = await admin.rpc("ipam_network_lookup", {
    p_tenant_id: key.tenant_id,
    p_ips: ip ? [q] : [],
    p_macs: mac ? [mac] : [],
    p_hostnames: !ip && !mac && /^[\w.-]+$/.test(q) ? [q] : [],
    p_asset_id: null,
  });
  if (lookup.error) throw dbFailure();
  const found = (lookup.data ?? {}) as Row;
  const strip = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as Row[]) : []).map(
      ({ department_id: _d, findings: _f, ...rest }) => rest,
    );
  let addresses = strip(found.addresses);
  if (!ip && !mac && safe) {
    const partial = await admin
      .from("ipam_addresses")
      .select(ADDRESS_COLUMNS)
      .eq("tenant_id", key.tenant_id)
      .or(
        `hostname.ilike.*${safe}*,dns_name.ilike.*${safe}*,description.ilike.*${safe}*`,
      )
      .order("address")
      .limit(50);
    if (partial.error) throw dbFailure();
    const known = new Set(addresses.map((entry) => String(entry.id)));
    addresses = [
      ...addresses,
      ...((partial.data ?? []) as Row[])
        .filter((row) => !known.has(String(row.id)))
        .map(addressOut),
    ].slice(0, 50);
  }
  let vlans: Row[] = [];
  if (!ip && !mac && safe) {
    const vlanQuery = /^\d{1,4}$/.test(q)
      ? admin
          .from("ipam_vlans")
          .select("id, vlan_number, name, description, site_id")
          .eq("tenant_id", key.tenant_id)
          .eq("vlan_number", Number(q))
      : admin
          .from("ipam_vlans")
          .select("id, vlan_number, name, description, site_id")
          .eq("tenant_id", key.tenant_id)
          .ilike("name", `%${safe}%`);
    const result = await vlanQuery.limit(50);
    if (result.error) throw dbFailure();
    vlans = ((result.data ?? []) as Row[]).map(vlanOut);
  }
  return respond(200, {
    data: { addresses, prefixes: strip(found.prefixes), vlans },
  });
}

async function route(admin: Admin, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const match = matchRoute(request.method, url.pathname);
  if ("status" in match) {
    return match.status === 405
      ? respond(
          405,
          {
            error: {
              code: "method_not_allowed",
              message: "Methode nicht erlaubt.",
            },
          },
          {
            Allow: match.allow ?? "",
          },
        )
      : respond(404, {
          error: {
            code: "not_found",
            message: "Diesen Endpunkt gibt es nicht.",
          },
        });
  }
  const key = await authenticate(admin, request);
  if (
    requiredScope(match.route.name) === "write" &&
    !key.scopes.includes("write")
  ) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Der API-Schlüssel darf nur lesen.",
    );
  }
  switch (match.route.name) {
    case "info":
      return respond(200, {
        data: {
          name: "nextDesk IPAM API",
          version: API_VERSION,
          scopes: key.scopes,
          rate_limit_per_minute: RATE_LIMIT_PER_MINUTE,
        },
      });
    case "listPrefixes":
      return await listPrefixes(admin, key, url);
    case "prefixAddresses":
      return await prefixAddresses(admin, key, match.route, url);
    case "nextAddress":
      return await nextAddress(admin, key, match.route, request);
    case "nextPrefix":
      return await nextPrefix(admin, key, match.route, request);
    case "getAddress":
      return respond(200, {
        data: addressOut(
          await loadAddress(admin, key.tenant_id, match.route.address!, url),
        ),
      });
    case "updateAddress":
      return await updateAddress(admin, key, match.route, request, url);
    case "releaseAddress":
      return await releaseAddress(admin, key, match.route, url);
    case "listVlans":
      return await listVlans(admin, key, url);
    case "search":
      return await search(admin, key, url);
  }
}

const apiHandler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      return await route(context.supabaseAdmin, request);
    } catch (error) {
      if (error instanceof ApiError) {
        return respond(
          error.status,
          { error: { code: error.code, message: error.message } },
          error.headers,
        );
      }
      console.error(
        "ipam_api_failed",
        error instanceof Error ? error.message : "",
      );
      return respond(500, {
        error: { code: "internal_error", message: "Interner Fehler." },
      });
    }
  },
);

// ---------------------------------------------------------------- Cron

async function intuneRefreshAll(admin: Admin): Promise<Row> {
  const { data, error } = await admin
    .from("asset_intune_connections")
    .select("tenant_id")
    .eq("enabled", true)
    .not("directory_tenant_id", "is", null)
    .limit(500);
  if (error) return { tenants: 0 };
  let refreshed = 0;
  for (const row of (data ?? []) as Row[]) {
    const tenantId = String(row.tenant_id);
    const features = await resolveTenantFeatureStates(admin, tenantId, [
      "ipam.management",
    ]);
    if (features?.["ipam.management"] !== true) continue;
    const result = await refreshIntuneDevices(admin, tenantId, null, "cron");
    if (result.status === "ok") {
      await admin.rpc("ipam_reconcile_intune", {
        p_tenant_id: tenantId,
        p_actor_id: null,
        p_trigger: "cron",
      });
      refreshed += 1;
    }
  }
  return { tenants: refreshed };
}

const cronHandler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const admin = context.supabaseAdmin;
    if (!(await verifyDispatchSecret(admin, request)))
      return new Response(null, { status: 401 });
    try {
      const body = (await request.json().catch(() => ({}))) as Row;
      if (body.job === "intune") {
        return respond(200, { data: await intuneRefreshAll(admin) });
      }
      let delivered = 0;
      let failed = 0;
      for (let round = 0; round < 4; round += 1) {
        const result = await deliverDueWebhooks(admin);
        delivered += result.delivered;
        failed += result.failed;
        if (result.delivered + result.failed < 50) break;
      }
      return respond(200, { data: { delivered, failed } });
    } catch (error) {
      console.error(
        "ipam_api_cron_failed",
        error instanceof Error ? error.message : "",
      );
      return new Response(null, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: { Allow: "GET, POST, PATCH, DELETE" },
      });
    if (request.headers.has("x-nextdesk-dispatch-secret"))
      return cronHandler(request);
    return apiHandler(request);
  },
};
