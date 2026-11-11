import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  type DepartmentScope,
  departmentVisible,
  loadDepartmentScope,
} from "../_shared/department-scope.ts";
import {
  API_SCOPES,
  type ApiScope,
  deliverWebhook,
  generateApiKey,
  generateWebhookSecret,
  isSafeWebhookUrl,
  normalizeMac,
  refreshIntuneDevices,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from "../_shared/ipam-integrations.ts";
import { detectNetworkCandidates, networkLookupTerms } from "./detect.ts";
import {
  type AssistantIntent,
  answerText,
  parseQuestion,
} from "./assistant.ts";
import {
  freeAddresses,
  fullPrefixes,
  hostLookup,
  LookupError,
  networkLookup,
  switchPortAddresses,
} from "./lookup.ts";

/**
 * IPAM-Integrationen (Benutzeraktionen, verify_jwt = true):
 *  - ticketLookup: IPs, MACs und Hostnamen im Ticket mit dem IPAM abgleichen
 *    (nur wenn die Person das Ticket lesen darf)
 *  - assetNetwork: Netzwerkdaten eines Assets (App: QR-Scan)
 *  - ask / freeAddress / switchPort / hostLookup / fullPrefixes: Abfragen für
 *    den KI-Assistenten (MCP-Connector); reserveAddress nur mit Bestätigung
 *  - intuneSync / prtgSync / coverage / syncRuns: Abgleich mit Intune und PRTG
 *  - apiSettings / createApiKey / revokeApiKey / saveWebhook /
 *    rotateWebhookSecret / testWebhook: Verwaltung der REST-API (ipam-api)
 * Lesen braucht ipam.read, Ändern ipam.manage, immer mit eingeschaltetem
 * Modul ipam.management. Daten werden nach den Prüfungen mit der Service-Rolle
 * gelesen und nach Abteilung gefiltert.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 16 * 1024;
const FEATURE = "ipam.management";
const READ_ACTIONS = new Set([
  "ticketLookup",
  "assetNetwork",
  "ask",
  "freeAddress",
  "switchPort",
  "hostLookup",
  "fullPrefixes",
  "coverage",
  "syncRuns",
]);
const MANAGE_ACTIONS = new Set([
  "reserveAddress",
  "intuneSync",
  "prtgSync",
  "apiSettings",
  "createApiKey",
  "revokeApiKey",
  "saveWebhook",
  "rotateWebhookSecret",
  "testWebhook",
]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const invalid = () =>
  new HttpError(
    422,
    "invalid_request",
    "Die Angaben sind unvollständig oder ungültig.",
  );
const dbFailure = () =>
  new HttpError(
    500,
    "database_error",
    "Die Daten konnten nicht verarbeitet werden.",
  );

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string" || value.includes("\u0000")) return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  return length >= min && length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  const result = text(value, 1, max);
  if (result === null) throw invalid();
  return result;
}

const IPV4_OR_V6 = /^[0-9a-f.:]{2,45}$/i;

async function readBody(request: Request): Promise<Row> {
  const body = await request.text().catch(() => null);
  if (
    body === null ||
    new TextEncoder().encode(body).length > MAX_REQUEST_BYTES
  ) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    const value: unknown = JSON.parse(body);
    if (
      isRecord(value) &&
      typeof value.type === "string" &&
      isUuid(value.tenantId)
    )
      return value;
  } catch {
    // fällt durch
  }
  throw invalid();
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

async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Row,
): Promise<void> {
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
}

// ---------------------------------------------------------------- Ticket

async function ticketLookup(
  client: Client,
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  ticketId: string,
) {
  const readable = await client.rpc("can_read_ticket", {
    p_ticket_id: ticketId,
  });
  if (readable.error)
    throw new HttpError(
      503,
      "permission_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  if (readable.data !== true)
    throw new HttpError(
      404,
      "ticket_not_found",
      "Das Ticket ist nicht verfügbar.",
    );
  const ticket = await admin
    .from("tickets")
    .select("id, subject, description")
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .is("deleted_at", null)
    .maybeSingle();
  if (ticket.error) throw dbFailure();
  if (!ticket.data)
    throw new HttpError(
      404,
      "ticket_not_found",
      "Das Ticket ist nicht verfügbar.",
    );
  const comments = await admin
    .from("ticket_comments")
    .select("body")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (comments.error) throw dbFailure();
  const candidates = detectNetworkCandidates([
    ticket.data.subject,
    ticket.data.description,
    ...((comments.data ?? []) as Row[]).map((row) =>
      typeof row.body === "string" ? row.body : null,
    ),
  ]);
  const terms = networkLookupTerms(candidates);
  if (!terms.ips.length && !terms.macs.length && !terms.hostnames.length) {
    return { candidates, addresses: [], prefixes: [] };
  }
  const result = await networkLookup(admin, tenantId, scope, terms);
  // Subnetze nur für IPs, zu denen keine Adresse dokumentiert ist.
  const documented = new Set(
    result.addresses.map((entry) => String(entry.address)),
  );
  return {
    candidates,
    addresses: result.addresses,
    prefixes: result.prefixes.filter(
      (entry) => !documented.has(String(entry.matched)),
    ),
  };
}

// ---------------------------------------------------------------- Assistent

async function runIntent(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  intent: AssistantIntent,
) {
  switch (intent.kind) {
    case "freeAddress":
      return { free: await freeAddresses(admin, tenantId, scope, intent) };
    case "switchPort":
      return {
        addresses: await switchPortAddresses(
          admin,
          tenantId,
          scope,
          intent.switchName,
          intent.port,
        ),
      };
    case "address":
      return await hostLookup(admin, tenantId, scope, { ip: intent.address });
    case "mac":
      return await hostLookup(admin, tenantId, scope, { mac: intent.mac });
    case "host":
      return await hostLookup(admin, tenantId, scope, { name: intent.name });
    case "fullPrefixes":
      return {
        prefixes: await fullPrefixes(admin, tenantId, scope, intent.threshold),
      };
    default:
      return {};
  }
}

function hostQuery(value: unknown): AssistantIntent {
  const query = text(value, 1, 253);
  if (!query) throw invalid();
  const mac = normalizeMac(query);
  if (mac) return { kind: "mac", mac };
  if (
    IPV4_OR_V6.test(query) &&
    /[.:]/.test(query) &&
    /\d/.test(query) &&
    !/[g-z]/i.test(query)
  ) {
    return { kind: "address", address: query };
  }
  return { kind: "host", name: query };
}

async function reserveAddress(
  admin: Admin,
  tenantId: string,
  actorId: string,
  scope: DepartmentScope,
  body: Row,
) {
  if (body.confirmed !== true) {
    throw new HttpError(
      409,
      "confirmation_required",
      "Die Reservierung muss bestätigt werden.",
    );
  }
  if (!isUuid(body.prefixId)) throw invalid();
  const address = text(body.address, 2, 45);
  if (!address || !IPV4_OR_V6.test(address)) throw invalid();
  const prefix = await admin
    .from("ipam_prefixes")
    .select("id, department_id")
    .eq("tenant_id", tenantId)
    .eq("id", body.prefixId)
    .maybeSingle();
  if (prefix.error) throw dbFailure();
  if (!prefix.data || !departmentVisible(scope, prefix.data.department_id)) {
    throw new HttpError(
      404,
      "prefix_not_found",
      "Das Subnetz ist nicht verfügbar.",
    );
  }
  const mac =
    body.mac === undefined || body.mac === null || body.mac === ""
      ? null
      : normalizeMac(body.mac);
  if (body.mac && !mac) throw invalid();
  const { data, error } = await admin.rpc("ipam_reserve_address", {
    p_tenant_id: tenantId,
    p_prefix_id: body.prefixId,
    p_address: address,
    p_hostname: optionalText(body.hostname, 253),
    p_description: optionalText(body.description, 1000),
    p_mac: mac,
    p_dns_name: null,
    p_actor_id: actorId,
    p_source: "assistant",
  });
  if (error) {
    if (error.code === "23505")
      throw new HttpError(
        409,
        "address_taken",
        "Die Adresse ist inzwischen vergeben.",
      );
    if (error.code === "22023" || error.code === "22P02") {
      throw new HttpError(
        422,
        "address_not_available",
        "Die Adresse liegt nicht frei im Subnetz.",
      );
    }
    throw dbFailure();
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "ipam.address_reserved",
    "ipam_address",
    ((data as Row)?.id as string) ?? null,
    {
      address: (data as Row)?.address,
      source: "assistant",
    },
  );
  return { reservation: data };
}

// ---------------------------------------------------------------- Abgleich

async function coverage(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
) {
  const [gaps, prefixes] = await Promise.all([
    admin.rpc("ipam_prtg_coverage", { p_tenant_id: tenantId }),
    admin
      .from("ipam_prefixes")
      .select("id, prefix, department_id")
      .eq("tenant_id", tenantId)
      .limit(10000),
  ]);
  if (gaps.error || prefixes.error) throw dbFailure();
  const prefixById = new Map(
    ((prefixes.data ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  return {
    gaps: ((gaps.data ?? []) as Row[]).flatMap((row) => {
      const prefix = prefixById.get(String(row.prefix_id));
      if (prefix && !departmentVisible(scope, prefix.department_id)) return [];
      return [
        {
          addressId: row.address_id,
          address: String(row.address).replace(/\/\d+$/, ""),
          hostname: row.hostname ?? null,
          deviceType: row.device_type,
          prefix: prefix?.prefix ?? null,
          assetId: row.asset_id ?? null,
        },
      ];
    }),
  };
}

async function syncRuns(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("ipam_sync_runs")
    .select(
      "id, source, trigger_kind, status, started_at, finished_at, summary, error_code",
    )
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(30);
  if (error) throw dbFailure();
  return { runs: data ?? [] };
}

async function reconcile(
  admin: Admin,
  fn: string,
  tenantId: string,
  actorId: string,
) {
  const { data, error } = await admin.rpc(fn, {
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_trigger: "manual",
  });
  if (error || !isRecord(data)) throw dbFailure();
  if (typeof data.error === "string") {
    throw new HttpError(500, "sync_failed", "Der Abgleich ist fehlgeschlagen.");
  }
  return data;
}

// ---------------------------------------------------------------- API-Verwaltung

async function apiSettings(admin: Admin, tenantId: string) {
  const [keys, hooks, outbox] = await Promise.all([
    admin
      .from("ipam_api_keys")
      .select(
        "id, name, key_prefix, scopes, created_at, last_used_at, revoked_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("ipam_webhooks")
      .select(
        "id, name, url, events, active, last_status, last_error, last_delivery_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("ipam_webhook_outbox")
      .select(
        "id, webhook_id, event, status, attempts, last_status, last_error, created_at, delivered_at",
      )
      .eq("tenant_id", tenantId)
      .order("id", { ascending: false })
      .limit(100),
  ]);
  if (keys.error || hooks.error || outbox.error) throw dbFailure();
  return {
    keys: keys.data ?? [],
    webhooks: hooks.data ?? [],
    deliveries: outbox.data ?? [],
  };
}

function parseScopes(value: unknown): ApiScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2)
    throw invalid();
  const scopes = [...new Set(value)];
  if (
    !scopes.every((scope): scope is ApiScope =>
      (API_SCOPES as readonly unknown[]).includes(scope),
    )
  )
    throw invalid();
  // Schreiben schliesst Lesen ein.
  return scopes.includes("write") ? ["read", "write"] : ["read"];
}

function parseEvents(value: unknown): WebhookEvent[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > WEBHOOK_EVENTS.length
  )
    throw invalid();
  const events = [...new Set(value)];
  if (
    !events.every((event): event is WebhookEvent =>
      (WEBHOOK_EVENTS as readonly unknown[]).includes(event),
    )
  ) {
    throw invalid();
  }
  return events;
}

async function createApiKey(
  admin: Admin,
  tenantId: string,
  actorId: string,
  body: Row,
) {
  const name = text(body.name, 1, 80);
  if (!name) throw invalid();
  const scopes = parseScopes(body.scopes);
  const generated = await generateApiKey();
  const { data, error } = await admin
    .from("ipam_api_keys")
    .insert({
      tenant_id: tenantId,
      name,
      key_prefix: generated.prefix,
      key_hash: generated.hash,
      scopes,
      created_by: actorId,
    })
    .select(
      "id, name, key_prefix, scopes, created_at, last_used_at, revoked_at",
    )
    .single();
  if (error) throw dbFailure();
  await audit(
    admin,
    tenantId,
    actorId,
    "ipam.api_key_created",
    "ipam_api_key",
    data.id,
    {
      name,
      key_prefix: generated.prefix,
      scopes,
    },
  );
  // Der Schlüssel wird nur in dieser Antwort gezeigt.
  return { key: data, secret: generated.key };
}

async function revokeApiKey(
  admin: Admin,
  tenantId: string,
  actorId: string,
  body: Row,
) {
  if (!isUuid(body.keyId)) throw invalid();
  const { data, error } = await admin
    .from("ipam_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("id", body.keyId)
    .is("revoked_at", null)
    .select("id, key_prefix")
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data)
    throw new HttpError(
      404,
      "key_not_found",
      "Der Schlüssel ist nicht vorhanden oder bereits widerrufen.",
    );
  await audit(
    admin,
    tenantId,
    actorId,
    "ipam.api_key_revoked",
    "ipam_api_key",
    data.id,
    { key_prefix: data.key_prefix },
  );
  return { revoked: true };
}

async function saveWebhook(
  admin: Admin,
  tenantId: string,
  actorId: string,
  body: Row,
) {
  const name = text(body.name, 1, 80);
  if (!name || !isSafeWebhookUrl(body.url)) {
    throw new HttpError(
      422,
      "invalid_webhook",
      "Bitte einen Namen und eine öffentliche HTTPS-Adresse angeben (keine internen Adressen).",
    );
  }
  const events = parseEvents(body.events);
  const active = body.active !== false;
  if (body.id !== undefined && body.id !== null) {
    if (!isUuid(body.id)) throw invalid();
    const { data, error } = await admin
      .from("ipam_webhooks")
      .update({
        name,
        url: body.url,
        events,
        active,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", body.id)
      .select("id")
      .maybeSingle();
    if (error) throw dbFailure();
    if (!data)
      throw new HttpError(
        404,
        "webhook_not_found",
        "Der Webhook ist nicht vorhanden.",
      );
    await audit(
      admin,
      tenantId,
      actorId,
      "ipam.webhook_updated",
      "ipam_webhook",
      data.id,
      { name, events, active },
    );
    return { id: data.id, secret: null };
  }
  const secret = generateWebhookSecret();
  const { data, error } = await admin
    .from("ipam_webhooks")
    .insert({
      tenant_id: tenantId,
      name,
      url: body.url,
      events,
      active,
      secret,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) throw dbFailure();
  await audit(
    admin,
    tenantId,
    actorId,
    "ipam.webhook_created",
    "ipam_webhook",
    data.id,
    { name, events },
  );
  return { id: data.id, secret };
}

async function rotateWebhookSecret(
  admin: Admin,
  tenantId: string,
  actorId: string,
  body: Row,
) {
  if (!isUuid(body.id)) throw invalid();
  const secret = generateWebhookSecret();
  const { data, error } = await admin
    .from("ipam_webhooks")
    .update({ secret, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", body.id)
    .select("id")
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data)
    throw new HttpError(
      404,
      "webhook_not_found",
      "Der Webhook ist nicht vorhanden.",
    );
  await audit(
    admin,
    tenantId,
    actorId,
    "ipam.webhook_secret_rotated",
    "ipam_webhook",
    data.id,
    {},
  );
  return { id: data.id, secret };
}

async function testWebhook(admin: Admin, tenantId: string, body: Row) {
  if (!isUuid(body.id)) throw invalid();
  const hook = await admin
    .from("ipam_webhooks")
    .select("id, url, secret")
    .eq("tenant_id", tenantId)
    .eq("id", body.id)
    .maybeSingle();
  if (hook.error) throw dbFailure();
  if (!hook.data)
    throw new HttpError(
      404,
      "webhook_not_found",
      "Der Webhook ist nicht vorhanden.",
    );
  const payload = {
    id: crypto.randomUUID(),
    event: "ping",
    occurred_at: new Date().toISOString(),
    tenant_id: tenantId,
    data: { message: "Testzustellung von nextDesk" },
  };
  const outbox = await admin
    .from("ipam_webhook_outbox")
    .insert({
      tenant_id: tenantId,
      webhook_id: hook.data.id,
      event: "ping",
      payload,
      attempts: 1,
      // Kein Wiederholen durch den Cron, Ergebnis wird sofort gesetzt.
      next_attempt_at: new Date(Date.now() + 3_600_000).toISOString(),
    })
    .select("id")
    .single();
  if (outbox.error) throw dbFailure();
  const result = await deliverWebhook({
    id: outbox.data.id,
    event: "ping",
    payload,
    url: hook.data.url,
    secret: hook.data.secret,
  });
  await admin
    .from("ipam_webhook_outbox")
    .update({
      status: result.ok ? "delivered" : "failed",
      last_status: result.status,
      last_error: result.error,
      delivered_at: result.ok ? new Date().toISOString() : null,
    })
    .eq("id", outbox.data.id);
  await admin
    .from("ipam_webhooks")
    .update({
      last_status: result.status,
      last_error: result.ok ? null : result.error,
      last_delivery_at: new Date().toISOString(),
    })
    .eq("id", hook.data.id);
  return result;
}

// ---------------------------------------------------------------- Handler

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST")
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId))
        return json(request, { error: { code: "unauthorized" } }, 401);
      const body = await readBody(request);
      const type = body.type as string;
      const tenantId = (body.tenantId as string).toLowerCase();
      if (!READ_ACTIONS.has(type) && !MANAGE_ACTIONS.has(type)) throw invalid();
      const admin = context.supabaseAdmin;
      const client = context.supabase;

      const features = await resolveUserFeatureStates(
        admin,
        tenantId,
        actorId,
        [FEATURE],
      );
      if (features?.[FEATURE] !== true) {
        throw new HttpError(
          403,
          "feature_disabled",
          "Die IP-Adressverwaltung ist für Sie nicht eingeschaltet.",
        );
      }
      const permission = MANAGE_ACTIONS.has(type) ? "ipam.manage" : "ipam.read";
      if (!(await hasPermission(client, tenantId, permission))) {
        throw new HttpError(
          403,
          "access_denied",
          "Für die IP-Adressverwaltung fehlt Ihnen die Berechtigung.",
        );
      }
      const scope = await loadDepartmentScope(
        admin,
        tenantId,
        actorId,
        FEATURE,
      );
      if (!scope)
        throw new HttpError(
          503,
          "scope_unavailable",
          "Der Abteilungsbezug konnte nicht geprüft werden.",
        );

      let data: Row;
      switch (type) {
        case "ticketLookup":
          if (!isUuid(body.ticketId)) throw invalid();
          data = await ticketLookup(
            client,
            admin,
            tenantId,
            scope,
            body.ticketId.toLowerCase(),
          );
          break;
        case "assetNetwork": {
          if (!isUuid(body.assetId)) throw invalid();
          const asset = await admin
            .from("assets")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("id", body.assetId)
            .maybeSingle();
          if (asset.error) throw dbFailure();
          if (!asset.data)
            throw new HttpError(
              404,
              "asset_not_found",
              "Das Gerät ist nicht verfügbar.",
            );
          data = await networkLookup(admin, tenantId, scope, {
            assetId: asset.data.id,
          });
          break;
        }
        case "ask": {
          const question = text(body.question, 2, 500);
          if (!question) throw invalid();
          const intent = parseQuestion(question);
          const results = await runIntent(admin, tenantId, scope, intent);
          data = { intent, answer: answerText(intent, results), results };
          break;
        }
        case "freeAddress": {
          const vlan =
            body.vlan === undefined || body.vlan === null
              ? null
              : Number(body.vlan);
          if (
            vlan !== null &&
            (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094)
          )
            throw invalid();
          const intent: AssistantIntent = {
            kind: "freeAddress",
            vlan,
            vlanName: optionalText(body.vlanName, 60),
            site: optionalText(body.site, 60),
          };
          if (intent.vlan === null && !intent.vlanName && !intent.site)
            throw invalid();
          const results = await runIntent(admin, tenantId, scope, intent);
          data = { intent, answer: answerText(intent, results), results };
          break;
        }
        case "switchPort": {
          const switchName = text(body.switchName, 1, 160);
          const port = text(body.port, 1, 80);
          if (!switchName || !port) throw invalid();
          const intent: AssistantIntent = {
            kind: "switchPort",
            switchName,
            port,
          };
          const results = await runIntent(admin, tenantId, scope, intent);
          data = { intent, answer: answerText(intent, results), results };
          break;
        }
        case "hostLookup": {
          const intent = hostQuery(body.query);
          const results = await runIntent(admin, tenantId, scope, intent);
          data = { intent, answer: answerText(intent, results), results };
          break;
        }
        case "fullPrefixes": {
          const threshold =
            body.threshold === undefined || body.threshold === null
              ? null
              : Number(body.threshold);
          if (
            threshold !== null &&
            (!Number.isFinite(threshold) || threshold < 1 || threshold > 100)
          )
            throw invalid();
          const intent: AssistantIntent = { kind: "fullPrefixes", threshold };
          const results = await runIntent(admin, tenantId, scope, intent);
          data = { intent, answer: answerText(intent, results), results };
          break;
        }
        case "coverage":
          data = await coverage(admin, tenantId, scope);
          break;
        case "syncRuns":
          data = await syncRuns(admin, tenantId);
          break;
        case "reserveAddress":
          data = await reserveAddress(admin, tenantId, actorId, scope, body);
          break;
        case "intuneSync": {
          const refresh = await refreshIntuneDevices(
            admin,
            tenantId,
            actorId,
            "manual",
          );
          data = {
            graph: refresh,
            result: await reconcile(
              admin,
              "ipam_reconcile_intune",
              tenantId,
              actorId,
            ),
          };
          break;
        }
        case "prtgSync":
          data = {
            result: await reconcile(
              admin,
              "ipam_reconcile_prtg",
              tenantId,
              actorId,
            ),
          };
          break;
        case "apiSettings":
          data = await apiSettings(admin, tenantId);
          break;
        case "createApiKey":
          data = await createApiKey(admin, tenantId, actorId, body);
          break;
        case "revokeApiKey":
          data = await revokeApiKey(admin, tenantId, actorId, body);
          break;
        case "saveWebhook":
          data = await saveWebhook(admin, tenantId, actorId, body);
          break;
        case "rotateWebhookSecret":
          data = await rotateWebhookSecret(admin, tenantId, actorId, body);
          break;
        case "testWebhook":
          data = await testWebhook(admin, tenantId, body);
          break;
        default:
          throw invalid();
      }
      return json(request, { data });
    } catch (error) {
      if (error instanceof HttpError || error instanceof LookupError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(
        "ipam_sync_failed",
        error instanceof Error ? error.message : "",
      );
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
