import { describe, expect, it } from "vitest";
import {
  lifecycleTone,
  priorityTone,
  slaTone,
  statusTone,
} from "../lib/status-tones";

describe("status tones", () => {
  it("maps priorities", () => {
    expect(priorityTone("Kritisch")).toBe("danger");
    expect(priorityTone("Hoch")).toBe("warning");
    expect(priorityTone("Mittel")).toBe("info");
    expect(priorityTone("Niedrig")).toBe("neutral");
  });
  it("maps SLA due dates", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(slaTone("2026-11-07T11:00:00Z", now)).toBe("danger");
    expect(slaTone("2026-11-07T14:00:00Z", now)).toBe("warning");
    expect(slaTone("2026-11-08T12:00:00Z", now)).toBe("success");
    expect(slaTone(null, now)).toBe("neutral");
  });
  it("maps statuses and lifecycle", () => {
    expect(statusTone("waiting_customer")).toBe("warning");
    expect(statusTone("resolved")).toBe("success");
    expect(statusTone("new")).toBe("accent");
    expect(lifecycleTone("repair")).toBe("warning");
  });
});
