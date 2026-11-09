import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; body: Record<string, unknown> }[] = [];
let response: unknown = null;
let fail = false;

vi.mock("../lib/nextdesk-client", () => ({
  invokeNextDesk: async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    if (fail) throw new Error("forbidden");
    return response;
  },
}));

const {
  loadPortalAssistantEnabled,
  recordAssistantOutcome,
  sendAssistantTurn,
} = await import("../lib/nextdesk-assistance");

beforeEach(() => {
  calls.length = 0;
  response = null;
  fail = false;
});

describe("mobile assistance calls", () => {
  it("asks the assistant informally («du»)", async () => {
    response = {
      data: {
        sessionId: "s-1",
        mode: "search",
        reply: "Keine Treffer.",
        question: null,
        questionsLeft: 2,
        articles: [],
        draft: { subject: "WLAN", description: "Geht nicht" },
      },
    };
    const turn = await sendAssistantTurn({
      tenantId: "t",
      sessionId: null,
      departmentId: null,
      messages: [{ role: "user", text: " WLAN geht nicht " }],
    });
    expect(turn.draft.subject).toBe("WLAN");
    expect(calls[0]?.body).toMatchObject({
      type: "turn",
      address: "informal",
      messages: [{ role: "user", text: "WLAN geht nicht" }],
    });
  });

  it("treats an unavailable assistant as switched off", async () => {
    fail = true;
    expect(await loadPortalAssistantEnabled("t")).toBe(false);
    await expect(
      recordAssistantOutcome({
        tenantId: "t",
        sessionId: "s",
        outcome: "abandoned",
      }),
    ).resolves.toBeUndefined();
  });
});
