import { describe, expect, it } from "vitest";

import { handbookHeadingId, handbookToc } from "./handbook-toc";

const markdown = `# Titel

Einleitung

## Wie mache ich …?

### Wie erfasse ich ein Ticket?

1. Schritt

### Wie ändere ich das Passwort?

## Anmelden

### Mit SSO

\`\`\`
## Kein Abschnitt
### Wie auch nicht
\`\`\`

## Profil
`;

describe("handbookToc", () => {
  it("liest Abschnitte und Anleitungen", () => {
    const toc = handbookToc(markdown);
    expect(toc.map((entry) => entry.title)).toEqual([
      "Wie mache ich …?",
      "Anmelden",
      "Profil",
    ]);
    expect(toc[0]!.children.map((entry) => entry.title)).toEqual([
      "Wie erfasse ich ein Ticket?",
      "Wie ändere ich das Passwort?",
    ]);
    expect(toc[1]!.children).toEqual([]);
  });

  it("bildet stabile Anker", () => {
    expect(handbookHeadingId("Wie ändere ich das Passwort?")).toBe(
      "hb-wie-andere-ich-das-passwort",
    );
  });
});
