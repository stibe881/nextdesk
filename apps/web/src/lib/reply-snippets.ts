// «Antwort-Bausteine»: placeholder resolution and the «/» picker logic of the
// reply composer. Pure functions without I/O.
//
// This file exists twice with identical content: apps/web/src/lib and
// mobile/lib (reply-snippets.ts). A web test keeps both copies identical.

export type ReplySnippet = {
  id: string;
  name: string;
  shortcut: string | null;
  body: string;
  departmentId: string | null;
  departmentName: string | null;
  personal: boolean;
  canEdit: boolean;
};

/** Values for the placeholders, taken from the ticket and the agent. */
export type SnippetContext = {
  requesterName: string | null;
  ticketNumber: string | null;
  subject: string | null;
  device: string | null;
  agentName: string | null;
  departmentName: string | null;
};

export const SNIPPET_PLACEHOLDERS: readonly {
  key: string;
  label: string;
}[] = [
  { key: "Vorname", label: "Vorname der anfragenden Person" },
  { key: "Nachname", label: "Nachname der anfragenden Person" },
  { key: "Name", label: "Vollständiger Name der anfragenden Person" },
  { key: "Ticketnummer", label: "Ticketnummer" },
  { key: "Betreff", label: "Betreff des Tickets" },
  { key: "Gerät", label: "Erstes verknüpftes Gerät" },
  { key: "Agent", label: "Ihr Name" },
  { key: "Abteilung", label: "Abteilung des Tickets" },
  { key: "Datum", label: "Heutiges Datum" },
];

export const MAX_SNIPPET_SHORTCUT_LENGTH = 40;
export const MAX_SNIPPET_NAME_LENGTH = 120;
export const MAX_SNIPPET_BODY_LENGTH = 10_000;
const SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Normalises a shortcut («/Gruss» → «gruss»); null when it is not valid. */
export function normalizeSnippetShortcut(value: string): string | null {
  const normalized = value.trim().replace(/^\/+/, "").toLowerCase();
  if (!normalized) return null;
  return SHORTCUT_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Splits a display name into first and last name. «Muster, Anna» is read as
 * «Nachname, Vorname»; otherwise the first word is the first name.
 */
export function splitPersonName(name: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return { firstName: "", lastName: "" };
  const comma = clean.indexOf(",");
  if (comma > 0) {
    const last = clean.slice(0, comma).trim();
    const first = clean.slice(comma + 1).trim();
    if (first && last) return { firstName: first, lastName: last };
  }
  const words = clean.split(" ");
  return {
    firstName: words[0] ?? "",
    lastName: words.slice(1).join(" "),
  };
}

/** Today in Swiss notation, e.g. 07.11.2026. */
export function formatSnippetDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function placeholderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue");
}

function placeholderValues(
  context: SnippetContext,
  today: Date,
): Map<string, string> {
  const name = (context.requesterName ?? "").replace(/\s+/g, " ").trim();
  const { firstName, lastName } = splitPersonName(name);
  const fullName = firstName && lastName ? `${firstName} ${lastName}` : name;
  const value = (text: string | null) => (text ?? "").trim();
  return new Map([
    ["vorname", firstName],
    ["nachname", lastName],
    ["name", fullName],
    ["ticketnummer", value(context.ticketNumber)],
    ["betreff", value(context.subject)],
    ["geraet", value(context.device)],
    ["agent", value(context.agentName)],
    ["abteilung", value(context.departmentName)],
    ["datum", formatSnippetDate(today)],
  ]);
}

/**
 * Replaces the placeholders ({Vorname}, {Ticketnummer} …, case-insensitive,
 * «Geraet» works too). Unknown placeholders stay as they are, so a typo is
 * visible before sending. An empty value also removes the space in front of
 * it when punctuation or the line end follows («Guten Tag {Vorname},» →
 * «Guten Tag,»).
 */
export function resolveSnippetPlaceholders(
  body: string,
  context: SnippetContext,
  today: Date = new Date(),
): string {
  const values = placeholderValues(context, today);
  return body.replace(
    /( ?)\{([^{}\n]{1,30})\}/g,
    (match, space: string, key: string, offset: number, whole: string) => {
      const resolved = values.get(placeholderKey(key));
      if (resolved === undefined) return match;
      if (resolved) return `${space}${resolved}`;
      const next = whole.charAt(offset + match.length);
      return next === "" || /[\s,.;:!?)]/.test(next) ? "" : space;
    },
  );
}

