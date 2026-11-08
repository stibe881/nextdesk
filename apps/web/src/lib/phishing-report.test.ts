import { describe, expect, it } from "vitest";

import {
  bytesToBase64,
  parsePhishingConfig,
  parsePhishingSettings,
  parsePhishingSubmit,
  settingsError,
  validateReportFile,
} from "./phishing-report";

describe("Phishing melden", () => {
  it("prüft Dateityp und Grösse", () => {
    expect(validateReportFile("Mail.eml", 100)).toBeNull();
    expect(validateReportFile("Mail.MSG", 100)).toBeNull();
    expect(validateReportFile("Rechnung.pdf", 100)).toMatch(/\.eml/);
    expect(validateReportFile("Mail.eml", 0)).toMatch(/leer/);
    expect(validateReportFile("Mail.eml", 6 * 1024 * 1024)).toMatch(/5 MB/);
  });

  it("kodiert Bytes als Base64", () => {
    expect(bytesToBase64(new TextEncoder().encode("Grüezi"))).toBe(
      btoa(String.fromCharCode(...new TextEncoder().encode("Grüezi"))),
    );
  });

  it("liest Konfiguration und Antwort", () => {
    expect(parsePhishingConfig({ data: { enabled: true } })).toEqual({
      enabled: true,
      reportAddress: null,
    });
    expect(parsePhishingConfig(null).enabled).toBe(false);
    expect(
      parsePhishingSubmit({
        data: {
          ticketId: "t",
          ticketNumber: "SEC-1",
          duplicate: true,
          message: "Danke für die Meldung!",
        },
      }),
    ).toEqual({
      ticketId: "t",
      ticketNumber: "SEC-1",
      duplicate: true,
      message: "Danke für die Meldung!",
    });
    expect(parsePhishingSubmit({ data: { ticketId: "t" } })).toBeNull();
  });

  it("liest und prüft die Einstellungen", () => {
    const parsed = parsePhishingSettings({
      data: {
        settings: { enabled: true, priorityKey: "x", departmentId: "d1" },
        options: {
          departments: [{ id: "d1", name: "IT" }, { id: 2 }],
          categories: [{ id: "c1", name: "Sicherheit", departmentId: "d1" }],
          teams: [],
        },
      },
    })!;
    expect(parsed.settings.priorityKey).toBe("high");
    expect(parsed.options.departments).toHaveLength(1);
    expect(settingsError(parsed.settings)).toBeNull();
    expect(
      settingsError({ ...parsed.settings, reportAddress: "kein-mail" }),
    ).toMatch(/gültige/);
    expect(settingsError({ ...parsed.settings, departmentId: null })).toMatch(
      /Zielabteilung/,
    );
  });
});
