import { describe, expect, it } from "vitest";
import { activeMentionQuery, mentionedAgentIds } from "./ticket-mentions";

const agents = [
  { id: "a", displayName: "Stefan Gross" },
  { id: "b", displayName: "Tamara Adzhova" },
  { id: "c", displayName: "Stefan" },
];

describe("mentionedAgentIds", () => {
  it("erkennt ganze Namen und unterscheidet keine Grossschreibung", () => {
    expect(
      mentionedAgentIds("Bitte @tamara adzhova anschauen.", agents),
    ).toEqual(["b"]);
    expect(mentionedAgentIds("@Stefan Gross, kannst du?", agents)).toEqual([
      "a",
    ]);
  });
  it("trifft den längsten Namen und keine Mailadressen", () => {
    expect(mentionedAgentIds("@Stefan Gross", agents)).toEqual(["a"]);
    expect(mentionedAgentIds("mail an x@Stefan Gross", agents)).toEqual([]);
  });
  it("findet keinen Namen ohne @", () => {
    expect(mentionedAgentIds("Stefan Gross", agents)).toEqual([]);
  });
});

describe("activeMentionQuery", () => {
  it("liefert den gerade getippten Namen", () => {
    expect(activeMentionQuery("Bitte @Ta")).toBe("Ta");
    expect(activeMentionQuery("Bitte @Tamara Ad")).toBe("Tamara Ad");
    expect(activeMentionQuery("Bitte @Tamara Adzhova schau")).toBeNull();
    expect(activeMentionQuery("info@firma.ch")).toBeNull();
  });
});
