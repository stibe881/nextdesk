import { assertEquals } from "jsr:@std/assert@1";
import {
  buildSupportLevelReport,
  currentHandover,
  handoverDirection,
  handoverTargets,
  type LevelChange,
  levelDurations,
  type LevelTeam,
  maxLevelReached,
  normalizeHandoverNote,
} from "./levels.ts";
import { parseAction } from "./index.ts";

const T = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const TEAM = "33333333-3333-4333-8333-333333333333";

Deno.test("handover direction allows one level up or any level down", () => {
  assertEquals(handoverDirection(1, 2), "escalated");
  assertEquals(handoverDirection(2, 3), "escalated");
  assertEquals(handoverDirection(1, 3), null);
  assertEquals(handoverDirection(3, 1), "returned");
  assertEquals(handoverDirection(2, 1), "returned");
  assertEquals(handoverDirection(2, 2), null);
  assertEquals(handoverDirection(null, 2), null);
});

Deno.test("handover note is mandatory and bounded", () => {
  assertEquals(normalizeHandoverNote("  kurz "), null);
  assertEquals(normalizeHandoverNote(42), null);
  assertEquals(
    normalizeHandoverNote("  Neustart geprüft\r\nProblem bleibt  "),
    "Neustart geprüft\nProblem bleibt",
  );
  assertEquals(normalizeHandoverNote("x".repeat(4001)), null);
});

Deno.test(
  "targets are teams of the next and lower levels in the department",
  () => {
    const teams: LevelTeam[] = [
      {
        id: "a",
        name: "Service Desk",
        departmentId: "d1",
        supportLevel: 1,
        active: true,
      },
      {
        id: "b",
        name: "Systemtechnik",
        departmentId: "d1",
        supportLevel: 2,
        active: true,
      },
      {
        id: "c",
        name: "Netzwerk",
        departmentId: "d1",
        supportLevel: 2,
        active: true,
      },
      {
        id: "d",
        name: "Archiv",
        departmentId: "d1",
        supportLevel: 3,
        active: false,
      },
      {
        id: "e",
        name: "Fremd",
        departmentId: "d2",
        supportLevel: 3,
        active: true,
      },
      {
        id: "f",
        name: "Projekt",
        departmentId: "d1",
        supportLevel: null,
        active: true,
      },
    ];
    const fromOne = handoverTargets(1, "d1", teams);
    assertEquals(fromOne.next, {
      level: 2,
      teams: [
        { id: "c", name: "Netzwerk" },
        { id: "b", name: "Systemtechnik" },
      ],
    });
    assertEquals(fromOne.back, []);
    const fromTwo = handoverTargets(2, "d1", teams);
    assertEquals(fromTwo.next, null);
    assertEquals(fromTwo.back, [
      { level: 1, teams: [{ id: "a", name: "Service Desk" }] },
    ]);
    assertEquals(handoverTargets(null, "d1", teams), { next: null, back: [] });
  },
);

const change = (
  fromLevel: LevelChange["fromLevel"],
  toLevel: LevelChange["toLevel"],
  kind: LevelChange["kind"],
  createdAt: string,
  note: string | null = null,
): LevelChange => ({
  ticketId: "t1",
  fromLevel,
  toLevel,
  kind,
  createdAt,
  note,
});

Deno.test("durations per level follow the history", () => {
  const changes = [
    change(null, 1, "initial", "2026-11-01T08:00:00Z"),
    change(1, 2, "escalated", "2026-11-01T09:00:00Z", "Logs geprüft"),
    change(2, 1, "returned", "2026-11-01T12:00:00Z", "Konto entsperrt"),
  ];
  const durations = levelDurations(changes, "2026-11-01T12:30:00Z");
  assertEquals(durations.get(1), 90 * 60_000);
  assertEquals(durations.get(2), 3 * 60 * 60_000);
  assertEquals(maxLevelReached(changes, 1), 2);
  assertEquals(maxLevelReached([], null), 1);
  assertEquals(currentHandover(changes, 1)?.note, "Konto entsperrt");
  assertEquals(currentHandover(changes, 2), null);
});

