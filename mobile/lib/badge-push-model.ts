// Zahl-Push (kind «badge»): der Server meldet die neue Zahl ungelesener
// Mitteilungen, wenn sie ausserhalb der App gelesen wurden. Rein, testbar.

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Liest die Zahl aus den Daten eines Zahl-Pushs. Android liefert die Daten je
 * nach Weg direkt, unter «data» oder «body» (als JSON-Text) oder unter
 * «notification.request.content.data».
 */
export function badgeCountFromPush(value: unknown): number | null {
  const queue: unknown[] = [value];
  for (let step = 0; step < 12 && queue.length; step += 1) {
    const current = parseJson(queue.shift());
    if (!isRecord(current)) continue;
    if (current.kind === "badge") {
      const count = current.badgeCount;
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
        return Math.min(count, 9999);
      }
    }
    for (const key of [
      "data",
      "body",
      "dataString",
      "notification",
      "request",
      "content",
    ]) {
      if (key in current) queue.push(current[key]);
    }
  }
  return null;
}

/** Push ohne sichtbaren Inhalt (reine Zahl): nicht als Mitteilung zeigen. */
export function isSilentPush(content: {
  title?: string | null;
  body?: string | null;
  data?: unknown;
}): boolean {
  if (badgeCountFromPush(content.data) !== null) return true;
  return !content.title?.trim() && !content.body?.trim();
}
