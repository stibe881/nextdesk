// Pure logic for backup monitoring: e-mail rule matching, report parsing
// (Veeam and generic formats), webhook payloads and ticket decisions.

export type BackupResult = "success" | "warning" | "failed";
export type BackupSource = "email" | "webhook";
export type TicketReason = "failed" | "warning" | "missing";
export type WarningAction = "ignore" | "ticket";

export type ParsedReport = {
  jobName: string;
  result: BackupResult;
  objectCount: number | null;
  summary: string | null;
};

const HOUR_MS = 3_600_000;

const RESULT_WORDS: [RegExp, BackupResult][] = [
  [/^(success|successful|succeeded|ok|erfolgreich|erfolg|completed)$/i, "success"],
  [/^(warning|warnings|warnung|warn)$/i, "warning"],
  [/^(failed|failure|error|errors|fehler|fehlgeschlagen|critical|kritisch)$/i, "failed"],
];

export function normalizeResult(value: unknown): BackupResult | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  for (const [pattern, result] of RESULT_WORDS) {
    if (pattern.test(text)) return result;
  }
  return null;
}

export function jobKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 300);
}

function cleanJobName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim()
    .slice(0, 300);
}

// Matching ------------------------------------------------------------------

/**
 * Sender patterns: exact address («veeam@kunde.ch»), whole domain
 * («@kunde.ch» or «*@kunde.ch») or a glob with «*».
 */
export function senderMatches(patterns: string[], sender: string): boolean {
  const address = sender.trim().toLowerCase();
  if (!address) return false;
  return patterns.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern.startsWith("@")) return address.endsWith(pattern);
    if (!pattern.includes("*")) return address === pattern;
    const regex = new RegExp(
      `^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`,
    );
    return regex.test(address);
  });
}

/** Subject patterns are case-insensitive substrings; empty list matches all. */
export function subjectMatches(patterns: string[], subject: string): boolean {
  const cleaned = patterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean);
  if (!cleaned.length) return true;
  const text = subject.toLowerCase();
  return cleaned.some((pattern) => text.includes(pattern));
}

export function emailRuleMatches(
  rule: { senderPatterns: string[]; subjectPatterns: string[] },
  sender: string,
  subject: string,
): boolean {
  return rule.senderPatterns.some((pattern) => pattern.trim()) &&
    senderMatches(rule.senderPatterns, sender) &&
    subjectMatches(rule.subjectPatterns, subject);
}

// Parsing -------------------------------------------------------------------

/** Removes reply/forward prefixes such as «AW:», «Fwd:». */
function stripPrefixes(subject: string): string {
  let text = subject.trim();
  for (let i = 0; i < 5; i++) {
    const next = text.replace(/^(re|aw|wg|fw|fwd|tr)\s*:\s*/i, "");
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * Veeam Backup & Replication / Agent / Microsoft 365 subjects:
 * «[Success] Daily VMs (3 VMs)», «[Warning] File Server (1 VM) 1 warning»,
 * «[Failed] SQL Backup (2 machines) 1 failed», «[Success] Configuration Backup»,
 * «Veeam Backup for Microsoft 365: [Failed] M365 Mail».
 */
export function parseVeeamSubject(subject: string): ParsedReport | null {
  const text = stripPrefixes(subject);
  const match = /\[\s*([A-Za-zäöü]+)\s*\]\s*(.+)$/.exec(text);
  if (!match) return null;
  const result = normalizeResult(match[1]);
  if (!result) return null;
  let rest = match[2] ?? "";
  let objectCount: number | null = null;
  let summary: string | null = null;
  // Trailing object count «(3 VMs)» plus optional «1 warning, 1 failed».
  const count = /^(.*?)\s*\((\d+)\s+(?:vms?|machines?|objects?|computers?|servers?|items?|hosts?|workloads?|tasks?|users?|mailboxes)\)\s*(.*)$/i
    .exec(rest);
  if (count) {
    rest = count[1] ?? "";
    objectCount = Number(count[2]);
    summary = (count[3] ?? "").trim() || null;
  }
  const jobName = cleanJobName(rest);
  if (!jobName) return null;
  return { jobName, result, objectCount, summary };
}

/**
 * Body lines «Job: Name» / «Job name: Name» and «Status: Failed» /
 * «Result: Success» (also German «Auftrag», «Ergebnis»).
 */
export function parseReportBody(body: string): { jobName: string | null; result: BackupResult | null } {
  let jobName: string | null = null;
  let result: BackupResult | null = null;
  for (const rawLine of body.split(/\r?\n/).slice(0, 200)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!jobName) {
      const job = /^(?:backup[- ]?)?(?:job(?: ?name)?|auftrag(?:sname)?|jobname|task)\s*[:=]\s*(.+)$/i.exec(line);
      if (job?.[1]) jobName = cleanJobName(job[1]) || null;
    }
    if (!result) {
      const status = /^(?:status|result|ergebnis|resultat|job status|session status)\s*[:=]?\s*([A-Za-zäöü]+)\b/i.exec(line);
      if (status?.[1]) result = normalizeResult(status[1]);
    }
    if (jobName && result) break;
  }
  return { jobName, result };
}

/** Generic subjects such as «Backup OK: NAS» or «Job Fileserver failed». */
function parseKeywordSubject(subject: string): ParsedReport | null {
  const text = stripPrefixes(subject);
  const words = text.split(/[\s:;,()[\]–—-]+/).filter(Boolean);
  let result: BackupResult | null = null;
  for (const priority of ["failed", "warning", "success"] as BackupResult[]) {
    if (words.some((word) => normalizeResult(word) === priority)) {
      result = priority;
      break;
    }
  }
  if (!result) return null;
  const jobName = cleanJobName(
    words.filter((word) => normalizeResult(word) === null).join(" "),
  );
  return jobName ? { jobName, result, objectCount: null, summary: null } : null;
}

function firstLines(body: string, max = 400): string | null {
  const text = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" · ");
  return text ? text.slice(0, max) : null;
}

