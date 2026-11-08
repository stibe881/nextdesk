import { describe, expect, it } from "vitest";

import {
  EMPTY_SOFTWARE_DRAFT,
  SOFTWARE_STATUS_LABEL,
  filterIntuneApps,
  softwareDraftFromLink,
  softwarePayload,
  softwareTone,
} from "./shop-software";

const APP = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";

describe("shop software", () => {
  it("clears the link when software is off", () => {
    expect(softwarePayload(EMPTY_SOFTWARE_DRAFT, "order")).toEqual({
      value: null,
    });
  });

  it("validates app and group ids", () => {
    const draft = { ...EMPTY_SOFTWARE_DRAFT, enabled: true, appId: "x" };
    expect(softwarePayload(draft, "order")).toHaveProperty("error");
    expect(
      softwarePayload({ ...draft, appId: APP, groupId: "nope" }, "order"),
    ).toHaveProperty("error");
    expect(
      softwarePayload({ ...draft, appId: APP, groupId: GROUP }, "loan"),
    ).toHaveProperty("error");
  });

  it("builds the payload and round-trips the link", () => {
    const result = softwarePayload(
      {
        enabled: true,
        appId: ` ${APP.toUpperCase()} `,
        appName: " Visio ",
        groupId: GROUP,
        mode: "device_group",
        ensureAppAssignment: true,
      },
      "order",
    );
    expect(result).toEqual({
      value: {
        appId: APP,
        appName: "Visio",
        groupId: GROUP,
        mode: "device_group",
        ensureAppAssignment: true,
      },
    });
    if ("value" in result) {
      expect(softwareDraftFromLink(result.value).enabled).toBe(true);
    }
    expect(softwareDraftFromLink(null).enabled).toBe(false);
  });

  it("maps the statuses to labels and tones", () => {
    expect(SOFTWARE_STATUS_LABEL.installing).toBe("Wird installiert");
    expect(SOFTWARE_STATUS_LABEL.assigned).toBe("Zugewiesen");
    expect(SOFTWARE_STATUS_LABEL.failed).toBe("Fehler");
    expect(softwareTone("pending")).toBe("info");
    expect(softwareTone("assigned")).toBe("success");
    expect(softwareTone("failed")).toBe("danger");
  });

  it("filters apps by name or publisher", () => {
    const apps = [
      { displayName: "Visio", publisher: "Microsoft" },
      { displayName: "Acrobat Reader", publisher: "Adobe" },
    ];
    expect(filterIntuneApps(apps, "adobe")).toHaveLength(1);
    expect(filterIntuneApps(apps, "")).toHaveLength(2);
    expect(filterIntuneApps(apps, "", 1)).toHaveLength(1);
  });
});
