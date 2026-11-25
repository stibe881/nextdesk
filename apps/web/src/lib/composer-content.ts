/**
 * Inhalt des Nachrichtenfelds mit eingefügten Bildern (wie in Outlook).
 *
 * Das Feld bleibt intern reiner Text. Ein Bild, das noch nicht hochgeladen
 * ist, steht als Platzhalter `[[nextdesk-pending-image:<key>]]` an seiner
 * Stelle. Beim Senden werden die Bilder hochgeladen und die Platzhalter durch
 * `[[nextdesk-inline-image:<anhang-id>]]` ersetzt; Web, App und Mail zeigen
 * das Bild dann an dieser Stelle im Text.
 */

const PENDING_MARKER = /\[\[nextdesk-pending-image:([a-z0-9-]{1,64})\]\]/giu;

export type ComposerPart =
  { kind: "text"; value: string } | { kind: "image"; key: string };

export function pendingImageMarker(key: string): string {
  return `[[nextdesk-pending-image:${key}]]`;
}

/** Text und Bild-Platzhalter in Reihenfolge. */
export function composerParts(value: string): ComposerPart[] {
  const parts: ComposerPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PENDING_MARKER)) {
    const index = match.index ?? 0;
    if (index > cursor)
      parts.push({ kind: "text", value: value.slice(cursor, index) });
    parts.push({ kind: "image", key: String(match[1]).toLowerCase() });
    cursor = index + match[0].length;
  }
  if (cursor < value.length)
    parts.push({ kind: "text", value: value.slice(cursor) });
  return parts;
}

/** Schlüssel der Bilder, die noch im Text stehen. */
export function pendingImageKeys(value: string): string[] {
  return composerParts(value).flatMap((part) =>
    part.kind === "image" ? [part.key] : [],
  );
}

/**
 * Ersetzt die Platzhalter durch die hochgeladenen Anhänge. Bilder ohne
 * hochgeladenen Anhang (z. B. aus einem wiederhergestellten Entwurf)
 * verschwinden; leere Zeilen rund um entfernte Bilder werden gestrafft.
 */
export function finalizeComposerBody(
  value: string,
  uploadedByKey: ReadonlyMap<string, string>,
): string {
  return value
    .replace(PENDING_MARKER, (_marker, key: string) => {
      const id = uploadedByKey.get(key.toLowerCase());
      return id ? `[[nextdesk-inline-image:${id}]]` : "";
    })
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Sichtbarer Text ohne Bilder (Länge, «nur Begrüssung», Erwähnungen). */
export function composerPlainText(value: string): string {
  return value.replace(PENDING_MARKER, "").trim();
}

/**
 * Nach einer KI-Umformulierung: Bilder, die im neuen Text fehlen, bleiben
 * am Ende erhalten statt still zu verschwinden.
 */
export function keepComposerImages(previous: string, next: string): string {
  const present = new Set(pendingImageKeys(next));
  const missing = pendingImageKeys(previous).filter((key) => !present.has(key));
  if (missing.length === 0) return next;
  return `${next.replace(/\s+$/u, "")}\n\n${missing.map(pendingImageMarker).join("\n")}`;
}
