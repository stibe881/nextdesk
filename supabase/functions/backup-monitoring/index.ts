import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  checkMissingReports,
  ingestBackupReport,
  type BackupSettings,
  BACKUP_SETTINGS_COLUMNS,
} from "../_shared/backup-monitoring.ts";
import { parseWebhookReport } from "../_shared/backup-monitoring-parse.ts";
import {
  dbFailure,
  HttpError,
  loadMonitoringOptions,
  optionalInteger,
  optionalPriorityKey,
  optionalUuid,
  parseTenantRequest,
  readJsonBody,
  requireMonitoringAdmin,
  ticketNumbers,
  validateReferences,
  verifyDispatchSecret,
} from "../_shared/monitoring-admin.ts";
import { generateMonitoringToken, sha256Hex } from "../_shared/monitoring-tickets.ts";
import { parseBody, parseQuery } from "../monitoring-webhook/prtg.ts";

/**
 * Backup monitoring.
 *
 * - Admin actions (tenant.settings.manage): get, saveSettings, saveJob,
 *   deleteJob, listReports, rotateToken.
 * - Webhook for backup tools: POST with `?token=…` or header
 *   `x-nextdesk-token` (stored only as SHA-256 hash) and fields
 *   job/status[/message/id/timestamp/objects] as JSON, form or query.
 * - Cron (x-nextdesk-dispatch-secret, every 15 minutes): missing reports.
 * Deploy with `[functions.backup-monitoring] verify_jwt = false`.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_WEBHOOK_BYTES = 32 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const encoder = new TextEncoder();

export type SettingsInput = {
  enabled: boolean;
  departmentId: string | null;
  priorityKey: string | null;
  warningAction: "ignore" | "ticket";
  autoResolve: boolean;
  defaultIntervalHours: number;
  defaultGraceHours: number;
  senderPatterns: string[];
  subjectPatterns: string[];
};

export type JobInput = {
  id: string;
  expectedIntervalHours: number | null;
  graceHours: number | null;
  departmentId: string | null;
  assetId: string | null;
  serviceId: string | null;
  active: boolean;
};

const SENDER_PATTERN = /^(\*|[a-z0-9._%+*-]+)?@([a-z0-9*-]+\.)*[a-z0-9*-]+$|^[a-z0-9._%+*-]+@[a-z0-9.*-]+$/;

function patternList(value: unknown, validate: (entry: string) => boolean, max: number): string[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(/[\n,;]+/)
    : value === undefined || value === null
    ? []
    : null;
  if (!raw) return null;
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const text = entry.trim();
    if (!text) continue;
    if (text.length > max || !validate(text)) return null;
    if (!cleaned.includes(text)) cleaned.push(text);
  }
  return cleaned.length <= 20 ? cleaned : null;
}

export function parseSettingsInput(value: unknown): SettingsInput | null {
  if (!isRecord(value)) return null;
  const departmentId = optionalUuid(value.departmentId);
  const priorityKey = optionalPriorityKey(value.priorityKey);
  const interval = optionalInteger(value.defaultIntervalHours, 1, 2160);
  const grace = optionalInteger(value.defaultGraceHours, 0, 336);
  const senderPatterns = patternList(
    value.senderPatterns,
    (entry) => SENDER_PATTERN.test(entry.toLowerCase()),
    200,
  );
  const subjectPatterns = patternList(value.subjectPatterns, () => true, 200);
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.autoResolve !== "boolean" ||
    (value.warningAction !== "ignore" && value.warningAction !== "ticket") ||
    departmentId === undefined || priorityKey === undefined ||
    typeof interval !== "number" || typeof grace !== "number" ||
    !senderPatterns || !subjectPatterns
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    departmentId,
    priorityKey,
    warningAction: value.warningAction,
    autoResolve: value.autoResolve,
    defaultIntervalHours: interval,
    defaultGraceHours: grace,
    senderPatterns: senderPatterns.map((entry) => entry.toLowerCase()),
    subjectPatterns,
  };
}

export function parseJobInput(value: unknown): JobInput | null {
  if (!isRecord(value) || !isUuid(value.id)) return null;
  const interval = optionalInteger(value.expectedIntervalHours, 1, 2160);
  const grace = optionalInteger(value.graceHours, 0, 336);
  const departmentId = optionalUuid(value.departmentId);
  const assetId = optionalUuid(value.assetId);
  const serviceId = optionalUuid(value.serviceId);
  if (
    interval === undefined || grace === undefined || departmentId === undefined ||
    assetId === undefined || serviceId === undefined || typeof value.active !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    expectedIntervalHours: interval,
    graceHours: grace,
    departmentId,
    assetId,
    serviceId,
    active: value.active,
  };
}

export function backupWebhookUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/backup-monitoring?token=${encodeURIComponent(token)}`;
}

function settingsView(row: Row | null) {
  return {
    configured: row !== null,
    enabled: row?.enabled === true,
    departmentId: (row?.department_id as string | null) ?? null,
    priorityKey: (row?.priority_key as string | null) ?? null,
    warningAction: row?.warning_action === "ticket" ? "ticket" : "ignore",
    autoResolve: row ? row.auto_resolve === true : true,
    defaultIntervalHours: Number(row?.default_interval_hours ?? 24),
    defaultGraceHours: Number(row?.default_grace_hours ?? 6),
    senderPatterns: Array.isArray(row?.sender_patterns) ? row.sender_patterns : [],
    subjectPatterns: Array.isArray(row?.subject_patterns) ? row.subject_patterns : [],
    hasToken: typeof row?.token_hash === "string",
    tokenRotatedAt: (row?.token_rotated_at as string | null) ?? null,
    lastReceivedAt: (row?.last_received_at as string | null) ?? null,
  };
}

async function listJobs(admin: Admin, tenantId: string) {
  const { data, error } = await admin.from("monitoring_backup_jobs").select("*")
    .eq("tenant_id", tenantId).order("name").limit(500);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  const numbers = await ticketNumbers(admin, tenantId, rows.map((row) => row.ticket_id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    lastSource: row.last_source ?? null,
    expectedIntervalHours: row.expected_interval_hours ?? null,
    graceHours: row.grace_hours ?? null,
    departmentId: row.department_id ?? null,
    assetId: row.asset_id ?? null,
    serviceId: row.service_id ?? null,
    active: row.active === true,
    lastResult: row.last_result ?? null,
    lastReportAt: row.last_report_at ?? null,
    lastSuccessAt: row.last_success_at ?? null,
    lastMessage: row.last_message ?? null,
    reportCount: row.report_count ?? 0,
    missingAlertedAt: row.missing_alerted_at ?? null,
    ticketId: row.ticket_id ?? null,
    ticketNumber: typeof row.ticket_id === "string" ? numbers.get(row.ticket_id) ?? null : null,
    ticketReason: row.ticket_reason ?? null,
    createdAt: row.created_at,
  }));
}

async function listReports(admin: Admin, tenantId: string, jobId: string) {
  const { data, error } = await admin.from("monitoring_backup_reports")
    .select("id, result, source, subject, summary, object_count, action, reported_at, received_at")
    .eq("tenant_id", tenantId).eq("job_id", jobId)
    .order("reported_at", { ascending: false }).limit(60);
  if (error) throw dbFailure();
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    result: row.result,
    source: row.source,
    subject: row.subject ?? null,
    summary: row.summary ?? null,
    objectCount: row.object_count ?? null,
    action: row.action ?? null,
    reportedAt: row.reported_at,
  }));
}

async function get(request: Request, admin: Admin, tenantId: string) {
  const [settings, jobs, options] = await Promise.all([
    admin.from("monitoring_backup_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    listJobs(admin, tenantId),
    loadMonitoringOptions(admin, tenantId),
  ]);
  if (settings.error) throw dbFailure();
  return json(request, { data: { settings: settingsView((settings.data as Row | null) ?? null), jobs, ...options } });
}

async function audit(admin: Admin, tenantId: string, actorId: string, action: string, entityId: string, metadata: Row, severity = "info") {
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "monitoring_backup",
    entity_id: entityId,
    severity,
    metadata,
  });
}

async function saveSettings(request: Request, admin: Admin, actorId: string, tenantId: string, input: SettingsInput) {
  await validateReferences(admin, tenantId, { departmentId: input.departmentId, priorityKeys: [input.priorityKey] });
  const { data, error } = await admin.from("monitoring_backup_settings").upsert({
    tenant_id: tenantId,
    enabled: input.enabled,
    department_id: input.departmentId,
    priority_key: input.priorityKey,
    warning_action: input.warningAction,
    auto_resolve: input.autoResolve,
    default_interval_hours: input.defaultIntervalHours,
    default_grace_hours: input.defaultGraceHours,
    sender_patterns: input.senderPatterns,
    subject_patterns: input.subjectPatterns,
  }, { onConflict: "tenant_id" }).select("*").single();
  if (error || !data) throw dbFailure();
  await audit(admin, tenantId, actorId, "monitoring.backup.settings_updated", tenantId, {
    enabled: input.enabled,
    senderPatterns: input.senderPatterns.length,
  });
  return json(request, { data: { settings: settingsView(data as Row) } });
}

async function saveJob(request: Request, admin: Admin, actorId: string, tenantId: string, input: JobInput) {
  await validateReferences(admin, tenantId, {
    departmentId: input.departmentId,
    assetId: input.assetId,
    serviceId: input.serviceId,
  });
  const { data, error } = await admin.from("monitoring_backup_jobs").update({
    expected_interval_hours: input.expectedIntervalHours,
    grace_hours: input.graceHours,
    department_id: input.departmentId,
    asset_id: input.assetId,
    service_id: input.serviceId,
    active: input.active,
  }).eq("tenant_id", tenantId).eq("id", input.id).select("id");
  if (error) throw dbFailure();
  if (!Array.isArray(data) || !data.length) {
    throw new HttpError(404, "job_not_found", "Der Backup-Job wurde nicht gefunden.");
  }
  await audit(admin, tenantId, actorId, "monitoring.backup.job_updated", input.id, {
    expectedIntervalHours: input.expectedIntervalHours,
    active: input.active,
  });
  return json(request, { data: { jobs: await listJobs(admin, tenantId) } });
}

async function deleteJob(request: Request, admin: Admin, actorId: string, tenantId: string, id: string) {
  const { data, error } = await admin.from("monitoring_backup_jobs").delete()
    .eq("tenant_id", tenantId).eq("id", id).select("id, name");
  if (error) throw dbFailure();
  if (!Array.isArray(data) || !data.length) {
    throw new HttpError(404, "job_not_found", "Der Backup-Job wurde nicht gefunden.");
  }
  await audit(admin, tenantId, actorId, "monitoring.backup.job_deleted", id, { name: data[0].name });
  return json(request, { data: { jobs: await listJobs(admin, tenantId) } });
}

async function rotateToken(request: Request, admin: Admin, actorId: string, tenantId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new HttpError(503, "configuration_missing", "Die Webhook-Adresse ist nicht konfiguriert.");
  }
  const token = generateMonitoringToken();
  const { data, error } = await admin.from("monitoring_backup_settings").upsert({
    tenant_id: tenantId,
    token_hash: await sha256Hex(token),
    token_rotated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" }).select("*").single();
  if (error || !data) throw dbFailure();
  await audit(admin, tenantId, actorId, "monitoring.backup.token_rotated", tenantId, {}, "security");
  return json(request, {
    data: { token, webhookUrl: backupWebhookUrl(supabaseUrl, token), settings: settingsView(data as Row) },
  });
}

const userHandler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      const parsed = parseTenantRequest(await readJsonBody(request, MAX_REQUEST_BYTES));
      const invalid = () =>
        json(request, {
          error: { code: "invalid_request", message: "Die Angaben sind unvollständig oder ungültig." },
        }, 422);
      if (!parsed) return invalid();
      const admin = context.supabaseAdmin;
      await requireMonitoringAdmin(admin, parsed.tenantId, actorId);
      const { type, tenantId, body } = parsed;
      switch (type) {
        case "get":
          return await get(request, admin, tenantId);
        case "saveSettings": {
          const input = parseSettingsInput(body.settings);
          return input ? await saveSettings(request, admin, actorId, tenantId, input) : invalid();
        }
        case "saveJob": {
          const input = parseJobInput(body.job);
          return input ? await saveJob(request, admin, actorId, tenantId, input) : invalid();
        }
        case "deleteJob":
          return isUuid(body.id) ? await deleteJob(request, admin, actorId, tenantId, body.id.toLowerCase()) : invalid();
        case "listReports":
          return isUuid(body.jobId)
            ? json(request, { data: { reports: await listReports(admin, tenantId, body.jobId.toLowerCase()) } })
            : invalid();
        case "rotateToken":
          return await rotateToken(request, admin, actorId, tenantId);
        default:
          return invalid();
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("backup_monitoring_failed", error instanceof Error ? error.message : "");
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

function reply(body: Row, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const webhookHandler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    }
    const url = new URL(request.url);
    const token = request.headers.get("x-nextdesk-token")?.trim() || url.searchParams.get("token")?.trim() || "";
    if (!TOKEN_PATTERN.test(token)) return reply({ ok: false, error: "unauthorized" }, 401);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_WEBHOOK_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }
    const body = request.method === "POST" ? await request.text().catch(() => null) : "";
    if (body === null || encoder.encode(body).length > MAX_WEBHOOK_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }
    const admin = context.supabaseAdmin;
    const { data: settings, error } = await admin.from("monitoring_backup_settings")
      .select(BACKUP_SETTINGS_COLUMNS).eq("token_hash", await sha256Hex(token)).maybeSingle();
    if (error) return reply({ ok: false, error: "unavailable" }, 503);
    if (!settings) return reply({ ok: false, error: "unauthorized" }, 401);
    const fields = parseBody(body, request.headers.get("content-type"));
    const report = fields ? parseWebhookReport({ ...parseQuery(url), ...fields }) : null;
    if (!report) return reply({ ok: false, error: "unusable_payload" }, 422);
    if (!(settings as BackupSettings).enabled) return reply({ ok: true, ignored: "disabled" });
    try {
      const result = await ingestBackupReport(admin, settings as BackupSettings, {
        ...report,
        source: "webhook",
        subject: null,
      });
      return reply({ ok: true, result });
    } catch (failure) {
      console.error("backup_webhook_failed", failure instanceof Error ? failure.message : "");
      return reply({ ok: false, error: "processing_failed" }, 500);
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
      const result = await checkMissingReports(context.supabaseAdmin);
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      console.error("backup_monitoring_cron_failed", error instanceof Error ? error.message : "");
      return new Response(null, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    if (request.headers.has("x-nextdesk-dispatch-secret")) return cronHandler(request);
    if (request.headers.has("x-nextdesk-token") || new URL(request.url).searchParams.has("token")) {
      return webhookHandler(request);
    }
    return userHandler(request);
  },
};
