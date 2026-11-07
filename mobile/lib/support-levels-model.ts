// Eskalationsstufen (1st/2nd/3rd Level) – reine Logik für die App, ohne
// Netzwerkzugriff, damit sie getestet werden kann.

export type MobileSupportLevel = 1 | 2 | 3;

export type MobileLevelTeam = { id: string; name: string };

export type MobileLevelHandover = {
  kind: "initial" | "escalated" | "returned" | "cleared";
  fromLevel: MobileSupportLevel | null;
  note: string;
  actorName: string | null;
  createdAt: string;
};

export type MobileTicketSupportLevel = {
  levelsConfigured: boolean;
  currentLevel: MobileSupportLevel | null;
  currentTeamName: string | null;
  canHandover: boolean;
  next: { level: MobileSupportLevel; teams: MobileLevelTeam[] } | null;
  back: { level: MobileSupportLevel; teams: MobileLevelTeam[] }[];
  currentHandover: MobileLevelHandover | null;
  historyCount: number;
};

export const MOBILE_NOTE_MIN = 10;
export const MOBILE_NOTE_MAX = 4000;

export function isMobileSupportLevel(
  value: unknown,
): value is MobileSupportLevel {
  return value === 1 || value === 2 || value === 3;
}

export function mobileSupportLevelLabel(level: MobileSupportLevel): string {
  return level === 1 ? "1st Level" : level === 2 ? "2nd Level" : "3rd Level";
}

/** Fehlertext für die Pflicht-Übergabenotiz (du-Form) oder null. */
export function mobileHandoverNoteError(note: string): string | null {
  const length = Array.from(note.trim()).length;
  if (length < MOBILE_NOTE_MIN)
    return `Beschreibe in mindestens ${MOBILE_NOTE_MIN} Zeichen, was du schon versucht hast und was du herausgefunden hast.`;
  if (length > MOBILE_NOTE_MAX)
    return `Die Notiz darf höchstens ${MOBILE_NOTE_MAX} Zeichen lang sein.`;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function teams(value: unknown): MobileLevelTeam[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string"
          ? [{ id: item.id, name: item.name }]
          : [],
      )
    : [];
}

export function parseMobileTicketSupportLevel(
  value: unknown,
): MobileTicketSupportLevel | null {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || !isRecord(data.targets)) return null;
  const next = isRecord(data.targets.next) ? data.targets.next : null;
  const handover = isRecord(data.currentHandover) ? data.currentHandover : null;
  const handoverKind = handover?.kind;
  return {
    levelsConfigured: data.levelsConfigured === true,
    currentLevel: isMobileSupportLevel(data.currentLevel)
      ? data.currentLevel
      : null,
    currentTeamName:
      isRecord(data.currentTeam) && typeof data.currentTeam.name === "string"
        ? data.currentTeam.name
        : null,
    canHandover: data.canHandover === true,
    next:
      next && isMobileSupportLevel(next.level) && teams(next.teams).length > 0
        ? { level: next.level, teams: teams(next.teams) }
        : null,
    back: Array.isArray(data.targets.back)
      ? data.targets.back.flatMap((item) =>
          isRecord(item) &&
          isMobileSupportLevel(item.level) &&
          teams(item.teams).length > 0
            ? [{ level: item.level, teams: teams(item.teams) }]
            : [],
        )
      : [],
    currentHandover:
      handover &&
      typeof handover.note === "string" &&
      typeof handover.createdAt === "string" &&
      (handoverKind === "initial" ||
        handoverKind === "escalated" ||
        handoverKind === "returned" ||
        handoverKind === "cleared")
        ? {
            kind: handoverKind,
            fromLevel: isMobileSupportLevel(handover.fromLevel)
              ? handover.fromLevel
              : null,
            note: handover.note,
            actorName:
              typeof handover.actorName === "string"
                ? handover.actorName
                : null,
            createdAt: handover.createdAt,
          }
        : null,
    historyCount: Array.isArray(data.history) ? data.history.length : 0,
  };
}

/** The card is hidden for tenants that do not use support levels. */
export function shouldShowSupportLevelCard(
  state: MobileTicketSupportLevel | null,
): boolean {
  return Boolean(
    state &&
    (state.levelsConfigured ||
      state.currentLevel !== null ||
      state.historyCount > 0),
  );
}
