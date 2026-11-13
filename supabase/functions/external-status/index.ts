// «Externe Störungen»: polls the official status feeds of cloud services and
// providers and keeps one incident (source = external) per provider issue.
//
// - Cron (header x-nextdesk-dispatch-secret, woken every 5 minutes by
//   public.monitoring_automation_wake('external-status')): checks all enabled
//   sources of all tenants.
// - User (tenant administrators): get / save the sources, check now.
//
// An issue opens an incident and alarms the incident team once (no
// re-alerting: nothing to do on site); when the provider no longer reports it,
// the incident is closed automatically. A failing feed never closes anything.

import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  dbFailure,
  HttpError,
  parseTenantRequest,
  readJsonBody,
  requireMonitoringAdmin,
  verifyDispatchSecret,
} from "../_shared/monitoring-admin.ts";
import { graphAccessToken } from "../_shared/entra-directory-graph.ts";
import {
  type ExternalIssue,
  parseAppleStatus,
  parseGoogleDashboard,
  parseInit7,
  parseMicrosoftIssues,
  parseStatuspage,
  SOURCE_KEYS,
  type SourceKey,
  SOURCES,
  sourceDefinition,
} from "./providers.ts";
import {
  anthropicCredentials,
  generateStructuredJson,
} from "../_shared/anthropic-json.ts";
import {
  parseTranslation,
  TRANSLATION_SCHEMA,
  TRANSLATION_SYSTEM,
  translationHash,
  translationPrompt,
} from "./translate.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 16_000;
/** AI calls per source and run; the rest follows in the next run. */
const MAX_TRANSLATIONS_PER_RUN = 8;

/** Issue with the German short version of title and text. */
type LocalIssue = ExternalIssue & {
  /** Text as published by the provider (before translation). */
  originalMessage: string | null;
  /** Translation still missing (AI temporarily unavailable). */
  pending: boolean;
};

/**
 * German short version of the provider texts (cached per original text in
 * external_status_translations). Without configured AI the original stays.
 */
async function translateIssues(
  admin: Admin,
  provider: string,
  issues: ExternalIssue[],
): Promise<LocalIssue[]> {
  if (!issues.length) return [];
  const credentials = anthropicCredentials();
  const hashes = await Promise.all(
    issues.map((issue) => translationHash(issue.title, issue.message)),
  );
  const cached = new Map<string, { title: string; message: string | null }>();
  const { data } = await admin
    .from("external_status_translations")
    .select("source_hash, title_de, message_de")
    .in("source_hash", hashes);
  for (const row of (data ?? []) as Row[]) {
    cached.set(String(row.source_hash), {
      title: String(row.title_de),
      message: typeof row.message_de === "string" ? row.message_de : null,
    });
  }
  let calls = 0;
  const result: LocalIssue[] = [];
  for (const [index, issue] of issues.entries()) {
    const hash = hashes[index]!;
    let german = cached.get(hash) ?? null;
    if (!german && credentials && calls < MAX_TRANSLATIONS_PER_RUN) {
      calls += 1;
      try {
        german = parseTranslation(
          await generateStructuredJson({
            apiKey: credentials.apiKey,
            model: credentials.model,
            system: TRANSLATION_SYSTEM,
            content: translationPrompt(provider, issue.title, issue.message),
            schema: TRANSLATION_SCHEMA as unknown as Record<string, unknown>,
            maxTokens: 1200,
            timeoutMs: 25_000,
          }),
        );
        if (german) {
          await admin.from("external_status_translations").upsert({
            source_hash: hash,
            title_de: german.title,
            message_de: issue.message ? german.message : null,
          });
        }
      } catch (failure) {
        console.error("external_status_translation_failed", {
          provider,
          error: failure instanceof Error ? failure.message : "unknown",
        });
        german = null;
      }
    }
    result.push({
      ...issue,
      title: german?.title ?? issue.title,
      message: german ? (issue.message ? german.message ?? issue.message : null) : issue.message,
      originalMessage: issue.message,
      pending: !german && credentials !== null,
    });
  }
  return result;
}
const FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": "nextDesk status check", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return await response.text();
}

const fetchJson = async (url: string, init: RequestInit = {}) =>
  JSON.parse(await fetchText(url, init)) as unknown;

