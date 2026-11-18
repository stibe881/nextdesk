import { describe, expect, it } from "vitest";

import {
  parseArticleDraft,
  parseCaseResult,
  parseCloseResult,
  parseIncidentDetail,
  parseIncidentList,
  parseTicketIncidents,
  ticketReplyText,
} from "./incidents";
import { parseIncidentMessages } from "./incidents-public-messages";

const base = {
  id: "i1",
  number: "STO-2026-0007",
  title: "SW-CORE – Ping",
  deviceName: "SW-CORE",
  severity: "down",
  state: "resolved",
  openedAt: "2026-11-10T08:00:00Z",
};

describe("incidents model", () => {
  it("reads a page with cursor and keeps stats optional", () => {
    const parsed = parseIncidentList({
      data: { incidents: [base], nextCursor: "2026-11-10T08:00:00.000Z|i1" },
    });
    expect(parsed?.incidents).toHaveLength(1);
    expect(parsed?.nextCursor).toBe("2026-11-10T08:00:00.000Z|i1");
    expect(parsed?.stats).toBeNull();
  });

  it("reads tickets, network context, recurrence and permissions", () => {
    const detail = parseIncidentDetail({
      data: {
        ...base,
        tickets: [
          {
            id: "t1",
            number: "T-1",
            subject: "WLAN weg",
            status: "Offen",
            closed: false,
            source: "text",
            linkedAt: "2026-11-10T08:05:00Z",
          },
          { id: "t2", number: "T-2", source: "erfunden" },
          { number: "ohne Id" },
        ],
        hiddenTickets: 2,
        network: {
          addresses: [
            {
              address: "10.31.0.2",
              prefix: "10.31.0.0/24",
              vlanNumber: 31,
              switchName: "sw-dist-01",
              switchPort: "Gi1/0/1",
            },
          ],
          subnetNeighbours: [
            { assetId: "a2", name: "AP Aula", state: "down", incidentId: "i2" },
            { name: "Drucker", state: "kaputt" },
          ],
          switchNeighbours: [],
        },
        recurrence: { sameDevice30d: 4, sameCause30d: 1, suggestCase: true },
        permissions: { openCase: true },
        problems: [{ id: "p1", title: "USV", status: "investigating" }],
      },
    });
    expect(detail?.tickets.map((ticket) => ticket.source)).toEqual([
      "text",
      "manual",
    ]);
    expect(detail?.hiddenTickets).toBe(2);
    expect(detail?.network?.addresses[0]?.vlanNumber).toBe(31);
    expect(detail?.network?.subnetNeighbours[1]?.state).toBe("unknown");
    expect(detail?.recurrence.suggestCase).toBe(true);
    expect(detail?.permissions).toEqual({
      openCase: true,
      draftArticle: false,
    });
    expect(detail?.problems[0]?.title).toBe("USV");
  });

  it("older answers without the new fields still parse", () => {
    const detail = parseIncidentDetail({ data: base });
    expect(detail?.tickets).toEqual([]);
    expect(detail?.network).toBeNull();
    expect(detail?.recurrence.suggestCase).toBe(false);
  });

  it("reads close, case and article results", () => {
    expect(
      parseCloseResult({
        data: {
          ...base,
          closeResult: {
            tickets: {
              notified: 2,
              resolved: 1,
              skipped: [{ ticketNumber: "T-3", reason: "sla_reason_required" }],
            },
            problemId: "p9",
          },
        },
      }),
    ).toEqual({
      tickets: {
        notified: 2,
        resolved: 1,
        skipped: [{ ticketNumber: "T-3", reason: "sla_reason_required" }],
      },
      problemId: "p9",
    });
    expect(parseCloseResult({ data: base })).toBeNull();
    expect(parseCaseResult({ data: { caseResult: { problemId: "p1" } } })).toBe(
      "p1",
    );
    expect(
      parseArticleDraft({
        data: { articleId: "k1", title: "T", aiUsed: true },
      }),
    ).toEqual({ articleId: "k1", title: "T", aiUsed: true });
  });

  it("ticket hint lists the incidents", () => {
    expect(
      parseTicketIncidents({
        data: {
          incidents: [{ id: "i1", number: "STO-1", title: "SW", state: "x" }],
          canOpen: true,
        },
      }),
    ).toEqual({
      incidents: [
        {
          id: "i1",
          number: "STO-1",
          title: "SW",
          state: "active",
          severity: "down",
        },
      ],
      canOpen: true,
    });
    expect(parseTicketIncidents(null)).toEqual({
      incidents: [],
      canOpen: false,
    });
  });

  it("reply to the tickets names number, device and cause", () => {
    const text = ticketReplyText(base, "power", "USV getauscht");
    expect(text).toContain("(STO-2026-0007, SW-CORE)");
    expect(text).toContain("Ursache: Strom\nUSV getauscht");
    expect(text).not.toContain("ß");
  });

  it("public messages: newest first, unknown states dropped", () => {
    const messages = parseIncidentMessages({
      data: {
        messages: [
          {
            id: "m1",
            state: "investigating",
            title: "A",
            body: "x",
            createdAt: "2026-11-10T08:00:00Z",
            updatedAt: null,
          },
          {
            id: "m2",
            state: "resolved",
            title: "B",
            body: "y",
            createdAt: "2026-11-10T09:00:00Z",
          },
          { id: "m3", state: "kaputt", createdAt: "2026-11-10T10:00:00Z" },
        ],
      },
    });
    expect(messages.map((message) => message.id)).toEqual(["m2", "m1"]);
    expect(parseIncidentMessages({ error: {} })).toEqual([]);
  });
});
