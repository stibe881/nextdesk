/** Tagesüberschriften für Verläufe: nur dort, wo der Tag wechselt. */

const DAY = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Zum Beispiel «Sa., 14.11.2026» (Zeit des Geräts). */
export function dayHeading(iso: string): string {
  return DAY.format(new Date(iso));
}

/** Liefert für jeden Eintrag die Überschrift, wenn sich der Tag gegenüber dem vorigen ändert. */
export function dayHeadings(timestamps: readonly string[]): (string | null)[] {
  let previous: string | null = null;
  return timestamps.map((iso) => {
    const key = dayKey(iso);
    if (key === previous) return null;
    previous = key;
    return dayHeading(iso);
  });
}
