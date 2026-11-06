// Employees without ticket work rights: their tickets (and those of their
// direct reports), the shop and the public knowledge. The service status is
// a badge on top of the menu, not a menu item.
export const REQUESTER_NAVIGATION_SECTIONS = [
  "Tickets",
  "Shop",
  "Wissen",
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
    section === "Systemstatus"
  );
}
