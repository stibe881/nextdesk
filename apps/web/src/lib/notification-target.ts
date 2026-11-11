// Ziel eines Klicks auf eine Benachrichtigung in der Glocke. Reine Logik,
// getestet in notification-target.test.ts. Gegenstück der App:
// mobile/lib/push-navigation.ts.

export type NotificationTargetSection =
  | "Tickets"
  | "Sicherheitsfälle"
  | "Störungen"
  | "Shop"
  | "IP-Adressen"
  | "Lager"
  | "Serviceaufgaben"
  | "Infrastruktur"
  | "Systemstatus"
  | "Teamführung"
  | "Fälle"
  | "Lizenzen"
  | "Verträge";

export type NotificationIpamFocus = {
  addressId: string | null;
  ip: string | null;
  prefixId: string | null;
  view: "findings" | "discovery" | null;
};

export type NotificationFocus =
  | { kind: "security"; id: string }
  | { kind: "incident"; id: string }
  | { kind: "serviceTask"; id: string }
  | { kind: "inventoryItem"; id: string }
  | { kind: "shopOrder"; id: string }
  | { kind: "infrastructureDevice"; id: string }
  | ({ kind: "ipam" } & NotificationIpamFocus);

export type NotificationTarget =
  | { type: "ticket"; ticketId: string }
  | {
      type: "section";
      section: NotificationTargetSection;
      focus?: NotificationFocus;
    };

export type NotificationTargetInput = {
  kind: string;
  payload: unknown;
  ticketId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP_ADDRESS = /^[0-9a-f.:]{2,45}$/i;

function payloadValue(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadId(payload: unknown, key: string): string | null {
  const value = payloadValue(payload, key);
  return value && UUID.test(value) ? value : null;
}

function section(
  name: NotificationTargetSection,
  focus?: NotificationFocus | null,
): NotificationTarget {
  return focus
    ? { type: "section", section: name, focus }
    : { type: "section", section: name };
}

function ipamTarget(kind: string, payload: unknown): NotificationTarget {
  if (kind === "ipam.agent_offline") {
    return section("IP-Adressen", {
      kind: "ipam",
      addressId: null,
      ip: null,
      prefixId: null,
      view: "discovery",
    });
  }
  const addressId = payloadId(payload, "addressId");
  const address = payloadValue(payload, "address");
  const ip = address && IP_ADDRESS.test(address) ? address : null;
  const prefixId = payloadId(payload, "prefixId");
  if (addressId || ip) {
    return section("IP-Adressen", {
      kind: "ipam",
      addressId,
      ip: addressId ? null : ip,
      prefixId: null,
      view: null,
    });
  }
  return section("IP-Adressen", {
    kind: "ipam",
    addressId: null,
    ip: null,
    prefixId,
    view: prefixId ? null : "findings",
  });
}

/** Wohin ein Klick führt; null, wenn es nichts zu öffnen gibt. */
export function notificationTarget(
  notification: NotificationTargetInput,
): NotificationTarget | null {
  const { kind, payload } = notification;
  const ticketId = notification.ticketId;

  if (kind === "ticket.security_report" || kind.startsWith("security.")) {
    return ticketId
      ? section("Sicherheitsfälle", { kind: "security", id: ticketId })
      : section("Sicherheitsfälle");
  }
  if (kind === "monitoring.ipam_finding" || kind.startsWith("ipam.")) {
    return ipamTarget(kind, payload);
  }
  if (kind.startsWith("monitoring.")) {
    const incidentId = payloadId(payload, "incidentId");
    return section(
      "Störungen",
      incidentId ? { kind: "incident", id: incidentId } : null,
    );
  }
  if (kind.startsWith("shop.order.")) {
    const orderId = payloadId(payload, "orderId");
    return section("Shop", orderId ? { kind: "shopOrder", id: orderId } : null);
  }
  if (kind.startsWith("inventory.")) {
    const itemId = payloadId(payload, "inventoryItemId");
    return section(
      "Lager",
      itemId ? { kind: "inventoryItem", id: itemId } : null,
    );
  }
  if (kind.startsWith("service_task.")) {
    const occurrenceId = payloadId(payload, "occurrenceId");
    return section(
      "Serviceaufgaben",
      occurrenceId ? { kind: "serviceTask", id: occurrenceId } : null,
    );
  }
  if (kind === "infrastructure.due") {
    const assetId = payloadId(payload, "assetId");
    return section(
      "Infrastruktur",
      assetId ? { kind: "infrastructureDevice", id: assetId } : null,
    );
  }
  if (kind === "maintenance.upcoming") return section("Systemstatus");
  if (kind === "team.overload") return section("Teamführung");
  if (kind === "problem.recurring_detected") return section("Fälle");
  if (kind === "license.reclaim_candidates") return section("Lizenzen");
  if (kind === "contract.deadline") return section("Verträge");
  if (ticketId) return { type: "ticket", ticketId };
  // Stellvertretung und Tickets, die es nicht mehr gibt: Ticketliste.
  if (kind.startsWith("delegation.") || kind.startsWith("ticket.")) {
    return section("Tickets");
  }
  return null;
}
