/**
 * Role-specific handbooks. The `handbooks` Function decides server-side which
 * handbooks the signed-in person may read; the app only shows what it returns.
 */
export type HandbookId =
  "mitarbeitende" | "agenten" | "administratoren" | "installation";

export type HandbookSummary = {
  id: HandbookId;
  title: string;
  description: string;
  audienceLabel: string;
  updatedAt: string;
};

export type Handbook = HandbookSummary & { markdown: string };

const HANDBOOK_IDS: readonly string[] = [
  "mitarbeitende",
  "agenten",
  "administratoren",
  "installation",
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function summary(value: unknown): HandbookSummary | null {
  const item = record(value);
  if (
    !item ||
    typeof item.id !== "string" ||
    !HANDBOOK_IDS.includes(item.id) ||
    typeof item.title !== "string" ||
    typeof item.description !== "string" ||
    typeof item.audienceLabel !== "string" ||
    typeof item.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: item.id as HandbookId,
    title: item.title,
    description: item.description,
    audienceLabel: item.audienceLabel,
    updatedAt: item.updatedAt,
  };
}

export function isHandbookId(value: unknown): value is HandbookId {
  return typeof value === "string" && HANDBOOK_IDS.includes(value);
}

export function parseHandbookList(value: unknown): HandbookSummary[] {
  const list = record(record(value)?.data)?.handbooks;
  if (!Array.isArray(list)) {
    throw new Error("Die Handbücher konnten nicht gelesen werden.");
  }
  const parsed = list.map(summary);
  if (!parsed.every((entry): entry is HandbookSummary => entry !== null)) {
    throw new Error("Die Handbücher konnten nicht gelesen werden.");
  }
  return parsed;
}

export function parseHandbook(value: unknown): Handbook {
  const handbook = record(record(value)?.data)?.handbook;
  const parsed = summary(handbook);
  const markdown = record(handbook)?.markdown;
  if (!parsed || typeof markdown !== "string") {
    throw new Error("Das Handbuch konnte nicht gelesen werden.");
  }
  return { ...parsed, markdown };
}

export function formatHandbookDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(date);
}

/** Markdown subset used by docs/handbooks, rendered natively in the app. */
export type HandbookBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "image"; alt: string; uri: string }
  | { kind: "table"; header: string[]; rows: string[][] };

// Handbook screenshots (data URIs) and uploaded knowledge article images
// (kb-image:<id>, resolved to signed URLs by the article screen).
const IMAGE_PATTERN =
  /^!\[([^\]]*)\]\((data:image\/(?:png|jpeg|webp);base64,[^)]+|kb-image:[0-9a-fA-F-]+)\)$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseHandbookBlocks(markdown: string): HandbookBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: HandbookBlock[] = [];
  let index = 0;

  const isBlockStart = (line: string) =>
    /^(#{1,3} |> |```|\|)/.test(line) ||
    /^(\s*[-*] |\s*\d+\. )/.test(line) ||
    IMAGE_PATTERN.test(line.trim());

  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: code.join("\n").trim() });
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(trimmed);
    if (heading) {
      // The title (#) is shown separately by the screen.
      if (heading[1] !== "#") {
        blocks.push({
          kind: "heading",
          level: heading[1] === "##" ? 2 : 3,
          text: heading[2]!.trim(),
        });
      }
      index += 1;
      continue;
    }
    const image = IMAGE_PATTERN.exec(trimmed);
    if (image) {
      blocks.push({ kind: "image", alt: image[1]!, uri: image[2]! });
      index += 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        quote.push(lines[index]!.trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ").trim() });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        const cells = tableCells(lines[index]!);
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      const [header = [], ...body] = rows;
      blocks.push({ kind: "table", header, rows: body });
      continue;
    }
    const listItem = /^\s*([-*]|\d+\.) (.+)$/.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]!);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const item = /^\s*([-*]|\d+\.) (.+)$/.exec(current);
        if (item) {
          items.push(item[2]!.trim());
        } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      (paragraph.length === 0 || !isBlockStart(lines[index]!))
    ) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export type HandbookInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

/** Splits **bold**, *italic* and `code` spans; links keep their label. */
export function parseHandbookInline(text: string): HandbookInline[] {
  const source = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  const parts: HandbookInline[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: source.slice(last, start) });
    const token = match[0];
    if (token.startsWith("**"))
      parts.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith("`"))
      parts.push({ text: token.slice(1, -1), code: true });
    else parts.push({ text: token.slice(1, -1), italic: true });
    last = start + token.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}
