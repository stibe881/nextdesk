// Ziel einer angetippten Push-Mitteilung (push-dispatch → App). Reine Logik,
// getestet in tests/push-navigation.test.ts.

export type PushNavigationData = {
  tenantId: string;
  ticketId?: string;
  orderId?: string;
  assetId?: string;
  incidentId?: string;
  ipamAddress?: string;
  notificationId?: string;
  kind?: string;
};

export type PushRoute =
  | { kind: "ticket"; ticketId: string }
  | { kind: "path"; path: string };

const IP_ADDRESS = /^[0-9a-f.:]{2,45}$/i;

export function pushRoute(data: PushNavigationData): PushRoute | null {
  // Phishing-Meldungen und Sicherheitsfälle öffnen den Fall.
  if (data.kind === "security_report" && data.ticketId) {
    return { kind: "path", path: `/phishing/${data.ticketId}` };
  }
  if (data.ticketId) return { kind: "ticket", ticketId: data.ticketId };
  if (data.kind === "shop" && data.orderId) {
    return { kind: "path", path: `/shop/order/${data.orderId}` };
  }
  if (data.kind === "infrastructure" && data.assetId) {
    return { kind: "path", path: `/infrastructure/${data.assetId}` };
  }
  if (data.kind === "incident" && data.incidentId) {
    return { kind: "path", path: `/incidents/${data.incidentId}` };
  }
  if (data.kind === "ipam") {
    // Gerät bekannt: Assetdetail (mit Netzwerkkarte), sonst die Adresse.
    if (data.assetId) return { kind: "path", path: `/assets/${data.assetId}` };
    if (data.ipamAddress && IP_ADDRESS.test(data.ipamAddress)) {
      return {
        kind: "path",
        path: `/ipam/${encodeURIComponent(data.ipamAddress)}`,
      };
    }
    return { kind: "path", path: "/notifications" };
  }
  if (data.kind === "summary") return { kind: "path", path: "/tickets" };
  return null;
}
