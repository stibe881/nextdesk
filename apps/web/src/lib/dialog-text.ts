/** Beschriftung und Ton der Bestätigungsdialoge, abgeleitet vom Fragetext. */

export type DialogTone = "danger" | "default";

const DANGER_WORDS: readonly { label: string; pattern: RegExp }[] = [
  { label: "Löschen", pattern: /lösch/i },
  { label: "Entfernen", pattern: /entfern/i },
  { label: "Stornieren", pattern: /storn/i },
  { label: "Ablehnen", pattern: /ablehn/i },
  { label: "Archivieren", pattern: /archiv/i },
  { label: "Zurückgeben", pattern: /zurückgeb/i },
  { label: "Abbrechen", pattern: /(?:offene|wirklich) .*abbrechen/i },
];

export function dialogTone(message: string): DialogTone {
  return DANGER_WORDS.some((word) => word.pattern.test(message))
    ? "danger"
    : "default";
}

export function dialogConfirmLabel(message: string): string {
  return (
    DANGER_WORDS.find((word) => word.pattern.test(message))?.label ??
    "Bestätigen"
  );
}

/** Erste Zeile als Titel, Rest als Text; kurze Fragen bleiben Titel ohne Text. */
export function splitDialogMessage(message: string): {
  body: string;
  title: string;
} {
  const lines = message.trim().split(/\n+/);
  const title = (lines[0] ?? "").trim();
  return { title, body: lines.slice(1).join("\n").trim() };
}
