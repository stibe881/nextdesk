import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  dbFailure,
  HttpError,
  loadMonitoringOptions,
  optionalInteger,
  optionalPriorityKey,
  optionalText,
  optionalUuid,
  parseTenantRequest,
  readJsonBody,
  requireMonitoringAdmin,
  ticketNumbers,
  validateReferences,
  verifyDispatchSecret,
} from "../_shared/monitoring-admin.ts";
import {
  addMonitoringComment,
  createMonitoringTicket,
  ensureMonitoringServiceIdentity,
  monitoringTicketOpen,
  raiseMonitoringTicketPriority,
  resolveMonitoringTicket,
} from "../_shared/monitoring-tickets.ts";
import { checkCertificate, checkDomain } from "./checks.ts";
import {
  classifyExpiry,
  decideExpiryAction,
  type ExpiryDetails,
  type ExpiryStatus,
  expiryTicketDescription,
  expiryTicketSubject,
  nextCheckDelayMs,
  parseCertificateTarget,
  parseDomainTarget,
  reminderComment,
  renewedComment,
  type TargetKind,
  type TargetText,
  type TicketStage,
} from "./expiry.ts";

/**
 * Certificate and domain expiry monitoring.
 *
 * - Admin actions (tenant.settings.manage): get, saveSettings, saveTarget,
 *   deleteTarget, checkNow.
 * - Cron (header x-nextdesk-dispatch-secret, woken hourly by
 *   public.monitoring_automation_wake('expiry-monitoring')): checks due
 *   targets of enabled tenants.
 * Deploy with `[functions.expiry-monitoring] verify_jwt = false`; user calls
 * are authenticated inside the function (auth: "user").
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_TARGETS_PER_TENANT = 500;
const CRON_BATCH = 40;
const CONCURRENCY = 4;

export type SettingsInput = {
  enabled: boolean;
  departmentId: string | null;
  priorityKey: string | null;
  reminderPriorityKey: string | null;
  warnDays: number;
  reminderDays: number;
  autoResolve: boolean;
};

export type TargetInput = {
  id: string | null;
  kind: TargetKind;
  host: string;
  port: number | null;
  label: string | null;
  departmentId: string | null;
  assetId: string | null;
  serviceId: string | null;
  warnDays: number | null;
  active: boolean;
};

export function parseSettingsInput(value: unknown): SettingsInput | null {
  if (!isRecord(value)) return null;
  const departmentId = optionalUuid(value.departmentId);
  const priorityKey = optionalPriorityKey(value.priorityKey);
  const reminderPriorityKey = optionalPriorityKey(value.reminderPriorityKey);
  const warnDays = optionalInteger(value.warnDays, 1, 180);
  const reminderDays = optionalInteger(value.reminderDays, 0, 90);
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.autoResolve !== "boolean" ||
    departmentId === undefined ||
    priorityKey === undefined ||
    reminderPriorityKey === undefined ||
    typeof warnDays !== "number" ||
    typeof reminderDays !== "number" ||
    reminderDays >= warnDays
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    departmentId,
    priorityKey,
    reminderPriorityKey,
    warnDays,
    reminderDays,
    autoResolve: value.autoResolve,
  };
}

export function parseTargetInput(value: unknown): TargetInput | null {
  if (!isRecord(value)) return null;
  const id = optionalUuid(value.id);
  const kind = value.kind === "certificate" || value.kind === "domain" ? value.kind : null;
  const label = optionalText(value.label, 200);
  const departmentId = optionalUuid(value.departmentId);
  const assetId = optionalUuid(value.assetId);
  const serviceId = optionalUuid(value.serviceId);
  const warnDays = optionalInteger(value.warnDays, 1, 180);
  if (
    id === undefined || !kind || label === undefined || departmentId === undefined ||
    assetId === undefined || serviceId === undefined || warnDays === undefined
  ) {
    return null;
  }
  let host: string | null;
  let port: number | null = null;
  if (kind === "certificate") {
    const parsed = parseCertificateTarget(value.host, value.port);
    host = parsed?.host ?? null;
    port = parsed?.port ?? null;
  } else {
    host = parseDomainTarget(value.host);
  }
  if (!host) return null;
  return {
    id,
    kind,
    host,
    port,
    label,
    departmentId,
    assetId,
    serviceId,
    warnDays,
    active: value.active !== false,
  };
}

type Settings = {
  tenant_id: string;
  enabled: boolean;
  department_id: string | null;
  priority_key: string | null;
  reminder_priority_key: string | null;
  warn_days: number;
  reminder_days: number;
  auto_resolve: boolean;
};

const DEFAULT_SETTINGS: Omit<Settings, "tenant_id"> = {
  enabled: false,
  department_id: null,
  priority_key: null,
  reminder_priority_key: null,
  warn_days: 30,
  reminder_days: 7,
  auto_resolve: true,
};

type Target = {
  id: string;
  tenant_id: string;
  kind: TargetKind;
  host: string;
  port: number | null;
  label: string | null;
  department_id: string | null;
  asset_id: string | null;
  service_id: string | null;
  warn_days: number | null;
  expires_at: string | null;
  consecutive_errors: number;
  ticket_id: string | null;
  ticket_stage: TicketStage | null;
  ticket_expires_at: string | null;
};

const TARGET_COLUMNS =
  "id, tenant_id, kind, host, port, label, department_id, asset_id, service_id, warn_days, expires_at, consecutive_errors, ticket_id, ticket_stage, ticket_expires_at";

function settingsView(row: Row | null) {
  const value = { ...DEFAULT_SETTINGS, ...(row ?? {}) } as Row;
  return {
    configured: row !== null,
    enabled: value.enabled === true,
    departmentId: (value.department_id as string | null) ?? null,
    priorityKey: (value.priority_key as string | null) ?? null,
    reminderPriorityKey: (value.reminder_priority_key as string | null) ?? null,
    warnDays: Number(value.warn_days),
    reminderDays: Number(value.reminder_days),
    autoResolve: value.auto_resolve === true,
    lastRunAt: (value.last_run_at as string | null) ?? null,
  };
}

async function loadSettings(admin: Admin, tenantId: string): Promise<Settings> {
  const { data, error } = await admin
    .from("monitoring_expiry_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw dbFailure();
  return { tenant_id: tenantId, ...DEFAULT_SETTINGS, ...(data ?? {}) } as Settings;
}

async function names(
  admin: Admin,
  table: "assets" | "services",
  tenantId: string,
  ids: unknown[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (!unique.length) return new Map();
  const { data, error } = await admin.from(table).select("id, name").eq("tenant_id", tenantId).in("id", unique);
  if (error) throw dbFailure();
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]));
}

async function listTargets(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("monitoring_expiry_targets")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("expires_at", { ascending: true, nullsFirst: true })
    .limit(MAX_TARGETS_PER_TENANT);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  const [numbers, assets, services] = await Promise.all([
    ticketNumbers(admin, tenantId, rows.map((row) => row.ticket_id)),
    names(admin, "assets", tenantId, rows.map((row) => row.asset_id)),
    names(admin, "services", tenantId, rows.map((row) => row.service_id)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    host: row.host,
    port: row.port ?? null,
    label: row.label ?? null,
    departmentId: row.department_id ?? null,
    assetId: row.asset_id ?? null,
    assetName: typeof row.asset_id === "string" ? assets.get(row.asset_id) ?? null : null,
    serviceId: row.service_id ?? null,
    serviceName: typeof row.service_id === "string" ? services.get(row.service_id) ?? null : null,
    warnDays: row.warn_days ?? null,
    active: row.active === true,
    status: row.status,
    expiresAt: row.expires_at ?? null,
    issuer: row.issuer ?? null,
    subject: row.subject ?? null,
    san: Array.isArray(row.san) ? row.san : [],
    serial: row.serial ?? null,
    registrar: row.registrar ?? null,
    checkMethod: row.check_method ?? null,
    lastError: row.last_error ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    nextCheckAt: row.next_check_at ?? null,
    ticketId: row.ticket_id ?? null,
    ticketNumber: typeof row.ticket_id === "string" ? numbers.get(row.ticket_id) ?? null : null,
    ticketStage: row.ticket_stage ?? null,
  }));
}

// Check processing ------------------------------------------------------------

type CheckOutcome = {
  status: ExpiryStatus;
  details: ExpiryDetails | null;
  error: string | null;
};

async function runCheck(target: Target, now: number, warnDays: number): Promise<CheckOutcome> {
  if (target.kind === "certificate") {
    const result = await checkCertificate(target.host, target.port ?? 443);
    if (!result.ok) return { status: "error", details: null, error: result.error };
    const details: ExpiryDetails = {
      expiresAt: result.certificate.expiresAt,
      issuer: result.certificate.issuer,
      subject: result.certificate.subject,
      san: result.certificate.san,
      serial: result.certificate.serial,
      registrar: null,
      statuses: [],
      method: result.method,
    };
    return { status: classifyExpiry(details.expiresAt, now, warnDays), details, error: result.note };
  }
  const result = await checkDomain(target.host);
  if (!result.ok) return { status: "error", details: null, error: result.error };
  const details: ExpiryDetails = {
    expiresAt: result.info.expiresAt,
    issuer: null,
    subject: null,
    san: [],
    serial: null,
    registrar: result.info.registrar,
    statuses: result.info.statuses,
    method: "rdap",
  };
  return { status: classifyExpiry(details.expiresAt, now, warnDays), details, error: null };
}

export async function processTarget(admin: Admin, settings: Settings, target: Target): Promise<string> {
  const now = Date.now();
  const warnDays = target.warn_days ?? settings.warn_days;
  const reminderDays = Math.min(settings.reminder_days, warnDays - 1);
  const outcome = await runCheck(target, now, warnDays);
  const errors = outcome.status === "error" ? target.consecutive_errors + 1 : 0;
  const update: Row = {
    status: outcome.status,
    last_checked_at: new Date(now).toISOString(),
    next_check_at: new Date(now + nextCheckDelayMs(outcome.status, errors)).toISOString(),
    last_error: outcome.error,
    consecutive_errors: errors,
  };
  if (outcome.details) {
    Object.assign(update, {
      expires_at: outcome.details.expiresAt,
      issuer: outcome.details.issuer,
      subject: outcome.details.subject,
      san: outcome.details.san,
      serial: outcome.details.serial,
      registrar: outcome.details.registrar,
      check_method: outcome.details.method,
    });
  }

  let result = "checked";
  if (outcome.details && settings.enabled) {
    const open = await monitoringTicketOpen(admin, target.tenant_id, target.ticket_id);
    const action = decideExpiryAction({
      expiresAt: outcome.details.expiresAt,
      now,
      warnDays,
      reminderDays,
      ticket: { open, stage: target.ticket_stage, expiresAt: target.ticket_expires_at },
    });
    if (action.type !== "none") {
      const [assets, services] = await Promise.all([
        names(admin, "assets", target.tenant_id, [target.asset_id]),
        names(admin, "services", target.tenant_id, [target.service_id]),
      ]);
      const text: TargetText = {
        kind: target.kind,
        host: target.host,
        port: target.port,
        label: target.label,
        assetName: target.asset_id ? assets.get(target.asset_id) ?? null : null,
        serviceName: target.service_id ? services.get(target.service_id) ?? null : null,
      };
      const identity = await ensureMonitoringServiceIdentity(admin);
      const source = target.kind;
      const raised = [settings.reminder_priority_key, "urgent", "high"];
      if (action.type === "create") {
        const ticket = await createMonitoringTicket(admin, {
          tenantId: target.tenant_id,
          departmentIds: [target.department_id, settings.department_id],
          priorityKeys: action.stage === "reminded" ? raised : [settings.priority_key, "high", "normal"],
          subject: expiryTicketSubject(text, outcome.details.expiresAt, now),
          description: expiryTicketDescription(text, outcome.details, now, action.stage),
          assetId: target.asset_id,
          source,
          metadata: { targetId: target.id, expiresAt: outcome.details.expiresAt, stage: action.stage },
        }, identity);
        Object.assign(update, {
          ticket_id: ticket.id,
          ticket_stage: action.stage,
          ticket_expires_at: outcome.details.expiresAt,
        });
        result = "ticket_created";
      } else if (action.type === "remind" && target.ticket_id) {
        await addMonitoringComment(
          admin,
          target.ticket_id,
          identity,
          reminderComment(text, outcome.details.expiresAt, now),
          source,
        );
        await raiseMonitoringTicketPriority(admin, target.tenant_id, target.ticket_id, raised, identity, source);
        update.ticket_stage = "reminded";
        result = "reminded";
      } else if (action.type === "renewed" && target.ticket_id) {
        await addMonitoringComment(
          admin,
          target.ticket_id,
          identity,
          renewedComment(text, target.ticket_expires_at, outcome.details.expiresAt),
          source,
        );
        if (settings.auto_resolve) {
          await resolveMonitoringTicket(admin, target.tenant_id, target.ticket_id, identity, source);
        }
        Object.assign(update, { ticket_id: null, ticket_stage: null, ticket_expires_at: null });
        result = "renewed";
      }
    }
  }
  const { error } = await admin.from("monitoring_expiry_targets").update(update).eq("id", target.id);
  if (error) throw new Error("target_update_failed");
  return result;
}

async function runCron(admin: Admin): Promise<Record<string, number>> {
  const { data: tenants, error } = await admin
    .from("monitoring_expiry_settings")
    .select("*")
    .eq("enabled", true)
    .limit(1000);
  if (error) throw new Error("settings_lookup_failed");
  const settingsByTenant = new Map(((tenants ?? []) as Settings[]).map((row) => [row.tenant_id, row]));
  if (!settingsByTenant.size) return { checked: 0 };
  const due = await admin
    .from("monitoring_expiry_targets")
    .select(TARGET_COLUMNS)
    .eq("active", true)
    .lte("next_check_at", new Date().toISOString())
    .in("tenant_id", [...settingsByTenant.keys()])
    .order("next_check_at")
    .limit(CRON_BATCH);
  if (due.error) throw new Error("target_lookup_failed");
  const queue = [...((due.data ?? []) as Target[])];
  const counts: Record<string, number> = { checked: 0, failed: 0 };
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try {
        const result = await processTarget(admin, settingsByTenant.get(target.tenant_id)!, target);
        counts.checked = (counts.checked ?? 0) + 1;
        counts[result] = (counts[result] ?? 0) + 1;
      } catch (failure) {
        counts.failed = (counts.failed ?? 0) + 1;
        console.error("expiry_target_failed", failure instanceof Error ? failure.message : "");
        // Retry later instead of hammering a broken target.
        await admin.from("monitoring_expiry_targets")
          .update({ next_check_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq("id", target.id);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const now = new Date().toISOString();
  await admin.from("monitoring_expiry_settings").update({ last_run_at: now })
    .in("tenant_id", [...settingsByTenant.keys()]);
  return counts;
}

// Admin actions ---------------------------------------------------------------

async function get(request: Request, admin: Admin, tenantId: string) {
  const [settings, targets, options] = await Promise.all([
    admin.from("monitoring_expiry_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    listTargets(admin, tenantId),
    loadMonitoringOptions(admin, tenantId),
  ]);
  if (settings.error) throw dbFailure();
  return json(request, {
    data: { settings: settingsView((settings.data as Row | null) ?? null), targets, ...options },
  });
}

async function saveSettings(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
  input: SettingsInput,
) {
  await validateReferences(admin, tenantId, {
    departmentId: input.departmentId,
    priorityKeys: [input.priorityKey, input.reminderPriorityKey],
  });
  const { data, error } = await admin
    .from("monitoring_expiry_settings")
    .upsert({
      tenant_id: tenantId,
      enabled: input.enabled,
      department_id: input.departmentId,
      priority_key: input.priorityKey,
      reminder_priority_key: input.reminderPriorityKey,
      warn_days: input.warnDays,
      reminder_days: input.reminderDays,
      auto_resolve: input.autoResolve,
    }, { onConflict: "tenant_id" })
    .select("*")
    .single();
  if (error || !data) throw dbFailure();
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.expiry.settings_updated",
    entity_type: "monitoring_expiry_settings",
    entity_id: tenantId,
    severity: "info",
    metadata: { enabled: input.enabled, warnDays: input.warnDays, reminderDays: input.reminderDays },
  });
  return json(request, { data: { settings: settingsView(data as Row) } });
}

async function saveTarget(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
  input: TargetInput,
) {
  await validateReferences(admin, tenantId, {
    departmentId: input.departmentId,
    assetId: input.assetId,
    serviceId: input.serviceId,
  });
  const values = {
    kind: input.kind,
    host: input.host,
    port: input.port,
    label: input.label,
    department_id: input.departmentId,
    asset_id: input.assetId,
    service_id: input.serviceId,
    warn_days: input.warnDays,
    active: input.active,
  };
  let saved;
  if (input.id) {
    const existing = await admin.from("monitoring_expiry_targets").select("id, kind, host, port")
      .eq("tenant_id", tenantId).eq("id", input.id).maybeSingle();
    if (existing.error) throw dbFailure();
    if (!existing.data) throw new HttpError(404, "target_not_found", "Der Eintrag wurde nicht gefunden.");
    const changedTarget = existing.data.kind !== input.kind || existing.data.host !== input.host ||
      (existing.data.port ?? null) !== input.port;
    saved = await admin.from("monitoring_expiry_targets")
      .update({
        ...values,
        ...(changedTarget
          ? { status: "pending", expires_at: null, next_check_at: new Date().toISOString(), consecutive_errors: 0 }
          : {}),
      })
      .eq("tenant_id", tenantId).eq("id", input.id).select("id").single();
  } else {
    const { count, error } = await admin.from("monitoring_expiry_targets")
      .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (error) throw dbFailure();
    if ((count ?? 0) >= MAX_TARGETS_PER_TENANT) {
      throw new HttpError(422, "target_limit", "Es können höchstens 500 Einträge überwacht werden.");
    }
    saved = await admin.from("monitoring_expiry_targets")
      .insert({ tenant_id: tenantId, ...values }).select("id").single();
  }
  if (saved.error) {
    if (saved.error.code === "23505") {
      throw new HttpError(409, "target_exists", "Dieser Eintrag wird bereits überwacht.");
    }
    throw dbFailure();
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: input.id ? "monitoring.expiry.target_updated" : "monitoring.expiry.target_created",
    entity_type: "monitoring_expiry_target",
    entity_id: saved.data.id,
    severity: "info",
    metadata: { kind: input.kind, host: input.host, port: input.port },
  });
  return json(request, { data: { id: saved.data.id, targets: await listTargets(admin, tenantId) } });
}

async function deleteTarget(request: Request, admin: Admin, actorId: string, tenantId: string, id: string) {
  const { data, error } = await admin.from("monitoring_expiry_targets").delete()
    .eq("tenant_id", tenantId).eq("id", id).select("id, kind, host");
  if (error) throw dbFailure();
  if (!Array.isArray(data) || data.length === 0) {
    throw new HttpError(404, "target_not_found", "Der Eintrag wurde nicht gefunden.");
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.expiry.target_deleted",
    entity_type: "monitoring_expiry_target",
    entity_id: id,
    severity: "info",
    metadata: { kind: data[0].kind, host: data[0].host },
  });
  return json(request, { data: { targets: await listTargets(admin, tenantId) } });
}

async function checkNow(request: Request, admin: Admin, tenantId: string, id: string) {
  const { data, error } = await admin.from("monitoring_expiry_targets").select(TARGET_COLUMNS)
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "target_not_found", "Der Eintrag wurde nicht gefunden.");
  const settings = await loadSettings(admin, tenantId);
  const result = await processTarget(admin, settings, data as Target);
  return json(request, { data: { result, targets: await listTargets(admin, tenantId) } });
}

const userHandler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
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
        case "saveTarget": {
          const input = parseTargetInput(body.target);
          return input ? await saveTarget(request, admin, actorId, tenantId, input) : invalid();
        }
        case "deleteTarget":
          return isUuid(body.id)
            ? await deleteTarget(request, admin, actorId, tenantId, body.id.toLowerCase())
            : invalid();
        case "checkNow":
          return isUuid(body.id) ? await checkNow(request, admin, tenantId, body.id.toLowerCase()) : invalid();
        default:
          return invalid();
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("expiry_monitoring_failed", error instanceof Error ? error.message : "");
      return json(request, { error: { code: "internal_error" } }, 500);
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
      const result = await runCron(context.supabaseAdmin);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("expiry_monitoring_cron_failed", error instanceof Error ? error.message : "");
      return new Response(null, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    if (request.headers.has("x-nextdesk-dispatch-secret")) return cronHandler(request);
    return userHandler(request);
  },
};
