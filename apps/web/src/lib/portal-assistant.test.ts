import { describe, expect, it } from "vitest";
import mobileCopy from "../../../../mobile/lib/portal-assistant.ts?raw";
import webCopy from "./portal-assistant.ts?raw";
import {
  deflectionRate,
  messagesForTurn,
  parseAssistantSettings,
  parseAssistantTurn,
  type AssistantMessage,
} from "./portal-assistant";

describe("portal assistant", () => {
  it("keeps the web and the mobile copy identical", () => {
    expect(webCopy).toBe(mobileCopy);
  });

  it("parses a turn and drops invalid articles", () => {
    const turn = parseAssistantTurn({
      data: {
        sessionId: "s-1",
        mode: "ai",
        reply: "Probieren Sie das.",
        question: "  ",
        questionsLeft: 1,
        articles: [
          { id: "a", title: "VPN einrichten", excerpt: "Schritt 1" },
          { id: "b" },
        ],
        draft: {
          subject: "VPN",
          description: "Geht nicht",
          categoryId: "",
          categoryName: null,
        },
      },
    });
    expect(turn?.question).toBeNull();
    expect(turn?.articles).toEqual([
      { id: "a", title: "VPN einrichten", excerpt: "Schritt 1" },
    ]);
    expect(turn?.draft.categoryId).toBeNull();
    expect(
      parseAssistantTurn({ data: { sessionId: "x", mode: "other" } }),
    ).toBeNull();
  });

  it("keeps the first message and starts with the person when trimming", () => {
    const history: AssistantMessage[] = [{ role: "user", text: "Start" }];
    for (let index = 0; index < 5; index++) {
      history.push({ role: "assistant", text: `Frage ${index}` });
      history.push({ role: "user", text: `Antwort ${index}` });
    }
    const trimmed = messagesForTurn(history);
    expect(trimmed.length).toBeLessThanOrEqual(8);
    expect(trimmed[0]).toEqual({ role: "user", text: "Start" });
    expect(trimmed.at(-1)).toEqual({ role: "user", text: "Antwort 4" });
    expect(messagesForTurn([{ role: "user", text: "  " }])).toEqual([]);
  });

  it("reads settings defensively and computes the deflection rate", () => {
    expect(parseAssistantSettings(null)).toEqual({
      enabled: false,
      canManage: false,
      summary: null,
    });
    const settings = parseAssistantSettings({
      data: {
        enabled: true,
        canManage: true,
        summary: { days: 30, total: 10, solvedByArticle: 3, ticketCreated: 1 },
      },
    });
    expect(settings.enabled).toBe(true);
    expect(deflectionRate(settings.summary)).toBe(75);
    expect(deflectionRate(null)).toBe(0);
  });
});
