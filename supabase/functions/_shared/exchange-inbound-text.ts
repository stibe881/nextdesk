const DEFAULT_FALLBACK = "E-Mail ohne Text";
const MAX_INBOUND_TEXT = 48_000;
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "br",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "section",
  "table",
  "td",
  "tr",
  "ul",
]);
const SILENT_TAGS = new Set(["head", "script", "style"]);
const INLINE_MARKER = /\[\[nextdesk-inline-(?:content|image):[^\]]+\]\]/giu;
const OUTLOOK_INTERNAL_TOKEN = /\[#INC-\d+\](?::\d+)+(?::[a-z]{2})?/giu;
const PROFILE_OR_REACTION_PREFIX =
  /^\[(?:profile image|like|love|laugh|sad|angry)\]\s*/iu;
const OUTLOOK_FOOTER_START =
  /^(?:führen sie jetzt ein upgrade auf das neueste outlook|diese e-mail wird durch die verwendung microsoft(?: 365| outlook)?)/iu;
const OUTLOOK_LINK_LINE =
  /^(?:zu nachricht wechseln|abonnement kündigen|mac|ios|android)\s*<https?:\/\/[^>]+>\s*$/iu;

function decodeEntitiesOnce(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(
      /&([a-z]+);/giu,
      (match, name: string) => named[name.toLowerCase()] ?? match,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (match, encoded: string) => {
      const codePoint = encoded.toLowerCase().startsWith("x")
        ? Number.parseInt(encoded.slice(1), 16)
        : Number.parseInt(encoded, 10);
      return Number.isSafeInteger(codePoint) &&
        codePoint > 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    });
}

function decodeEntities(value: string): string {
  let decoded = value;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = decodeEntitiesOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function decodeMarkupDelimiters(value: string): string {
  let decoded = value;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = decoded
      .replace(/&(amp|lt|gt);/giu, (_match, name: string) => {
        return name.toLowerCase() === "amp"
          ? "&"
          : name.toLowerCase() === "lt"
            ? "<"
            : ">";
      })
      .replace(/&#(x[0-9a-f]+|\d+);/giu, (match, encoded: string) => {
        const codePoint = encoded.toLowerCase().startsWith("x")
          ? Number.parseInt(encoded.slice(1), 16)
          : Number.parseInt(encoded, 10);
        return codePoint === 38
          ? "&"
          : codePoint === 60
            ? "<"
            : codePoint === 62
              ? ">"
              : match;
      });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function findTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function tagName(token: string): string | null {
  const match = /^<\s*\/?\s*([A-Za-z][A-Za-z0-9-]*)\b/u.exec(token);
  return match?.[1]?.toLowerCase() ?? null;
}

function isClosingTag(token: string): boolean {
  return /^<\s*\//u.test(token);
}

function rawAngleReference(value: string, start: number): string | null {
  const rest = value.slice(start);
  const match = /^<(?:https?:\/\/|cid:)[^>\s]+>/iu.exec(rest);
  return match?.[0] ?? null;
}

function cidMarker(token: string): string | null {
  const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(token);
  const source = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!source?.toLowerCase().startsWith("cid:")) return null;
  const contentId = source.slice(4).trim();
  return contentId && /^[^\s<>"'&]+$/u.test(contentId)
    ? `[cid:${contentId}]`
    : null;
}

function stripHtmlToText(value: string): string {
  const output: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("<!--", index)) {
      const end = value.indexOf("-->", index + 4);
      index = end === -1 ? value.length : end + 3;
      continue;
    }
    if (value[index] !== "<") {
      output.push(value[index]);
      index += 1;
      continue;
    }

    const reference = rawAngleReference(value, index);
    if (reference) {
      output.push(reference);
      index += reference.length;
      continue;
    }

    const end = findTagEnd(value, index);
    if (end === -1) {
      output.push(value[index]);
      index += 1;
      continue;
    }
    const token = value.slice(index, end + 1);
    if (/^<!/u.test(token) || /^<\?/u.test(token)) {
      index = end + 1;
      continue;
    }
    const name = tagName(token);
    if (!name) {
      output.push(token);
      index = end + 1;
      continue;
    }

    if (SILENT_TAGS.has(name) && !isClosingTag(token)) {
      const closing = new RegExp(`<\\s*/\\s*${name}\\s*>`, "iu").exec(
        value.slice(end + 1),
      );
      index = closing
        ? end + 1 + closing.index + closing[0].length
        : value.length;
      continue;
    }
    if (name === "img" && !isClosingTag(token)) {
      output.push(`\n${cidMarker(token) ?? ""}\n`);
    } else if (BLOCK_TAGS.has(name)) {
      output.push("\n");
    }
    index = end + 1;
  }
  return output.join("");
}

function shouldRemoveLine(value: string): boolean {
  const line = value.trim();
  return (
    line === "Microsoft Outlook" ||
    OUTLOOK_LINK_LINE.test(line) ||
    /^\[?(?:profile image|like|love|laugh|sad|angry)\]?$/iu.test(line)
  );
}

function normalizeLines(value: string): string {
  const lines: string[] = [];
  let inOutlookFooter = false;
  for (const rawLine of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine
      .replace(OUTLOOK_INTERNAL_TOKEN, "")
      .replace(PROFILE_OR_REACTION_PREFIX, "")
      .trimEnd();
    if (OUTLOOK_FOOTER_START.test(line.trim())) inOutlookFooter = true;
    if (inOutlookFooter || shouldRemoveLine(line)) continue;
    if (!line.trim()) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

/**
 * Converts a Graph text/HTML fallback into safe ticket text. It deliberately
 * retains only textual content and existing CID references for the separate,
 * private inline-media pipeline; it never resolves remote assets or URLs.
 */
export function normalizeInboundEmailText(
  value: unknown,
  fallback = DEFAULT_FALLBACK,
): string {
  if (typeof value !== "string") return fallback;
  const text = decodeEntities(
    stripHtmlToText(decodeMarkupDelimiters(value.replace(/\u0000/gu, ""))),
  );
  const normalized = normalizeLines(text)
    .replace(INLINE_MARKER, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, MAX_INBOUND_TEXT);
  return normalized || fallback;
}
