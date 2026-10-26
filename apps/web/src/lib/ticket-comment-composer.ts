export type TicketCommentComposerMode = "internal" | "external";

export type TicketCommentComposerCopy = {
  bodyLabel: string;
  hint: string;
  modeLabel: string;
  modeSummary: string;
  placeholder: string;
  submitLabel: string;
};

export type TicketCommentDrafts = Record<TicketCommentComposerMode, string>;

export type TicketCommentComposerContext = {
  canUseInternalNotes: boolean;
  key: string;
};

const composerCopy: Record<
  TicketCommentComposerMode,
  TicketCommentComposerCopy
> = {
  internal: {
    bodyLabel: "Interne Notiz",
    hint: "Nur berechtigte Mitarbeitende sehen diese interne Notiz.",
    modeLabel: "Interne Notiz",
    modeSummary: "Nur für berechtigte Mitarbeitende",
    placeholder: "Interne Notiz für das Team verfassen …",
    submitLabel: "Interne Notiz speichern",
  },
  external: {
    bodyLabel: "Antwort an anfragende Person",
    hint: "Diese Antwort ist für die anfragende Person sichtbar.",
    modeLabel: "Antwort an anfragende Person",
    modeSummary: "Für die anfragende Person sichtbar",
    placeholder: "Antwort an die anfragende Person verfassen …",
    submitLabel: "Externe Antwort senden",
  },
};

export function ticketCommentComposerCopy(
  mode: TicketCommentComposerMode,
): TicketCommentComposerCopy {
  return composerCopy[mode];
}

export function ticketCommentDraftForMode(
  drafts: TicketCommentDrafts,
  mode: TicketCommentComposerMode,
): string {
  return drafts[mode];
}

export function updateTicketCommentDraft(
  drafts: TicketCommentDrafts,
  mode: TicketCommentComposerMode,
  body: string,
): TicketCommentDrafts {
  return { ...drafts, [mode]: body };
}

export function ticketCommentComposerModeForTicketContext({
  currentMode,
  nextContext,
  previousContext,
}: {
  currentMode: TicketCommentComposerMode;
  nextContext: TicketCommentComposerContext;
  previousContext: TicketCommentComposerContext | null;
}): TicketCommentComposerMode {
  if (previousContext?.key !== nextContext.key) {
    return nextContext.canUseInternalNotes ? "internal" : "external";
  }

  if (!nextContext.canUseInternalNotes) return "external";
  if (!previousContext.canUseInternalNotes) return "internal";
  return currentMode;
}
