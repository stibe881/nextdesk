import { describe, expect, it } from "vitest";
import { mergePreviewLines, parseMergePreview } from "./ticket-merge-preview";

const base = {
  subject: "Drucker",
  isClosed: false,
  mergedInto: null,
  comments: 0,
  resolutionDueAt: null,
  assignedAgentName: null,
  teamName: null,
  timeMinutes: 0,
  openChecklistItems: 0,
};

describe("parseMergePreview", () => {
  it("liest Vorschlag und Tickets und verwirft fremde Kennungen", () => {
    const preview = parseMergePreview({
      suggestedPrimaryId: "a",
      primaryId: "x",
      tickets: [
        {
          ...base,
          id: "a",
          ticketNumber: "T-1",
          prioritySort: 10,
          priorityLabel: "Normal",
          requesterEmail: "a@x.ch",
          mailChannel: false,
        },
        {
          ...base,
          id: "b",
          ticketNumber: "T-2",
          prioritySort: 40,
          priorityLabel: "Dringend",
          requesterEmail: "b@x.ch",
          mailChannel: true,
        },
        { id: 5 },
      ],
    });
    expect(preview?.tickets).toHaveLength(2);
    expect(preview?.suggestedPrimaryId).toBe("a");
    expect(preview?.primaryId).toBeNull();
  });

  it("fasst Priorität, Personen und Mails zusammen", () => {
    const preview = parseMergePreview({
      suggestedPrimaryId: "a",
      primaryId: "a",
      tickets: [
        {
          ...base,
          id: "a",
          ticketNumber: "T-1",
          prioritySort: 10,
          priorityLabel: "Normal",
          requesterEmail: "a@x.ch",
          mailChannel: false,
        },
        {
          ...base,
          id: "b",
          ticketNumber: "T-2",
          prioritySort: 40,
          priorityLabel: "Dringend",
          requesterEmail: "b@x.ch",
          mailChannel: true,
        },
      ],
    });
    expect(preview && mergePreviewLines(preview)).toEqual([
      "Haupt-Ticket: T-1",
      "Priorität danach: Dringend",
      "2 Personen betroffen",
      "1 Info-Mail an anfragende Personen",
    ]);
  });

  it("lehnt Antworten ohne Tickets ab", () => {
    expect(parseMergePreview({ tickets: [] })).toBeNull();
    expect(parseMergePreview(null)).toBeNull();
  });
});
