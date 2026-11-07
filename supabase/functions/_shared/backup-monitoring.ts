// Backup monitoring: stores job reports from e-mail or webhook, opens and
// resolves tickets, and alerts on missing reports. Used by the Exchange mail
// processing, email-ingress and the backup-monitoring function.

import {
  type BackupResult,
  type BackupSource,
  decideMissingAction,
  decideReportAction,
  emailRuleMatches,
  jobKey,
  missingComment,
  missingTicketDescription,
  parseBackupEmail,
  type ParsedReport,
  reportComment,
  reportTicketDescription,
  reportTicketSubject,
  type TicketReason,
  type WarningAction,
} from "./backup-monitoring-parse.ts";
import {
  addMonitoringComment,
  createMonitoringTicket,
  ensureMonitoringServiceIdentity,
  monitoringTicketOpen,
  resolveMonitoringTicket,
} from "./monitoring-tickets.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type BackupSettings = {
  tenant_id: string;
  enabled: boolean;
  department_id: string | null;
  priority_key: string | null;
  warning_action: WarningAction;
  auto_resolve: boolean;
  default_interval_hours: number;
  default_grace_hours: number;
  sender_patterns: string[];
  subject_patterns: string[];
};

export const BACKUP_SETTINGS_COLUMNS =
  "tenant_id, enabled, department_id, priority_key, warning_action, auto_resolve, default_interval_hours, default_grace_hours, sender_patterns, subject_patterns";

type Job = {
  id: string;
  tenant_id: string;
  name: string;
  expected_interval_hours: number | null;
  grace_hours: number | null;
  department_id: string | null;
  asset_id: string | null;
  service_id: string | null;
  active: boolean;
  last_result: BackupResult | null;
  last_report_at: string | null;
  report_count: number;
  ticket_id: string | null;
  ticket_reason: TicketReason | null;
  missing_alerted_at: string | null;
  created_at: string;
};

const JOB_COLUMNS =
  "id, tenant_id, name, expected_interval_hours, grace_hours, department_id, asset_id, service_id, active, last_result, last_report_at, report_count, ticket_id, ticket_reason, missing_alerted_at, created_at";