/** Issues of a public source (same for every tenant). */
async function publicIssues(key: SourceKey): Promise<ExternalIssue[]> {
  const gemini = (title: string) => /gemini/i.test(title);
  switch (key) {
    case "github":
      return parseStatuspage(
        await fetchJson("https://www.githubstatus.com/api/v2/summary.json"),
        "https://www.githubstatus.com",
      );
    case "claude":
      return parseStatuspage(
        await fetchJson("https://status.claude.com/api/v2/summary.json"),
        "https://status.claude.com",
      );
    case "gemini": {
      const [workspace, cloud] = await Promise.all([
        fetchJson("https://www.google.com/appsstatus/dashboard/incidents.json"),
        fetchJson("https://status.cloud.google.com/incidents.json"),
      ]);
      return [
        ...parseGoogleDashboard(
          workspace,
          "https://www.google.com/appsstatus/dashboard/",
          gemini,
        ),
        ...parseGoogleDashboard(
          cloud,
          "https://status.cloud.google.com/",
          gemini,
        ),
      ];
    }
    case "apple_app_store": {
      const statusUrl = "https://www.apple.com/de/support/systemstatus/";
      return parseAppleStatus(
        await fetchText(
          "https://www.apple.com/support/systemstatus/data/system_status_de_CH.js",
        ),
        ["App Store", "Mac App Store"],
        statusUrl,
      );
    }
    case "google_play":
      return parseGoogleDashboard(
        await fetchJson("https://status.play.google.com/incidents.json"),
        "https://status.play.google.com/",
        null,
      );
    case "init7": {
      const [html, rss] = await Promise.all([
        fetchText("https://www.as13030.net/status.php"),
        fetchText("https://www.as13030.net/status/rss.php").catch(() => null),
      ]);
      return parseInit7(html, rss, "https://www.as13030.net/status.php");
    }
    default:
      throw new Error("unknown_source");
  }
}

