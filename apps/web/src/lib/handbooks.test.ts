import { describe, expect, it } from "vitest";

import {
  handbookDateLabel,
  handbookFromResponse,
  handbookListFromResponse,
  handbookUrlTransform,
} from "./handbooks";

const summary = {
  id: "agenten",
  title: "Handbuch für Agenten",
  description: "Tickets bearbeiten",
  audienceLabel: "Agenten",
  updatedAt: "2026-11-08",
};

describe("handbook responses", () => {
  it("parses the list returned by the handbooks Function", () => {
    expect(handbookListFromResponse({ data: { handbooks: [summary] } })).toEqual(
      [summary],
    );
    expect(handbookListFromResponse({ data: { handbooks: [] } })).toEqual([]);
  });

  it("rejects unknown handbook ids and malformed payloads", () => {
    expect(
      handbookListFromResponse({
        data: { handbooks: [{ ...summary, id: "geheim" }] },
      }),
    ).toBeNull();
    expect(handbookListFromResponse({ data: {} })).toBeNull();
    expect(handbookFromResponse({ data: { handbook: summary } })).toBeNull();
  });

  it("parses a single handbook with Markdown", () => {
    expect(
      handbookFromResponse({
        data: { handbook: { ...summary, markdown: "## Start" } },
      }),
    ).toEqual({ ...summary, markdown: "## Start" });
  });
});

describe("handbookUrlTransform", () => {
  it("allows embedded screenshots only as image sources", () => {
    const image = "data:image/jpeg;base64,AAAA";
    expect(handbookUrlTransform(image, "src")).toBe(image);
    expect(handbookUrlTransform(image, "href")).toBe("");
    expect(handbookUrlTransform("data:text/html;base64,AAAA", "src")).toBe("");
  });

  it("keeps web links and anchors but drops scripts", () => {
    expect(handbookUrlTransform("https://app.nextdesk.ch", "href")).toBe(
      "https://app.nextdesk.ch",
    );
    expect(handbookUrlTransform("#hb-start", "href")).toBe("#hb-start");
    expect(handbookUrlTransform("javascript:alert(1)", "href")).toBe("");
  });
});

describe("handbookDateLabel", () => {
  it("formats the revision date in Swiss German", () => {
    expect(handbookDateLabel("2026-11-08")).toBe("08. November 2026");
  });
});
