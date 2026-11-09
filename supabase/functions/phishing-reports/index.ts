import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  analyzeMail,
  bytesToBinary,
  type ParsedMail,
  parseMime,
  parsePastedMail,
  type PhishingSource,
  selectOriginal,
} from "../_shared/phishing-analysis.ts";
import { isCompoundFile, parseOutlookMsg } from "../_shared/outlook-msg.ts";
import {
  createSecurityTicket,
  finalizePhishingReport,
  loadPhishingSettings,
  reportFingerprint,
  tenantReferenceDomains,
  THANK_YOU_TEXT,
} from "../_shared/phishing-report-intake.ts";

/**
 * «Phishing melden» (web portal and app): the person uploads a .eml/.msg file
 * or pastes the headers/source. The server analyses it (no link or attachment
 * is opened), creates a security ticket with an internal risk summary and
 * notifies the security team. The reporter only gets a thank-you.
 * Administrators configure the report address, target department/category,
 * priority and the security team here as well.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_CHARACTERS = 7_200_000;
const MAX_PASTE_CHARACTERS = 1_000_000;
const MAX_REPORTS_PER_HOUR = 10;

type SubmitAction = {
  type: "submit";
  tenantId: string;
  channel: "portal" | "mobile";
  fileName: string | null;
  fileBase64: string | null;
  rawText: string | null;
};
type SettingsInput = {
  enabled: boolean;
  reportAddress: string | null;
  departmentId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  priorityKey: "low" | "normal" | "high" | "urgent";
  notifyTeamId: string | null;
};
type CreateCategoryAction = {
  type: "createCategory";
  tenantId: string;
  departmentId: string;
  parentId: string | null;
  name: string;
};
type Action =
  | { type: "getConfig"; tenantId: string }
  | { type: "getSettings"; tenantId: string }
  | ({ type: "saveSettings"; tenantId: string } & SettingsInput)
  | CreateCategoryAction
  | SubmitAction;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const unavailable = () =>
  new HttpError(503, "phishing_reports_unavailable", "Die Phishing-Meldung ist gerade nicht verfügbar.");

const EMAIL = /^[^@\s]+@[a-z0-9.-]+\.[a-z0-9-]{2,}$/;

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return isUuid(value) ? value : undefined;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId;
  if (value.type === "getConfig" || value.type === "getSettings") {
    return { type: value.type, tenantId };
  }
  if (value.type === "saveSettings") {
    const reportAddress = typeof value.reportAddress === "string" && value.reportAddress.trim()
      ? value.reportAddress.trim().toLowerCase()
      : null;
    const departmentId = optionalUuid(value.departmentId);
    const categoryId = optionalUuid(value.categoryId);
    const subcategoryId = optionalUuid(value.subcategoryId);
    const notifyTeamId = optionalUuid(value.notifyTeamId);
    const priorityKey = value.priorityKey;
    if (
      typeof value.enabled !== "boolean" ||
      (reportAddress !== null && (!EMAIL.test(reportAddress) || reportAddress.length > 320)) ||
      departmentId === undefined || categoryId === undefined || subcategoryId === undefined ||
      notifyTeamId === undefined ||
      (priorityKey !== "low" && priorityKey !== "normal" && priorityKey !== "high" &&
        priorityKey !== "urgent")
    ) {
      return null;
    }
    return {
      type: "saveSettings",
      tenantId,
      enabled: value.enabled,
      reportAddress,
      departmentId,
      categoryId,
      subcategoryId: categoryId ? subcategoryId : null,
      priorityKey,
      notifyTeamId,
    };
  }
  if (value.type === "createCategory") {
    const departmentId = optionalUuid(value.departmentId);
    const parentId = optionalUuid(value.parentId);
    const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
    if (!departmentId || parentId === undefined || name.length < 1 || name.length > 80) {
      return null;
    }
    return { type: "createCategory", tenantId, departmentId, parentId, name };
  }
  if (value.type === "submit") {
    const channel = value.channel === "mobile" ? "mobile" : value.channel === "portal" ? "portal" : null;
    const fileName = typeof value.fileName === "string" && value.fileName.trim()
      ? value.fileName.trim().slice(0, 255)
      : null;
    const fileBase64 = typeof value.fileBase64 === "string" && value.fileBase64.length
      ? value.fileBase64
      : null;
    const rawText = typeof value.rawText === "string" && value.rawText.trim() ? value.rawText : null;
    if (!channel || (fileBase64 === null) === (rawText === null)) return null;
    if (fileBase64 !== null && (!fileName || !/\.(eml|msg|txt)$/i.test(fileName))) return null;
    if (rawText !== null && rawText.length > MAX_PASTE_CHARACTERS) return null;
    return { type: "submit", tenantId, channel, fileName, fileBase64, rawText };
  }
  return null;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/^data:[^,]*,/, "").replace(/\s/g, ""));
    if (binary.length > MAX_FILE_BYTES) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Parses the submitted material into the reported original. */