/** Placeholders in a body that the composer does not know. */
export function unknownSnippetPlaceholders(body: string): string[] {
  const known = new Set(
    SNIPPET_PLACEHOLDERS.map((placeholder) => placeholderKey(placeholder.key)),
  );
  const unknown: string[] = [];
  for (const match of body.matchAll(/\{([^{}\n]{1,30})\}/g)) {
    const key = match[1] ?? "";
    if (!known.has(placeholderKey(key)) && !unknown.includes(key)) {
      unknown.push(key);
    }
  }
  return unknown;
}

export type SnippetTrigger = { start: number; query: string };

/**
 * The «/» trigger in front of the caret: a slash at the start of the text or
 * after whitespace, followed by up to 40 letters, digits, «-» or «_».
 */
export function snippetTriggerAt(
  text: string,
  caret: number,
): SnippetTrigger | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /(^|\s)\/([\p{L}\p{N}_-]{0,40})$/u.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** Replaces the trigger («/gruss») with the resolved snippet text. */
export function insertSnippetAt(
  text: string,
  trigger: SnippetTrigger,
  caret: number,
  snippetText: string,
): { text: string; caret: number } {
  const end = Math.max(trigger.start, Math.min(caret, text.length));
  const next = `${text.slice(0, trigger.start)}${snippetText}${text.slice(end)}`;
  return { text: next, caret: trigger.start + snippetText.length };
}

function searchable(value: string): string {
  return value.toLocaleLowerCase("de-CH").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Snippets for the picker: only those without department or of the ticket's
 * department; shortcut matches first, then name and text matches. A personal
 * snippet comes before a shared one with the same shortcut.
 */
export function filterSnippets(
  snippets: readonly ReplySnippet[],
  query: string,
  departmentId: string | null,
  limit = 8,
): ReplySnippet[] {
  const needle = searchable(query.trim());
  const scored: { snippet: ReplySnippet; score: number }[] = [];
  for (const snippet of snippets) {
    if (
      snippet.departmentId !== null &&
      departmentId !== null &&
      snippet.departmentId !== departmentId
    ) {
      continue;
    }
    const shortcut = searchable(snippet.shortcut ?? "");
    const name = searchable(snippet.name);
    let score: number;
    if (!needle) score = 3;
    else if (shortcut === needle) score = 0;
    else if (shortcut.startsWith(needle)) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle)) score = 3;
    else if (shortcut.includes(needle)) score = 4;
    else if (searchable(snippet.body).includes(needle)) score = 5;
    else continue;
    scored.push({ snippet, score: score * 2 + (snippet.personal ? 0 : 1) });
  }
  return scored
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.snippet.name.localeCompare(right.snippet.name, "de-CH"),
    )
    .slice(0, limit)
    .map((entry) => entry.snippet);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max
    ? value
    : null;
}

/** Validates one snippet of the reply-snippets edge function. */
export function parseReplySnippet(value: unknown): ReplySnippet | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  const name = optionalText(value.name, MAX_SNIPPET_NAME_LENGTH);
  const body = optionalText(value.body, MAX_SNIPPET_BODY_LENGTH);
  if (!name || !body) return null;
  const shortcut =
    value.shortcut === null || value.shortcut === undefined
      ? null
      : typeof value.shortcut === "string"
        ? normalizeSnippetShortcut(value.shortcut)
        : null;
  return {
    id: value.id,
    name,
    shortcut,
    body,
    departmentId:
      typeof value.departmentId === "string" && value.departmentId
        ? value.departmentId
        : null,
    departmentName: optionalText(value.departmentName, 200),
    personal: value.personal === true,
    canEdit: value.canEdit === true,
  };
}

/** Validates the placeholder values of the edge function. */
export function parseSnippetContext(value: unknown): SnippetContext {
  const record = isRecord(value) ? value : {};
  const text = (entry: unknown) => optionalText(entry, 500);
  return {
    requesterName: text(record.requesterName),
    ticketNumber: text(record.ticketNumber),
    subject: text(record.subject),
    device: text(record.device),
    agentName: text(record.agentName),
    departmentName: text(record.departmentName),
  };
}

/** Parses `{ data: { snippets, context? } }`; invalid entries are dropped. */
export function parseSnippetResponse(value: unknown): {
  snippets: ReplySnippet[];
  context: SnippetContext;
  canManageShared: boolean;
} | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (!Array.isArray(data.snippets)) return null;
  return {
    snippets: data.snippets
      .map(parseReplySnippet)
      .filter((snippet): snippet is ReplySnippet => snippet !== null),
    context: parseSnippetContext(data.context),
    canManageShared: data.canManageShared === true,
  };
}
