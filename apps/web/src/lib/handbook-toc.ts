/** Verzeichnis eines Handbuchs: Abschnitte (##) und, darunter, Anleitungen (###). */

export type HandbookTocEntry = {
  children: HandbookTocEntry[];
  id: string;
  title: string;
};

export function handbookHeadingId(text: string): string {
  return (
    "hb-" +
    text
      .toLocaleLowerCase("de-CH")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/**
 * Liest die Überschriften ## und ### (ausserhalb von Codeblöcken). Die
 * Anleitungen («Wie mache ich …?») hängen als Unterpunkte unter ihrem
 * Abschnitt; Unterüberschriften anderer Abschnitte erscheinen nicht, sonst
 * wird das Verzeichnis zu lang.
 */
export function handbookToc(markdown: string): HandbookTocEntry[] {
  const entries: HandbookTocEntry[] = [];
  let inFence = false;
  let current: HandbookTocEntry | null = null;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      const title = h2[1]!.trim();
      current = { id: handbookHeadingId(title), title, children: [] };
      entries.push(current);
      continue;
    }
    const h3 = /^### (.+)$/.exec(line);
    if (h3 && current && /^wie\b/i.test(h3[1]!.trim())) {
      const title = h3[1]!.trim();
      current.children.push({
        id: handbookHeadingId(title),
        title,
        children: [],
      });
    }
  }
  return entries;
}