/** Parses a backup report mail; null when no job name and result are found. */
export function parseBackupEmail(subject: string, body: string): ParsedReport | null {
  const veeam = parseVeeamSubject(subject);
  if (veeam) {
    return { ...veeam, summary: veeam.summary ?? firstLines(body) };
  }
  const fromBody = parseReportBody(body);
  if (fromBody.jobName && fromBody.result) {
    return { jobName: fromBody.jobName, result: fromBody.result, objectCount: null, summary: firstLines(body) };
  }
  const keyword = parseKeywordSubject(subject);
  if (keyword) {
    return {
      ...keyword,
      jobName: fromBody.jobName ?? keyword.jobName,
      result: fromBody.result ?? keyword.result,
      summary: firstLines(body),
    };
  }
  return null;
}

/**
 * Webhook payload (JSON, form or query fields):
 * { "job": "NAS Sync", "status": "failed", "message": "…", "id": "run-42",
 *   "timestamp": "2026-11-07T02:00:00Z", "objects": 3 }
 */
export function parseWebhookReport(fields: Record<string, unknown>): (ParsedReport & {
  dedupeKey: string | null;
  reportedAt: string | null;
}) | null {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return null;
  };
  const jobName = cleanJobName(pick("job", "jobname", "job_name", "name", "task") ?? "");
  const result = normalizeResult(pick("status", "result", "state", "outcome") ?? "");
  if (!jobName || !result) return null;
  const objects = pick("objects", "objectcount", "object_count", "count");
  const timestamp = pick("timestamp", "time", "finishedat", "finished_at", "date");
  const parsedTime = timestamp ? Date.parse(timestamp) : Number.NaN;
  const dedupe = pick("id", "runid", "run_id", "sessionid", "session_id");
  return {
    jobName,
    result,
    objectCount: objects && /^\d{1,9}$/.test(objects) ? Number(objects) : null,
    summary: (pick("message", "details", "summary", "text") ?? "").slice(0, 2000) || null,
    dedupeKey: dedupe ? `webhook:${dedupe.slice(0, 500)}` : null,
    reportedAt: Number.isNaN(parsedTime) ? null : new Date(parsedTime).toISOString(),
  };
}

// Decisions -----------------------------------------------------------------

export type ReportAction =
  | { type: "none" }
  | { type: "create"; reason: TicketReason }
  | { type: "comment" }
  | { type: "resolve" };

/**
 * - Failed: ticket, or comment on the open one.
 * - Warning: comment on the open ticket; otherwise a ticket only when
 *   configured.
 * - Success: comment and (optionally) resolve the open ticket.
 */
export function decideReportAction(input: {
  result: BackupResult;
  ticketOpen: boolean;
  warningAction: WarningAction;
}): ReportAction {
  const { result, ticketOpen, warningAction } = input;
  if (result === "success") return ticketOpen ? { type: "resolve" } : { type: "none" };
  if (ticketOpen) return { type: "comment" };
  if (result === "failed") return { type: "create", reason: "failed" };
  return warningAction === "ticket" ? { type: "create", reason: "warning" } : { type: "none" };
}

