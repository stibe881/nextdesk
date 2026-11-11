// Ziel einer angetippten Push-Mitteilung (push-dispatch → App). Reine Logik,
// getestet in tests/push-navigation.test.ts.
//
// Der Server (supabase/functions/_shared/apns.ts) schickt im Feld «kind» die
// Push-Art (APNs-Payload-Art) und in «notificationKind» die genaue
// Benachrichtigungsart (z. B. «inventory.count_due»). Jede Push-Art braucht
// hier ein Ziel; der Test prüft das für alle Arten in PUSH_PAYLOAD_KINDS.

import type { MobileFeatureKey } from "@/lib/mobile-features";

/** Alle Push-Arten, die push-dispatch verschickt (ApnsPayloadKind). */
export const PUSH_PAYLOAD_KINDS = [
  "assigned",
  "requester_reply",
  "support_reply",
  "requester_reminder",
  "mention",
  "resolved",
  "approval",
  "department_question_asked",
  "department_question_answered",
  "supervisor_request",
  "supervisor_answer",
  "escalation",
  "sla",
  "follow_up",
  "contract_deadline",
  "inventory_low_stock",
  "shop",
  "service_task",
  "infrastructure",
  "watched",
  "rule_reminder",
  "vendor_reminder",
  "children_done",
  "kudos",
  "security_report",
  "incident",
  "ipam",
  "summary",
  "test",
] as const;

export type PushPayloadKind = (typeof PUSH_PAYLOAD_KINDS)[number];

/** Push-Arten, die ein Ticket öffnen. */
const TICKET_KINDS: ReadonlySet<string> = new Set([
  "assigned",
  "requester_reply",
  "support_reply",
  "requester_reminder",
  "mention",
  "resolved",
  "approval",
  "department_question_asked",
  "department_question_answered",
  "supervisor_request",
  "supervisor_answer",
  "escalation",
  "sla",
  "follow_up",
  "watched",
  "rule_reminder",
  "vendor_reminder",
  "children_done",
  "kudos",
]);

export type PushNavigationData = {
  tenantId: string;
  kind?: string;
  /** Genaue Benachrichtigungsart, z. B. «ipam.agent_offline». */
  notificationKind?: string;
  notificationId?: string;
  ticketId?: string;
  orderId?: string;
  assetId?: string;
  incidentId?: string;
  ipamAddress?: string;
  ipamEvent?: string;
  occurrenceId?: string;
  contractId?: string;
  inventoryItemId?: string;
  inventoryLocationId?: string;
};

export type PushRoute =
  | { kind: "ticket"; ticketId: string }
  | { kind: "path"; path: string; feature?: MobileFeatureKey }
  /** Kein Bildschirm in der App: Hinweis statt leerer Seite. */
  | { kind: "message"; title: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP_ADDRESS = /^[0-9a-f.:]{2,45}$/i;

function uuid(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TEXT_FIELDS = [
  "kind",
  "notificationKind",
  "notificationId",
  "ticketId",
  "orderId",
  "assetId",
  "incidentId",
  "ipamAddress",
  "ipamEvent",
  "occurrenceId",
  "contractId",
  "inventoryItemId",
  "inventoryLocationId",
] as const;

/**
 * Liest die Felder der Mitteilung (APNs legt sie unter «body» ab, lokale
 * Mitteilungen direkt). Ohne Mandant keine Navigation.
 */
export function parsePushNavigationData(
  value: unknown,
): PushNavigationData | null {
  if (!isRecord(value)) return null;
  const body = isRecord(value.body) ? value.body : value;
  if (typeof body.tenantId !== "string" || !UUID.test(body.tenantId)) {
    return null;
  }
  const data: PushNavigationData = { tenantId: body.tenantId };
  for (const key of TEXT_FIELDS) {
    const field = body[key];
    if (typeof field === "string" && field.trim() && field.length <= 120) {
      data[key] = field.trim();
    }
  }
  return data;
}

function path(target: string, feature?: MobileFeatureKey): PushRoute {
  return feature
    ? { kind: "path", path: target, feature }
    : { kind: "path", path: target };
}

/** Ziel einer Mitteilung; null nur für die Testmitteilung. */
export function pushRoute(data: PushNavigationData): PushRoute | null {
  const kind = data.kind ?? "";
  const ticketId = uuid(data.ticketId);

  // Phishing-Meldungen und Sicherheitsfälle (Fall = Ticket) öffnen den Fall.
  if (kind === "security_report") {
    return ticketId ? path(`/phishing/${ticketId}`) : path("/phishing");
  }
  if (TICKET_KINDS.has(kind)) {
    return ticketId ? { kind: "ticket", ticketId } : path("/tickets");
  }
  if (kind === "incident") {
    const incidentId = uuid(data.incidentId);
    return incidentId ? path(`/incidents/${incidentId}`) : path("/incidents");
  }
  if (kind === "shop") {
    const orderId = uuid(data.orderId);
    return orderId
      ? path(`/shop/order/${orderId}`, "self_service.shop")
      : path("/shop", "self_service.shop");
  }
  if (kind === "infrastructure") {
    const assetId = uuid(data.assetId);
    return assetId
      ? path(`/infrastructure/${assetId}`, "assets.management")
      : path("/infrastructure", "assets.management");
  }
  if (kind === "inventory_low_stock") {
    const itemId = uuid(data.inventoryItemId);
    if (itemId)
      return path(`/inventory?item=${itemId}`, "inventory.management");
    const locationId = uuid(data.inventoryLocationId);
    if (locationId) {
      return path(`/inventory?location=${locationId}`, "inventory.management");
    }
    return path("/inventory", "inventory.management");
  }
  if (kind === "service_task") {
    const occurrenceId = uuid(data.occurrenceId);
    return occurrenceId
      ? path(`/service-task/${occurrenceId}`, "service.tasks")
      : {
          kind: "message",
          title: "Serviceaufgabe",
          message:
            "Diese Serviceaufgabe lässt sich nicht mehr öffnen. Deine Aufgaben findest du in der Web-App unter «Serviceaufgaben».",
        };
  }
  if (kind === "ipam") {
    const agentOffline =
      data.ipamEvent === "agent_offline" ||
      data.notificationKind === "ipam.agent_offline";
    if (!agentOffline) {
      // Gerät bekannt: Assetdetail (mit Netzwerkkarte), sonst die Adresse.
      const assetId = uuid(data.assetId);
      if (assetId) return path(`/assets/${assetId}`);
      if (data.ipamAddress && IP_ADDRESS.test(data.ipamAddress)) {
        return path(`/ipam/${encodeURIComponent(data.ipamAddress)}`);
      }
    }
    return {
      kind: "message",
      title: agentOffline ? "Netzwerkagent offline" : "IP-Adressverwaltung",
      message: agentOffline
        ? "Netzwerkagenten verwaltest du in der Web-App unter «IP-Adressen → Verwaltung → Discovery & Agenten»."
        : "Details zu diesem Fund findest du in der Web-App unter «IP-Adressen → Funde».",
    };
  }
  if (kind === "contract_deadline") {
    return {
      kind: "message",
      title: "Vertragsfrist",
      message:
        "Verträge gibt es nur in der Web-App. Öffne dort «Verträge», um die Frist zu sehen.",
    };
  }
  if (kind === "summary") {
    return ticketId ? { kind: "ticket", ticketId } : path("/tickets");
  }
  if (kind === "test") return null;
  // Unbekannte (neuere) Art mit Ticket: Ticket öffnen.
  return ticketId ? { kind: "ticket", ticketId } : null;
}
