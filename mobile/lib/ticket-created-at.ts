const timeFormat = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * When a ticket was created, for ticket cards: «Erstellt heute, 14:32»,
 * «Erstellt gestern, 09:05» or «Erstellt 07.11.2026, 09:12». Null when the
 * time is missing or invalid.
 */
export function formatTicketCreatedAt(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return null;
  const time = timeFormat.format(created);
  if (sameDay(created, now)) return `Erstellt heute, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(created, yesterday)) return `Erstellt gestern, ${time}`;
  return `Erstellt ${dateFormat.format(created)}, ${time}`;
}
