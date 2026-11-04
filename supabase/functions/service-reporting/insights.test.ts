import { assertEquals } from "jsr:@std/assert@1";
import {
  buildInsights,
  mood,
  rangeDays,
  type InsightTicket,
} from "./insights.ts";

const current = {
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-03T21:59:59.999Z",
};
const previous = {
  startsAt: "2026-09-28T00:00:00.000Z",
  endsAt: "2026-09-30T23:59:59.999Z",
};

function ticket(overrides: Partial<InsightTicket>): InsightTicket {
  return {
    id: crypto.randomUUID(),
    assignedTeamId: null,
    assignedAgentId: "agent-a",
    requesterId: "requester",
    source: "email",
    createdAt: "2026-10-01T08:00:00.000Z",
    firstRespondedAt: null,
    resolvedAt: null,
    responseDueAt: null,
    resolutionDueAt: null,
    ...overrides,
  };
}

Deno.test("mood maps 1-5 scores to happy, neutral and unhappy", () => {
  assertEquals([1, 2, 3, 4, 5].map(mood), [
    "unhappy",
    "unhappy",
    "neutral",
    "happy",
    "happy",
  ]);
});

Deno.test("rangeDays lists Swiss calendar days", () => {
  assertEquals(
    rangeDays(current).map((day) => day.date),
    ["2026-10-01", "2026-10-02", "2026-10-03"],
  );
});

Deno.test(
  "buildInsights aggregates trends, overview, satisfaction and agents",
  () => {
    const resolvedInTime = ticket({
      firstRespondedAt: "2026-10-01T09:00:00.000Z",
      responseDueAt: "2026-10-01T10:00:00.000Z",
      resolvedAt: "2026-10-02T08:00:00.000Z",
      resolutionDueAt: "2026-10-03T08:00:00.000Z",
    });
    const late = ticket({
      assignedAgentId: "agent-b",
      source: "portal",
      createdAt: "2026-10-02T12:00:00.000Z",
      firstRespondedAt: "2026-10-02T20:00:00.000Z",
      responseDueAt: "2026-10-02T13:00:00.000Z",
    });
    const backlog = ticket({
      assignedAgentId: null,
      createdAt: "2026-09-29T08:00:00.000Z",
    });
    const result = buildInsights({
      current,
      previous,
      tickets: [resolvedInTime, late, backlog],
      comments: [
        {
          ticketId: resolvedInTime.id,
          authorId: "agent-a",
          external: true,
          createdAt: "2026-10-01T09:00:00.000Z",
        },
        {
          ticketId: resolvedInTime.id,
          authorId: "requester",
          external: true,
          createdAt: "2026-10-01T10:00:00.000Z",
        },
        {
          ticketId: resolvedInTime.id,
          authorId: "agent-a",
          external: true,
          createdAt: "2026-10-01T10:30:00.000Z",
        },
      ],
      ratings: [
        {
          ticketId: resolvedInTime.id,
          score: 5,
          submittedAt: "2026-10-02T09:00:00.000Z",
        },
      ],
      teamNames: new Map(),
      agentNames: new Map([
        ["agent-a", "Agent A"],
        ["agent-b", "Agent B"],
      ]),
    });

    assertEquals(
      result.trends.daily.map((day) => [
        day.received,
        day.resolved,
        day.unresolved,
      ]),
      [
        [1, 0, 2],
        [1, 1, 2],
        [0, 0, 2],
      ],
    );
    assertEquals(result.trends.byHour[10].email, 1);
    assertEquals(result.trends.byHour[14].portal, 1);

    const overview = result.overview.current;
    assertEquals(overview.received, 2);
    assertEquals(overview.resolved, 1);
    assertEquals(overview.unresolved, 2);
    // Two public agent replies: not resolved on first contact.
    assertEquals(overview.firstContactResolutionRate, 0);
    assertEquals(overview.resolutionSlaCompliance, 100);
    assertEquals(overview.firstResponseSlaCompliance, 50);
    assertEquals(overview.averageReactionMinutes, 30);
    assertEquals(result.overview.previous.received, 1);

    assertEquals(result.satisfaction.responses, 1);
    assertEquals(result.satisfaction.happyPercent, 100);

    assertEquals(
      result.agents.rows.map((row) => row.name),
      [null, "Agent A", "Agent B"].filter((name) => name !== null),
    );
    const agentA = result.agents.rows.find((row) => row.id === "agent-a")!;
    assertEquals(agentA.averageResolutionMinutes, 24 * 60);
    assertEquals(agentA.happyPercent, 100);
    assertEquals(result.agents.total.firstResponseSlaCompliance, 50);
  },
);
