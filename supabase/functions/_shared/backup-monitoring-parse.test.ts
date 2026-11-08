import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  decideMissingAction,
  decideReportAction,
  emailRuleMatches,
  jobKey,
  parseBackupEmail,
  parseReportBody,
  parseVeeamSubject,
  parseWebhookReport,
  reportDueAt,
  reportTicketSubject,
  senderMatches,
} from "./backup-monitoring-parse.ts";

Deno.test("Veeam subjects", () => {
  assertEquals(parseVeeamSubject("[Success] Daily VMs (3 VMs)"), {
    jobName: "Daily VMs",
    result: "success",
    objectCount: 3,
    summary: null,
  });
  assertEquals(parseVeeamSubject("[Warning] File Server (1 VM) 1 warning"), {
    jobName: "File Server",
    result: "warning",
    objectCount: 1,
    summary: "1 warning",
  });
  assertEquals(parseVeeamSubject("[Failed] SQL Backup (2 machines) 1 failed")?.result, "failed");
  assertEquals(parseVeeamSubject("[Failed] SQL Backup (2 machines) 1 failed")?.jobName, "SQL Backup");
  assertEquals(parseVeeamSubject("[Success] Configuration Backup")?.jobName, "Configuration Backup");
  assertEquals(
    parseVeeamSubject("AW: WG: Veeam Backup for Microsoft 365: [Failed] M365 Mail (120 users)"),
    { jobName: "M365 Mail", result: "failed", objectCount: 120, summary: null },
  );
  assertEquals(parseVeeamSubject("[Error] Tape Job (4 objects)")?.result, "failed");
  assertEquals(parseVeeamSubject("[Info] Something"), null);
  assertEquals(parseVeeamSubject("Daily report"), null);
  assertEquals(parseVeeamSubject("[Success]   "), null);
});

Deno.test("body and keyword fallbacks", () => {
  assertEquals(parseReportBody("Hallo\nJob name: NAS Sync\nStatus: Failed\n"), {
    jobName: "NAS Sync",
    result: "failed",
  });
  const report = parseBackupEmail("Backup report", "Auftrag: Exchange\nErgebnis: Erfolgreich");
  assertEquals(report?.jobName, "Exchange");
  assertEquals(report?.result, "success");
  assertEquals(parseBackupEmail("Synology Hyper Backup: Fileserver failed", "")?.result, "failed");
  assertEquals(parseBackupEmail("Synology Hyper Backup: Fileserver failed", "")?.jobName, "Synology Hyper Backup Fileserver");
  assertEquals(parseBackupEmail("Newsletter", "Hallo zusammen"), null);
  const veeam = parseBackupEmail("[Warning] Daily (5 VMs)", "Backup job: Daily\n\n1 of 5 VMs processed with warning");
  assertEquals(veeam?.summary, "Backup job: Daily · 1 of 5 VMs processed with warning");
});

Deno.test("sender and subject rules", () => {
  assert(senderMatches(["veeam@kunde.ch"], "Veeam@Kunde.ch"));
  assert(senderMatches(["@kunde.ch"], "backup@kunde.ch"));
  assert(senderMatches(["*@backup.kunde.ch"], "vbr01@backup.kunde.ch"));
  assert(!senderMatches(["@kunde.ch"], "x@evil-kunde.ch.attacker.com"));
  assert(!senderMatches(["veeam@kunde.ch"], "other@kunde.ch"));
  const rule = { senderPatterns: ["veeam@kunde.ch"], subjectPatterns: ["[success]", "[failed]", "[warning]"] };
  assert(emailRuleMatches(rule, "veeam@kunde.ch", "[Failed] Job (1 VM)"));
  assert(!emailRuleMatches(rule, "veeam@kunde.ch", "License expires soon"));
  assert(emailRuleMatches({ ...rule, subjectPatterns: [] }, "veeam@kunde.ch", "Anything"));
  assert(!emailRuleMatches({ senderPatterns: [], subjectPatterns: [] }, "veeam@kunde.ch", "[Failed] Job"));
  assertEquals(jobKey("  Daily   VMs "), "daily vms");
});

Deno.test("webhook payloads", () => {
  const report = parseWebhookReport({
    job: "NAS Sync",
    status: "FAILED",
    message: "Disk full",
    id: "run-42",
    timestamp: "2026-11-07T02:00:00Z",
    objects: "3",
  });
  assertEquals(report, {
    jobName: "NAS Sync",
    result: "failed",
    objectCount: 3,
    summary: "Disk full",
    dedupeKey: "webhook:run-42",
    reportedAt: "2026-11-07T02:00:00.000Z",
  });
  assertEquals(parseWebhookReport({ jobname: "X", result: "ok" })?.result, "success");
  assertEquals(parseWebhookReport({ job: "X", status: "maybe" }), null);
  assertEquals(parseWebhookReport({ status: "success" }), null);
});

Deno.test("report decisions", () => {
  assertEquals(decideReportAction({ result: "failed", ticketOpen: false, warningAction: "ignore" }), {
    type: "create",
    reason: "failed",
  });
  assertEquals(decideReportAction({ result: "failed", ticketOpen: true, warningAction: "ignore" }), {
    type: "comment",
  });
  assertEquals(decideReportAction({ result: "warning", ticketOpen: false, warningAction: "ignore" }), {
    type: "none",
  });
  assertEquals(decideReportAction({ result: "warning", ticketOpen: false, warningAction: "ticket" }), {
    type: "create",
    reason: "warning",
  });
  assertEquals(decideReportAction({ result: "warning", ticketOpen: true, warningAction: "ignore" }), {
    type: "comment",
  });
  assertEquals(decideReportAction({ result: "success", ticketOpen: true, warningAction: "ignore" }), {
    type: "resolve",
  });
  assertEquals(decideReportAction({ result: "success", ticketOpen: false, warningAction: "ticket" }), {
    type: "none",
  });
  assertEquals(reportTicketSubject("Daily", "missing"), "Backup-Meldung ausgeblieben: Daily");
});

Deno.test("missing report decisions", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const job = {
    active: true,
    expectedIntervalHours: 24,
    graceHours: 6,
    lastReportAt: "2026-11-06T02:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    missingAlertedAt: null,
    ticketOpen: false,
    now,
  };
  assertEquals(reportDueAt(job), Date.parse("2026-11-07T08:00:00Z"));
  assertEquals(decideMissingAction(job), { type: "create" });
  assertEquals(decideMissingAction({ ...job, ticketOpen: true }), { type: "comment" });
  assertEquals(decideMissingAction({ ...job, missingAlertedAt: "2026-11-07T08:15:00Z" }), { type: "none" });
  assertEquals(decideMissingAction({ ...job, lastReportAt: "2026-11-07T02:00:00Z" }), { type: "none" });
  assertEquals(decideMissingAction({ ...job, expectedIntervalHours: null }), { type: "none" });
  assertEquals(decideMissingAction({ ...job, active: false }), { type: "none" });
  // Never reported: counted from creation.
  assertEquals(
    decideMissingAction({ ...job, lastReportAt: null, createdAt: "2026-11-07T00:00:00Z" }),
    { type: "none" },
  );
});
