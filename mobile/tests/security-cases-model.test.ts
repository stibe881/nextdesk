import { describe, expect, it } from "vitest";

import { parseOperations } from "../lib/my-priorities-model";
import { parseSecurityDetail } from "../lib/security-cases-model";

describe("Sicherheitsfall in der App", () => {
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
        measures: [{ id: "m", label: "Sitzungen widerrufen", status: "succeeded" }],
      },
    });
    expect(detail?.clickedAt).toBe("2026-11-11T08:00:00Z");
    expect(detail?.campaign?.reporters).toBe(3);
    expect(detail?.iocHits.map((hit) => hit.id)).toEqual(["1"]);
    expect(detail?.measures[0]?.status).toBe("succeeded");
  });
});

describe("Meine Prioritäten in der App", () => {
  it("liest Störungen und Sicherheitsfälle", () => {
    expect(
      parseOperations([
        { kind: "incident", id: "i", number: "STO-1", title: "Switch", urgent: true, reason: "Ausfall" },
        { kind: "security_case", id: "s", number: "SEC-1" },
        { kind: "ticket", id: "t", number: "T-1" },
      ]),
    ).toEqual([
      { kind: "incident", id: "i", number: "STO-1", title: "Switch", urgent: true, reason: "Ausfall" },
      { kind: "security_case", id: "s", number: "SEC-1", title: "", urgent: false, reason: "" },
    ]);
    expect(parseOperations(undefined)).toEqual([]);
  });
});
