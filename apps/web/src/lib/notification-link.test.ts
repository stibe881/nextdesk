import { describe, expect, it } from "vitest";

import {
  forgetNotificationLink,
  NOTIFICATION_LINK_MAX_AGE_MS,
  NOTIFICATION_LINK_STORAGE_KEY,
  notificationIdFromSearch,
  notificationLinkMessage,
  notificationLinkStep,
  pendingNotificationLink,
  rememberNotificationLink,
  urlWithoutNotificationLink,
} from "./notification-link";

const id = "7f3e2a10-1234-4abc-8def-00000000ab12";
const tenantA = "10000000-0000-4000-8000-000000000001";
const tenantB = "10000000-0000-4000-8000-000000000002";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("notificationIdFromSearch", () => {
  it("reads the opaque id", () => {
    expect(notificationIdFromSearch(`?benachrichtigung=${id}`)).toBe(id);
    expect(
      notificationIdFromSearch(`?a=1&benachrichtigung=${id.toUpperCase()}`),
    ).toBe(id);
  });

  it("ignores anything that is not a uuid", () => {
    expect(notificationIdFromSearch("")).toBeNull();
    expect(notificationIdFromSearch("?benachrichtigung=")).toBeNull();
    expect(notificationIdFromSearch("?benachrichtigung=../tickets")).toBeNull();
    expect(notificationIdFromSearch(`?notification=${id}`)).toBeNull();
  });
});

describe("urlWithoutNotificationLink", () => {
  it("removes only the parameter", () => {
    expect(
      urlWithoutNotificationLink(
        `https://app.nextdesk.ch/?benachrichtigung=${id}&wissen=x#top`,
      ),
    ).toBe("https://app.nextdesk.ch/?wissen=x#top");
    expect(
      urlWithoutNotificationLink(
        `https://app.nextdesk.ch/?benachrichtigung=${id}`,
      ),
    ).toBe("https://app.nextdesk.ch/");
  });

  it("leaves other addresses alone", () => {
    expect(urlWithoutNotificationLink("https://app.nextdesk.ch/")).toBeNull();
    expect(urlWithoutNotificationLink("not a url")).toBeNull();
  });
});

describe("pending link across the sign-in", () => {
  it("keeps the id for an hour", () => {
    const storage = memoryStorage();
    rememberNotificationLink(storage, id, 1_000);
    expect(pendingNotificationLink(storage, 1_000 + 5 * 60_000)).toBe(id);
    expect(
      pendingNotificationLink(storage, 1_000 + NOTIFICATION_LINK_MAX_AGE_MS),
    ).toBe(id);
  });

  it("drops stale and invalid entries", () => {
    const storage = memoryStorage();
    rememberNotificationLink(storage, id, 1_000);
    expect(
      pendingNotificationLink(storage, 1_001 + NOTIFICATION_LINK_MAX_AGE_MS),
    ).toBeNull();
    expect(storage.values.has(NOTIFICATION_LINK_STORAGE_KEY)).toBe(false);

    storage.setItem(NOTIFICATION_LINK_STORAGE_KEY, "{broken");
    expect(pendingNotificationLink(storage, 1_000)).toBeNull();
    storage.setItem(
      NOTIFICATION_LINK_STORAGE_KEY,
      JSON.stringify({ id: "x", at: 1_000 }),
    );
    expect(pendingNotificationLink(storage, 1_000)).toBeNull();
  });

  it("forgets the id once used", () => {
    const storage = memoryStorage();
    rememberNotificationLink(storage, id, 1_000);
    forgetNotificationLink(storage);
    expect(pendingNotificationLink(storage, 1_000)).toBeNull();
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberNotificationLink(broken, id, 1)).not.toThrow();
    expect(pendingNotificationLink(broken, 1)).toBeNull();
    expect(() => forgetNotificationLink(broken)).not.toThrow();
  });
});

describe("notificationLinkStep", () => {
  it("opens in the active tenant", () => {
    expect(
      notificationLinkStep({
        notificationTenantId: tenantA,
        activeTenantId: tenantA,
        tenantIds: [tenantA, tenantB],
      }),
    ).toBe("open");
  });

  it("switches to the notification's tenant first", () => {
    expect(
      notificationLinkStep({
        notificationTenantId: tenantB,
        activeTenantId: tenantA,
        tenantIds: [tenantA, tenantB],
      }),
    ).toBe("switch");
  });

  it("does not open other tenants", () => {
    expect(
      notificationLinkStep({
        notificationTenantId: tenantB,
        activeTenantId: tenantA,
        tenantIds: [tenantA],
      }),
    ).toBe("unavailable");
  });
});

describe("notificationLinkMessage", () => {
  it("explains why nothing opens", () => {
    expect(notificationLinkMessage("notification_not_found")).toContain(
      "anderen Konto",
    );
    expect(notificationLinkMessage("tenant_membership_required")).toContain(
      "keinen Zugriff",
    );
    expect(
      notificationLinkMessage("notification_target_unavailable"),
    ).toContain("gelöscht");
    expect(notificationLinkMessage(null)).toContain("Glocke");
  });
});
