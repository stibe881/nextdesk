import { describe, expect, it } from "vitest";

import { parseOperations } from "../lib/my-priorities-model";
import {
  assessCase,
  parseSecurityDetail,
  readableMailText,
} from "../lib/security-cases-model";

describe("Phishing-/Junk-Fall in der App", () => {
  it("liest Kampagne, IOC-Treffer und Massnahmen", () => {
    const detail = parseSecurityDetail({
      data: {
        ticketId: "case-1",
        clickedAt: "2026-11-11T08:00:00Z",
        campaign: { reports: 4, reporters: 3, caseCount: 2 },
        iocHits: [
          { id: "1", kind: "domain", value: "evil[.]example" },
          { id: "2", kind: "hash", value: "x" },
        ],
        measures: [
          { id: "m", label: "Sitzungen widerrufen", status: "succeeded" },
        ],
      },
    });
    expect(detail?.clickedAt).toBe("2026-11-11T08:00:00Z");
    expect(detail?.campaign?.reporters).toBe(3);
    expect(detail?.iocHits.map((hit) => hit.id)).toEqual(["1"]);
    expect(detail?.measures[0]?.status).toBe("succeeded");
  });
});

describe("Meine Prioritäten in der App", () => {
  it("liest Störungen und Phishing-/Junk-Fälle", () => {
    expect(
      parseOperations([
        {
          kind: "incident",
          id: "i",
          number: "STO-1",
          title: "Switch",
          urgent: true,
          reason: "Ausfall",
        },
        { kind: "security_case", id: "s", number: "SEC-1" },
        { kind: "ticket", id: "t", number: "T-1" },
      ]),
    ).toEqual([
      {
        kind: "incident",
        id: "i",
        number: "STO-1",
        title: "Switch",
        urgent: true,
        reason: "Ausfall",
      },
      {
        kind: "security_case",
        id: "s",
        number: "SEC-1",
        title: "",
        urgent: false,
        reason: "",
      },
    ]);
    expect(parseOperations(undefined)).toEqual([]);
  });
});

describe("Einschätzung eines Phishing-/Junk-Falls", () => {
  const hrMail = parseSecurityDetail({
    data: {
      ticketId: "case-hr",
      analysis: {
        score: 35,
        level: "medium",
        from: "hr_abteilung@hr-abteilung.zuerick.ch",
        fromName: "Ihre HR-Abteilung",
        returnPath: "hr_abteilung@hr-abteilung.zuerick.ch",
        sendingIp: "94.100.132.73",
        auth: { spf: "pass", dkim: "pass", dmarc: "permerror" },
        findings: [
          {
            severity: "high",
            message: "DMARC-Prüfung fehlgeschlagen (permerror).",
          },
        ],
        links: [
          {
            href: "hxxps://hr-abteilung[.]ch-secure[.]com/hr_kontaktformular/1[.]php",
          },
        ],
      },
      reporters: [{ name: "R", email: "ramona@sonnenberg-baar.ch" }],
      iocHits: [{ id: "1", kind: "ip", value: "94[.]100[.]132[.]73" }],
      originalMail: {
        subject: "Lohnangaben",
        headers: [{ name: "From", value: "x" }],
        html: "<p>Bitte <a href='https://evil.example/login'>hier</a> best&auml;tigen</p>",
        text: "",
      },
    },
  })!;

  it("erkennt die gefälschte HR-Mail als Phishing", () => {
    const result = assessCase(hrMail);
    expect(result.suggestion).toBe("phishing");
    expect(result.headline).toBe("Wahrscheinlich Phishing");
    const text = result.reasons.map((reason) => reason.text).join("\n");
    expect(text).toContain("interne Stelle");
    expect(text).toContain("ch-secure[.]com");
    expect(text).toContain("früheren");
    expect(result.reasons[0]?.tone).toBe("bad");
  });

  it("zeigt die Mail als Text mit entschärften Links", () => {
    expect(hrMail.originalMail?.subject).toBe("Lohnangaben");
    expect(
      readableMailText("", "<p>Hallo</p><p>Siehe https://evil.example/a</p>"),
    ).toBe("Hallo\nSiehe hxxps://evil[.]example/a");
  });

  it("schlägt bei eigener, sauber bestätigter Mail «Harmlos» vor", () => {
    const own = parseSecurityDetail({
      data: {
        ticketId: "case-own",
        analysis: {
          from: "info@sonnenberg-baar.ch",
          auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
        },
        reporters: [{ name: "R", email: "ramona@sonnenberg-baar.ch" }],
      },
    })!;
    expect(assessCase(own).suggestion).toBe("harmless");
  });
});
