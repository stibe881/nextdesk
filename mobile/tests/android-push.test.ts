import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-notifications", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/lib/nextdesk-client", () => ({ invokeNextDesk: vi.fn() }));

import { isExpoPushToken } from "@/lib/android-push";

describe("isExpoPushToken", () => {
  it("akzeptiert Expo-Tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]")).toBe(
      true,
    );
    expect(isExpoPushToken("ExpoPushToken[abc_def-12345]")).toBe(true);
  });

  it("verwirft alles andere", () => {
    expect(isExpoPushToken("abcdef")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[short]")).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
  });
});
