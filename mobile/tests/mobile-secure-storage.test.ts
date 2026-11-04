import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (value.length > 2048) throw new Error("too large");
    store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    store.delete(key);
  },
}));

const { mobileSecureStorage } = await import("../lib/mobile-secure-storage");

describe("mobileSecureStorage (native)", () => {
  beforeEach(() => store.clear());

  it("splits large values into chunks and reads them back", async () => {
    const session = "x".repeat(7_000);
    await mobileSecureStorage.setItem("sb-session", session);
    expect([...store.values()].every((value) => value.length <= 2048)).toBe(
      true,
    );
    expect(await mobileSecureStorage.getItem("sb-session")).toBe(session);
  });

  it("removes stale chunks when a value shrinks or is deleted", async () => {
    await mobileSecureStorage.setItem("sb-session", "y".repeat(5_000));
    await mobileSecureStorage.setItem("sb-session", "small");
    expect(await mobileSecureStorage.getItem("sb-session")).toBe("small");
    expect(store.size).toBe(1);
    await mobileSecureStorage.setItem("sb-session", "z".repeat(5_000));
    await mobileSecureStorage.removeItem("sb-session");
    expect(store.size).toBe(0);
  });

  it("keeps reading values stored before chunking existed", async () => {
    store.set("sb-session", "legacy");
    expect(await mobileSecureStorage.getItem("sb-session")).toBe("legacy");
  });
});