Deno.test(
  "report computes first-level rate, category escalations and time per level",
  () => {
    const range = {
      startsAt: "2026-11-01T00:00:00Z",
      endsAt: "2026-11-07T23:59:59Z",
    };
    const report = buildSupportLevelReport({
      range,
      resolvedTickets: [
        {
          id: "t1",
          departmentId: "d1",
          categoryId: "c1",
          currentLevel: 1,
          resolvedAt: "2026-11-02T10:00:00Z",
        },
        {
          id: "t2",
          departmentId: "d1",
          categoryId: "c1",
          currentLevel: 2,
          resolvedAt: "2026-11-03T10:00:00Z",
        },
        {
          id: "t3",
          departmentId: "d1",
          categoryId: null,
          currentLevel: null,
          resolvedAt: "2026-11-03T10:00:00Z",
        },
        {
          id: "t4",
          departmentId: "d9",
          categoryId: null,
          currentLevel: null,
          resolvedAt: "2026-11-03T10:00:00Z",
        },
        {
          id: "t5",
          departmentId: "d1",
          categoryId: null,
          currentLevel: 1,
          resolvedAt: "2026-10-03T10:00:00Z",
        },
      ],
      changesByTicket: new Map([
        [
          "t1",
          [
            {
              ...change(null, 1, "initial", "2026-11-02T08:00:00Z"),
              ticketId: "t1",
            },
          ],
        ],
        [
          "t2",
          [
            {
              ...change(null, 1, "initial", "2026-11-03T08:00:00Z"),
              ticketId: "t2",
            },
            {
              ...change(1, 2, "escalated", "2026-11-03T09:00:00Z"),
              ticketId: "t2",
            },
          ],
        ],
      ]),
      periodChanges: [
        {
          ...change(1, 2, "escalated", "2026-11-03T09:00:00Z"),
          ticketId: "t2",
          categoryId: "c1",
        },
        {
          ...change(1, 2, "escalated", "2026-11-04T09:00:00Z"),
          ticketId: "t6",
          categoryId: null,
        },
        {
          ...change(2, 1, "returned", "2026-11-04T10:00:00Z"),
          ticketId: "t6",
          categoryId: null,
        },
        {
          ...change(1, 2, "escalated", "2026-10-04T09:00:00Z"),
          ticketId: "t7",
          categoryId: "c1",
        },
      ],
      leveledDepartmentIds: new Set(["d1"]),
      categoryNames: new Map([["c1", "Netzwerk"]]),
    });
    assertEquals(report.firstLevelResolution, {
      resolvedTickets: 3,
      resolvedAtFirstLevel: 2,
      rate: 0.667,
    });
    assertEquals(report.escalations, 2);
    assertEquals(report.returns, 1);
    assertEquals(report.escalationsByCategory, [
      {
        categoryId: "c1",
        categoryName: "Netzwerk",
        escalations: 1,
        tickets: 1,
      },
      {
        categoryId: null,
        categoryName: "Ohne Kategorie",
        escalations: 1,
        tickets: 1,
      },
    ]);
    assertEquals(report.averageTimeByLevel[0], {
      level: 1,
      label: "1st Level",
      averageMinutes: 90,
      tickets: 2,
    });
    assertEquals(report.averageTimeByLevel[1].averageMinutes, 60);
    assertEquals(report.averageTimeByLevel[2].averageMinutes, null);
  },
);

Deno.test("actions are parsed strictly", () => {
  assertEquals(
    parseAction({ type: "getTicket", tenantId: T, ticketId: TICKET }),
    {
      type: "getTicket",
      tenantId: T,
      ticketId: TICKET,
    },
  );
  assertEquals(
    parseAction({
      type: "handover",
      tenantId: T,
      ticketId: TICKET,
      targetTeamId: TEAM,
      note: "  Neustart geprüft, Fehler bleibt ",
      expectedLevel: 1,
    }),
    {
      type: "handover",
      tenantId: T,
      ticketId: TICKET,
      targetTeamId: TEAM,
      targetAgentId: null,
      note: "Neustart geprüft, Fehler bleibt",
      expectedLevel: 1,
    },
  );
  assertEquals(
    parseAction({
      type: "handover",
      tenantId: T,
      ticketId: TICKET,
      targetTeamId: TEAM,
      note: "kurz",
      expectedLevel: 1,
    }),
    null,
  );
  assertEquals(
    parseAction({ type: "getTicket", tenantId: T, ticketId: TICKET, extra: 1 }),
    null,
  );
  assertEquals(
    parseAction({
      type: "report",
      tenantId: T,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T00:00:00.000Z",
    }),
    {
      type: "report",
      tenantId: T,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T00:00:00.000Z",
    },
  );
  assertEquals(
    parseAction({
      type: "report",
      tenantId: T,
      startsAt: "2024-01-01T00:00:00.000Z",
      endsAt: "2026-10-31T00:00:00.000Z",
    }),
    null,
  );
});