export async function loadBackupSettings(admin: Admin, tenantId: string): Promise<BackupSettings | null> {
  const { data, error } = await admin
    .from("monitoring_backup_settings")
    .select(BACKUP_SETTINGS_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("backup_settings_lookup_failed");
  return (data as BackupSettings | null) ?? null;
}

async function linkedNames(admin: Admin, job: Job): Promise<{ assetName: string | null; serviceName: string | null }> {
  const [asset, service] = await Promise.all([
    job.asset_id
      ? admin.from("assets").select("name").eq("tenant_id", job.tenant_id).eq("id", job.asset_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.service_id
      ? admin.from("services").select("name").eq("tenant_id", job.tenant_id).eq("id", job.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    assetName: typeof asset.data?.name === "string" ? asset.data.name : null,
    serviceName: typeof service.data?.name === "string" ? service.data.name : null,
  };
}

async function findOrCreateJob(admin: Admin, settings: BackupSettings, name: string): Promise<Job> {
  const key = jobKey(name);
  const existing = await admin.from("monitoring_backup_jobs").select(JOB_COLUMNS)
    .eq("tenant_id", settings.tenant_id).eq("name_key", key).maybeSingle();
  if (existing.error) throw new Error("backup_job_lookup_failed");
  if (existing.data) return existing.data as Job;
  const inserted = await admin.from("monitoring_backup_jobs").insert({
    tenant_id: settings.tenant_id,
    name: name.slice(0, 300),
    name_key: key,
    expected_interval_hours: settings.default_interval_hours,
  }).select(JOB_COLUMNS).single();
  if (!inserted.error && inserted.data) return inserted.data as Job;
  if (inserted.error?.code !== "23505") throw new Error("backup_job_create_failed");
  const again = await admin.from("monitoring_backup_jobs").select(JOB_COLUMNS)
    .eq("tenant_id", settings.tenant_id).eq("name_key", key).single();
  if (again.error || !again.data) throw new Error("backup_job_lookup_failed");
  return again.data as Job;
}

export type IngestInput = ParsedReport & {
  source: BackupSource;
  subject: string | null;
  dedupeKey: string | null;
  reportedAt: string | null;
};

export async function ingestBackupReport(
  admin: Admin,
  settings: BackupSettings,
  input: IngestInput,
): Promise<string> {
  const job = await findOrCreateJob(admin, settings, input.jobName);
  const reportedAt = input.reportedAt ?? new Date().toISOString();
  const report = await admin.from("monitoring_backup_reports").insert({
    tenant_id: settings.tenant_id,
    job_id: job.id,
    result: input.result,
    source: input.source,
    subject: input.subject?.slice(0, 500) ?? null,
    summary: input.summary?.slice(0, 2000) ?? null,
    object_count: input.objectCount,
    dedupe_key: input.dedupeKey,
    reported_at: reportedAt,
  }).select("id").single();
  if (report.error) {
    if (report.error.code === "23505") return "duplicate";
    throw new Error("backup_report_create_failed");
  }

  const newest = !job.last_report_at || Date.parse(reportedAt) >= Date.parse(job.last_report_at);
  const update: Row = {
    report_count: job.report_count + 1,
    last_source: input.source,
  };
  if (newest) {
    Object.assign(update, {
      last_result: input.result,
      last_report_at: reportedAt,
      last_message: (input.summary ?? input.subject)?.slice(0, 2000) ?? null,
      missing_alerted_at: null,
      ...(input.result === "success" ? { last_success_at: reportedAt } : {}),
    });
  }

  let action = "recorded";
  if (settings.enabled && job.active && newest) {
    const open = await monitoringTicketOpen(admin, job.tenant_id, job.ticket_id);
    const decision = decideReportAction({
      result: input.result,
      ticketOpen: open,
      warningAction: settings.warning_action,
    });
    if (!open && job.ticket_id) Object.assign(update, { ticket_id: null, ticket_reason: null });
    if (decision.type !== "none") {
      const identity = await ensureMonitoringServiceIdentity(admin);
      if (decision.type === "create") {
        const names = await linkedNames(admin, job);
        const ticket = await createMonitoringTicket(admin, {
          tenantId: job.tenant_id,
          departmentIds: [job.department_id, settings.department_id],
          priorityKeys: decision.reason === "failed"
            ? [settings.priority_key, "high", "normal"]
            : [settings.priority_key, "normal"],
          subject: reportTicketSubject(job.name, decision.reason),
          description: reportTicketDescription({
            jobName: job.name,
            result: input.result,
            source: input.source,
            reportedAt,
            objectCount: input.objectCount,
            summary: input.summary,
            subject: input.subject,
            ...names,
          }),
          assetId: job.asset_id,
          source: "backup",
          metadata: { jobId: job.id, result: input.result },
        }, identity);
        Object.assign(update, { ticket_id: ticket.id, ticket_reason: decision.reason });
        action = "ticket_created";
      } else if (job.ticket_id) {
        await addMonitoringComment(
          admin,
          job.ticket_id,
          identity,
          reportComment({ result: input.result, reportedAt, summary: input.summary, subject: input.subject }),
          "backup",
        );
        action = "comment_added";
        if (decision.type === "resolve") {
          if (settings.auto_resolve) {
            await resolveMonitoringTicket(admin, job.tenant_id, job.ticket_id, identity, "backup");
          }
          Object.assign(update, { ticket_id: null, ticket_reason: null });
          action = "resolved";
        }
      }
    }
  }
  await admin.from("monitoring_backup_reports").update({ action }).eq("id", report.data.id);
  const { error } = await admin.from("monitoring_backup_jobs").update(update).eq("id", job.id);
  if (error) throw new Error("backup_job_update_failed");
  await admin.from("monitoring_backup_settings").update({ last_received_at: new Date().toISOString() })
    .eq("tenant_id", job.tenant_id);
  return action;
}

export type BackupEmail = {
  tenantId: string;
  sender: string;
  subject: string;
  body: string;
  messageId: string | null;
  receivedAt: string | null;
};

/**
 * Routes a backup report mail. Returns true when the message was consumed by
 * backup monitoring (it must then not become a ticket). Messages from a
 * matching sender that cannot be parsed are not consumed, so nothing gets
 * lost.
 */
export async function routeBackupEmail(admin: Admin, mail: BackupEmail): Promise<boolean> {
  let settings: BackupSettings | null;
  try {
    settings = await loadBackupSettings(admin, mail.tenantId);
  } catch {
    return false;
  }
  if (!settings?.enabled) return false;
  if (
    !emailRuleMatches(
      { senderPatterns: settings.sender_patterns ?? [], subjectPatterns: settings.subject_patterns ?? [] },
      mail.sender,
      mail.subject,
    )
  ) {
    return false;
  }
  const parsed = parseBackupEmail(mail.subject, mail.body);
  if (!parsed) return false;
  await ingestBackupReport(admin, settings, {
    ...parsed,
    source: "email",
    subject: mail.subject,
    dedupeKey: mail.messageId ? `email:${mail.messageId.slice(0, 590)}` : null,
    reportedAt: mail.receivedAt,
  });
  return true;
}

/** Cron: tickets for jobs whose report is overdue. */
export async function checkMissingReports(admin: Admin): Promise<Record<string, number>> {
  const { data: settingsRows, error } = await admin.from("monitoring_backup_settings")
    .select(BACKUP_SETTINGS_COLUMNS).eq("enabled", true).limit(1000);
  if (error) throw new Error("backup_settings_lookup_failed");
  const settingsByTenant = new Map(((settingsRows ?? []) as BackupSettings[]).map((row) => [row.tenant_id, row]));
  const counts: Record<string, number> = { checked: 0, ticket_created: 0, comment_added: 0, failed: 0 };
  if (!settingsByTenant.size) return counts;
  const jobs = await admin.from("monitoring_backup_jobs").select(JOB_COLUMNS)
    .eq("active", true)
    .is("missing_alerted_at", null)
    .not("expected_interval_hours", "is", null)
    .in("tenant_id", [...settingsByTenant.keys()])
    .limit(2000);
  if (jobs.error) throw new Error("backup_job_lookup_failed");
  const now = Date.now();
  for (const job of (jobs.data ?? []) as Job[]) {
    const settings = settingsByTenant.get(job.tenant_id);
    if (!settings) continue;
    counts.checked = (counts.checked ?? 0) + 1;
    const graceHours = job.grace_hours ?? settings.default_grace_hours;
    const base = {
      active: job.active,
      expectedIntervalHours: job.expected_interval_hours,
      graceHours,
      lastReportAt: job.last_report_at,
      createdAt: job.created_at,
      missingAlertedAt: job.missing_alerted_at,
      now,
    };
    if (decideMissingAction({ ...base, ticketOpen: false }).type === "none") continue;
    try {
      const open = await monitoringTicketOpen(admin, job.tenant_id, job.ticket_id);
      const decision = decideMissingAction({ ...base, ticketOpen: open });
      const identity = await ensureMonitoringServiceIdentity(admin);
      const update: Row = { missing_alerted_at: new Date(now).toISOString() };
      if (decision.type === "comment" && job.ticket_id) {
        await addMonitoringComment(admin, job.ticket_id, identity, missingComment(job.last_report_at), "backup");
        counts.comment_added = (counts.comment_added ?? 0) + 1;
      } else if (decision.type === "create") {
        const names = await linkedNames(admin, job);
        const ticket = await createMonitoringTicket(admin, {
          tenantId: job.tenant_id,
          departmentIds: [job.department_id, settings.department_id],
          priorityKeys: [settings.priority_key, "high", "normal"],
          subject: reportTicketSubject(job.name, "missing"),
          description: missingTicketDescription({
            jobName: job.name,
            lastReportAt: job.last_report_at,
            lastResult: job.last_result,
            expectedIntervalHours: job.expected_interval_hours ?? 24,
            graceHours,
            ...names,
          }),
          assetId: job.asset_id,
          source: "backup",
          metadata: { jobId: job.id, reason: "missing" },
        }, identity);
        Object.assign(update, { ticket_id: ticket.id, ticket_reason: "missing" });
        counts.ticket_created = (counts.ticket_created ?? 0) + 1;
      }
      await admin.from("monitoring_backup_jobs").update(update).eq("id", job.id);
    } catch (failure) {
      counts.failed = (counts.failed ?? 0) + 1;
      console.error("backup_missing_check_failed", failure instanceof Error ? failure.message : "");
    }
  }
  return counts;
}