export function readSubmission(action: Pick<SubmitAction, "fileName" | "fileBase64" | "rawText">): {
  mail: ParsedMail;
  source: PhishingSource;
} | null {
  if (action.rawText !== null) return parsePastedMail(action.rawText);
  const bytes = action.fileBase64 ? decodeBase64(action.fileBase64) : null;
  if (!bytes || bytes.length === 0) return null;
  if (isCompoundFile(bytes)) {
    try {
      return { mail: parseOutlookMsg(bytes), source: "msg" };
    } catch {
      return null;
    }
  }
  if (/\.msg$/i.test(action.fileName ?? "")) return null;
  const mail = parseMime(bytesToBinary(bytes));
  // A saved forward (.eml with the original attached or quoted) is unwrapped;
  // the reported mail itself (with Received headers) is analysed as it is.
  const hasTransportHeaders = mail.headers.some((entry) => entry.name === "received");
  return selectOriginal(mail, mail.headers.length ? "eml" : "text", {
    preferInline: !hasTransportHeaders,
  });
}

async function requireMember(client: Client, tenantId: string): Promise<void> {
  const { data, error } = await client.rpc("is_active_tenant_member", { p_tenant_id: tenantId });
  if (error) throw unavailable();
  if (data !== true) throw new HttpError(403, "forbidden", "Kein Zugriff auf diesen Mandanten.");
}

async function canManage(client: Client, tenantId: string): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  if (error) throw unavailable();
  return data === true;
}

async function settingsOptions(admin: Client, tenantId: string) {
  const [departments, categories, teams] = await Promise.all([
    admin.from("departments").select("id, name").eq("tenant_id", tenantId).eq("active", true)
      .order("name").limit(200),
    admin.from("ticket_categories").select("id, name, department_id, parent_id").eq("tenant_id", tenantId)
      .eq("active", true).order("name").limit(1000),
    admin.from("teams").select("id, name, department_id").eq("tenant_id", tenantId).eq("active", true)
      .order("name").limit(200),
  ]);
  if (departments.error || categories.error || teams.error) throw unavailable();
  return {
    departments: ((departments.data ?? []) as Row[]).map((row) => ({ id: row.id, name: row.name })),
    categories: ((categories.data ?? []) as Row[]).filter((row) => !row.parent_id).map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
    })),
    subcategories: ((categories.data ?? []) as Row[]).filter((row) => row.parent_id).map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.parent_id,
    })),
    teams: ((teams.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id ?? null,
    })),
  };
}

