import { describe, expect, it } from "vitest";
import { ticketCreateSchema, tenantDomainSchema } from "../src";

const ticket = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  departmentId: "22222222-2222-4222-8222-222222222222",
  subject: "Drucker im Sitzungszimmer",
  description: "Der Drucker zeigt einen Papierstau an.",
};

describe("shared input validation", () => {
  it("applies safe default urgency and impact", () => {
    const result = ticketCreateSchema.parse(ticket);
    expect(result.urgency).toBe("normal");
    expect(result.impact).toBe("normal");
  });

  it("rejects unexpected client-controlled ticket fields", () => {
    expect(() =>
      ticketCreateSchema.parse({ ...ticket, assignedAgentId: "not-allowed" }),
    ).toThrow();
  });

  it("normalizes hostnames before domain verification", () => {
    expect(
      tenantDomainSchema.parse({ hostname: "Support.Beispiel.CH" }).hostname,
    ).toBe("support.beispiel.ch");
  });
});
