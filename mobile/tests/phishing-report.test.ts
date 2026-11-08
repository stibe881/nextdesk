import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; body: Record<string, unknown> }[] = [];
let response: unknown = null;
let fail = false;

vi.mock("../lib/nextdesk-client", () => ({
  invokeNextDesk: async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    if (fail) throw new Error("forbidden");
    return response;
  },
}));

const {
  informalThanks,
  loadPhishingConfig,
  parsePhishingSubmit,
  submitPhishingReport,
} = await import("../lib/phishing-report");

beforeEach(() => {
  calls.length = 0;
  response = null;
  fail = false;
});

describe("Phishing melden (mobile)", () => {
  it("lädt die Konfiguration und fällt bei Fehlern auf aus zurück", async () => {
    response = { data: { enabled: true, reportAddress: "phishing@firma.ch" } };
    expect(await loadPhishingConfig("t1")).toEqual({
      enabled: true,
      reportAddress: "phishing@firma.ch",
    });
    expect(calls[0]).toEqual({
      name: "phishing-reports",
      body: { type: "getConfig", tenantId: "t1" },
    });
    fail = true;
    expect((await loadPhishingConfig("t1")).enabled).toBe(false);
  });

  it("sendet eingefügte Kopfzeilen als mobile Meldung", async () => {
    response = {
      data: {
        ticketId: "x",
        ticketNumber: "SEC-7",
        duplicate: false,
        message: "Danke für die Meldung!",
      },
    };
    const result = await submitPhishingReport(
      "t1",
      "Received: from a\nFrom: b@c.ch",
    );
    expect(calls[0]!.body).toMatchObject({
      type: "submit",
      channel: "mobile",
      tenantId: "t1",
    });
    expect(informalThanks(result)).toContain("SEC-7");
    expect(informalThanks(result)).toContain("Klicke keine Links");
    await expect(submitPhishingReport("t1", "   ")).rejects.toThrow(
      /Kopfzeilen/,
    );
  });

  it("verwirft unvollständige Antworten", () => {
    expect(parsePhishingSubmit({ data: { ticketId: "x" } })).toBeNull();
    expect(
      informalThanks({
        ticketId: "x",
        ticketNumber: "SEC-1",
        duplicate: true,
        message: "m",
      }),
    ).toContain("bereits gemeldet");
  });
});
