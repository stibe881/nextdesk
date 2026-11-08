/** SLA breach causes and customer praise: labels and pure helpers. */

export const SLA_BREACH_REASON_OPTIONS = [
  { code: "third_party", label: "Drittanbieter" },
  { code: "wrong_routing", label: "Falsches Team / Weiterleitung" },
  {
    code: "missing_requester_info",
    label: "Fehlende Infos von meldender Person",
  },
  { code: "capacity", label: "Kapazität / Überlastung" },
  { code: "complexity", label: "Komplexität" },
  { code: "other", label: "Sonstiges" },
] as const;

export type SlaBreachReasonCode =
  (typeof SLA_BREACH_REASON_OPTIONS)[number]["code"];
export type SlaBreachKind = "response" | "resolution";

export const SLA_BREACH_NOTE_MAX = 500;

export type SlaBreach = {
  kind: SlaBreachKind;
  dueAt: string;
  reason: {
    code: SlaBreachReasonCode;
    label: string;
    note: string | null;
    recordedAt: string;
    recordedByName: string | null;
  } | null;
};

export function slaBreachKindLabel(kind: SlaBreachKind): string {
  return kind === "response" ? "Erstreaktion" : "Lösungsziel";
}

export function slaBreachReasonLabel(code: string): string {
  return (
    SLA_BREACH_REASON_OPTIONS.find((option) => option.code === code)?.label ??
    code
  );
}

/** Breaches that still need a reason. */
export function breachesWithoutReason(breaches: SlaBreach[]): SlaBreach[] {
  return breaches.filter((breach) => !breach.reason);
}

/** «Erstreaktion und Lösungsziel» for the prompt headline. */
export function describeBreachKinds(breaches: SlaBreach[]): string {
  const labels = [...new Set(breaches.map((breach) => breach.kind))]
    .sort((a, b) => (a === b ? 0 : a === "response" ? -1 : 1))
    .map(slaBreachKindLabel);
  return labels.join(" und ");
}

/** Validates the form; returns an error message or null. */
export function validateReasonDraft(
  code: SlaBreachReasonCode | "",
  note: string,
): string | null {
  if (!code) return "Bitte wählen Sie eine Ursache.";
  const trimmed = note.trim();
  if (code === "other" && !trimmed)
    return "Bitte beschreiben Sie die Ursache kurz.";
  if ([...trimmed].length > SLA_BREACH_NOTE_MAX)
    return `Die Notiz darf höchstens ${SLA_BREACH_NOTE_MAX} Zeichen lang sein.`;
  return null;
}

export type KudosEntry = {
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
  agentId: string | null;
  agentName?: string | null;
  score: number;
  comment: string | null;
  requesterName: string | null;
  createdAt: string;
};

/** «★★★★★» for a 1–5 score (empty stars fill up to five). */
export function scoreStars(score: number): string {
  const value = Math.max(0, Math.min(5, Math.round(score)));
  return "★".repeat(value) + "☆".repeat(5 - value);
}

/** Only the display name is shown – never an e-mail address. */
export function kudosAuthor(name: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.includes("@")) return "Meldende Person";
  return trimmed;
}
