import { describe, expect, it } from "vitest";

import { pushRoute } from "../lib/push-navigation";

const tenantId = "10000000-0000-4000-8000-000000000001";

describe("pushRoute", () => {
  it("öffnet Tickets, Fälle und Störungen wie bisher", () => {
    expect(pushRoute({ tenantId, ticketId: "t1", kind: "assigned" })).toEqual({
      kind: "ticket",
      ticketId: "t1",
    });
    expect(
      pushRoute({ tenantId, ticketId: "t1", kind: "security_report" }),
    ).toEqual({ kind: "path", path: "/phishing/t1" });
    expect(pushRoute({ tenantId, incidentId: "i1", kind: "incident" })).toEqual(
      { kind: "path", path: "/incidents/i1" },
    );
  });

  it("öffnet IP-Adressen über das Gerät oder die Adresse", () => {
    expect(pushRoute({ tenantId, kind: "ipam", assetId: "a1" })).toEqual({
      kind: "path",
      path: "/assets/a1",
    });
    expect(
      pushRoute({ tenantId, kind: "ipam", ipamAddress: "fd00::1" }),
    ).toEqual({ kind: "path", path: "/ipam/fd00%3A%3A1" });
    expect(
      pushRoute({ tenantId, kind: "ipam", ipamAddress: "../../x" }),
    ).toEqual({ kind: "path", path: "/notifications" });
  });

  it("ignoriert unbekannte Mitteilungen", () => {
    expect(pushRoute({ tenantId, kind: "inventory_low_stock" })).toBeNull();
  });
});
