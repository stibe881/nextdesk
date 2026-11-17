import { describe, expect, it } from "vitest";

import { handbookToc, parseHandbookBlocks } from "../lib/handbooks-model";

describe("handbookToc", () => {
  it("sammelt Abschnitte und Anleitungen", () => {
    const blocks = parseHandbookBlocks(
      [
        "## Wie mache ich …?",
        "### Wie erfasse ich ein Ticket?",
        "1. Schritt",
        "### Wie ändere ich das Passwort?",
        "## Anmelden",
        "### Mit SSO",
      ].join("\n"),
    );
    const toc = handbookToc(blocks);
    expect(toc.map((section) => section.text)).toEqual([
      "Wie mache ich …?",
      "Anmelden",
    ]);
    expect(toc[0]!.guides.map((guide) => guide.text)).toEqual([
      "Wie erfasse ich ein Ticket?",
      "Wie ändere ich das Passwort?",
    ]);
    expect(toc[1]!.guides).toEqual([]);
  });
});
