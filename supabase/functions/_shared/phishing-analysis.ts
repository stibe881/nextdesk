// «Phishing melden»: server-side analysis of a reported e-mail.
// Pure functions only: nothing here opens a link, resolves a host, or executes
// or renders an attachment. Input is parsed as untrusted text.

export type MailHeader = { name: string; value: string };
export type MailAttachmentInfo = {
  filename: string;
  contentType: string;
  size: number;
};
export type ParsedMail = {
  headers: MailHeader[];
  text: string;
  html: string;
  attachments: MailAttachmentInfo[];
  embedded: ParsedMail[];
};

export type Severity = "info" | "low" | "medium" | "high";
export type Finding = { code: string; severity: Severity; message: string };
export type AuthVerdict =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

export type ReceivedHop = {
  from: string | null;
  by: string | null;
  ip: string | null;
};

export type HeaderAnalysis = {
  fromAddress: string | null;
  fromName: string | null;
  fromDomain: string | null;
  returnPath: string | null;
  returnPathDomain: string | null;
  replyTo: string | null;
  replyToDomain: string | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
  auth: { spf: AuthVerdict; dkim: AuthVerdict; dmarc: AuthVerdict };
  received: ReceivedHop[];
  sendingIp: string | null;
  findings: Finding[];
};

export type LinkInfo = {
  href: string;
  text: string | null;
  host: string | null;
  findings: Finding[];
};

export type AttachmentAnalysis = MailAttachmentInfo & { findings: Finding[] };

export type PhishingSource =
  | "eml"
  | "msg"
  | "headers"
  | "inline_forward"
  | "text";

export type RiskLevel = "low" | "medium" | "high";

export type PhishingAnalysis = {
  source: PhishingSource;
  headers: HeaderAnalysis;
  links: LinkInfo[];
  attachments: AttachmentAnalysis[];
  findings: Finding[];
  score: number;
  level: RiskLevel;
};

const MAX_DEPTH = 6;
const MAX_PARTS = 200;
const MAX_LINKS = 100;
const MAX_TEXT = 200_000;

// ---------------------------------------------------------------------------
// Low-level decoding

/** Bytes → "binary string" (one char per byte) so MIME parsing stays byte-exact. */
export function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return out;
}

function binaryToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function decodeCharset(bytes: Uint8Array, charset: string | null): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(label || "utf-8").decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return bytesToBinary(bytes);
    }
  }
}

function decodeBase64Binary(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, "");
  const trimmed = clean.slice(0, clean.length - (clean.length % 4));
  try {
    return atob(trimmed);
  } catch {
    return "";
  }
}

function decodeQuotedPrintableBinary(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/** RFC 2047 encoded words in header values (=?utf-8?B?…?= / Q). */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g,
      (_match, charset: string, encoding: string, text: string) => {
        const binary = encoding.toUpperCase() === "B"
          ? decodeBase64Binary(text)
          : decodeQuotedPrintableBinary(text.replace(/_/g, " "));
        return decodeCharset(binaryToBytes(binary), charset.split("*")[0]!);
      },
    );
}

/** Splits raw header text into unfolded name/value pairs (order preserved). */
export function parseHeaderBlock(block: string): MailHeader[] {
  const headers: MailHeader[] = [];
  for (const line of block.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1]!.value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([!-9;-~]{1,76}):[ \t]?(.*)$/.exec(line);
    if (match) {
      headers.push({ name: match[1]!.toLowerCase(), value: match[2]!.trim() });
    }
  }
  return headers.map((header) => ({
    name: header.name,
    value: decodeEncodedWords(header.value).slice(0, 4_000),
  }));
}

function header(headers: MailHeader[], name: string): string | null {
  return headers.find((entry) => entry.name === name)?.value ?? null;
}

function headerAll(headers: MailHeader[], name: string): string[] {
  return headers.filter((entry) => entry.name === name).map((entry) =>
    entry.value
  );
}

type ContentType = { type: string; params: Record<string, string> };

