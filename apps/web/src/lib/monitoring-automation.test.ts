import { describe, expect, it } from "vitest";

import {
  backupOverdue,
  backupResultChip,
  expiryLabel,
  expiryStatusChip,
  intervalLabel,
  parseBackupJobs,
  parseBackupSettings,
  parseExpirySettings,
  parseExpiryTargets,
  sortTargets,
  splitPatterns,
  targetDisplay,
} from "./monitoring-automation";

const NOW = Date.parse("2026-11-07T08:00:00Z");

describe("expiry monitoring", () => {
  it("maps status chips", () => {
    expect(expiryStatusChip("valid")).toEqual({
      label: "gültig",
      tone: "success",
    });
    expect(expiryStatusChip("expiring")).toEqual({
      label: "läuft bald ab",
      tone: "warning",
    });
    expect(expiryStatusChip("expired")).toEqual({
      label: "abgelaufen",
      tone: "danger",
    });
    expect(expiryStatusChip("error")).toEqual({
      label: "Fehler",
      tone: "danger",
    });
    expect(expiryStatusChip("pending").tone).toBe("neutral");
  });

  it("parses settings and targets defensively", () => {
    expect(
      parseExpirySettings({
        enabled: true,
        autoResolve: false,
        warnDays: 30,
        reminderDays: 7,
      }),
    ).toMatchObject({ warnDays: 30, reminderDays: 7, departmentId: null });
    expect(parseExpirySettings({ enabled: true })).toBeNull();
    const targets = parseExpiryTargets([
      {
        id: "a",
        kind: "certificate",
        host: "vpn.example.ch",
        port: 8443,
        status: "valid",
      },
      {
        id: "b",
        kind: "domain",
        host: "example.com",
        status: "weird",
        san: ["x", 1],
      },
      { id: "c", kind: "ftp", host: "x" },
    ]);
    expect(targets).toHaveLength(2);
    expect(targets[1]?.status).toBe("pending");
    expect(targets[1]?.san).toEqual(["x"]);
    expect(targetDisplay(targets[0]!)).toBe("vpn.example.ch:8443");
    expect(
      targetDisplay({ kind: "certificate", host: "a.ch", port: 443 }),
    ).toBe("a.ch");
  });

  it("sorts problems first, then by expiry", () => {
    const sorted = sortTargets(
      parseExpiryTargets([
        {
          id: "1",
          kind: "domain",
          host: "late.ch",
          status: "valid",
          expiresAt: "2027-06-01T00:00:00Z",
        },
        {
          id: "2",
          kind: "domain",
          host: "early.ch",
          status: "valid",
          expiresAt: "2027-01-01T00:00:00Z",
        },
        { id: "3", kind: "domain", host: "broken.ch", status: "error" },
        {
          id: "4",
          kind: "domain",
          host: "gone.ch",
          status: "expired",
          expiresAt: "2026-10-01T00:00:00Z",
        },
      ]),
    );
    expect(sorted.map((target) => target.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("labels the expiry date", () => {
    expect(expiryLabel("2026-11-17T08:00:00Z", NOW)).toContain("in 10 Tagen");
    expect(expiryLabel("2026-11-05T08:00:00Z", NOW)).toContain(
      "seit 2 Tagen abgelaufen",
    );
    expect(expiryLabel(null, NOW)).toBe("unbekannt");
  });
});

describe("backup monitoring", () => {
  it("maps result chips", () => {
    expect(backupResultChip("failed")).toEqual({
      label: "Fehlgeschlagen",
      tone: "danger",
    });
    expect(backupResultChip(null).tone).toBe("neutral");
  });

  it("parses settings and jobs", () => {
    expect(
      parseBackupSettings({
        enabled: true,
        autoResolve: true,
        hasToken: false,
        defaultIntervalHours: 24,
        defaultGraceHours: 6,
        warningAction: "ticket",
        senderPatterns: ["veeam@kunde.ch"],
      }),
    ).toMatchObject({
      warningAction: "ticket",
      senderPatterns: ["veeam@kunde.ch"],
    });
    expect(parseBackupSettings({ enabled: true })).toBeNull();
    const jobs = parseBackupJobs([
      {
        id: "j",
        name: "Daily",
        lastResult: "failed",
        ticketReason: "missing",
        reportCount: 3,
      },
      { id: 1 },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      lastResult: "failed",
      ticketReason: "missing",
      reportCount: 3,
    });
  });

  it("detects overdue reports", () => {
    const job = {
      active: true,
      expectedIntervalHours: 24,
      graceHours: null,
      lastReportAt: "2026-11-06T01:00:00Z",
    };
    expect(backupOverdue(job, 6, NOW)).toBe(true);
    expect(backupOverdue({ ...job, graceHours: 12 }, 6, NOW)).toBe(false);
    expect(backupOverdue({ ...job, expectedIntervalHours: null }, 6, NOW)).toBe(
      false,
    );
    expect(backupOverdue({ ...job, active: false }, 6, NOW)).toBe(false);
  });

  it("formats intervals and splits patterns", () => {
    expect(intervalLabel(24)).toBe("täglich");
    expect(intervalLabel(168)).toBe("wöchentlich");
    expect(intervalLabel(48)).toBe("alle 2 Tage");
    expect(intervalLabel(12)).toBe("alle 12 Stunden");
    expect(intervalLabel(null)).toBe("nicht überwacht");
    expect(splitPatterns("veeam@a.ch\n\n@b.ch, veeam@a.ch")).toEqual([
      "veeam@a.ch",
      "@b.ch",
    ]);
  });
});
