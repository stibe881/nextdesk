// Security cases: phishing reports are handled as their own kind of case
// (see migration 0261). Shared by the mail worker, phishing-reports and
// security-cases.

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type SecurityVerdict = "harmless" | "spam" | "phishing" | "targeted";
export const SECURITY_VERDICTS: readonly SecurityVerdict[] = [
  "harmless",
  "spam",
  "phishing",
  "targeted",
];

export function isSecurityVerdict(value: unknown): value is SecurityVerdict {
  return typeof value === "string" &&
    (SECURITY_VERDICTS as readonly string[]).includes(value);
}

export const VERDICT_LABELS: Record<SecurityVerdict, string> = {
  harmless: "Harmlos",
  spam: "Spam",
  phishing: "Phishing",
  targeted: "Gezielter Angriff",
};

/** Checklist used while a tenant has not set up its own (Phishing settings). */
export const DEFAULT_ACTIONS: Record<SecurityVerdict, string[]> = {
  harmless: [],
  spam: ["Absender in Microsoft Defender als Spam sperren"],
  phishing: [
    "Absender und Domain in Microsoft Defender sperren",
    "Link-Domains blockieren",
    "Mail aus allen Postfächern entfernen (Defender → Bedrohungs-Explorer)",
    "Melder fragen: geklickt oder Daten eingegeben?",
    "Falls ja: Passwort zurücksetzen und Anmeldungen prüfen",
  ],
  targeted: [
    "Absender und Domain in Microsoft Defender sperren",
    "Link-Domains blockieren",
    "Mail aus allen Postfächern entfernen (Defender → Bedrohungs-Explorer)",
    "Melder fragen: geklickt oder Daten eingegeben?",
    "Falls ja: Passwort zurücksetzen und Anmeldungen prüfen",
    "Geschäftsleitung informieren",
    "Vorfall dokumentieren und Meldepflicht prüfen",
  ],
};

/** Result mail to every reporter, one text per verdict. */
export const VERDICT_RESULT_TEXT: Record<SecurityVerdict, string> = {
  harmless:
    "Wir haben die gemeldete E-Mail geprüft: Sie ist echt und ungefährlich. Sie können sie normal bearbeiten.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.",
  spam:
    "Wir haben die gemeldete E-Mail geprüft: Es ist Werbung (Spam), aber kein Angriff. Sie können sie löschen.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.",
  phishing:
    "Wir haben die gemeldete E-Mail geprüft: Das war Phishing. Die Mail wollte Zugangsdaten oder persönliche Angaben abgreifen. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nSie müssen nichts weiter tun. Falls Sie einen Link geöffnet, einen Anhang geöffnet oder Ihr Passwort eingegeben haben, melden Sie sich bitte sofort beim Support.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.",
  targeted:
    "Wir haben die gemeldete E-Mail geprüft: Das war ein gezielter Angriff auf unsere Organisation. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nFalls Sie einen Link geöffnet, einen Anhang geöffnet oder Ihr Passwort eingegeben haben, melden Sie sich bitte sofort beim Support.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.",
};

export const CLICK_QUESTION_TEXT =
  "Danke für Ihre Phishing-Meldung. Damit wir den Schaden richtig einschätzen können, brauchen wir eine kurze Rückmeldung:\n\nHaben Sie in der gemeldeten E-Mail einen Link oder Anhang geöffnet oder irgendwo Ihr Passwort oder andere Daten eingegeben?\n\nBitte antworten Sie über die Schaltfläche unten. Ehrlich ist hier wichtig: Es passiert Ihnen nichts, wir müssen nur schnell reagieren können.";

