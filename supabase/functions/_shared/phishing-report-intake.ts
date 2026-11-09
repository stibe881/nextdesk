// «Phishing melden»: turns an analysed report into a security ticket, stores
// the analysis, writes the internal risk summary and notifies the security
// team. Used by the edge function phishing-reports (portal/app upload) and by
// the Exchange inbound processing (forward to the report address).

import {
  domainOf,
  type ParsedMail,
  type PhishingAnalysis,
  riskLevelLabel,
  storedAnalysis,
  summaryText,
} from "./phishing-analysis.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type PhishingSettings = {
  enabled: boolean;
  reportAddress: string | null;
  departmentId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  priorityKey: "low" | "normal" | "high" | "urgent";
  notifyTeamId: string | null;
};

export type PhishingChannel = "email" | "portal" | "mobile";

export const THANK_YOU_TEXT =
  "Danke für die Meldung! Unser Sicherheitsteam prüft die E-Mail. Bitte klicken Sie keine Links an und öffnen Sie keine Anhänge dieser Nachricht. Wenn Sie bereits Daten eingegeben haben, melden Sie sich bitte umgehend beim Support.";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseSettingsRow(row: Row | null | undefined): PhishingSettings {
  const priority = row?.priority_key;
  return {
    enabled: row?.enabled === true,
    reportAddress: text(row?.report_address)?.toLowerCase() ?? null,
    departmentId: text(row?.department_id),
    categoryId: text(row?.category_id),
    subcategoryId: text(row?.subcategory_id),
    priorityKey: priority === "low" || priority === "normal" || priority === "urgent"
      ? priority
      : "high",
    notifyTeamId: text(row?.notify_team_id),
  };
}

