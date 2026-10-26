import { describe, expect, it } from "vitest";
import {
  ticketCommentComposerCopy,
  ticketCommentComposerModeForTicketContext,
  ticketCommentDraftForMode,
  updateTicketCommentDraft,
} from "./ticket-comment-composer";

describe("Ticketkommunikation", () => {
  it("bezeichnet interne Notizen eindeutig und nur für berechtigte Mitarbeitende", () => {
    expect(ticketCommentComposerCopy("internal")).toMatchObject({
      bodyLabel: "Interne Notiz",
      submitLabel: "Interne Notiz speichern",
    });
    expect(ticketCommentComposerCopy("internal").hint).toContain(
      "berechtigte Mitarbeitende",
    );
  });

  it("bezeichnet externe Antworten eindeutig für die anfragende Person", () => {
    expect(ticketCommentComposerCopy("external")).toMatchObject({
      bodyLabel: "Antwort an anfragende Person",
      submitLabel: "Externe Antwort senden",
    });
    expect(ticketCommentComposerCopy("external").hint).toContain(
      "anfragende Person",
    );
  });

  it("hält interne und externe Entwürfe beim Wechsel strikt getrennt", () => {
    const withInternalNote = updateTicketCommentDraft(
      { external: "", internal: "Interne Abklärung mit dem Team" },
      "external",
      "Antwort an die anfragende Person",
    );

    expect(ticketCommentDraftForMode(withInternalNote, "internal")).toBe(
      "Interne Abklärung mit dem Team",
    );
    expect(ticketCommentDraftForMode(withInternalNote, "external")).toBe(
      "Antwort an die anfragende Person",
    );
  });

  it("wählt eine interne Notiz nur beim neuen oder erneut berechtigten Ticketkontext als Standard", () => {
    const internalContext = { canUseInternalNotes: true, key: "tenant:ticket" };
    const externalContext = {
      canUseInternalNotes: false,
      key: "tenant:ticket",
    };

    expect(
      ticketCommentComposerModeForTicketContext({
        currentMode: "external",
        nextContext: internalContext,
        previousContext: null,
      }),
    ).toBe("internal");
    expect(
      ticketCommentComposerModeForTicketContext({
        currentMode: "external",
        nextContext: internalContext,
        previousContext: externalContext,
      }),
    ).toBe("internal");
    expect(
      ticketCommentComposerModeForTicketContext({
        currentMode: "external",
        nextContext: internalContext,
        previousContext: internalContext,
      }),
    ).toBe("external");
  });
});
