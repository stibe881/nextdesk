import { describe, expect, it } from "vitest";
import {
  MAX_SPLIT_CHILDREN,
  newSplitChild,
  openChildCount,
  splitPayload,
  updateSplitChild,
  validateSplitDraft,
} from "./ticket-split";

const parent = {
  ticketNumber: "IT-2026-000042",
  subject: "Eintritt Anna Muster",
  description: "Arbeitsplatz, Badge und Zugänge vorbereiten.",
};

describe("Ticket-Aufteilung", () => {
  it("übernimmt Betreff und Beschreibung des Haupttickets", () => {
    const child = newSplitChild("a", parent);
    expect(child.subject).toBe("Eintritt Anna Muster");
    expect(child.description).toContain("Teil von Ticket IT-2026-000042");
    expect(child.description).toContain("Badge und Zugänge");
    expect(child.departmentId).toBe("");
  });

  it("verlangt Betreff, Beschreibung und Abteilung pro Teil-Ticket", () => {
    const child = { ...newSplitChild("a", parent), subject: "ab" };
    const result = validateSplitDraft([
      child,
      { ...newSplitChild("b", parent), departmentId: "d1", description: " " },
    ]);
    expect(result.valid).toBe(false);
    const [first, second] = result.childErrors;
    expect(first?.subject).toContain("mindestens 3 Zeichen");
    expect(first?.departmentId).toBeDefined();
    expect(second?.description).toBeDefined();
    expect(second?.departmentId).toBeUndefined();
  });

  it("begrenzt die Anzahl der Teil-Tickets", () => {
    expect(validateSplitDraft([]).formError).toContain("mindestens ein");
    const many = Array.from({ length: MAX_SPLIT_CHILDREN + 1 }, (_, index) => ({
      ...newSplitChild(String(index), parent),
      departmentId: "d1",
    }));
    const result = validateSplitDraft(many);
    expect(result.valid).toBe(false);
    expect(result.formError).toContain("höchstens 10");
  });

  it("akzeptiert vollständige Teil-Tickets und baut die Anfrage", () => {
    const children = [
      { ...newSplitChild("a", parent), departmentId: "d1", teamId: "t1" },
      {
        ...newSplitChild("b", parent),
        subject: "  Badge erstellen ",
        departmentId: "d2",
        agentId: "u1",
      },
    ];
    expect(validateSplitDraft(children).valid).toBe(true);
    expect(splitPayload(children)).toEqual([
      expect.objectContaining({
        departmentId: "d1",
        teamId: "t1",
        agentId: null,
      }),
      expect.objectContaining({
        subject: "Badge erstellen",
        departmentId: "d2",
        teamId: null,
        agentId: "u1",
      }),
    ]);
  });

  it("setzt Team und Person beim Abteilungswechsel zurück", () => {
    const child = {
      ...newSplitChild("a", parent),
      departmentId: "d1",
      teamId: "t1",
      agentId: "u1",
    };
    expect(updateSplitChild(child, { departmentId: "d2" })).toMatchObject({
      departmentId: "d2",
      teamId: "",
      agentId: "",
    });
    expect(updateSplitChild(child, { teamId: "t2" })).toMatchObject({
      teamId: "t2",
      agentId: "",
    });
    expect(updateSplitChild(child, { subject: "Neu" }).agentId).toBe("u1");
  });

  it("zählt offene Teil-Tickets, die den Abschluss blockieren", () => {
    expect(
      openChildCount([
        { isClosed: true },
        { isClosed: false },
        { isClosed: false },
      ]),
    ).toBe(2);
    expect(openChildCount([])).toBe(0);
  });
});
