import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({ setBadgeCountAsync: vi.fn() }));
vi.mock("@/lib/nextdesk-client", () => ({
  invokeNextDesk: vi.fn(),
  nextDesk: null,
}));

import { parseUnreadCount } from "@/lib/app-badge";

describe("parseUnreadCount", () => {
  it("liest die Zahl aus der Antwort der Funktion", () => {
    expect(parseUnreadCount({ data: { count: 4 } })).toBe(4);
    expect(parseUnreadCount({ count: 0 })).toBe(0);
  });

  it("begrenzt und verwirft ungültige Werte", () => {
    expect(parseUnreadCount({ data: { count: 123456 } })).toBe(9999);
    expect(parseUnreadCount({ data: { count: -1 } })).toBeNull();
    expect(parseUnreadCount({ data: { count: 1.5 } })).toBeNull();
    expect(parseUnreadCount({ data: { count: "3" } })).toBeNull();
    expect(parseUnreadCount(null)).toBeNull();
  });
});
