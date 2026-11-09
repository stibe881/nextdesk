// Display names on ticket cards.

/** "stefan gross" → "Stefan Gross"; names with capitals stay as they are. */
export function formatRequesterName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@") || trimmed !== trimmed.toLocaleLowerCase("de-CH")) {
    return trimmed;
  }
  return trimmed.replace(
    /(^|[\s-])(\p{L})/gu,
    (_match, start: string, letter: string) =>
      `${start}${letter.toLocaleUpperCase("de-CH")}`,
  );
}
