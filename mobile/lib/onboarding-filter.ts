// Filter und Suche der Eintritte in der App; rein, testbar.
import type { OnboardingEntry } from "./nextdesk-onboarding";

export type OnboardingEntryFilter = "open" | "done" | "all";

/** Ein Eintritt ist erledigt, wenn alle seine Aufgaben erledigt sind. */
export function onboardingEntryDone(entry: OnboardingEntry): boolean {
  return (
    entry.tasks.length > 0 &&
    entry.tasks.every((item) => item.status === "completed")
  );
}

/** Filter «Offen / Erledigt / Alle» und Suche (wie im Web). */
export function filterOnboardingEntries(
  entries: readonly OnboardingEntry[],
  filter: OnboardingEntryFilter,
  query: string,
): OnboardingEntry[] {
  const words = query.toLocaleLowerCase("de-CH").split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const done = onboardingEntryDone(entry);
    if (filter === "open" && done) return false;
    if (filter === "done" && !done) return false;
    if (!words.length) return true;
    const text = [
      entry.employeeName,
      entry.organisationUnit,
      entry.location,
      entry.managerName,
      entry.ictResponsibleName,
      entry.sourceTicketNumber,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("de-CH");
    return words.every((word) => text.includes(word));
  });
}
