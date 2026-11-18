/** Anzeige der App-Version und des Builds, zum Beispiel «Version 1.0.2 (Build 10135)». */
export function formatAppVersion(
  version: string | null | undefined,
  build: string | null | undefined,
): string {
  const v = version?.trim();
  const b = build?.trim();
  if (v && b) return `Version ${v} (Build ${b})`;
  if (v) return `Version ${v}`;
  if (b) return `Build ${b}`;
  return "";
}
