// Employees without ticket work rights: their workplace (personal area),
// their tickets (and those of their direct reports), the shop, the public
// knowledge and the service status.
export const REQUESTER_NAVIGATION_SECTIONS = [
  "Arbeitsplatz",
  "Tickets",
  "Shop",
  "Wissen",
  "Systemstatus",
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
    section === "Tickets" ||
    section === "Shop" ||
    section === "Wissen" ||
    section === "Systemstatus" ||
    (section === "Arbeitsplatz" && requesterPortalEnabled)
  );
}