function parseParams(value: string): ContentType {
  const [main, ...rest] = value.split(";");
  const params: Record<string, string> = {};
  const continuations: Record<string, string[]> = {};
  for (const part of rest) {
    const match = /^\s*([^=\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))\s*$/.exec(
      part,
    );
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const raw = (match[2] ?? match[3] ?? "").trim();
    const rfc2231 = /^([^*]+)\*(\d+)?\*?$/.exec(key);
    if (rfc2231) {
      const base = rfc2231[1]!;
      let decoded = raw;
      const extended = /^([^']*)'[^']*'(.*)$/.exec(raw);
      if (key.endsWith("*") && extended) {
        try {
          decoded = decodeCharset(
            binaryToBytes(
              extended[2]!.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                String.fromCharCode(parseInt(hex, 16))
              ),
            ),
            extended[1] || "utf-8",
          );
        } catch {
          decoded = extended[2]!;
        }
      }
      const index = rfc2231[2] ? Number(rfc2231[2]) : 0;
      (continuations[base] ??= [])[index] = decoded;
      continue;
    }
    params[key] = decodeEncodedWords(raw.replace(/\\(.)/g, "$1"));
  }
  for (const [key, parts] of Object.entries(continuations)) {
    params[key] = parts.join("");
  }
  return { type: (main ?? "").trim().toLowerCase(), params };
}

function splitHeadersAndBody(raw: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { head: raw, body: "" };
  return {
    head: raw.slice(0, match.index),
    body: raw.slice(match.index + match[0].length),
  };
}

function decodeTransfer(body: string, encoding: string | null): string {
  const value = (encoding ?? "").trim().toLowerCase();
  if (value === "base64") return decodeBase64Binary(body);
  if (value === "quoted-printable") return decodeQuotedPrintableBinary(body);
  return body;
}

// ---------------------------------------------------------------------------
// MIME parsing

/**
 * Parses an RFC 822 / MIME message given as a binary string. Header-only input
 * (pasted headers) yields a mail without body. Nested message/rfc822 parts are
 * returned in `embedded` (forwarded as attachment).
 */
export function parseMime(raw: string): ParsedMail {
  const counter = { parts: 0 };
  return parseEntity(raw, 0, counter);
}

function emptyMail(headers: MailHeader[] = []): ParsedMail {
  return { headers, text: "", html: "", attachments: [], embedded: [] };
}

function parseEntity(
  raw: string,
  depth: number,
  counter: { parts: number },
): ParsedMail {
  const { head, body } = splitHeadersAndBody(raw);
  const headers = parseHeaderBlock(head);
  const mail = emptyMail(headers);
  collectPart(headers, body, mail, depth, counter);
  return mail;
}

function collectPart(
  headers: MailHeader[],
  body: string,
  mail: ParsedMail,
  depth: number,
  counter: { parts: number },
): void {
  counter.parts += 1;
  if (counter.parts > MAX_PARTS || depth > MAX_DEPTH) return;
  const contentType = parseParams(header(headers, "content-type") ?? "text/plain");
  const disposition = parseParams(header(headers, "content-disposition") ?? "");
  const encoding = header(headers, "content-transfer-encoding");
  const filename = disposition.params.filename ?? contentType.params.name ?? null;

  if (contentType.type.startsWith("multipart/")) {
    const boundary = contentType.params.boundary;
    if (!boundary) return;
    for (const part of splitMultipart(body, boundary)) {
      const { head, body: partBody } = splitHeadersAndBody(part);
      collectPart(parseHeaderBlock(head), partBody, mail, depth + 1, counter);
    }
    return;
  }

  if (contentType.type === "message/rfc822") {
    const decoded = decodeTransfer(body, encoding);
    const nested = parseEntity(decoded, depth + 1, counter);
    mail.embedded.push(nested);
    mail.attachments.push({
      filename: filename ?? `${header(nested.headers, "subject") ?? "Nachricht"}.eml`,
      contentType: "message/rfc822",
      size: decoded.length,
    });
    return;
  }

  const isAttachment = disposition.type === "attachment" || (filename !== null &&
    !(contentType.type === "text/plain" || contentType.type === "text/html"));
  const decoded = decodeTransfer(body, encoding);
  if (isAttachment) {
    const name = (filename ?? "Anhang").slice(0, 255);
    // An attached .eml without the proper type is still a forwarded original.
    if (/\.eml$/i.test(name) && depth < MAX_DEPTH) {
      mail.embedded.push(parseEntity(decoded, depth + 1, counter));
    }
    mail.attachments.push({
      filename: name,
      contentType: contentType.type || "application/octet-stream",
      size: decoded.length,
    });
    return;
  }
  const text = decodeCharset(binaryToBytes(decoded), contentType.params.charset ?? null);
  if (contentType.type === "text/html") {
    if (mail.html.length < MAX_TEXT) mail.html += text.slice(0, MAX_TEXT);
  } else if (contentType.type === "text/plain" || contentType.type === "") {
    if (mail.text.length < MAX_TEXT) mail.text += text.slice(0, MAX_TEXT);
  }
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(delimiter)) {
      if (current) parts.push(current.join("\n"));
      if (line.slice(delimiter.length).startsWith("--")) {
        current = null;
        break;
      }
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current && current.length) parts.push(current.join("\n"));
  return parts.slice(0, MAX_PARTS);
}

/** The forwarded original: a message/rfc822 (.eml) part, otherwise null. */
export function forwardedOriginal(mail: ParsedMail): ParsedMail | null {
  return mail.embedded[0] ?? null;
}

// ---------------------------------------------------------------------------
// Inline forwards ("---- Original Message ----", "Von: … Betreff: …")

const FORWARD_MARKER =
  /^[ \t>]*(?:-{2,}|_{5,})\s*(?:original message|ursprüngliche nachricht|weitergeleitete nachricht|forwarded message|message d'origine|messaggio originale)\s*-*\s*$/im;
const FORWARD_FIELD =
  /^[ \t>*]*(von|from|gesendet|sent|datum|date|an|to|cc|betreff|subject|antwort an|reply-to)\s*:\s*\**\s*(.*)$/i;

/**
 * Detects a forward that was pasted into the body. Returns a synthetic mail
 * with From/Date/To/Subject headers and the quoted text, or null.
 */
export function parseInlineForward(text: string): ParsedMail | null {
  const normalized = text.replace(/\r\n?/g, "\n").slice(0, MAX_TEXT);
  const lines = normalized.split("\n");
  let start = -1;
  const marker = FORWARD_MARKER.exec(normalized);
  if (marker) {
    start = normalized.slice(0, marker.index).split("\n").length;
  } else {
    for (let index = 0; index < lines.length; index += 1) {
      const field = FORWARD_FIELD.exec(lines[index]!);
      if (!field || !/^(von|from)$/i.test(field[1]!)) continue;
      const window = lines.slice(index, index + 8).join("\n");
      if (/^[ \t>*]*(betreff|subject)\s*:/im.test(window)) {
        start = index;
        break;
      }
    }
  }
  if (start < 0) return null;
  const headers: MailHeader[] = [];
  let index = start;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) break;
    const field = FORWARD_FIELD.exec(line);
    if (!field) {
      if (headers.length) headers[headers.length - 1]!.value += ` ${line.trim()}`;
      continue;
    }
    const key = field[1]!.toLowerCase();
    const name = key === "von" || key === "from"
      ? "from"
      : key === "gesendet" || key === "sent" || key === "datum" || key === "date"
      ? "date"
      : key === "an" || key === "to"
      ? "to"
      : key === "betreff" || key === "subject"
      ? "subject"
      : key === "cc"
      ? "cc"
      : "reply-to";
    headers.push({ name, value: normalizeForwardAddress(field[2]!.trim()) });
  }
  if (!headers.some((entry) => entry.name === "from")) return null;
  const body = lines.slice(index).map((line) => line.replace(/^>\s?/, "")).join("\n")
    .trim();
  return { ...emptyMail(headers), text: body };
}

