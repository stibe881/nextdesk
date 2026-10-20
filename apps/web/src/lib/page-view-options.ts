export type PageViewOption = "ticketDensity" | "ticketSplitView";

export function pageViewOptionsForSection(
  section: string,
  canUseTicketSplitView: boolean,
): readonly PageViewOption[] {
  if (section !== "Tickets") return [];

  return canUseTicketSplitView
    ? ["ticketDensity", "ticketSplitView"]
    : ["ticketDensity"];
}