async function handle(
  request: Request,
  admin: Client,
  client: Client,
  action: Action,
  actorId: string,
): Promise<Response> {
  await requireMember(client, action.tenantId);
  const settings = await loadPhishingSettings(admin, action.tenantId);
  if (!settings) throw unavailable();

  if (action.type === "getConfig") {
    return json(request, {
      data: { enabled: settings.enabled, reportAddress: settings.enabled ? settings.reportAddress : null },
    });
  }

  if (action.type === "createCategory") {
    if (!(await canManage(client, action.tenantId))) {
      throw new HttpError(
        403,
        "settings_manage_required",
        "Dafür fehlt Ihnen die Berechtigung «Mandanteneinstellungen verwalten».",
      );
    }
    const options = await settingsOptions(admin, action.tenantId);
    if (
      !options.departments.some((entry) => entry.id === action.departmentId) ||
      (action.parentId && !options.categories.some((entry) =>
        entry.id === action.parentId && entry.departmentId === action.departmentId
      ))
    ) {
      throw new HttpError(422, "category_invalid", "Abteilung oder Kategorie ist ungültig.");
    }
    const siblings = action.parentId
      ? options.subcategories.filter((entry) => entry.categoryId === action.parentId)
      : options.categories.filter((entry) => entry.departmentId === action.departmentId);
    const existing = siblings.find((entry) =>
      String(entry.name).toLocaleLowerCase("de-CH") === action.name.toLocaleLowerCase("de-CH")
    );
    let id = existing ? String(existing.id) : null;
    if (!id) {
      const created = await admin.from("ticket_categories").insert({
        tenant_id: action.tenantId,
        department_id: action.departmentId,
        parent_id: action.parentId,
        name: action.name,
      }).select("id").single();
      if (created.error || !created.data?.id) {
        throw new HttpError(
          409,
          "category_exists",
          "Die Kategorie konnte nicht erstellt werden. Gibt es sie vielleicht schon (inaktiv)?",
        );
      }
      id = String(created.data.id);
      await admin.from("audit_logs").insert({
        tenant_id: action.tenantId,
        actor_id: actorId,
        action: action.parentId ? "ticket_subcategory.created" : "ticket_category.created",
        entity_type: "ticket_categories",
        entity_id: id,
        severity: "info",
        after_data: { name: action.name, departmentId: action.departmentId, parentId: action.parentId },
        metadata: { source: "phishing_report_settings" },
      });
    }
    return json(request, {
      data: { id, options: await settingsOptions(admin, action.tenantId) },
    });
  }

  if (action.type === "getSettings" || action.type === "saveSettings") {
    if (!(await canManage(client, action.tenantId))) {
      throw new HttpError(
        403,
        "settings_manage_required",
        "Dafür fehlt Ihnen die Berechtigung «Mandanteneinstellungen verwalten».",
      );
    }
    if (action.type === "saveSettings") {
      const options = await settingsOptions(admin, action.tenantId);
      if (
        (action.departmentId && !options.departments.some((entry) => entry.id === action.departmentId)) ||
        (action.categoryId && !options.categories.some((entry) =>
          entry.id === action.categoryId && entry.departmentId === action.departmentId
        )) ||
        (action.subcategoryId && !options.subcategories.some((entry) =>
          entry.id === action.subcategoryId && entry.categoryId === action.categoryId
        )) ||
        (action.notifyTeamId && !options.teams.some((entry) => entry.id === action.notifyTeamId))
      ) {
        throw new HttpError(422, "settings_invalid", "Abteilung, Kategorie oder Team ist ungültig.");
      }
      if (action.enabled && !action.departmentId) {
        throw new HttpError(422, "department_required", "Bitte wählen Sie eine Zielabteilung.");
      }
      const { error } = await admin.from("phishing_report_settings").upsert({
        tenant_id: action.tenantId,
        enabled: action.enabled,
        report_address: action.reportAddress,
        department_id: action.departmentId,
        category_id: action.categoryId,
        subcategory_id: action.subcategoryId,
        priority_key: action.priorityKey,
        notify_team_id: action.notifyTeamId,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw unavailable();
      await admin.from("audit_logs").insert({
        tenant_id: action.tenantId,
        actor_id: actorId,
        action: "phishing_reports.settings_updated",
        entity_type: "phishing_report_settings",
        entity_id: action.tenantId,
        severity: "security",
        after_data: {
          enabled: action.enabled,
          hasReportAddress: action.reportAddress !== null,
          departmentId: action.departmentId,
          notifyTeamId: action.notifyTeamId,
        },
        metadata: {},
      });
    }
    const current = action.type === "saveSettings"
      ? {
        enabled: action.enabled,
        reportAddress: action.reportAddress,
        departmentId: action.departmentId,
        categoryId: action.categoryId,
        subcategoryId: action.subcategoryId,
        priorityKey: action.priorityKey,
        notifyTeamId: action.notifyTeamId,
      }
      : settings;
    return json(request, {
      data: { settings: current, options: await settingsOptions(admin, action.tenantId) },
    });
  }

  // submit
  if (!settings.enabled) {
    throw new HttpError(
      403,
      "phishing_reports_disabled",
      "Phishing-Meldungen sind für diesen Mandanten nicht eingerichtet.",
    );
  }
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const recent = await admin.from("phishing_reports").select("id", { count: "exact", head: true })
    .eq("tenant_id", action.tenantId).eq("reporter_id", actorId).gte("created_at", since);
  if (!recent.error && Number(recent.count ?? 0) >= MAX_REPORTS_PER_HOUR) {
    throw new HttpError(429, "too_many_reports", "Sie haben in kurzer Zeit sehr viele Meldungen gesendet. Bitte versuchen Sie es später erneut.");
  }
  const submission = readSubmission(action);
  if (!submission) {
    throw new HttpError(
      422,
      "submission_unreadable",
      "Die E-Mail konnte nicht gelesen werden. Laden Sie eine .eml- oder .msg-Datei hoch oder fügen Sie die Kopfzeilen ein.",
    );
  }
  const references = await tenantReferenceDomains(admin, action.tenantId);
  const analysis = analyzeMail(submission.mail, { source: submission.source, referenceDomains: references });
  const fingerprint = await reportFingerprint(submission.mail);

  // The same person reporting the same mail again gets the existing ticket.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const duplicate = await admin.from("phishing_reports")
    .select("ticket_id, tickets(ticket_number)")
    .eq("tenant_id", action.tenantId).eq("reporter_id", actorId).eq("fingerprint", fingerprint)
    .gte("created_at", weekAgo).not("ticket_id", "is", null).limit(1).maybeSingle();
  const duplicateTicket = duplicate.data
    ? (Array.isArray(duplicate.data.tickets) ? duplicate.data.tickets[0] : duplicate.data.tickets)
    : null;
  if (duplicate.data?.ticket_id && duplicateTicket?.ticket_number) {
    return json(request, {
      data: {
        ticketId: duplicate.data.ticket_id,
        ticketNumber: duplicateTicket.ticket_number,
        duplicate: true,
        message: "Danke für die Meldung! Diese E-Mail haben Sie bereits gemeldet – unser Sicherheitsteam ist informiert.",
      },
    });
  }

  await admin.from("user_profiles").upsert({ id: actorId });
  let ticket: { id: string; ticketNumber: string };
  try {
    ticket = await createSecurityTicket(admin, {
      tenantId: action.tenantId,
      settings,
      reporterId: actorId,
      analysis,
    });
  } catch (error) {
    console.error("phishing_ticket_failed", error instanceof Error ? error.message : "");
    throw unavailable();
  }
  try {
    await finalizePhishingReport(admin, {
      tenantId: action.tenantId,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      noteAuthorId: actorId,
      reporterId: actorId,
      reporterEmail: null,
      channel: action.channel,
      analysis,
      fingerprint,
    });
  } catch (error) {
    // The ticket exists; the report row is the only missing piece.
    console.error("phishing_report_finalize_failed", error instanceof Error ? error.message : "");
  }
  return json(request, {
    data: {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      duplicate: false,
      message: THANK_YOU_TEXT,
    },
  }, 201);
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
      const text = await request.text().catch(() => "");
      if (text.length > MAX_REQUEST_CHARACTERS) {
        return json(request, {
          error: { code: "payload_too_large", message: "Die Datei ist zu gross (max. 5 MB)." },
        }, 413);
      }
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const action = parseAction(body);
      if (!action) {
        return json(request, {
          error: { code: "invalid_request", message: "Die Anfrage ist ungültig." },
        }, 422);
      }
      return await handle(request, context.supabaseAdmin, context.supabase, action, actorId);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("phishing_reports_failed", error instanceof Error ? error.message : "");
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
