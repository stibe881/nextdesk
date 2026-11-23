/**
 * Erkennt «@Vorname Nachname» im Text einer Notiz oder Antwort und liefert die
 * IDs der erwähnten Agenten. Gross-/Kleinschreibung zählt nicht; nach dem
 * Namen muss der Text enden oder ein Leer- bzw. Satzzeichen folgen.
 */
export type MentionCandidate = { id: string; displayName: string };

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionedAgentIds(
  body: string,
  agents: readonly MentionCandidate[],
): string[] {
  if (!body.includes("@")) return [];
  const ids = new Set<string>();
  // Längere Namen zuerst, damit «@Anna Muster» nicht nur «@Anna» trifft.
  const sorted = [...agents]
    .filter((agent) => agent.displayName.trim().length >= 2)
    .sort((a, b) => b.displayName.length - a.displayName.length);
  let remaining = body;
  for (const agent of sorted) {
    const pattern = new RegExp(
      `(^|[\\s(\\[,;:])@${escape(agent.displayName.trim())}(?=$|[\\s.,;:!?)\\]])`,
      "giu",
    );
    if (pattern.test(remaining)) {
      ids.add(agent.id);
      remaining = remaining.replace(pattern, "$1");
    }
  }
  return [...ids];
}

/** Teil nach dem letzten «@» am Textende, solange gerade ein Name getippt wird. */
export function activeMentionQuery(body: string): string | null {
  const match = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/u.exec(body);
  return match ? match[1]! : null;
}
