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
const SIGNATURE_FAREWELL =
  /^(?:(?:(?:mit\s+)?freundliche[nr]?|liebe[nr]?|beste[nr]?|herzliche[nr]?|viele[nr]?)\s+)?gr(?:uss|üsse|uesse)[,!\.\s]*$/iu;
const SIGNATURE_IMAGE_FILE =
  /^\s*\[(?!cid:)([^\]]+\.(?:png|jpe?g|gif|webp|svg))\]\s*$/iu;
const SIGNATURE_CONTACT = /^(?:tel(?:efon)?|mobile?|handy|t|m|f|w)\s*:\s*\S+/iu;
const SIGNATURE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const SIGNATURE_LINK =
  /(?:<https?:\/\/[^>]+>|https?:\/\/\S+|(?:linkedin|facebook|instagram)\.com)/iu;
const SIGNATURE_POSTAL_ADDRESS = /\b(?:CH-)?\d{4}\s+[\p{L}.-]+/iu;
const PERSONAL_POSTSCRIPT = /^(?:p\.?\s*s\.?|nachtrag|hinweis)\b/iu;
const DECORATIVE_SIGNATURE_IMAGE =
  /(?:^|[-_.\s])(?:logo|signatur|signature|footer|banner)(?=$|[-_.\s])/iu;
const RAW_SIGNATURE_LINK = /(?:<https?:\/\/[^>]+>|https?:\/\/[^\s<]+)/giu;
const SOCIAL_NETWORK_LABEL =
  /^(?:linkedin|facebook|instagram|x|twitter|youtube|tiktok)\s*:?\s*$/iu;
const SIGNATURE_SCAN_LIMIT = 18;

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

function signatureEvidence(value: string): Set<string> {
  const line = value.trim();
  const signals = new Set<string>();
  if (!line) return signals;
  if (SIGNATURE_IMAGE_FILE.test(line)) signals.add("image");
  if (SIGNATURE_CONTACT.test(line)) signals.add("contact");
  if (SIGNATURE_EMAIL.test(line)) signals.add("email");
  if (SIGNATURE_LINK.test(line)) signals.add("link");
  if (SIGNATURE_POSTAL_ADDRESS.test(line)) signals.add("postal_address");
  return signals;
}

function displayableSignatureLine(value: string): string | null {
  const line = value.trim();
  if (!line) return null;
  const imageFile = SIGNATURE_IMAGE_FILE.exec(line)?.[1] ?? null;
  if (imageFile) {
    return DECORATIVE_SIGNATURE_IMAGE.test(imageFile)
      ? null
      : `Bildanhang: ${imageFile}`;
  }
  const withoutLinks = line
    .replace(RAW_SIGNATURE_LINK, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (!withoutLinks || SOCIAL_NETWORK_LABEL.test(withoutLinks)) return null;
  return withoutLinks;
}

/**
 * Keeps a clearly identifiable corporate signature visible, but separates it
 * from the actual message and removes technical image filenames and raw link
 * lists. CID markers remain untouched for the private inline-media pipeline.
 */
function formatCorporateSignature(value: string): string {
  const lines = value.split("\n");
  for (
    let farewellIndex = 0;
    farewellIndex < lines.length;
    farewellIndex += 1
  ) {
    if (!SIGNATURE_FAREWELL.test(lines[farewellIndex].trim())) continue;
    let closingIndex = farewellIndex + 1;
    while (closingIndex < lines.length && !lines[closingIndex].trim()) {
      closingIndex += 1;
    }
    if (
      closingIndex >= lines.length ||
      closingIndex - farewellIndex > 3 ||
      !lines[closingIndex].trim()
    ) {
      continue;
    }

    const signals = new Set<string>();
    let signatureDetected = false;
    let postscriptIndex: number | null = null;
    const scanEnd = Math.min(
      lines.length,
      closingIndex + 1 + SIGNATURE_SCAN_LIMIT,
    );
    for (let index = closingIndex + 1; index < scanEnd; index += 1) {
      if (PERSONAL_POSTSCRIPT.test(lines[index].trim())) {
        if (signatureDetected) postscriptIndex = index;
        break;
      }
      for (const signal of signatureEvidence(lines[index])) signals.add(signal);
      if (
        signals.size >= 2 &&
        (signals.has("contact") || signals.has("email"))
      ) {
        signatureDetected = true;
      }
    }
    if (!signatureDetected) continue;

    const signatureLines = lines
      .slice(closingIndex + 1, postscriptIndex ?? lines.length)
      .map(displayableSignatureLine)
      .filter((line): line is string => line !== null);
    if (!signatureLines.length) return value;
    return [
      ...lines.slice(0, closingIndex + 1),
      "",
      "E-Mail-Signatur",
      ...signatureLines,
      ...(postscriptIndex === null
        ? []
        : ["", ...lines.slice(postscriptIndex)]),
    ]
      .join("\n")
      .trimEnd();
  }
  return value;
}

/**
 * Converts a Graph text/HTML fallback into safe ticket text. It deliberately
 * retains only textual content and existing CID references for the separate,
 * private inline-media pipeline; it never resolves remote assets or URLs.
 */
export function normalizeInboundEmailText(
  value: unknown,
  fallback = DEFAULT_FALLBACK,
  options: { formatCorporateSignature?: boolean } = {},
): string {
  if (typeof value !== "string") return fallback;
  const text = decodeEntities(
    stripHtmlToText(decodeMarkupDelimiters(value.replace(/\u0000/gu, ""))),
  );
  const normalizedLines = normalizeLines(text);
  const normalized = (
    options.formatCorporateSignature
      ? formatCorporateSignature(normalizedLines)
      : normalizedLines
  )
    .replace(INLINE_MARKER, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, MAX_INBOUND_TEXT);
  return normalized || fallback;
}
