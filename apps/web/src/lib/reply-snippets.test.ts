import { describe, expect, it } from "vitest";
import mobileCopy from "../../../../mobile/lib/reply-snippets.ts?raw";
import webCopy from "./reply-snippets.ts?raw";
import {
  filterSnippets,
  formatSnippetDate,
  insertSnippetAt,
  normalizeSnippetShortcut,
  parseSnippetResponse,
  resolveSnippetPlaceholders,
  snippetTriggerAt,
  splitPersonName,
  unknownSnippetPlaceholders,
  type ReplySnippet,
  type SnippetContext,
} from "./reply-snippets";

const context: SnippetContext = {
  requesterName: "Anna Muster",
  ticketNumber: "T-2026-0042",
  subject: "Drucker druckt nicht",
  device: "NB-0815",
  agentName: "Max Support",
  departmentName: "IT",
};
const today = new Date(2026, 10, 7);

function snippet(partial: Partial<ReplySnippet>): ReplySnippet {
  return {
    id: "s",
    name: "Gruss",
    shortcut: null,
    body: "Text",
    departmentId: null,
    departmentName: null,
    personal: false,
    canEdit: false,
    ...partial,
  };
}

describe("reply snippets", () => {
  it("keeps the web and the mobile copy identical", () => {
    expect(webCopy).toBe(mobileCopy);
  });

  it("resolves all placeholders from the ticket", () => {
    expect(
      resolveSnippetPlaceholders(
        "Guten Tag {Vorname} {Nachname} ({Name}), Ticket {Ticketnummer} «{Betreff}» zu {Gerät} – {Agent}, {Abteilung}, {Datum}",
        context,
        today,
      ),
    ).toBe(
      "Guten Tag Anna Muster (Anna Muster), Ticket T-2026-0042 «Drucker druckt nicht» zu NB-0815 – Max Support, IT, 07.11.2026",
    );
  });

  it("is case-insensitive, accepts Geraet and keeps unknown placeholders", () => {
    expect(
      resolveSnippetPlaceholders(
        "{vorname} {GERAET} {Unbekannt}",
        context,
        today,
      ),
    ).toBe("Anna NB-0815 {Unbekannt}");
    expect(unknownSnippetPlaceholders("{Vorname} {Foo} {Foo}")).toEqual([
      "Foo",
    ]);
  });

  it("drops the space of empty values before punctuation", () => {
    const empty = { ...context, requesterName: null, device: null };
    expect(
      resolveSnippetPlaceholders("Guten Tag {Vorname},", empty, today),
    ).toBe("Guten Tag,");
    expect(
      resolveSnippetPlaceholders(
        "Hallo {Vorname} {Nachname}!\nDanke",
        empty,
        today,
      ),
    ).toBe("Hallo!\nDanke");
    expect(
      resolveSnippetPlaceholders("Gerät {Gerät} prüfen", empty, today),
    ).toBe("Gerät prüfen");
  });

  it("splits names, also «Nachname, Vorname»", () => {
    expect(splitPersonName("Muster, Anna")).toEqual({
      firstName: "Anna",
      lastName: "Muster",
    });
    expect(splitPersonName("Anna Maria von Muster")).toEqual({
      firstName: "Anna",
      lastName: "Maria von Muster",
    });
    expect(splitPersonName("  ")).toEqual({ firstName: "", lastName: "" });
    expect(
      resolveSnippetPlaceholders(
        "{Name}",
        { ...context, requesterName: "Muster, Anna" },
        today,
      ),
    ).toBe("Anna Muster");
  });

  it("formats the date in Swiss notation", () => {
    expect(formatSnippetDate(new Date(2026, 0, 5))).toBe("05.01.2026");
  });

  it("finds the slash trigger only at a word start", () => {
    expect(snippetTriggerAt("/gru", 4)).toEqual({ start: 0, query: "gru" });
    expect(snippetTriggerAt("Hallo /", 7)).toEqual({ start: 6, query: "" });
    expect(snippetTriggerAt("und/oder", 8)).toBeNull();
    expect(snippetTriggerAt("Hallo /gr x", 11)).toBeNull();
    expect(snippetTriggerAt("Hallo /grüsse", 13)).toEqual({
      start: 6,
      query: "grüsse",
    });
  });

  it("replaces the trigger with the snippet", () => {
    const trigger = snippetTriggerAt("Hallo /gr und", 9)!;
    expect(insertSnippetAt("Hallo /gr und", trigger, 9, "Grüezi")).toEqual({
      text: "Hallo Grüezi und",
      caret: 12,
    });
  });

  it("filters by department and ranks shortcut matches first", () => {
    const snippets = [
      snippet({ id: "a", name: "Abschluss", shortcut: "ende" }),
      snippet({ id: "b", name: "Gruss", shortcut: "gruss" }),
      snippet({
        id: "c",
        name: "Gruss persönlich",
        shortcut: "gruss",
        personal: true,
      }),
      snippet({ id: "d", name: "Grussformel HR", departmentId: "hr" }),
      snippet({ id: "e", name: "Ende gut", body: "alles gut" }),
    ];
    expect(filterSnippets(snippets, "gruss", "it").map((s) => s.id)).toEqual([
      "c",
      "b",
    ]);
    expect(filterSnippets(snippets, "gru", "hr").map((s) => s.id)).toEqual([
      "c",
      "b",
      "d",
    ]);
    expect(filterSnippets(snippets, "ende", null).map((s) => s.id)).toEqual([
      "a",
      "e",
    ]);
    expect(filterSnippets(snippets, "", "it", 2)).toHaveLength(2);
  });

  it("normalises shortcuts and parses the response", () => {
    expect(normalizeSnippetShortcut("/Gruss")).toBe("gruss");
    expect(normalizeSnippetShortcut("mit leer")).toBeNull();
    const parsed = parseSnippetResponse({
      data: {
        canManageShared: true,
        snippets: [
          { id: "1", name: "A", body: "x", shortcut: "a", personal: true },
          { id: "2", name: "", body: "x" },
        ],
        context: { requesterName: "Anna", ticketNumber: 42 },
      },
    });
    expect(parsed?.snippets.map((s) => s.id)).toEqual(["1"]);
    expect(parsed?.context.requesterName).toBe("Anna");
    expect(parsed?.context.ticketNumber).toBeNull();
    expect(parsed?.canManageShared).toBe(true);
    expect(parseSnippetResponse({ data: {} })).toBeNull();
  });
});
