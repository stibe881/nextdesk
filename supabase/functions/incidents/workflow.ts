// Pure helpers of the incidents function: list cursor, sorting, texts for
// the linked tickets, the case and the knowledge article draft.
import { type Formality, tone } from "../_shared/formality.ts";

export const CAUSES = [
  "power",
  "network",
  "hardware",
  "software",
  "maintenance",
  "external",
  "unknown",
] as const;
export type Cause = (typeof CAUSES)[number];

export const CAUSE_LABELS: Record<Cause, string> = {
  power: "Strom",
  network: "Netzwerk",
  hardware: "Hardware",
  software: "Software",
  maintenance: "Wartung",
  external: "Extern (Provider, Lieferant)",
  unknown: "Unbekannt",
};

export type IncidentFilter =
  | "active"
  | "unacknowledged"
  | "services"
  | "recent"
  | "resolved"
  | "closed"
  | "all";

/** Filters on active incidents: one page holds all of them (sorted by urgency). */
export const ACTIVE_FILTERS: readonly IncidentFilter[] = [
  "active",
  "unacknowledged",
  "services",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset cursor «<opened_at ISO>|<id>» of the last listed incident. */
export function encodeCursor(openedAt: string, id: string): string {
  return `${openedAt}|${id}`;
}

export function parseCursor(
  value: unknown,
): { openedAt: string; id: string } | null {
  if (typeof value !== "string" || value.length > 120) return null;
  const [openedAt, id, ...rest] = value.split("|");
  if (rest.length || !openedAt || !id || !UUID.test(id)) return null;
  const time = Date.parse(openedAt);
  return Number.isFinite(time) ? { openedAt: new Date(time).toISOString(), id } : null;
}

type Sortable = {
  state: string;
  acknowledgedAt: string | null;
  severity: string;
  openedAt: string;
};

/**
 * Active incidents: unacknowledged first, then outages before warnings, the
 * oldest first. Everything else: newest first.
 */
export function compareIncidents(a: Sortable, b: Sortable): number {
  if (a.state === "active" && b.state === "active") {
    const rank = (entry: Sortable) => (entry.severity === "down" ? 0 : 1);
    return Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) ||
      rank(a) - rank(b) ||
      a.openedAt.localeCompare(b.openedAt);
  }
  if (a.state === "active") return -1;
  if (b.state === "active") return 1;
  return b.openedAt.localeCompare(a.openedAt);
}

type IncidentText = {
  number: string;
  title: string;
  deviceName: string | null;
};

/** Public reply to the tickets of an incident (to the requesters). */
export function ticketReplyText(
  incident: IncidentText,
  cause: Cause,
  note: string | null,
  formality: Formality = "du",
): string {
  const device = incident.deviceName ?? incident.title;
  return [
    "Guten Tag",
    "",
    tone(
      formality,
      `Deine Meldung hängt mit einer Störung zusammen (${incident.number}, ${device}). Die Störung ist behoben.`,
      `Ihre Meldung hängt mit einer Störung zusammen (${incident.number}, ${device}). Die Störung ist behoben.`,
    ),
    "",
    `Ursache: ${CAUSE_LABELS[cause]}${note ? `\n${note}` : ""}`,
    "",
    tone(
      formality,
      "Wir setzen dein Ticket deshalb auf «Gelöst». Besteht das Problem weiterhin, antworte bitte auf diese Nachricht.",
      "Wir setzen Ihr Ticket deshalb auf «Gelöst». Besteht das Problem weiterhin, antworten Sie bitte auf diese Nachricht.",
    ),
    "",
    "Freundliche Grüsse",
  ].join("\n");
}

/** Description of a case opened from an incident. */
export function caseDescription(input: {
  incident: IncidentText & { cause: Cause | null; closingNote: string | null };
  incidentNumbers: string[];
  services: string[];
}): string {
  const lines = [
    `Aus Störung ${input.incident.number}: ${input.incident.title}`,
    `Gerät: ${input.incident.deviceName ?? "nicht zugeordnet"}`,
  ];
  if (input.incident.cause) lines.push(`Ursache: ${CAUSE_LABELS[input.incident.cause]}`);
  if (input.services.length) lines.push(`Dienste: ${input.services.join(", ")}`);
  if (input.incidentNumbers.length > 1) {
    lines.push(`Störungen (30 Tage): ${input.incidentNumbers.join(", ")}`);
  }
  if (input.incident.closingNote) lines.push("", input.incident.closingNote);
  return lines.join("\n").slice(0, 4000);
}

export type ArticleSource = {
  number: string;
  title: string;
  deviceName: string | null;
  location: string | null;
  services: string[];
  cause: Cause;
  closingNote: string | null;
  openedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  sensors: string[];
  notes: string[];
};

function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} Minuten`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Text for the AI draft (facts only, no personal data). */
export function articleSourceText(source: ArticleSource): string {
  return [
    `Störung ${source.number}: ${source.title}`,
    `Gerät: ${source.deviceName ?? "unbekannt"}${source.location ? ` (${source.location})` : ""}`,
    source.services.length ? `Betroffene Dienste: ${source.services.join(", ")}` : "",
    `Dauer: ${duration(source.durationMinutes)}`,
    `Ursache: ${CAUSE_LABELS[source.cause]}`,
    source.closingNote ? `Lösung / Notiz beim Abschluss: ${source.closingNote}` : "",
    source.sensors.length ? `Betroffene Sensoren: ${source.sensors.join(", ")}` : "",
    source.notes.length ? `Notizen im Verlauf:\n${source.notes.map((note) => `- ${note}`).join("\n")}` : "",
  ].filter(Boolean).join("\n").slice(0, 6000);
}

export const INCIDENT_ARTICLE_INSTRUCTIONS = [
  "Erstelle aus dieser behobenen Störung (Monitoring) einen internen Wissensartikel",
  "für das IT-Team. Titel: kurz, nennt Gerät bzw. Dienst und Symptom.",
  "Text in Markdown mit den Abschnitten ## Symptom, ## Ursache, ## Lösung,",
  "## Vorbeugung. Sachlich, auf Deutsch (Schweiz, ss statt ß).",
  "Erfinde nichts: fehlt eine Angabe, schreibe «noch zu ergänzen».",
].join(" ");

/** Draft without AI: the facts in the article structure. */
export function incidentArticleTemplate(
  source: ArticleSource,
): { title: string; bodyMarkdown: string } {
  const device = source.deviceName ?? source.title;
  const title = `Störung ${device}: ${CAUSE_LABELS[source.cause]}`.slice(0, 200);
  const body = [
    "## Symptom",
    "",
    `${device} war gestört (${source.number}, Dauer ${duration(source.durationMinutes)}).` +
    (source.services.length ? ` Betroffene Dienste: ${source.services.join(", ")}.` : ""),
    source.sensors.length ? `\nGemeldete Sensoren: ${source.sensors.join(", ")}.` : "",
    "",
    "## Ursache",
    "",
    CAUSE_LABELS[source.cause] + (source.location ? ` · Standort: ${source.location}` : ""),
    "",
    "## Lösung",
    "",
    source.closingNote ?? "Noch zu ergänzen.",
    ...(source.notes.length ? ["", "**Notizen aus dem Verlauf**", "", ...source.notes.map((note) => `- ${note}`)] : []),
    "",
    "## Vorbeugung",
    "",
    "Noch zu ergänzen.",
  ].join("\n");
  return { title, bodyMarkdown: body };
}