/** Microsoft 365 service health of the tenant (Graph, application token). */
async function microsoftIssues(
  admin: Admin,
  tenantId: string,
): Promise<ExternalIssue[]> {
  const { data: entraTenantId, error } = await admin.rpc(
    "trusted_entra_tenant_id_for_tenant",
    {
      p_tenant_id: tenantId,
    },
  );
  if (error || !isUuid(entraTenantId))
    throw new Error("Kein verbundener Microsoft-365-Mandant.");
  let token: string;
  try {
    token = await graphAccessToken(entraTenantId);
  } catch {
    throw new Error("Anmeldung bei Microsoft Graph fehlgeschlagen.");
  }
  try {
    return parseMicrosoftIssues(
      await fetchJson(
        "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/issues?$filter=isResolved%20eq%20false&$top=100",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "";
    throw new Error(
      message === "http_403" || message === "http_401"
        ? "Berechtigung ServiceHealth.Read.All fehlt in der Entra-App (Administratorzustimmung erteilen)."
        : "Der Dienststatus von Microsoft 365 ist nicht erreichbar.",
    );
  }
}

async function addEvent(
  admin: Admin,
  tenantId: string,
  incidentId: string,
  kind: string,
  message: string | null,
) {
  await admin.from("monitoring_incident_events").insert({
    tenant_id: tenantId,
    incident_id: incidentId,
    kind,
    message: message ? message.slice(0, 4000) : null,
  });
}

/**
 * Public message on the status page (if the source has services assigned):
 * created with the first text, extended with every new text of the provider.
 */
async function publishNotice(
  admin: Admin,
  incidentId: string,
  message: string | null,
) {
  const { error } = await admin.rpc("monitoring_external_publish", {
    p_incident_id: incidentId,
    p_message: message,
  });
  if (error) {
    console.error("external_status_publish_failed", { code: error.code });
  }
}

/** Opens, updates and closes the external incidents of one tenant source. */
export async function syncSource(
  admin: Admin,
  tenantId: string,
  key: SourceKey,
  issues: LocalIssue[],
  teamId: string | null,
  /** False when a source is switched off: close silently. */
  notify = true,
): Promise<{ opened: number; closed: number }> {
  const definition = sourceDefinition(key)!;
  const prefix = `ext:${key}:`;
  const { data: rows, error } = await admin
    .from("monitoring_incidents")
    .select("id, incident_key, title, severity")
    .eq("tenant_id", tenantId)
    .eq("source", "external")
    .eq("state", "active")
    .like("incident_key", `${prefix}%`);
  if (error) throw dbFailure();
  const active = new Map(
    ((rows ?? []) as Row[]).map((row) => [String(row.incident_key), row]),
  );
  const now = new Date().toISOString();
  let opened = 0;
  let closed = 0;

  for (const issue of issues) {
    const incidentKey = `${prefix}${issue.id}`.slice(0, 300);
    const existing = active.get(incidentKey);
    active.delete(incidentKey);
    const title = issue.title.slice(0, 300);
    if (existing) {
      // Wait for the German version instead of posting the original.
      if (issue.pending) continue;
      const changed =
        existing.title !== title || existing.severity !== issue.severity;
      if (changed) {
        await admin
          .from("monitoring_incidents")
          .update({
            title,
            severity: issue.severity,
            last_event_at: now,
          })
          .eq("id", existing.id);
      }
      // New text from the provider: one entry in the history.
      const { data: last } = await admin
        .from("monitoring_incident_events")
        .select("id, message")
        .eq("incident_id", existing.id)
        .in("kind", ["external", "opened"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Same text as before (also the older «X meldet: …» form): no entry.
      const lastText =
        typeof last?.message === "string"
          ? last.message.replace(/^.{1,80}? meldet: /, "")
          : null;
      // Same text, still in the original language: replace it in place.
      if (
        issue.message &&
        lastText !== issue.message &&
        lastText === issue.originalMessage
      ) {
        await admin
          .from("monitoring_incident_events")
          .update({ message: issue.message.slice(0, 4000) })
          .eq("id", last.id);
        if (notify) await publishNotice(admin, String(existing.id), issue.message);
        continue;
      }
      if (issue.message && lastText !== issue.message) {
        await addEvent(
          admin,
          tenantId,
          String(existing.id),
          "external",
          issue.message,
        );
        await admin
          .from("monitoring_incidents")
          .update({ last_event_at: now })
          .eq("id", existing.id);
        // The team hears about every new text of the provider.
        if (notify) {
          await publishNotice(admin, String(existing.id), issue.message);
          await admin.rpc("monitoring_incident_notify", {
            p_incident_id: String(existing.id),
            p_reason: "updated",
          });
        }
      }
      continue;
    }
    const number = await admin.rpc("monitoring_next_incident_number", {
      p_tenant_id: tenantId,
    });
    if (number.error || typeof number.data !== "string") throw dbFailure();
    const inserted = await admin
      .from("monitoring_incidents")
      .insert({
        tenant_id: tenantId,
        number: number.data,
        incident_key: incidentKey,
        device_name: definition.label,
        title,
        severity: issue.severity,
        state: "active",
        team_id: teamId,
        opened_at:
          issue.startedAt && !Number.isNaN(Date.parse(issue.startedAt))
            ? issue.startedAt
            : now,
        last_event_at: now,
        source: "external",
        external_provider: definition.label,
        external_url: issue.url ?? definition.statusUrl,
      })
      .select("id")
      .single();
    if (inserted.error) {
      // Opened by a concurrent run (unique active key): nothing more to do.
      if (inserted.error.code === "23505") continue;
      throw dbFailure();
    }
    const incidentId = String(inserted.data.id);
    await addEvent(
      admin,
      tenantId,
      incidentId,
      "opened",
      issue.message ?? title,
    );
    await admin.rpc("monitoring_incident_notify", {
      p_incident_id: incidentId,
      p_reason: "opened",
    });
    await publishNotice(admin, incidentId, issue.message);
    opened += 1;
  }

  // Issues the provider no longer reports are over.
  for (const row of active.values()) {
    const updated = await admin
      .from("monitoring_incidents")
      .update({
        state: "closed",
        resolved_at: now,
        closed_at: now,
        closing_note: `Automatisch abgeschlossen: ${definition.label} meldet die Störung als behoben.`,
        last_event_at: now,
      })
      .eq("id", row.id)
      .eq("state", "active")
      .select("id");
    if (((updated.data ?? []) as Row[]).length) {
      await addEvent(
        admin,
        tenantId,
        String(row.id),
        "resolved",
        `${definition.label} meldet die Störung als behoben. Automatisch abgeschlossen.`,
      );
      if (notify) {
        await admin.rpc("monitoring_incident_notify", {
          p_incident_id: String(row.id),
          p_reason: "resolved",
        });
      }
      closed += 1;
    }
  }
  return { opened, closed };
}

async function incidentTeam(
  admin: Admin,
  tenantId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("monitoring_integrations")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return typeof data?.team_id === "string" ? data.team_id : null;
}

/** Checks the given enabled sources; public feeds are fetched once per run. */
async function runChecks(admin: Admin, rows: Row[]) {
  const cache = new Map<SourceKey, Promise<LocalIssue[]>>();
  const teams = new Map<string, string | null>();
  const result: Record<string, unknown>[] = [];
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    const key = String(row.source_key) as SourceKey;
    if (!sourceDefinition(key)) continue;
    let issues: LocalIssue[];
    const label = sourceDefinition(key)!.label;
    try {
      if (key === "microsoft365") {
        issues = await translateIssues(
          admin,
          label,
          await microsoftIssues(admin, tenantId),
        );
      } else {
        if (!cache.has(key)) {
          cache.set(
            key,
            publicIssues(key).then((found) => translateIssues(admin, label, found)),
          );
        }
        issues = await cache.get(key)!;
      }
    } catch (failure) {
      const message =
        failure instanceof Error && !/^http_|^[a-z_]+$/.test(failure.message)
          ? failure.message
          : "Die Statusquelle ist gerade nicht erreichbar.";
      await admin
        .from("monitoring_external_sources")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: message.slice(0, 500),
        })
        .eq("tenant_id", tenantId)
        .eq("source_key", key);
      result.push({ tenantId, key, error: message });
      continue;
    }
    if (!teams.has(tenantId))
      teams.set(tenantId, await incidentTeam(admin, tenantId));
    const counts = await syncSource(
      admin,
      tenantId,
      key,
      issues,
      teams.get(tenantId) ?? null,
    );
    await admin
      .from("monitoring_external_sources")
      .update({
        last_checked_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("tenant_id", tenantId)
      .eq("source_key", key);
    result.push({ tenantId, key, active: issues.length, ...counts });
  }
  return result;
}

async function sourcesForResponse(admin: Admin, tenantId: string) {
  const [{ data: stored, error }, { data: incidents }] = await Promise.all([
    admin
      .from("monitoring_external_sources")
      .select("source_key, enabled, last_checked_at, last_error, publish_service_ids")
      .eq("tenant_id", tenantId),
    admin
      .from("monitoring_incidents")
      .select("incident_key")
      .eq("tenant_id", tenantId)
      .eq("source", "external")
      .eq("state", "active"),
  ]);
  if (error) throw dbFailure();
  const byKey = new Map(
    ((stored ?? []) as Row[]).map((row) => [String(row.source_key), row]),
  );
  const activeKeys = ((incidents ?? []) as Row[]).map((row) =>
    String(row.incident_key),
  );
  return SOURCES.map((source) => {
    const row = byKey.get(source.key);
    return {
      key: source.key,
      label: source.label,
      description: source.description,
      statusUrl: source.statusUrl,
      requiresEntra: source.requiresEntra === true,
      enabled: row?.enabled === true,
      lastCheckedAt: (row?.last_checked_at as string | null) ?? null,
      lastError: (row?.last_error as string | null) ?? null,
      activeIncidents: activeKeys.filter((key) =>
        key.startsWith(`ext:${source.key}:`),
      ).length,
      // Services of the status page published automatically.
      serviceIds: Array.isArray(row?.publish_service_ids)
        ? (row.publish_service_ids as string[])
        : [],
    };
  });
}

/** Active services of the status page to assign to a source. */
async function statusServices(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("services")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name")
    .limit(500);
  if (error) throw dbFailure();
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));
}

/** Valid service lists per source key; null when the input is invalid. */
export function parseSourceServices(
  value: unknown,
): Record<string, string[]> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const result: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value)) {
    if (!(SOURCE_KEYS as readonly string[]).includes(key)) return null;
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isUuid)) {
      return null;
    }
    result[key] = [...new Set((ids as string[]).map((id) => id.toLowerCase()))];
  }
  return result;
}

