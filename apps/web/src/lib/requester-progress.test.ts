import { describe, expect, it } from "vitest";

import { setFormality } from "./formality";
import {
  expectedResolutionText,
  formatProgressTime,
  parseRequesterProgress,
  progressStepLabel,
} from "./requester-progress";

const response = {
  data: {
    progress: {
      currentStep: "waiting_for_requester",
      steps: [
        { key: "received", state: "done", reachedAt: "2026-11-06T08:00:00Z" },
        {
          key: "in_progress",
          state: "done",
          reachedAt: "2026-11-06T09:00:00Z",
        },
        {
          key: "waiting_for_requester",
          state: "current",
          reachedAt: "2026-11-07T09:00:00Z",
        },
        { key: "resolved", state: "upcoming", reachedAt: null },
      ],
      expected: null,
      waitingForRequester: true,
    },
  },
};

describe("parseRequesterProgress", () => {
  it("reads a valid response", () => {
    const progress = parseRequesterProgress(response);
    expect(progress?.currentStep).toBe("waiting_for_requester");
    expect(progress?.steps).toHaveLength(4);
    expect(progress?.waitingForRequester).toBe(true);
  });

  it("rejects unknown steps and responses without a current step", () => {
    expect(
      parseRequesterProgress({
        data: {
          progress: {
            ...response.data.progress,
            steps: [{ key: "internal", state: "current", reachedAt: null }],
          },
        },
      }),
    ).toBeNull();
    expect(
      parseRequesterProgress({
        data: {
          progress: {
            ...response.data.progress,
            steps: [{ key: "received", state: "done", reachedAt: null }],
          },
        },
      }),
    ).toBeNull();
    expect(parseRequesterProgress(null)).toBeNull();
  });

  it("drops an invalid expected time", () => {
    const progress = parseRequesterProgress({
      data: {
        progress: {
          ...response.data.progress,
          expected: { at: "morgen", basis: "sla" },
        },
      },
    });
    expect(progress?.expected).toBeNull();
  });
});

describe("wording", () => {
  it("uses the informal address by default", () => {
    expect(progressStepLabel("waiting_for_requester")).toBe("Wartet auf dich");
  });

  it("uses the formal address when switched", () => {
    setFormality("sie");
    try {
      expect(progressStepLabel("waiting_for_requester")).toBe("Wartet auf Sie");
    } finally {
      setFormality("du");
    }
  });

  it("formats relative days", () => {
    const now = new Date(2026, 10, 7, 10, 0);
    expect(
      formatProgressTime(new Date(2026, 10, 7, 14, 0).toISOString(), now),
    ).toBe("heute, 14:00");
    expect(
      formatProgressTime(new Date(2026, 10, 8, 9, 5).toISOString(), now),
    ).toBe("morgen, 09:05");
    expect(
      formatProgressTime(new Date(2026, 10, 12, 9, 5).toISOString(), now),
    ).toMatch(/12\. Nov.*09:05/);
  });

  it("explains the source of the expected time", () => {
    const now = new Date(2026, 10, 7, 10, 0);
    const at = new Date(2026, 10, 8, 16, 0).toISOString();
    expect(expectedResolutionText({ at, basis: "sla" }, now)).toBe(
      "Voraussichtlich gelöst bis morgen, 16:00",
    );
    expect(expectedResolutionText({ at, basis: "history" }, now)).toContain(
      "Erfahrungswert",
    );
    expect(expectedResolutionText(null, now)).toBeNull();
  });
});
