const DISPLAY_NAME_LOCALE = "de-CH";

function titleCaseNamePart(value: string): string {
  const characters = Array.from(value);
  const firstCharacter = characters.shift();
  if (!firstCharacter) return value;

  return `${firstCharacter.toLocaleUpperCase(DISPLAY_NAME_LOCALE)}${characters
    .join("")
    .toLocaleLowerCase(DISPLAY_NAME_LOCALE)}`;
}

function formatLowercaseNameWord(value: string): string {
  return value
    .split(/([-’'])/u)
    .map((part) =>
      part === "-" || part === "’" || part === "'"
        ? part
        : titleCaseNamePart(part),
    )
    .join("");
}

/**
 * Korrigiert ausschliesslich vollständig klein geschriebene Personennamen für
 * die Anzeige. Bereits gepflegte Grossschreibung bleibt unverändert, damit
 * Eigenschreibweisen wie «McDonald» oder «ICT Service» nicht verfälscht werden.
 */
export function formatPersonDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    normalized.includes("@") ||
    normalized !== normalized.toLocaleLowerCase(DISPLAY_NAME_LOCALE)
  ) {
    return normalized;
  }

  return normalized
    .split(" ")
    .map((word) => formatLowercaseNameWord(word))
    .join(" ");
}
