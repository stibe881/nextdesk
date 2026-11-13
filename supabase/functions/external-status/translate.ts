// Externe Störungen: Titel und Text der Anbieter (meist Englisch, mit
// Floskeln) als kurze deutsche Fassung. Reine Funktionen; der Aufruf der KI
// und der Zwischenspeicher liegen in index.ts.

export type Translation = { title: string; message: string | null };

export const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "message"],
  properties: {
    title: { type: "string" },
    message: { type: "string" },
  },
} as const;

export const TRANSLATION_SYSTEM =
  "Du übersetzt Störungsmeldungen von Anbietern (Statusseiten) für ein IT-Team in der Schweiz. " +
  "Schreibe auf Deutsch (Schweizer Rechtschreibung, ss statt ß), sachlich und kurz. " +
  "Titel: höchstens 90 Zeichen, beschreibt das Problem (betroffener Dienst und Auswirkung), ohne Anbieternamen am Anfang, wenn er nur wiederholt wird. " +
  "Text: ein bis drei kurze Sätze mit dem aktuellen Stand: was betroffen ist, Ursache falls bekannt, was der Anbieter tut. " +
  "Lass Floskeln weg (z. B. «Wir untersuchen das Problem und melden uns», «Weitere Updates folgen», Entschuldigungen, Links, Zeitangaben für das nächste Update). " +
  "Erfinde nichts. Produktnamen (z. B. Claude Code, Exchange Online, Outlook) bleiben unverändert. " +
  "Ist kein Text vorhanden, gib für message eine leere Zeichenkette zurück.";

/** Stable key of the original text (title and message). */
export async function translationHash(
  title: string,
  message: string | null,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}\n\n${message ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function translationPrompt(
  provider: string,
  title: string,
  message: string | null,
): string {
  return `Anbieter: ${provider}\nTitel: ${title}\nText: ${message ?? ""}`;
}

/** Validates the AI answer; null when unusable. */
export function parseTranslation(value: unknown): Translation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const clean = (field: unknown, max: number) =>
    typeof field === "string"
      ? field.replace(/\s+/g, " ").trim().slice(0, max)
      : "";
  const title = clean(row.title, 300);
  if (!title) return null;
  const message = clean(row.message, 4000);
  return { title, message: message || null };
}
