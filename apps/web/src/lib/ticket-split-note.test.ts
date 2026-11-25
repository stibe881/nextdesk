import { describe, expect, it } from "vitest";
import { parseTicketSplitNote, ticketSplitNoteText } from "./ticket-split-note";

describe("parseTicketSplitNote", () => {
  it("reads part, total and siblings and strips the note", () => {
    const parsed = parseTicketSplitNote(
      "Aufgeteilt aus Ticket ICT-2026-000209 – Teil 2 von 3. Weitere Teile: ICT-2026-000210, ICT-2026-000212.\n\nLiebes Team",
    );
    expect(parsed.note).toEqual({
      parentTicketNumber: "ICT-2026-000209",
      part: 2,
      total: 3,
      siblingTicketNumbers: ["ICT-2026-000210", "ICT-2026-000212"],
    });
    expect(parsed.body).toBe("Liebes Team");
    expect(ticketSplitNoteText(parsed.note!)).toBe(
      "Teil 2 von 3 aus dem aufgeteilten Ticket ICT-2026-000209",
    );
  });

  it("handles a single part without siblings", () => {
    const parsed = parseTicketSplitNote(
      "Aufgeteilt aus Ticket ICT-2026-000209 – Teil 1 von 1.\n\nText",
    );
    expect(parsed.note?.siblingTicketNumbers).toEqual([]);
    expect(parsed.body).toBe("Text");
  });

  it("recognises the older note", () => {
    const parsed = parseTicketSplitNote(
      "Teil von Ticket IT-2026-000042\n\nText",
    );
    expect(parsed.note?.parentTicketNumber).toBe("IT-2026-000042");
    expect(parsed.note?.part).toBeNull();
    expect(parsed.body).toBe("Text");
  });

  it("leaves other descriptions untouched", () => {
    expect(parseTicketSplitNote("Hallo\nWelt")).toEqual({
      note: null,
      body: "Hallo\nWelt",
    });
  });
});