/** Time after which a report is overdue, or null when not watched. */
export function reportDueAt(job: {
  expectedIntervalHours: number | null;
  graceHours: number;
  lastReportAt: string | null;
  createdAt: string;
}): number | null {
  if (!job.expectedIntervalHours) return null;
  const base = Date.parse(job.lastReportAt ?? job.createdAt);
  if (Number.isNaN(base)) return null;
  return base + (job.expectedIntervalHours + job.graceHours) * HOUR_MS;
}

export type MissingAction = { type: "none" } | { type: "create" } | { type: "comment" };

/** One alert per gap: a new report resets missing_alerted_at. */
export function decideMissingAction(input: {
  active: boolean;
  expectedIntervalHours: number | null;
  graceHours: number;
  lastReportAt: string | null;
  createdAt: string;
  missingAlertedAt: string | null;
  ticketOpen: boolean;
  now: number;
}): MissingAction {
  if (!input.active || input.missingAlertedAt) return { type: "none" };
  const due = reportDueAt(input);
  if (due === null || input.now < due) return { type: "none" };
  return input.ticketOpen ? { type: "comment" } : { type: "create" };
}

// Texts ---------------------------------------------------------------------

const RESULT_LABEL: Record<BackupResult, string> = {
  success: "Erfolgreich",
  warning: "Warnung",
  failed: "Fehlgeschlagen",
};

export function resultLabel(result: BackupResult): string {
  return RESULT_LABEL[result];
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  });
}

export function reportTicketSubject(jobName: string, reason: TicketReason): string {
  const label = reason === "missing"
    ? "Backup-Meldung ausgeblieben"
    : reason === "warning"
    ? "Backup mit Warnung"
    : "Backup fehlgeschlagen";
  return `${label}: ${jobName}`.slice(0, 300);
}

export function reportTicketDescription(input: {
  jobName: string;
  result: BackupResult;
  source: BackupSource;
  reportedAt: string;
  objectCount: number | null;
  summary: string | null;
  subject: string | null;
  assetName: string | null;
  serviceName: string | null;
}): string {
  const lines = [
    `Der Backup-Job «${input.jobName}» meldet: ${resultLabel(input.result)}.`,
    "",
    `Gemeldet: ${dateTime(input.reportedAt)} (${input.source === "email" ? "E-Mail" : "Webhook"})`,
  ];
  if (input.subject) lines.push(`Betreff: ${input.subject}`);
  if (input.objectCount !== null) lines.push(`Objekte: ${input.objectCount}`);
  if (input.summary) lines.push("", input.summary);
  if (input.assetName) lines.push("", `Verknüpftes Asset: ${input.assetName}`);
  if (input.serviceName) lines.push(`Verknüpfter Dienst: ${input.serviceName}`);
  lines.push(
    "",
    "Weitere Meldungen zu diesem Job werden als interne Kommentare ergänzt. Bei der nächsten erfolgreichen Sicherung wird das Ticket automatisch kommentiert und gelöst.",
  );
  return lines.join("\n");
}

export function missingTicketDescription(input: {
  jobName: string;
  lastReportAt: string | null;
  lastResult: BackupResult | null;
  expectedIntervalHours: number;
  graceHours: number;
  assetName: string | null;
  serviceName: string | null;
}): string {
  const lines = [
    `Für den Backup-Job «${input.jobName}» ist keine Meldung eingegangen.`,
    "",
    `Erwartet: alle ${input.expectedIntervalHours} Stunden (Toleranz ${input.graceHours} Stunden)`,
    `Letzte Meldung: ${
      input.lastReportAt
        ? `${dateTime(input.lastReportAt)}${input.lastResult ? ` (${resultLabel(input.lastResult)})` : ""}`
        : "noch nie"
    }`,
    "",
    "Bitte prüfen Sie, ob der Job läuft und der Bericht versendet wird (Zeitplan, Mailversand, Webhook).",
  ];
  if (input.assetName) lines.push("", `Verknüpftes Asset: ${input.assetName}`);
  if (input.serviceName) lines.push(`Verknüpfter Dienst: ${input.serviceName}`);
  return lines.join("\n");
}

export function reportComment(input: {
  result: BackupResult;
  reportedAt: string;
  summary: string | null;
  subject: string | null;
}): string {
  const head = input.result === "success"
    ? `Backup wieder erfolgreich (${dateTime(input.reportedAt)}).`
    : `Neue Backup-Meldung: ${resultLabel(input.result)} (${dateTime(input.reportedAt)}).`;
  return [head, input.subject ? `Betreff: ${input.subject}` : null, input.summary]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function missingComment(lastReportAt: string | null): string {
  return `Backup-Meldung ausgeblieben: seit ${
    lastReportAt ? dateTime(lastReportAt) : "Beginn der Überwachung"
  } ist kein Bericht mehr eingegangen.`;
}
