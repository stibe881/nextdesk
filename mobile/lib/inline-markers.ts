/**
 * Platzhalter für eingebettete Bilder ([[nextdesk-inline-image:<id>]]) im
 * Text einer Nachricht oder Beschreibung. Die App zeigt die Bilder als
 * Anhänge unter der Nachricht; im Text werden die Platzhalter ausgeblendet.
 */
export function withoutInlineMarkers(text: string): string {
  return text
    .replace(/\[\[nextdesk-(?:inline|pending)-image:[0-9a-z-]{1,64}\]\]/giu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