/** Time until the verdict is due, by the automatic risk level. */
export function decisionDueAt(level: string | null | undefined, from = new Date()): string {
  const minutes = level === "high" ? 30 : level === "medium" ? 4 * 60 : 24 * 60;
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Open case of the same reported mail (bundling), reported within 30 days. */
export async function openSecurityCaseFor(
  admin: Admin,
  tenantId: string,
  fingerprint: string | null,
): Promise<{ id: string; ticketNumber: string } | null> {
  if (!fingerprint) return null;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const { data } = await admin.from("security_cases")
    .select("ticket_id, tickets(ticket_number)")
    .eq("tenant_id", tenantId).eq("fingerprint", fingerprint)
    .neq("state", "closed").gte("created_at", since)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const row = data as Row | null;
  const ticket = row
    ? (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as Row | null
    : null;
  const id = text(row?.ticket_id);
  const ticketNumber = text(ticket?.ticket_number);
  return id && ticketNumber ? { id, ticketNumber } : null;
}

/** Marks a ticket as security case and creates the case row (idempotent). */
export async function ensureSecurityCase(
  admin: Admin,
  input: {
    tenantId: string;
    ticketId: string;
    fingerprint: string | null;
    riskLevel: string | null;
  },
): Promise<void> {
  await admin.from("tickets").update({ is_security_case: true })
    .eq("id", input.ticketId).eq("tenant_id", input.tenantId);
  await admin.from("security_cases").upsert({
    ticket_id: input.ticketId,
    tenant_id: input.tenantId,
    fingerprint: input.fingerprint,
    state: "triage",
    decision_due_at: decisionDueAt(input.riskLevel),
  }, { onConflict: "ticket_id", ignoreDuplicates: true });
}

/**
 * A mail ticket for a mail that is already an open case: it is closed and
 * merged into the case, so the report lands on one case only.
 */
export async function mergeIntoSecurityCase(
  admin: Admin,
  input: { tenantId: string; duplicateTicketId: string; caseTicketId: string; actorId: string },
): Promise<void> {
  const closed = await admin.from("ticket_statuses").select("id")
    .eq("tenant_id", input.tenantId).eq("key", "closed").maybeSingle();
  const update: Row = {
    is_security_case: true,
    merged_into_ticket_id: input.caseTicketId,
  };
  if (text(closed.data?.id)) update.status_id = closed.data.id;
  await admin.from("tickets").update(update)
    .eq("id", input.duplicateTicketId).eq("tenant_id", input.tenantId);
  await admin.from("ticket_events").insert({
    ticket_id: input.duplicateTicketId,
    actor_id: input.actorId,
    event_type: "ticket.merged",
    payload: { into: input.caseTicketId, source: "phishing_report" },
  });
}

/** No «we received your request» mail for a phishing report. */
export async function suppressAcknowledgement(admin: Admin, ticketId: string): Promise<void> {
  await admin.from("mail_messages")
    .update({ processing_status: "ignored", ignore_reason: "security_case" })
    .eq("ticket_id", ticketId).eq("kind", "acknowledgement")
    .in("processing_status", ["pending", "failed"]);
}

async function activeChannel(
  admin: Admin,
  tenantId: string,
  ticketId: string,
): Promise<{ id: string; version: number; address: string } | null> {
  const ticket = await admin.from("tickets").select("exchange_mail_channel_id")
    .eq("id", ticketId).eq("tenant_id", tenantId).maybeSingle();
  const preferred = text(ticket.data?.exchange_mail_channel_id);
  const { data } = await admin.from("exchange_mail_channels")
    .select("id, mailbox_address, configuration_version, created_at")
    .eq("tenant_id", tenantId).eq("status", "active").is("deleted_at", null)
    .eq("access_mode", "delegated").order("created_at", { ascending: true }).limit(20);
  const rows = (data ?? []) as Row[];
  const channel = rows.find((row) => row.id === preferred) ?? rows[0];
  if (!channel) return null;
  const version = Number(channel.configuration_version);
  const address = text(channel.mailbox_address);
  return Number.isSafeInteger(version) && version >= 1 && address
    ? { id: String(channel.id), version, address }
    : null;
}

/**
 * Writes `body` as an internal note on the case and sends it to each
 * recipient as its own mail (nobody sees the other reporters). Returns the
 * note id and the number of queued mails.
 */
export async function queueSecurityNotice(
  admin: Admin,
  input: {
    tenantId: string;
    ticketId: string;
    authorId: string;
    subject: string;
    body: string;
    recipients: readonly string[];
    note?: string;
    /** Runs after the note exists and before any mail is queued. */
    beforeQueue?: (commentId: string) => Promise<void>;
  },
): Promise<{ commentId: string | null; queued: number }> {
  const comment = await admin.from("ticket_comments").insert({
    ticket_id: input.ticketId,
    author_id: input.authorId,
    visibility: "internal",
    body: input.note ? `${input.note}\n\n${input.body}` : input.body,
  }).select("id").single();
  const commentId = text(comment.data?.id);
  if (!commentId) return { commentId: null, queued: 0 };
  if (input.beforeQueue) await input.beforeQueue(commentId);
  const channel = await activeChannel(admin, input.tenantId, input.ticketId);
  if (!channel) return { commentId, queued: 0 };
  const recipients = [...new Set(input.recipients.map((entry) => entry.trim().toLowerCase()))]
    .filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry))
    .slice(0, 200);
  let queued = 0;
  for (const recipient of recipients) {
    const result = await admin.from("mail_messages").insert({
      tenant_id: input.tenantId,
      channel_id: channel.id,
      exchange_configuration_version: channel.version,
      direction: "outbound",
      kind: "security_notice",
      ticket_id: input.ticketId,
      comment_id: commentId,
      from_address: channel.address,
      to_addresses: [recipient],
      subject: input.subject.slice(0, 500),
    });
    if (!result.error) queued += 1;
  }
  return { commentId, queued };
}

/** E-mail addresses of everybody who reported this case. */
export async function caseReporterEmails(
  admin: Admin,
  tenantId: string,
  ticketId: string,
): Promise<string[]> {
  const { data } = await admin.from("phishing_reports")
    .select("reporter_id, reporter_email").eq("tenant_id", tenantId).eq("ticket_id", ticketId)
    .limit(500);
  const rows = (data ?? []) as Row[];
  const emails = new Set<string>();
  const userIds: string[] = [];
  for (const row of rows) {
    const email = text(row.reporter_email)?.toLowerCase();
    if (email) emails.add(email);
    else if (text(row.reporter_id)) userIds.push(String(row.reporter_id));
  }
  for (const userId of [...new Set(userIds)].slice(0, 100)) {
    const user = await admin.auth.admin.getUserById(userId);
    const email = text(user.data?.user?.email)?.toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}