export async function loadPhishingSettings(
  admin: Admin,
  tenantId: string,
): Promise<PhishingSettings | null> {
  const { data, error } = await admin
    .from("phishing_report_settings")
    .select("enabled, report_address, department_id, category_id, subcategory_id, priority_key, notify_team_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return null;
  return parseSettingsRow(data as Row | null);
}

/** Whether a message was sent (To/Cc) to the configured report address. */
export function isReportRecipient(
  settings: PhishingSettings | null,
  recipients: readonly string[],
): boolean {
  if (!settings?.enabled || !settings.reportAddress) return false;
  const target = settings.reportAddress.toLowerCase();
  return recipients.some((address) => address.trim().toLowerCase() === target);
}

/**
 * When the report address is the support mailbox itself, only messages that
 * are explicitly marked as a report count (e.g. «WG: Phishing …»); every
 * other mail to the support mailbox stays an ordinary ticket.
 */
export function isMarkedPhishingReport(subject: string | null | undefined): boolean {
  return /phishing|verd(ä|ae)chtig/i.test(subject ?? "");
}

/**
 * Whether an inbound mail is a phishing report. A separate report address
 * (alias) in To/Cc always counts; the shared support mailbox only counts
 * with a marked subject.
 */
export function isPhishingReportMail(
  settings: PhishingSettings | null,
  input: { mailboxAddress: string; recipients: readonly string[]; subject?: string | null },
): boolean {
  if (!settings?.enabled || !settings.reportAddress) return false;
  const target = settings.reportAddress.toLowerCase();
  if (target === input.mailboxAddress.trim().toLowerCase()) {
    return isMarkedPhishingReport(input.subject);
  }
  return isReportRecipient(settings, input.recipients);
}

/** The tenant's own mail domains: lookalikes of these are flagged. */
export async function tenantReferenceDomains(admin: Admin, tenantId: string): Promise<string[]> {
  const [sso, channels, settings] = await Promise.all([
    admin.from("tenant_sso_configurations").select("allowed_email_domains")
      .eq("tenant_id", tenantId).maybeSingle(),
    admin.from("exchange_mail_channels").select("mailbox_address")
      .eq("tenant_id", tenantId).is("deleted_at", null).limit(20),
    admin.from("phishing_report_settings").select("report_address")
      .eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const domains = new Set<string>();
  for (const domain of (sso.data?.allowed_email_domains ?? []) as unknown[]) {
    if (typeof domain === "string" && domain.includes(".")) domains.add(domain.toLowerCase());
  }
  for (const row of (channels.data ?? []) as Row[]) {
    const domain = domainOf(text(row.mailbox_address));
    if (domain) domains.add(domain);
  }
  const reportDomain = domainOf(text(settings.data?.report_address));
  if (reportDomain) domains.add(reportDomain);
  return [...domains].slice(0, 30);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Same original (Message-ID, otherwise sender+subject+body) → same fingerprint. */
export async function reportFingerprint(mail: ParsedMail): Promise<string> {
  const messageId = mail.headers.find((entry) => entry.name === "message-id")?.value?.trim();
  if (messageId) return await sha256Hex(`mid:${messageId.toLowerCase()}`);
  const from = mail.headers.find((entry) => entry.name === "from")?.value ?? "";
  const subject = mail.headers.find((entry) => entry.name === "subject")?.value ?? "";
  return await sha256Hex(`c:${from}\n${subject}\n${(mail.text || mail.html).slice(0, 5000)}`);
}

export function securityTicketSubject(analysis: PhishingAnalysis): string {
  const subject = analysis.headers.subject?.replace(/\s+/g, " ").trim() || "ohne Betreff";
  return `Phishing-Meldung: ${subject}`.slice(0, 240);
}

/** Requester-visible description: no links, no analysis details. */
export function securityTicketDescription(
  analysis: PhishingAnalysis,
  reporterLabel: string,
): string {
  const h = analysis.headers;
  return [
    `Verdächtige E-Mail gemeldet von ${reporterLabel}.`,
    "",
    `Absender: ${h.fromAddress ?? "unbekannt"}`,
    `Betreff: ${h.subject ?? "–"}`,
    h.date ? `Datum: ${h.date}` : null,
    "",
    "Die automatische Risikoeinschätzung steht als interne Notiz im Ticket.",
  ].filter((line): line is string => line !== null).join("\n").slice(0, 5000);
}

async function priorityId(admin: Admin, tenantId: string, key: string): Promise<string | null> {
  const { data } = await admin.from("ticket_priorities").select("id, key")
    .eq("tenant_id", tenantId).in("key", [key, "high", "normal"]);
  const rows = (data ?? []) as Row[];
  return text(rows.find((row) => row.key === key)?.id) ??
    text(rows.find((row) => row.key === "high")?.id) ??
    text(rows.find((row) => row.key === "normal")?.id);
}

async function targetDepartment(
  admin: Admin,
  tenantId: string,
  settings: PhishingSettings,
): Promise<{ id: string; key: string } | null> {
  const query = admin.from("departments").select("id, key").eq("tenant_id", tenantId)
    .eq("active", true);
  const { data } = settings.departmentId
    ? await query.eq("id", settings.departmentId).maybeSingle()
    : await query.order("key").limit(1).maybeSingle();
  const row = data as Row | null;
  if (row?.id) return { id: String(row.id), key: String(row.key ?? "SEC") };
  if (settings.departmentId) {
    return await targetDepartment(admin, tenantId, { ...settings, departmentId: null });
  }
  return null;
}

async function validCategory(
  admin: Admin,
  tenantId: string,
  departmentId: string,
  categoryId: string | null,
): Promise<string | null> {
  if (!categoryId) return null;
  const { data } = await admin.from("ticket_categories").select("id")
    .eq("id", categoryId).eq("tenant_id", tenantId).eq("department_id", departmentId)
    .eq("active", true).is("parent_id", null).maybeSingle();
  return text((data as Row | null)?.id);
}

async function validSubcategory(
  admin: Admin,
  tenantId: string,
  departmentId: string,
  categoryId: string | null,
  subcategoryId: string | null,
): Promise<string | null> {
  if (!categoryId || !subcategoryId) return null;
  const { data } = await admin.from("ticket_categories").select("id")
    .eq("id", subcategoryId).eq("tenant_id", tenantId).eq("department_id", departmentId)
    .eq("active", true).eq("parent_id", categoryId).maybeSingle();
  return text((data as Row | null)?.id);
}

async function requesterContactFor(
  admin: Admin,
  tenantId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const existing = await admin.from("ticket_requesters").select("id, display_name")
    .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (existing.data?.id) {
    return { id: existing.data.id, name: text(existing.data.display_name) ?? "Mitarbeitende Person" };
  }
  const profile = await admin.from("user_profiles").select("display_name").eq("id", userId)
    .maybeSingle();
  const candidate = text(profile.data?.display_name);
  const name = candidate && !candidate.includes("@") ? candidate.slice(0, 120) : "Angemeldete Person";
  const created = await admin.from("ticket_requesters").insert({
    tenant_id: tenantId,
    user_id: userId,
    display_name: name,
    email: null,
    source: "portal",
  }).select("id, display_name").single();
  if (created.data?.id) return { id: created.data.id, name };
  if (created.error?.code === "23505") {
    const again = await admin.from("ticket_requesters").select("id, display_name")
      .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    if (again.data?.id) return { id: again.data.id, name: text(again.data.display_name) ?? name };
  }
  return null;
}

/** Creates the security ticket for a report from the portal or the app. */
export async function createSecurityTicket(
  admin: Admin,
  input: {
    tenantId: string;
    settings: PhishingSettings;
    reporterId: string;
    analysis: PhishingAnalysis;
  },
): Promise<{ id: string; ticketNumber: string }> {
  const department = await targetDepartment(admin, input.tenantId, input.settings);
  const [status, priority, contact] = await Promise.all([
    admin.from("ticket_statuses").select("id").eq("tenant_id", input.tenantId).eq("key", "new")
      .maybeSingle(),
    priorityId(admin, input.tenantId, input.settings.priorityKey),
    requesterContactFor(admin, input.tenantId, input.reporterId),
  ]);
  if (!department || !status.data?.id || !priority || !contact) {
    throw new Error("ticket_defaults_unavailable");
  }
  const category = await validCategory(admin, input.tenantId, department.id, input.settings.categoryId);
  const number = await admin.rpc("reserve_ticket_number", {
    p_tenant_id: input.tenantId,
    p_department_id: department.id,
    p_prefix: department.key.slice(0, 8),
  });
  if (number.error || typeof number.data !== "string") throw new Error("ticket_number_failed");
  const created = await admin.from("tickets").insert({
    tenant_id: input.tenantId,
    department_id: department.id,
    ticket_number: number.data,
    subject: securityTicketSubject(input.analysis),
    description: securityTicketDescription(input.analysis, contact.name),
    status_id: status.data.id,
    priority_id: priority,
    category_id: category,
    subcategory_id: await validSubcategory(
      admin,
      input.tenantId,
      department.id,
      category,
      input.settings.subcategoryId,
    ),
    requester_id: input.reporterId,
    requester_contact_id: contact.id,
    source: "portal",
  }).select("id, ticket_number").single()
    .setHeader("x-nextdesk-actor-id", input.reporterId);
  if (created.error || !created.data?.id) throw new Error("ticket_create_failed");
  await admin.from("ticket_events").insert({
    ticket_id: created.data.id,
    actor_id: input.reporterId,
    event_type: "ticket.created",
    payload: { source: "phishing_report" },
  });
  return { id: created.data.id, ticketNumber: created.data.ticket_number };
}

/** Moves a ticket created from a forwarded mail into the security department. */
export async function convertToSecurityTicket(
  admin: Admin,
  input: {
    tenantId: string;
    ticketId: string;
    settings: PhishingSettings;
    analysis: PhishingAnalysis;
    /** Replaces the description (e.g. with defanged links). */
    description?: string;
  },
): Promise<void> {
  const department = await targetDepartment(admin, input.tenantId, input.settings);
  const priority = await priorityId(admin, input.tenantId, input.settings.priorityKey);
  const subject = securityTicketSubject(input.analysis);
  const update: Row = { subject };
  if (input.description) update.description = input.description.slice(0, 50_000);
  if (priority) update.priority_id = priority;
  if (department) {
    const category = await validCategory(
      admin,
      input.tenantId,
      department.id,
      input.settings.categoryId,
    );
    Object.assign(update, {
      department_id: department.id,
      category_id: category,
      subcategory_id: await validSubcategory(
        admin,
        input.tenantId,
        department.id,
        category,
        input.settings.subcategoryId,
      ),
      assigned_team_id: null,
      assigned_agent_id: null,
    });
  }
  const result = await admin.from("tickets").update(update)
    .eq("id", input.ticketId).eq("tenant_id", input.tenantId).select("id");
  if (result.error || !result.data?.length) {
    // Department rules may reject the move; keep at least subject/priority.
    const fallback: Row = { subject };
    if (priority) fallback.priority_id = priority;
    if (update.description) fallback.description = update.description;
    await admin.from("tickets").update(fallback)
      .eq("id", input.ticketId).eq("tenant_id", input.tenantId);
  }
}

/**
 * Stores the report, writes the internal summary and notifies the security
 * team. Errors in the notification never undo the report.
 */
export async function finalizePhishingReport(
  admin: Admin,
  input: {
    tenantId: string;
    ticketId: string;
    ticketNumber: string;
    noteAuthorId: string;
    reporterId: string | null;
    reporterEmail: string | null;
    channel: PhishingChannel;
    analysis: PhishingAnalysis;
    fingerprint: string;
  },
): Promise<{ previousReports: number }> {
  const previous = await admin.from("phishing_reports").select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId).eq("fingerprint", input.fingerprint);
  const previousReports = previous.error ? 0 : Number(previous.count ?? 0);
  const h = input.analysis.headers;
  const stored = await admin.from("phishing_reports").insert({
    tenant_id: input.tenantId,
    ticket_id: input.ticketId,
    reporter_id: input.reporterId,
    reporter_email: input.reporterEmail?.slice(0, 320) ?? null,
    channel: input.channel,
    source: input.analysis.source,
    risk_score: input.analysis.score,
    risk_level: input.analysis.level,
    original_subject: h.subject?.slice(0, 300) ?? null,
    original_from: h.fromAddress?.slice(0, 320) ?? null,
    sending_ip: h.sendingIp?.slice(0, 64) ?? null,
    fingerprint: input.fingerprint,
    analysis: storedAnalysis(input.analysis),
  });
  if (stored.error) throw new Error("phishing_report_store_failed");
  await admin.from("ticket_comments").insert({
    ticket_id: input.ticketId,
    author_id: input.noteAuthorId,
    visibility: "internal",
    body: summaryText(input.analysis, { previousReports }),
  });
  await admin.from("ticket_events").insert({
    ticket_id: input.ticketId,
    actor_id: input.reporterId,
    event_type: "ticket.phishing_analyzed",
    payload: {
      riskLevel: input.analysis.level,
      riskScore: input.analysis.score,
      channel: input.channel,
      previousReports,
    },
  });
  try {
    await admin.rpc("phishing_report_notify", {
      p_tenant_id: input.tenantId,
      p_ticket_id: input.ticketId,
      p_payload: {
        ticketNumber: input.ticketNumber,
        riskLevel: input.analysis.level,
        riskLabel: riskLevelLabel(input.analysis.level),
        riskScore: input.analysis.score,
        subject: h.subject?.slice(0, 160) ?? null,
      },
    });
  } catch {
    // Notification is best effort.
  }
  return { previousReports };
}