/** «Name [mailto:a@b.ch]» / «Name <a@b.ch>» → «Name <a@b.ch>». */
function normalizeForwardAddress(value: string): string {
  return value
    .replace(/\[mailto:([^\]]+)\]/gi, "<$1>")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Addresses and domains

export function parseAddress(
  value: string | null,
): { address: string | null; name: string | null } {
  if (!value) return { address: null, name: null };
  // The last <…> is the real address; the display name may contain another.
  const angle = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>[^<>]*$/.exec(value);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"|"$/g, "").trim();
    return { address: angle[2]!.toLowerCase(), name: name || null };
  }
  const bare = /([^\s<>"(),;:]+@[^\s<>"(),;:]+)/.exec(value);
  const address = bare ? bare[1]!.toLowerCase().replace(/[.>]+$/, "") : null;
  const name = value.replace(/\(.*?\)/g, "").replace(bare?.[1] ?? "", "").replace(
    /["<>]/g,
    "",
  ).trim();
  return { address, name: name || null };
}

export function domainOf(address: string | null): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  const domain = (at >= 0 ? address.slice(at + 1) : address).trim().toLowerCase()
    .replace(/[>\].]+$/, "");
  return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/i.test(domain) || domain.startsWith("xn--")
    ? domain
    : null;
}

const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "com.br", "com.cn", "com.tr", "co.za", "com.mx", "co.in",
  "gv.at", "co.at", "or.at", "com.pl", "com.es", "com.ar", "com.sg", "com.hk",
]);

