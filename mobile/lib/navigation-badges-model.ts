/**
 * Menu badges of the bottom navigation (counterpart of the web sidebar):
 * «Tickets» = tickets without an assigned agent, «Störungen» = all active
 * incidents, «Phishing» = all open security cases (both red while some are
 * unacknowledged / unassigned, otherwise grey), «Shop» = new orders (only for
 * people who fulfil orders).
 */

export type NavigationBadgeKey = "tickets" | "incidents" | "phishing" | "shop";
export type NavigationBadges = Partial<Record<NavigationBadgeKey, number>> & {
  /** Badges that need action (red); the others of «Störungen»/«Phishing» are grey. */
  urgent?: Partial<Record<NavigationBadgeKey, boolean>>;
};

/** Only positive, safe integers count; everything else shows no badge. */
export function badgeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/** «99+» for big numbers, like the web badge. */
export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Result of the `navigation_ticket_attention` RPC. */
export function parseTicketAttention(data: unknown): NavigationBadges {
  const summary = record(data);
  const unacknowledged = badgeCount(summary?.incidentsUnacknowledged);
  const unassigned = badgeCount(summary?.securityTriage);
  // Older servers only report the counts needing action.
  const active =
    summary?.incidentsActive === undefined
      ? unacknowledged
      : badgeCount(summary.incidentsActive);
  const open =
    summary?.securityOpen === undefined
      ? unassigned
      : badgeCount(summary.securityOpen);
  return {
    tickets: badgeCount(summary?.unassignedTickets),
    incidents: active,
    phishing: open,
    urgent: {
      tickets: true,
      incidents: unacknowledged > 0,
      phishing: unassigned > 0,
      shop: true,
    },
  };
}

/** `getContext` of the shop function: new orders only for fulfilment staff. */
export function parseShopAttention(data: unknown): number {
  const context = record(record(data)?.data) ?? record(data);
  return context?.canFulfill === true ? badgeCount(context.newOrders) : 0;
}

/** Spoken label of a tab with a badge, e.g. «Tickets, 16 offen». */
export function badgeAccessibilityLabel(label: string, count: number): string {
  return count > 0 ? `${label}, ${count} offen` : label;
}
