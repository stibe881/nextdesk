import { describe, expect, it } from "vitest";
import {
  parseIncidentPushSettings,
  toggleIncidentService,
} from "./incident-push";

const services = [
  { id: "a", name: "E-Mail" },
  { id: "b", name: "Telefonie" },
];

describe("incident push settings", () => {
  it("parses the response and rejects invalid data", () => {
    expect(
      parseIncidentPushSettings({ enabled: true, serviceIds: null, services }),
    ).toEqual({ enabled: true, serviceIds: null, services });
    expect(parseIncidentPushSettings({ enabled: "x", services })).toBeNull();
    expect(parseIncidentPushSettings(null)).toBeNull();
  });

  it("toggles a service and falls back to all when everything is chosen", () => {
    const all = { enabled: true, serviceIds: null, services };
    expect(toggleIncidentService(all, "a")).toEqual(["b"]);
    expect(
      toggleIncidentService({ ...all, serviceIds: ["b"] }, "a"),
    ).toBeNull();
    expect(toggleIncidentService({ ...all, serviceIds: ["b"] }, "b")).toEqual(
      [],
    );
  });
});
