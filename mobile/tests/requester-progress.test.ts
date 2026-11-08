import { describe, expect, it } from "vitest";

import {
  REMINDER_ACTION_NEED_HELP,
  REMINDER_ACTION_RESOLVED,
  expectedResolutionText,
  formatProgressTime,
  parseRequesterProgress,
  progressStepLabel,
  reminderAnswerFromNotificationAction,
  reminderAnswerFromParam,
} from "../lib/requester-progress";

const data = {
  progress: {
    currentStep: "in_progress",
    steps: [
      { key: "received", state: "done", reachedAt: "2026-11-06T08:00:00Z" },
      { key: "in_progress", state: "current", reachedAt: null },
      { key: "resolved", state: "upcoming", reachedAt: null },
    ],
    expected: { at: "2026-11-09T16:00:00Z", basis: "history" },
    waitingForRequester: false,
  },
};

describe("requester progress", () => {
  it("parses the server response", () => {
    const progress = parseRequesterProgress(data);
    expect(progress?.currentStep).toBe("in_progress");
    expect(progress?.expected?.basis).toBe("history");
  });

  it("rejects unknown steps", () => {
    expect(
      parseRequesterProgress({
        progress: { ...data.progress, currentStep: "triage" },
      }),
    ).toBeNull();
  });

  it("uses du", () => {
    expect(progressStepLabel("waiting_for_requester")).toBe("Wartet auf dich");
  });

  it("formats expected times", () => {
    const now = new Date(2026, 10, 7, 10, 0);
    expect(
      formatProgressTime(new Date(2026, 10, 7, 15, 30).toISOString(), now),
    ).toBe("heute, 15:30");
    expect(
      expectedResolutionText(
        { at: new Date(2026, 10, 8, 9, 0).toISOString(), basis: "sla" },
        now,
      ),
    ).toBe("Voraussichtlich gelöst bis morgen, 09:00");
  });
});

describe("reminder actions", () => {
  it("maps notification actions", () => {
    expect(reminderAnswerFromNotificationAction(REMINDER_ACTION_RESOLVED)).toBe(
      "resolved",
    );
    expect(
      reminderAnswerFromNotificationAction(REMINDER_ACTION_NEED_HELP),
    ).toBe("need_help");
    expect(
      reminderAnswerFromNotificationAction(
        "expo.modules.notifications.actions.DEFAULT",
      ),
    ).toBeNull();
  });

  it("reads the route parameter", () => {
    expect(reminderAnswerFromParam("resolved")).toBe("resolved");
    expect(reminderAnswerFromParam(["need_help"])).toBe("need_help");
    expect(reminderAnswerFromParam("delete")).toBeNull();
  });
});