async function save(
  admin: Admin,
  tenantId: string,
  actorId: string,
  enabled: Record<string, unknown>,
  services: Record<string, string[]>,
) {
  const rows = SOURCE_KEYS.map((key) => ({
    tenant_id: tenantId,
    source_key: key,
    enabled: enabled[key] === true,
    updated_at: new Date().toISOString(),
    ...(services[key]
      ? {
        publish_service_ids: services[key],
        publish_actor_id: services[key]!.length ? actorId : null,
      }
      : {}),
  }));
  const { error } = await admin
    .from("monitoring_external_sources")
    .upsert(rows, { onConflict: "tenant_id,source_key" });
  if (error) throw dbFailure();
  // Switched off: its open incidents are closed (nobody watches them anymore).
  for (const key of SOURCE_KEYS.filter((key) => enabled[key] !== true)) {
    await syncSource(admin, tenantId, key, [], null, false);
  }
  // Newly assigned services: publish the incidents that are already active.
  const keys = Object.keys(services).filter((key) =>
    enabled[key] === true && services[key]!.length > 0
  );
  for (const key of keys) {
    const { data: active } = await admin
      .from("monitoring_incidents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source", "external")
      .eq("state", "active")
      .like("incident_key", `ext:${key}:%`);
    for (const incident of (active ?? []) as Row[]) {
      const { data: last } = await admin
        .from("monitoring_incident_events")
        .select("message")
        .eq("incident_id", incident.id)
        .in("kind", ["external", "opened"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      await publishNotice(
        admin,
        String(incident.id),
        typeof last?.message === "string" ? last.message : null,
      );
    }
  }
}

const userHandler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST")
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId))
        return json(request, { error: { code: "unauthorized" } }, 401);
      const parsed = parseTenantRequest(
        await readJsonBody(request, MAX_REQUEST_BYTES),
      );
      if (!parsed) {
        return json(
          request,
          {
            error: {
              code: "invalid_request",
              message: "Die Anfrage ist ungültig.",
            },
          },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      await requireMonitoringAdmin(admin, parsed.tenantId, actorId);
      const { type, tenantId, body } = parsed;
      if (type === "save") {
        if (!isRecord(body.enabled)) {
          return json(
            request,
            {
              error: {
                code: "invalid_request",
                message: "Die Anfrage ist ungültig.",
              },
            },
            422,
          );
        }
        const services = parseSourceServices(body.services);
        if (!services) {
          return json(
            request,
            {
              error: {
                code: "invalid_request",
                message: "Die Anfrage ist ungültig.",
              },
            },
            422,
          );
        }
        await save(admin, tenantId, actorId, body.enabled, services);
      } else if (type === "checkNow") {
        const { data, error } = await admin
          .from("monitoring_external_sources")
          .select("tenant_id, source_key")
          .eq("tenant_id", tenantId)
          .eq("enabled", true);
        if (error) throw dbFailure();
        await runChecks(admin, (data ?? []) as Row[]);
      } else if (type !== "get") {
        return json(
          request,
          {
            error: {
              code: "invalid_request",
              message: "Die Anfrage ist ungültig.",
            },
          },
          422,
        );
      }
      return json(request, {
        data: {
          sources: await sourcesForResponse(admin, tenantId),
          services: await statusServices(admin, tenantId),
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(
        "external_status_failed",
        error instanceof Error ? error.message : "",
      );
      return json(
        request,
        {
          error: {
            code: "internal_error",
            message: "Die externen Statusquellen sind gerade nicht verfügbar.",
          },
        },
        500,
      );
    }
  },
);

const cronHandler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (!(await verifyDispatchSecret(context.supabaseAdmin, request))) {
      return new Response(null, { status: 401 });
    }
    try {
      const { data, error } = await context.supabaseAdmin
        .from("monitoring_external_sources")
        .select("tenant_id, source_key")
        .eq("enabled", true)
        .limit(2000);
      if (error) throw dbFailure();
      const result = await runChecks(
        context.supabaseAdmin,
        (data ?? []) as Row[],
      );
      return new Response(JSON.stringify({ checked: result.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error(
        "external_status_cron_failed",
        error instanceof Error ? error.message : "",
      );
      return new Response(null, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    if (request.headers.has("x-nextdesk-dispatch-secret"))
      return cronHandler(request);
    return userHandler(request);
  },
};