/** Approximate registrable domain (eTLD+1) for comparisons. */
export function organizationalDomain(host: string | null): string | null {
  if (!host) return null;
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function sameOrganization(a: string | null, b: string | null): boolean {
  return organizationalDomain(a) === organizationalDomain(b);
}

// ---------------------------------------------------------------------------
// Punycode (RFC 3492, decode only) and lookalike detection

export function punycodeDecode(input: string): string | null {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  let n = 128, bias = 72, i = 0;
  const output: number[] = [];
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j += 1) {
    if (input.charCodeAt(j) >= 0x80) return null;
    output.push(input.charCodeAt(j));
  }
  const adapt = (delta: number, points: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i;
    for (let w = 1, k = base;; k += base) {
      if (index >= input.length) return null;
      const code = input.charCodeAt(index++);
      const digit = code - 48 < 10
        ? code - 22
        : code - 65 < 26
        ? code - 65
        : code - 97 < 26
        ? code - 97
        : base;
      if (digit >= base) return null;
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
      if (w > 0x7fffffff) return null;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Unicode form of a host (xn-- labels decoded). */
export function unicodeHost(host: string): string {
  return host.split(".").map((label) =>
    label.startsWith("xn--") ? punycodeDecode(label.slice(4)) ?? label : label
  ).join(".");
}

const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "һ": "h", "ӏ": "l",
  "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t", "ι": "i", "κ": "k",
  "ä": "a", "ö": "o", "ü": "u", "é": "e", "è": "e", "à": "a", "ç": "c",
  "0": "o", "1": "l", "3": "e", "5": "s", "@": "a", "$": "s",
};

/** Visual skeleton: confusable characters folded, rn→m, vv→w, i/l unified. */
export function skeleton(label: string): string {
  return Array.from(label.toLowerCase().normalize("NFC"))
    .map((character) => CONFUSABLES[character] ?? character)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/cl/g, "d")
    .replace(/[il|]/g, "l")
    .replace(/-/g, "");
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Frequently impersonated brands (registrable domains). */
export const DEFAULT_REFERENCE_DOMAINS = [
  "microsoft.com", "office.com", "outlook.com", "live.com", "microsoftonline.com",
  "sharepoint.com", "apple.com", "icloud.com", "google.com", "gmail.com",
  "paypal.com", "amazon.com", "netflix.com", "dhl.com", "post.ch", "postfinance.ch",
  "swisscom.ch", "sbb.ch", "ubs.com", "raiffeisen.ch", "zkb.ch", "twint.ch",
  "admin.ch", "docusign.net", "dropbox.com", "linkedin.com", "adobe.com",
];

/** Words too generic to count as an impersonated brand inside a host name. */
const GENERIC_LABELS = new Set([
  "office", "outlook", "admin", "login", "support", "mail", "secure", "account",
]);

export type LookalikeMatch = {
  reference: string;
  reason: "homoglyph" | "edit_distance" | "brand_in_subdomain";
};

/**
 * Whether `host` imitates one of the reference domains without being it.
 * Exact matches and subdomains of a reference are never lookalikes.
 */
export function detectLookalike(
  host: string,
  references: readonly string[],
  ownDomains: readonly string[] = [],
): LookalikeMatch | null {
  const ascii = host.toLowerCase().replace(/\.$/, "");
  const org = organizationalDomain(ascii);
  if (!org) return null;
  const unicodeOrg = unicodeHost(org);
  const label = unicodeOrg.split(".")[0] ?? "";
  for (const reference of references) {
    const refOrg = organizationalDomain(reference.toLowerCase());
    if (!refOrg) continue;
    if (org === refOrg) return null;
  }
  for (const reference of references) {
    const refOrg = organizationalDomain(reference.toLowerCase())!;
    const refLabel = refOrg.split(".")[0] ?? "";
    if (refLabel.length < 3) continue;
    if (label !== refLabel && skeleton(label) === skeleton(refLabel)) {
      return { reference: refOrg, reason: "homoglyph" };
    }
    if (
      label === refLabel && org !== refOrg && /^[a-z0-9-]+$/.test(label) &&
      refLabel.length >= 4 &&
      ownDomains.some((own) => organizationalDomain(own.toLowerCase()) === refOrg)
    ) {
      // Same name under another TLD (microsoft.co instead of microsoft.com).
      return { reference: refOrg, reason: "edit_distance" };
    }
    const distance = editDistance(skeleton(label), skeleton(refLabel));
    if (
      label !== refLabel &&
      ((refLabel.length >= 5 && distance === 1) ||
        (refLabel.length >= 9 && distance === 2))
    ) {
      return { reference: refOrg, reason: "edit_distance" };
    }
    // microsoft.com-login.xyz or login.paypal.secure-check.top
    const subdomainPart = ascii.slice(0, Math.max(0, ascii.length - org.length));
    const tokens = `${subdomainPart}${label}`.split(/[.-]/).filter(Boolean);
    if (
      refLabel.length >= 5 && !GENERIC_LABELS.has(refLabel) &&
      label !== refLabel && tokens.includes(refLabel)
    ) {
      return { reference: refOrg, reason: "brand_in_subdomain" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Header analysis

function authVerdict(value: string | undefined): AuthVerdict {
  const verdict = (value ?? "").toLowerCase();
  return (["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror"]
      .includes(verdict)
    ? verdict
    : verdict === "hardfail"
    ? "fail"
    : "unknown") as AuthVerdict;
}

const IPV4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/;
const IPV6 = /\[?(?:IPv6:)?((?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4})\]?/i;

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127);
}

function ipIn(text: string): string | null {
  const bracketed = /\[((?:IPv6:)?[0-9a-f:.]+)\]/i.exec(text);
  const candidate = bracketed?.[1]?.replace(/^IPv6:/i, "") ?? null;
  if (candidate && (IPV4.test(candidate) || candidate.includes(":"))) {
    return IPV4.exec(candidate)?.[1] ?? candidate.toLowerCase();
  }
  const v4 = IPV4.exec(text);
  if (v4) return v4[1]!;
  const v6 = IPV6.exec(text);
  return v6 && v6[1]!.split(":").length > 3 ? v6[1]!.toLowerCase() : null;
}

export function parseReceived(value: string): ReceivedHop {
  const fromMatch = /\bfrom\s+(.+?)(?=\s+by\s|\s+with\s|;|$)/i.exec(value);
  const byMatch = /\bby\s+([^\s;()]+)/i.exec(value);
  return {
    from: fromMatch ? fromMatch[1]!.trim().slice(0, 200) : null,
    by: byMatch ? byMatch[1]!.trim().slice(0, 200) : null,
    ip: fromMatch ? ipIn(fromMatch[1]!) : null,
  };
}

function finding(code: string, severity: Severity, message: string): Finding {
  return { code, severity, message };
}

export function analyzeHeaders(
  headers: MailHeader[],
  referenceDomains: readonly string[] = [],
): HeaderAnalysis {
  const from = parseAddress(header(headers, "from"));
  const returnPath = parseAddress(header(headers, "return-path")).address;
  const replyTo = parseAddress(header(headers, "reply-to")).address;
  const fromDomain = domainOf(from.address);
  const returnPathDomain = domainOf(returnPath);
  const replyToDomain = domainOf(replyTo);
  const messageId = header(headers, "message-id");

  // The topmost Authentication-Results header is the one added by the
  // receiving organisation; lower ones may be forged by the sender.
  const authHeaders = [
    ...headerAll(headers, "authentication-results"),
    ...headerAll(headers, "arc-authentication-results"),
  ];
  const firstMatch = (pattern: RegExp) => {
    for (const value of authHeaders) {
      const match = pattern.exec(value);
      if (match) return match[1];
    }
    return undefined;
  };
  let spf = authVerdict(firstMatch(/\bspf\s*=\s*([a-z]+)/i));
  if (spf === "unknown") {
    spf = authVerdict(/^\s*([a-z]+)/i.exec(header(headers, "received-spf") ?? "")?.[1]);
  }
  const dkim = authVerdict(firstMatch(/\bdkim\s*=\s*([a-z]+)/i));
  const dmarc = authVerdict(firstMatch(/\bdmarc\s*=\s*([a-z]+)/i));

  const received = headerAll(headers, "received").slice(0, 30).map(parseReceived);
  const authIp = firstMatch(/sender ip is\s+([0-9a-f:.]+)/i) ??
    firstMatch(/smtp\.remote-ip\s*=\s*([0-9a-f:.]+)/i) ??
    /client-ip\s*=\s*([0-9a-f:.]+)/i.exec(header(headers, "received-spf") ?? "")?.[1];
  const sendingIp = authIp ??
    received.map((hop) => hop.ip).find((ip): ip is string =>
      ip !== null && !isPrivateIp(ip)
    ) ??
    header(headers, "x-originating-ip")?.replace(/[[\]\s]/g, "") ?? null;

  const findings: Finding[] = [];
  if (fromDomain && returnPathDomain && !sameOrganization(fromDomain, returnPathDomain)) {
    findings.push(finding(
      "return_path_mismatch",
      "medium",
      `Absender-Domain (${fromDomain}) und Return-Path (${returnPathDomain}) unterscheiden sich.`,
    ));
  }
  if (replyToDomain && fromDomain && !sameOrganization(fromDomain, replyToDomain)) {
    findings.push(finding(
      "reply_to_mismatch",
      "high",
      `Antworten gehen an eine andere Domain (${replyToDomain}) als der Absender (${fromDomain}).`,
    ));
  }
  const nameAddress = from.name ? parseAddress(from.name).address : null;
  if (nameAddress && domainOf(nameAddress) && !sameOrganization(domainOf(nameAddress), fromDomain)) {
    findings.push(finding(
      "display_name_spoof",
      "high",
      `Der Anzeigename enthält die Adresse ${nameAddress}, gesendet wurde aber von ${from.address ?? "einer anderen Adresse"}.`,
    ));
  }
  if (fromDomain) {
    const lookalike = detectLookalike(
      fromDomain,
      [...referenceDomains, ...DEFAULT_REFERENCE_DOMAINS],
      referenceDomains,
    );
    if (lookalike) {
      findings.push(finding(
        "sender_lookalike",
        "high",
        `Die Absender-Domain ${unicodeHost(fromDomain)} ähnelt ${lookalike.reference}.`,
      ));
    }
    if (fromDomain.split(".").some((label) => label.startsWith("xn--"))) {
      findings.push(finding(
        "sender_punycode",
        "medium",
        `Die Absender-Domain enthält internationale Zeichen (${unicodeHost(fromDomain)}).`,
      ));
    }
  }
  const authFinding = (name: string, verdict: AuthVerdict, failSeverity: Severity) => {
    if (verdict === "fail" || verdict === "permerror") {
      findings.push(finding(`${name}_fail`, failSeverity, `${name.toUpperCase()}-Prüfung fehlgeschlagen (${verdict}).`));
    } else if (verdict === "softfail") {
      findings.push(finding(`${name}_softfail`, "medium", `${name.toUpperCase()}-Prüfung nur «softfail».`));
    } else if (verdict === "none" || verdict === "neutral") {
      findings.push(finding(`${name}_none`, "low", `Kein gültiges ${name.toUpperCase()}-Ergebnis (${verdict}).`));
    }
  };
  authFinding("spf", spf, "high");
  authFinding("dkim", dkim, "medium");
  authFinding("dmarc", dmarc, "high");
  if (authHeaders.length === 0 && received.length > 0) {
    findings.push(finding(
      "auth_results_missing",
      "info",
      "Keine Authentication-Results vorhanden (SPF/DKIM/DMARC nicht beurteilbar).",
    ));
  }
  if (received.length === 0) {
    findings.push(finding(
      "received_missing",
      "info",
      "Keine Received-Kopfzeilen vorhanden – der Übertragungsweg ist nicht nachvollziehbar.",
    ));
  }

  return {
    fromAddress: from.address,
    fromName: from.name,
    fromDomain,
    returnPath,
    returnPathDomain,
    replyTo,
    replyToDomain,
    subject: header(headers, "subject"),
    date: header(headers, "date"),
    messageId,
    auth: { spf, dkim, dmarc },
    received,
    sendingIp: sendingIp && (IPV4.test(sendingIp) || sendingIp.includes(":"))
      ? sendingIp
      : null,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Links

const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id",
  "lnkd.in", "bit.do", "shorte.st", "adf.ly", "v.gd", "qrco.de", "tr.im",
]);
const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "xyz", "top", "click", "country", "gq", "tk", "ml", "cf", "work",
  "support", "rest", "cam", "icu",
]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function hostOf(href: string): string | null {
  try {
    const url = new URL(href);
    return url.hostname ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function urlLikeHost(text: string): string | null {
  const value = text.trim();
  const explicit = /^(?:https?:\/\/|www\.)\S+/i.test(value);
  const bareDomain = /^(?:[a-z0-9\u00a1-\uffff-]+\.)+[a-z\u00a1-\uffff]{2,24}(?:[/:?#]\S*)?$/i.test(value);
  if (!explicit && !bareDomain) return null;
  return hostOf(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

export function analyzeLink(
  href: string,
  text: string | null,
  referenceDomains: readonly string[] = [],
): LinkInfo {
  const findings: Finding[] = [];
  const trimmed = href.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase() ?? null;
  if (scheme === "javascript" || scheme === "data" || scheme === "vbscript") {
    findings.push(finding("dangerous_scheme", "high", `Link mit Schema «${scheme}:».`));
    return { href: trimmed.slice(0, 500), text, host: null, findings };
  }
  const host = hostOf(trimmed);
  if (host) {
    try {
      const url = new URL(trimmed);
      if (url.username || url.password) {
        findings.push(finding(
          "userinfo_trick",
          "high",
          `Der Link enthält «@»: das eigentliche Ziel ist ${host}.`,
        ));
      }
      if (url.protocol === "http:") {
        findings.push(finding("insecure_http", "low", `Unverschlüsselter Link (http) zu ${host}.`));
      }
    } catch {
      // hostOf already validated the URL
    }
    if (IPV4.test(host) || host.startsWith("[")) {
      findings.push(finding("ip_host", "high", `Der Link zeigt direkt auf eine IP-Adresse (${host}).`));
    }
    if (URL_SHORTENERS.has(host) || URL_SHORTENERS.has(host.replace(/^www\./, ""))) {
      findings.push(finding("url_shortener", "medium", `Kurz-URL (${host}) verschleiert das Ziel.`));
    }
    if (host.split(".").some((label) => label.startsWith("xn--"))) {
      findings.push(finding(
        "punycode",
        "medium",
        `Internationale Domain: ${host} wird als «${unicodeHost(host)}» angezeigt.`,
      ));
    }
    const lookalike = detectLookalike(
      host,
      [...referenceDomains, ...DEFAULT_REFERENCE_DOMAINS],
      referenceDomains,
    );
    if (lookalike) {
      findings.push(finding(
        "lookalike_domain",
        lookalike.reason === "brand_in_subdomain" ? "medium" : "high",
        `${unicodeHost(host)} ähnelt ${lookalike.reference} (${
          lookalike.reason === "homoglyph"
            ? "verwechselbare Zeichen"
            : lookalike.reason === "brand_in_subdomain"
            ? "Markenname in fremder Domain"
            : "fast gleiche Schreibweise"
        }).`,
      ));
    }
    const tld = host.split(".").pop() ?? "";
    if (SUSPICIOUS_TLDS.has(tld)) {
      findings.push(finding("suspicious_tld", "low", `Häufig missbrauchte Endung «.${tld}».`));
    }
    if (text) {
      const shownHost = urlLikeHost(text);
      if (shownHost && !sameOrganization(shownHost, host)) {
        findings.push(finding(
          "text_href_mismatch",
          "high",
          `Angezeigt wird ${unicodeHost(shownHost)}, der Link führt aber zu ${unicodeHost(host)}.`,
        ));
      }
    }
  }
  return { href: trimmed.slice(0, 500), text: text ? text.slice(0, 200) : null, host, findings };
}

/** Links from the HTML (anchors with display text) and bare URLs in the text. */
export function extractLinks(
  html: string,
  text: string,
  referenceDomains: readonly string[] = [],
): LinkInfo[] {
  const links: LinkInfo[] = [];
  const seen = new Set<string>();
  const add = (href: string, display: string | null) => {
    const key = `${href}\u0000${display ?? ""}`;
    if (!href || seen.has(key) || links.length >= MAX_LINKS) return;
    seen.add(key);
    links.push(analyzeLink(href, display, referenceDomains));
  };
  const anchor =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.slice(0, MAX_TEXT).matchAll(anchor)) {
    const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!href || href.startsWith("#") || /^mailto:/i.test(href) || /^cid:/i.test(href)) {
      continue;
    }
    const display = stripTags(match[4] ?? "");
    add(href, display || null);
  }
  // Display texts of anchors are not links of their own.
  const htmlWithoutAnchors = html ? stripTags(html.slice(0, MAX_TEXT).replace(anchor, " ")) : "";
  const plain = `${text}\n${htmlWithoutAnchors}`.slice(0, MAX_TEXT);
  for (const match of plain.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "");
    const href = raw.toLowerCase().startsWith("www.") ? `http://${raw}` : raw;
    if ([...seen].some((key) => key.startsWith(`${href}\u0000`))) continue;
    add(href, null);
  }
  return links;
}

// ---------------------------------------------------------------------------
// Attachments

const HIGH_RISK_EXTENSIONS = new Set([
  "exe", "scr", "com", "pif", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js",
  "jse", "wsf", "wsh", "hta", "msi", "msix", "msp", "jar", "lnk", "iso", "img",
  "vhd", "vhdx", "dll", "reg", "cpl", "chm", "appx", "appxbundle", "scf", "url",
  "application", "gadget", "xll", "library-ms", "settingcontent-ms",
]);
const MEDIUM_RISK_EXTENSIONS = new Set([
  "html", "htm", "shtml", "xhtml", "svg", "docm", "xlsm", "pptm", "dotm",
  "xlam", "xlsb", "one", "onepkg", "zip", "rar", "7z", "gz", "tar", "cab", "ace",
  "arj", "r00", "uue", "xz", "z",
]);

export function analyzeAttachment(info: MailAttachmentInfo): AttachmentAnalysis {
  const findings: Finding[] = [];
  const name = info.filename.normalize("NFC");
  if (/[‪-‮⁦-⁩]/.test(name)) {
    findings.push(finding(
      "rtl_override",
      "high",
      `Der Dateiname «${name.replace(/[‪-‮⁦-⁩]/g, "")}» verwendet Steuerzeichen, um die Endung zu verschleiern.`,
    ));
  }
  const parts = name.toLowerCase().replace(/[‪-‮⁦-⁩]/g, "").split(".");
  const extension = parts.length > 1 ? parts[parts.length - 1]!.trim() : "";
  const previous = parts.length > 2 ? parts[parts.length - 2]!.trim() : "";
  if (HIGH_RISK_EXTENSIONS.has(extension)) {
    findings.push(finding("risky_extension", "high", `Ausführbarer Dateityp «.${extension}».`));
  } else if (MEDIUM_RISK_EXTENSIONS.has(extension)) {
    findings.push(finding(
      "risky_extension",
      "medium",
      `Dateityp «.${extension}» wird oft für Schadsoftware oder gefälschte Anmeldeseiten genutzt.`,
    ));
  }
  if (
    previous && /^(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt|rtf|csv)$/.test(previous) &&
    (HIGH_RISK_EXTENSIONS.has(extension) || MEDIUM_RISK_EXTENSIONS.has(extension))
  ) {
    findings.push(finding(
      "double_extension",
      "high",
      `Doppelte Endung «.${previous}.${extension}» täuscht einen harmlosen Dateityp vor.`,
    ));
  }
  return { ...info, filename: name.slice(0, 255), findings };
}

// ---------------------------------------------------------------------------
// Risk

const WEIGHT: Record<Severity, number> = { info: 0, low: 5, medium: 15, high: 35 };

export function riskScore(findings: readonly Finding[]): { score: number; level: RiskLevel } {
  // Each finding code counts once, so fifty identical links do not dominate.
  const byCode = new Map<string, Severity>();
  for (const entry of findings) {
    const current = byCode.get(entry.code);
    if (!current || WEIGHT[entry.severity] > WEIGHT[current]) {
      byCode.set(entry.code, entry.severity);
    }
  }
  const score = Math.min(100, [...byCode.values()].reduce((sum, severity) => sum + WEIGHT[severity], 0));
  return { score, level: score >= 60 ? "high" : score >= 25 ? "medium" : "low" };
}

/** Analyses one (already selected) original mail. */
export function analyzeMail(
  mail: ParsedMail,
  options: { source: PhishingSource; referenceDomains?: readonly string[] },
): PhishingAnalysis {
  const references = options.referenceDomains ?? [];
  const headers = analyzeHeaders(mail.headers, references);
  const links = extractLinks(mail.html, mail.text, references);
  const attachments = mail.attachments.slice(0, 50).map(analyzeAttachment);
  const findings = [
    ...headers.findings,
    ...links.flatMap((link) => link.findings),
    ...attachments.flatMap((attachment) => attachment.findings),
  ];
  return { source: options.source, headers, links, attachments, findings, ...riskScore(findings) };
}

/**
 * Picks the reported original from what the person submitted: an attached
 * .eml, otherwise an inline forward, otherwise the message itself.
 */
export function selectOriginal(
  mail: ParsedMail,
  outerSource: PhishingSource,
  options: { preferInline: boolean },
): { mail: ParsedMail; source: PhishingSource } {
  const attached = forwardedOriginal(mail);
  if (attached) return { mail: attached, source: "eml" };
  if (options.preferInline) {
    const inline = parseInlineForward(mail.text || stripTags(mail.html));
    if (inline) {
      // Inline forwards keep the original's HTML (links) and attachments.
      return {
        mail: { ...inline, html: mail.html, attachments: mail.attachments },
        source: "inline_forward",
      };
    }
  }
  return { mail, source: outerSource };
}

/**
 * Pasted input: full source or headers when it starts with header lines,
 * otherwise a forwarded text (or plain text with links).
 */
export function parsePastedMail(input: string): { mail: ParsedMail; source: PhishingSource } {
  const text = input.replace(/^\uFEFF/, "").slice(0, 2_000_000);
  const firstLine = text.replace(/^\s+/, "").split(/\r?\n/, 1)[0] ?? "";
  if (
    /^(received|return-path|from|delivered-to|authentication-results|message-id|dkim-signature|x-[a-z0-9-]+|arc-[a-z-]+|date|subject|to|mime-version|content-type)\s*:/i
      .test(firstLine)
  ) {
    const mail = parseMime(text.replace(/^\s+/, ""));
    const hasBody = Boolean(mail.text || mail.html || mail.attachments.length);
    return selectOriginal(mail, hasBody ? "eml" : "headers", { preferInline: false });
  }
  const inline = parseInlineForward(text);
  if (inline) return { mail: inline, source: "inline_forward" };
  return { mail: { ...emptyMail(), text }, source: "text" };
}

// ---------------------------------------------------------------------------
// Summary for the ticket (internal note). Links are defanged.

export function defang(value: string): string {
  return value
    .replace(/^http/i, "hxxp")
    .replace(/\./g, "[.]")
    .replace(/@/g, "[@]");
}

/** Defangs every URL in a text so nothing in the ticket is clickable. */
export function defangText(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi, (url) => defang(url));
}

const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};

export function riskLevelLabel(level: RiskLevel): string {
  return LEVEL_LABEL[level];
}

const SOURCE_LABEL: Record<PhishingSource, string> = {
  eml: "E-Mail mit Kopfzeilen",
  msg: "Outlook-Datei (.msg)",
  headers: "nur Kopfzeilen",
  inline_forward: "weitergeleiteter Text (Kopfzeilen nicht verfügbar)",
  text: "Text ohne Kopfzeilen",
};

export function summaryText(
  analysis: PhishingAnalysis,
  extra: { previousReports?: number } = {},
): string {
  const h = analysis.headers;
  const lines: string[] = [
    "Automatische Phishing-Analyse (Links und Anhänge wurden nicht geöffnet)",
    `Risiko: ${LEVEL_LABEL[analysis.level]} (${analysis.score}/100) · Grundlage: ${SOURCE_LABEL[analysis.source]}`,
    "",
    `Absender: ${h.fromName ? `«${h.fromName}» ` : ""}${h.fromAddress ? defang(h.fromAddress) : "unbekannt"}`,
  ];
  if (h.returnPath) lines.push(`Return-Path: ${defang(h.returnPath)}`);
  if (h.replyTo) lines.push(`Reply-To: ${defang(h.replyTo)}`);
  if (h.subject) lines.push(`Betreff: ${h.subject.slice(0, 200)}`);
  if (h.date) lines.push(`Datum: ${h.date.slice(0, 80)}`);
  lines.push(
    `Authentifizierung: SPF ${h.auth.spf} · DKIM ${h.auth.dkim} · DMARC ${h.auth.dmarc}`,
    `Sende-IP: ${h.sendingIp ?? "unbekannt"} · Received-Kette: ${h.received.length} ${h.received.length === 1 ? "Station" : "Stationen"}`,
  );
  if (extra.previousReports && extra.previousReports > 0) {
    lines.push(`Dieselbe E-Mail wurde bereits ${extra.previousReports}× gemeldet.`);
  }
  const ordered = [...analysis.findings].sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]);
  const unique = ordered.filter((entry, index) =>
    ordered.findIndex((other) => other.message === entry.message) === index
  ).slice(0, 25);
  lines.push("", "Befunde:");
  if (unique.length === 0) lines.push("• Keine auffälligen Merkmale gefunden.");
  for (const entry of unique) {
    lines.push(`• [${entry.severity === "high" ? "hoch" : entry.severity === "medium" ? "mittel" : entry.severity === "low" ? "niedrig" : "Info"}] ${entry.message}`);
  }
  if (analysis.links.length) {
    lines.push("", `Links (${analysis.links.length}, entschärft):`);
    for (const link of analysis.links.slice(0, 15)) {
      const flags = link.findings.length ? ` – ${link.findings.map((item) => item.code).join(", ")}` : "";
      lines.push(`• ${defang(link.href).slice(0, 160)}${link.text ? ` (Text: «${link.text.slice(0, 60)}»)` : ""}${flags}`);
    }
  }
  if (analysis.attachments.length) {
    lines.push("", `Anhänge (${analysis.attachments.length}):`);
    for (const attachment of analysis.attachments.slice(0, 15)) {
      const flags = attachment.findings.length ? " – riskant" : "";
      lines.push(`• ${attachment.filename} (${attachment.contentType}, ${Math.round(attachment.size / 1024)} KB)${flags}`);
    }
  }
  if (h.received.length) {
    lines.push("", "Übertragungsweg (neueste zuerst):");
    for (const hop of h.received.slice(0, 8)) {
      lines.push(`• von ${hop.from ?? "?"} über ${hop.by ?? "?"}${hop.ip ? ` [${hop.ip}]` : ""}`.slice(0, 260));
    }
  }
  return lines.join("\n").slice(0, 20_000);
}

/** Compact, JSON-safe copy of the analysis for storage. */
export function storedAnalysis(analysis: PhishingAnalysis): Record<string, unknown> {
  return {
    source: analysis.source,
    score: analysis.score,
    level: analysis.level,
    headers: { ...analysis.headers, received: analysis.headers.received.slice(0, 15) },
    links: analysis.links.slice(0, 50),
    attachments: analysis.attachments.slice(0, 30),
    findings: analysis.findings.slice(0, 100),
  };
}
