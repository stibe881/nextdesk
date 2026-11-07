// Text hygiene for ticket content before it leaves nextDesk (AI provider).

export function isUnsafeControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === undefined ||
    (codePoint >= 0x0001 && codePoint <= 0x0008) ||
    (codePoint >= 0x000b && codePoint <= 0x000c) ||
    (codePoint >= 0x000e && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** Removes contact data and secret-like lines before text leaves nextDesk. */
export function redactTicketText(value: string): string {
  const secretLike =
    /(?:authorization\s*:\s*bearer|api[ _-]?key\s*[=:]|passw(?:or)?t\s*[=:]|password\s*[=:]|-----begin [a-z ]*private key-----|(?:sk|pk)_[a-z0-9_-]{16,})/i;
  return Array.from(value)
    .filter((character) => !isUnsafeControlCharacter(character))
    .join("")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (secretLike.test(line) ? "[entfernt: vertraulicher Inhalt]" : line))
    .join("\n")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[E-Mail]")
    .replace(/(?:\+|00)\d[\d\s/-]{7,}\d|\b0\d{2}[\s/-]?\d{3}[\s/-]?\d{2}[\s/-]?\d{2}\b/g, "[Telefon]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Shortens text to at most `maximum` characters (code points). */
export function clipText(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, maximum).join("")} …`;
}
