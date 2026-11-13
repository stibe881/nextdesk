import { describe, expect, it } from "vitest";

import {
  badgeAccessibilityLabel,
  badgeCount,
  badgeLabel,
  parseShopAttention,
  parseTicketAttention,
} from "../lib/navigation-badges-model";

describe("navigation badges", () => {
  it("counts only positive safe integers", () => {
    expect(badgeCount(16)).toBe(16);
    expect(badgeCount(0)).toBe(0);
    expect(badgeCount(-3)).toBe(0);
    expect(badgeCount(1.5)).toBe(0);
    expect(badgeCount("4")).toBe(0);
    expect(badgeCount(Number.MAX_SAFE_INTEGER + 1)).toBe(0);
    expect(badgeCount(null)).toBe(0);
  });

  it("shows 99+ for big numbers", () => {
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });

  it("reads the ticket attention summary", () => {
    expect(
      parseTicketAttention({
        unassignedTickets: 16,
        securityTriage: 1,
        incidentsUnacknowledged: 2,
        canWorkSecurityCases: true,
      }),
    ).toMatchObject({
      tickets: 16,
      phishing: 1,
      incidents: 2,
      urgent: { incidents: true, phishing: true },
    });
    expect(
      parseTicketAttention({
        unassignedTickets: 0,
        securityTriage: 0,
        securityOpen: 3,
        incidentsUnacknowledged: 1,
        incidentsActive: 4,
      }),
    ).toMatchObject({
      phishing: 3,
      incidents: 4,
      urgent: { incidents: true, phishing: false },
    });
    expect(parseTicketAttention(null)).toMatchObject({
      tickets: 0,
      phishing: 0,
      incidents: 0,
    });
  });

  it("counts new shop orders only for fulfilment staff", () => {
    expect(
      parseShopAttention({ data: { canFulfill: true, newOrders: 3 } }),
    ).toBe(3);
    expect(
      parseShopAttention({ data: { canFulfill: false, newOrders: 3 } }),
    ).toBe(0);
    expect(parseShopAttention(undefined)).toBe(0);
  });

  it("speaks the count in the accessibility label", () => {
    expect(badgeAccessibilityLabel("Tickets", 16)).toBe("Tickets, 16 offen");
    expect(badgeAccessibilityLabel("Tickets", 0)).toBe("Tickets");
  });
});
