export const REQUESTER_NAVIGATION_SECTIONS = [
  "Übersicht",
  "Tickets",
  "Shop",
  "Mein Portal",
] as const;

export function requesterNavigationSections<T extends { label: string }>(
  sections: readonly T[],
): T[] {
  return sections.filter((section) =>
    (REQUESTER_NAVIGATION_SECTIONS as readonly string[]).includes(
      section.label,
    ),
  );
}

export function canRequesterOpenSection(
  section: string,
  requesterPortalEnabled: boolean,
): boolean {
  return (
    section === "Übersicht" ||
    section === "Tickets" ||
    section === "Shop" ||
    (section === "Mein Portal" && requesterPortalEnabled)
  );
}
