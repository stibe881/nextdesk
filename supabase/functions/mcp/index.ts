// nextDesk-Connector nach dem Model Context Protocol (MCP) über HTTP.
//
// Anmeldung: OAuth 2.1 des Supabase-Auth-Servers. Der Client erhält ein
// normales Zugriffstoken der angemeldeten Person. Jede Aktion läuft mit diesem
// Token über dieselben Edge Functions und Zeilenregeln wie die Web-App und die
// App, es gibt keinen eigenen Rechtepfad. Ohne Token antwortet die Funktion mit
// 401 und dem Hinweis auf die Metadaten des Autorisierungsservers.

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const SERVER_INFO = { name: "nextdesk", version: "3.0.0" } as const;
const STATUS_KEYS = [
  "new",
  "in_progress",
  "waiting",
  "waiting_customer",
  "resolved",
  "closed",
];
const PRIORITY_KEYS = ["low", "normal", "high", "urgent"];
const BILLING_KINDS = ["internal", "billable", "goodwill"];
const RELATION_TYPES = [
  "relates_to",
  "duplicates",
  "blocks",
  "blocked_by",
  "parent",
  "child",
];
const EVENT_EQUIPMENT = [
  "ict_material",
  "internet_access",
  "sobe_network_access",
  "projector",
  "connections",
  "display",
  "audio",
  "videocall",
  "microphones",
  "screen",
  "reception_laptop",
];
const EVENT_REQUEST_STATUSES = [
  "planned",
  "in_preparation",
  "ready",
  "conducted",
  "completed",
];
const CONNECTOR_NOTE = "Erfasst über den nextDesk-Connector.";
/** Hinweise darauf, dass es um Software geht (herunterladen, installieren …). */
const SOFTWARE_WORDS =
  /herunterlad|download|install|programm|software|applikation|anwendung|\bapps?\b|lizenz|update|aktualisier|bekomm|beziehen|bestell|freischalt/i;
/** Allgemeiner Weg zu Software, wenn zum Programm selbst nichts dasteht. */
const SOFTWARE_FALLBACK_QUERIES = [
  "Unternehmensportal",
  "Company Portal",
  "Software installieren",
  "Software",
];
const STOP_WORDS = new Set([
  "wie",
  "was",
  "wer",
  "wo",
  "wann",
  "warum",
  "kann",
  "ich",
  "man",
  "mir",
  "mich",
  "mein",
  "meine",
  "meinen",
  "einen",
  "eine",
  "einem",
  "einer",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "und",
  "oder",
  "mit",
  "für",
  "von",
  "auf",
  "aus",
  "bei",
  "ist",
  "sind",
  "bitte",
  "habe",
  "hat",
  "nicht",
  "kein",
  "keine",
  "geht",
  "gibt",
  "funktioniert",
  "brauche",
  "möchte",
  "will",
  "soll",
  "muss",
  "darf",
  "neu",
  "neue",
  "neuen",
  "the",
  "how",
  "can",
]);

type Json = Record<string, unknown>;
type Config = { anonKey: string; supabaseUrl: string };
type Session = { token: string; userId: string };
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

class ToolError extends Error {}

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

function str(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = Array.from(text).length;
  return length >= min && length <= max && !text.includes("\u0000")
    ? text
    : null;
}

function clip(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  return Array.from(text).length > max
    ? `${Array.from(text).slice(0, max).join("")} …`
    : text;
}

function textResult(value: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(localizeOutput(value), null, 2) },
    ],
  };
}

// ---------------------------------------------------------------- Zugriff

function authHeaders(config: Config, session: Session): HeadersInit {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
}

async function callFunction(
  config: Config,
  session: Session,
  name: string,
  body: Json,
): Promise<Json> {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: authHeaders(config, session),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : `http_${response.status}`;
    // Einige Funktionen liefern eine verständliche Meldung mit (z. B.
    // «Bitte eine Notiz zum Ergebnis erfassen.»); diese wird weitergegeben.
    const detail =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string"
        ? ` ${clip(payload.error.message, 300)}`
        : "";
    throw new ToolError(
      response.status === 403
        ? `Keine Berechtigung für diese Aktion (${code}).${detail}`
        : `Die Aktion war nicht möglich (${code}).${detail}`,
    );
  }
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ToolError("Die Antwort von nextDesk war unvollständig.");
  }
  return payload.data;
}

async function rest(
  config: Config,
  session: Session,
  table: string,
  params: Record<string, string>,
): Promise<Json[]> {
  // Leerzeichen werden als %20 kodiert (nicht als "+"), damit PostgREST sie
  // eindeutig als Leerzeichen liest.
  const query = Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}?${query}`,
    {
      headers: { ...authHeaders(config, session), Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new ToolError("Die Daten konnten nicht gelesen werden.");
  }
  return payload.filter(isRecord);
}

/** Datenbankfunktion unter der Identität der angemeldeten Person. */
async function rpcCall(
  config: Config,
  session: Session,
  name: string,
  args: Json,
): Promise<unknown> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...authHeaders(config, session), Accept: "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    throw new ToolError("Keine Berechtigung für diese Daten.");
  }
  if (!response.ok) {
    throw new ToolError("Die Daten konnten nicht gelesen werden.");
  }
  return payload;
}

const SECURITY_STATE_LABELS: Json = {
  triage: "zu beurteilen",
  actions: "Massnahmen",
  closed: "abgeschlossen",
};

type Workspace = { id: string; name: string; slug: string };

async function listWorkspaces(
  config: Config,
  session: Session,
): Promise<Workspace[]> {
  const rows = await rest(config, session, "tenant_memberships", {
    select: "tenant_id,tenants(id,name,slug)",
    status: "eq.active",
  });
  const result: Workspace[] = [];
  for (const row of rows) {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
    if (
      isRecord(tenant) &&
      isUuid(tenant.id) &&
      typeof tenant.name === "string" &&
      typeof tenant.slug === "string"
    ) {
      result.push({ id: tenant.id, name: tenant.name, slug: tenant.slug });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
}

async function resolveWorkspace(
  config: Config,
  session: Session,
  requested: unknown,
): Promise<Workspace> {
  const workspaces = await listWorkspaces(config, session);
  if (workspaces.length === 0) {
    throw new ToolError(
      "Für dieses Konto ist kein aktiver Arbeitsbereich verfügbar.",
    );
  }
  if (typeof requested === "string" && requested.trim()) {
    const needle = requested.trim().toLocaleLowerCase("de-CH");
    const match = workspaces.find(
      (workspace) =>
        workspace.id === needle ||
        workspace.slug.toLocaleLowerCase("de-CH") === needle ||
        workspace.name.toLocaleLowerCase("de-CH") === needle,
    );
    if (!match) {
      throw new ToolError(
        `Arbeitsbereich nicht gefunden. Verfügbar: ${workspaces.map((workspace) => workspace.slug).join(", ")}.`,
      );
    }
    return match;
  }
  if (workspaces.length === 1) return workspaces[0]!;
  throw new ToolError(
    `Mehrere Arbeitsbereiche verfügbar, bitte "arbeitsbereich" angeben: ${workspaces.map((workspace) => workspace.slug).join(", ")}.`,
  );
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1), max)
    : fallback;
}

/** Entfernt Zeichen, die in PostgREST-Filtern eine Sonderbedeutung haben. */
function filterText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[,()*%_\\"'`]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
    : "";
}

async function ticketIdFromReference(
  config: Config,
  session: Session,
  workspace: Workspace,
  reference: unknown,
): Promise<string> {
  const value = str(reference, 1, 64);
  if (!value) throw new ToolError('"ticket" fehlt (Ticketnummer oder ID).');
  if (UUID.test(value)) return value;
  const rows = await rest(config, session, "tickets", {
    select: "id",
    tenant_id: `eq.${workspace.id}`,
    ticket_number: `eq.${value.toUpperCase()}`,
    limit: "1",
  });
  const id = rows[0]?.id;
  if (!isUuid(id)) throw new ToolError("Ticket nicht gefunden.");
  return id;
}

async function ticketContext(
  config: Config,
  session: Session,
  args: Json,
): Promise<{ workspace: Workspace; ticketId: string }> {
  const workspace = await resolveWorkspace(
    config,
    session,
    args.arbeitsbereich,
  );
  const ticketId = await ticketIdFromReference(
    config,
    session,
    workspace,
    args.ticket,
  );
  return { workspace, ticketId };
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Liest Datum/Zeit flexibel ein und liefert ISO-8601 (UTC) oder null. */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Ticketnummern und Betreffe zu einer Liste von Ticket-IDs. */
async function ticketLabels(
  config: Config,
  session: Session,
  workspace: Workspace,
  ids: unknown[],
): Promise<Map<string, { number: unknown; subject: unknown }>> {
  const unique = [...new Set(ids.filter(isUuid))].slice(0, 100);
  if (unique.length === 0) return new Map();
  const rows = await rest(config, session, "tickets", {
    select: "id,ticket_number,subject",
    tenant_id: `eq.${workspace.id}`,
    id: `in.(${unique.join(",")})`,
  });
  return new Map(
    rows.map((row) => [
      String(row.id),
      { number: row.ticket_number, subject: row.subject },
    ]),
  );
}

function matches(query: string, ...values: unknown[]): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase("de-CH");
  return values.some(
    (value) =>
      typeof value === "string" &&
      value.toLocaleLowerCase("de-CH").includes(needle),
  );
}

function daysUntil(date: unknown): number | null {
  if (typeof date !== "string") return null;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed)
    ? Math.ceil((parsed - Date.now()) / 86_400_000)
    : null;
}

/** Sucht einen Eintrag nach ID oder (eindeutigem) Namen. */
function findByName(
  list: Json[],
  value: unknown,
  field: string,
  label: string,
): Json & { id: string } {
  const needle =
    typeof value === "string" ? value.trim().toLocaleLowerCase("de-CH") : "";
  if (!needle) throw new ToolError(`${label} fehlt.`);
  const exact = list.filter(
    (entry) =>
      String(entry.id).toLowerCase() === needle ||
      String(entry[field] ?? "").toLocaleLowerCase("de-CH") === needle,
  );
  const candidates = exact.length
    ? exact
    : list.filter((entry) =>
        String(entry[field] ?? "")
          .toLocaleLowerCase("de-CH")
          .includes(needle),
      );
  if (candidates.length === 1 && isUuid(candidates[0]!.id)) {
    return candidates[0] as Json & { id: string };
  }
  const names = (candidates.length ? candidates : list)
    .slice(0, 15)
    .map((entry) => entry[field])
    .join(", ");
  throw new ToolError(
    candidates.length
      ? `${label} ist nicht eindeutig: ${names}.`
      : `${label} nicht gefunden. Verfügbar: ${names}.`,
  );
}

function findRoom(rooms: Json[], value: unknown): Json & { id: string } {
  return findByName(rooms, value, "name", "Raum");
}

const zurichFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type LocalTime = [number, number, number, number, number, number];

const zurichLabelFormatter = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Termin lesbar in Schweizer Zeit, z. B. «Di., 24.11.2026, 09:00 – 10:00». */
function zurichLabel(occurrence: { startsAt: string; endsAt: string }): string {
  const end = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(occurrence.endsAt));
  return `${zurichLabelFormatter.format(new Date(occurrence.startsAt))} – ${end}`;
}

/** Kalenderteile eines Zeitpunkts in Zürcher Ortszeit (Monat 1-12). */
function zurichParts(ms: number): LocalTime {
  const parts = new Map<string, number>(
    zurichFormatter
      .formatToParts(new Date(ms))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const get = (key: string) => parts.get(key) ?? 0;
  return [
    get("year"),
    get("month"),
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  ];
}

/** Zürcher Ortszeit als UTC-Zeitpunkt, mit Sommerzeit. */
function zurichToUtc(local: LocalTime): number {
  const toUtc = ([y, mo, d, h, mi, se]: LocalTime) =>
    Date.UTC(y, mo - 1, d, h, mi, se);
  const wanted = toUtc(local);
  let guess = wanted;
  for (let step = 0; step < 3; step += 1) {
    guess += wanted - toUtc(zurichParts(guess));
  }
  return guess;
}

/**
 * Termine einer Serie: gleiche Zürcher Uhrzeit, wöchentlich (+7 Tage) oder
 * monatlich (gleicher Tag, am Monatsende gekürzt), wie es event-spaces prüft.
 */
export function seriesOccurrences(
  startsAt: string,
  endsAt: string,
  recurrence: "none" | "weekly" | "monthly",
  count: number,
): { startsAt: string; endsAt: string }[] {
  const start = Date.parse(startsAt);
  const duration = Date.parse(endsAt) - start;
  if (recurrence === "none") return [{ startsAt, endsAt }];
  const [year, month, day, hour, minute, second] = zurichParts(start);
  const result: { startsAt: string; endsAt: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    let local: LocalTime;
    if (recurrence === "weekly") {
      const date = new Date(Date.UTC(year, month - 1, day + index * 7));
      local = [
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        minute,
        second,
      ];
    } else {
      const absolute = year * 12 + (month - 1) + index;
      const targetYear = Math.floor(absolute / 12);
      const targetMonth = (absolute % 12) + 1;
      const lastDay = new Date(
        Date.UTC(targetYear, targetMonth, 0),
      ).getUTCDate();
      local = [
        targetYear,
        targetMonth,
        Math.min(day, lastDay),
        hour,
        minute,
        second,
      ];
    }
    const occurrenceStart = zurichToUtc(local);
    result.push({
      startsAt: new Date(occurrenceStart).toISOString(),
      endsAt: new Date(occurrenceStart + duration).toISOString(),
    });
  }
  return result;
}

/** Liest alle Seiten der Raumplanung (je 250 Buchungen, höchstens 8 Seiten). */
async function eventWorkspace(
  config: Config,
  session: Session,
  workspace: Workspace,
): Promise<{ rooms: Json[]; requests: Json[]; complete: boolean }> {
  const requests: Json[] = [];
  let rooms: Json[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < 8 && offset !== null; page += 1) {
    const data = await callFunction(config, session, "event-spaces", {
      type: "listWorkspace",
      tenantId: workspace.id,
      offset,
    });
    if (page === 0) rooms = records(data.rooms);
    requests.push(...records(data.requests));
    const pagination = isRecord(data.pagination) ? data.pagination : {};
    offset =
      pagination.hasMore === true && typeof pagination.nextOffset === "number"
        ? pagination.nextOffset
        : null;
  }
  return { rooms, requests, complete: offset === null };
}

/** Abteilung eines Tickets (über die Zeilenregeln der Person gelesen). */
async function ticketDepartmentId(
  config: Config,
  session: Session,
  workspace: Workspace,
  ticketId: string,
): Promise<string> {
  const rows = await rest(config, session, "tickets", {
    select: "department_id",
    tenant_id: `eq.${workspace.id}`,
    id: `eq.${ticketId}`,
    limit: "1",
  });
  const id = rows[0]?.department_id;
  if (!isUuid(id)) throw new ToolError("Ticket nicht gefunden.");
  return id;
}

/** Abteilungen, in denen die Person Tickets erfassen kann. */
async function formDepartments(
  config: Config,
  session: Session,
  workspace: Workspace,
): Promise<{ departments: Json[]; currentRequester: Json | null }> {
  const options = await callFunction(config, session, "ticket-actions", {
    type: "getFormOptions",
    tenantId: workspace.id,
  });
  return {
    departments: records(options.departments),
    currentRequester: isRecord(options.currentRequester)
      ? options.currentRequester
      : null,
  };
}

/** Kompakte Darstellung einer Serviceaufgabe aus getOccurrence/updateOccurrence. */
function serviceTaskDetail(data: Json): Json {
  const occurrence = isRecord(data.occurrence) ? data.occurrence : {};
  return {
    id: occurrence.id,
    title: occurrence.title,
    status: occurrence.status,
    dueAt: occurrence.dueAt,
    overdue: occurrence.overdue === true,
    assignee: isRecord(occurrence.assignee) ? occurrence.assignee.name : null,
    instructions: clip(occurrence.instructions, 3000) || null,
    requireNote: occurrence.requireNote === true,
    note: occurrence.note ?? null,
    checklist: records(occurrence.checklist).map((item) => ({
      id: item.id,
      label: item.label,
      done: item.done === true,
    })),
    nextDueOn: data.nextDueOn ?? null,
  };
}

function validQuantity(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1e9 ||
    Math.round(value * 1000) !== value * 1000
  ) {
    throw new ToolError(
      '"menge" muss eine positive Zahl mit höchstens 3 Nachkommastellen sein.',
    );
  }
  return value;
}

/** Artikel und Lagerorte für Namensauflösung (Name, Nummer/Code oder ID). */
async function inventoryRefs(
  config: Config,
  session: Session,
  workspace: Workspace,
) {
  const data = await callFunction(config, session, "inventory", {
    type: "workspace",
    tenantId: workspace.id,
  });
  const items = records(data.items).filter((entry) => entry.active !== false);
  const locations = records(data.locations).filter(
    (entry) => entry.active !== false,
  );
  const byCode = (list: Json[], key: string, value: unknown) =>
    typeof value === "string"
      ? list.filter(
          (entry) =>
            typeof entry[key] === "string" &&
            String(entry[key]).toLowerCase() === value.trim().toLowerCase(),
        )
      : [];
  return {
    item: (value: unknown) => {
      const exact = byCode(items, "articleNumber", value);
      return exact.length === 1
        ? (exact[0] as Json & { id: string })
        : findByName(items, value, "name", "Artikel");
    },
    location: (value: unknown) => {
      const exact = byCode(locations, "code", value);
      return exact.length === 1
        ? (exact[0] as Json & { id: string })
        : findByName(locations, value, "name", "Lagerort");
    },
  };
}

const CONFIRM_PROPERTY = {
  type: "boolean",
  description:
    "Erst true, wenn die Person den Entwurf geprüft und das Abschicken ausdrücklich bestätigt hat.",
};

/** Ausgefülltes Formular, das die Person vor dem Abschicken prüft. */
function draftResult(
  template: string,
  fields: Json,
  open: (string | false | null | undefined)[] = [],
): ToolResult {
  const missing = open.filter((entry): entry is string => Boolean(entry));
  return textResult({
    draft: true,
    template,
    fields,
    ...(missing.length ? { optionalNotFilled: missing } : {}),
    next: "Zeige der Person dieses Formular, ergänze oder korrigiere Angaben nach ihren Wünschen und schicke erst nach ihrer ausdrücklichen Bestätigung mit denselben Angaben und bestaetigt=true ab.",
  });
}

// ---------------------------------------------------------------- Werkzeuge

type Tool = {
  annotations: Json;
  description: string;
  inputSchema: Json;
  name: string;
  run: (config: Config, session: Session, args: Json) => Promise<ToolResult>;
};

const WORKSPACE_PROPERTY = {
  type: "string",
  description:
    "Arbeitsbereich (Kürzel oder Name). Nur nötig, wenn das Konto mehrere hat.",
};

const TICKET_PROPERTY = {
  type: "string",
  description: "Ticketnummer (z. B. ICT-2026-000011) oder ID.",
};

const TOOLS: Tool[] = [
  {
    name: "arbeitsbereiche_anzeigen",
    description:
      "Listet die Arbeitsbereiche (Mandanten), auf die du Zugriff hast.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Arbeitsbereiche" },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: async (config, session) =>
      textResult({ workspaces: await listWorkspaces(config, session) }),
  },
  {
    name: "tickets_suchen",
    description:
      "Sucht Tickets. bereich: mine (mir zugewiesen), open (offen, Standard), unassigned (nicht zugewiesen), all.",
    annotations: { readOnlyHint: true, title: "Tickets suchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Suchtext in Nummer, Betreff oder Beschreibung.",
        },
        bereich: {
          type: "string",
          enum: ["mine", "open", "unassigned", "all"],
        },
        max_anzahl: { type: "integer", minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const scope = typeof args.bereich === "string" ? args.bereich : "open";
      if (!["mine", "open", "unassigned", "all"].includes(scope)) {
        throw new ToolError("Ungültiger bereich.");
      }
      const [statuses, priorities] = await Promise.all([
        rest(config, session, "ticket_statuses", {
          select: "id,label,is_closed",
          tenant_id: `eq.${workspace.id}`,
        }),
        rest(config, session, "ticket_priorities", {
          select: "id,label",
          tenant_id: `eq.${workspace.id}`,
        }),
      ]);
      const params: Record<string, string> = {
        select:
          "id,ticket_number,subject,status_id,priority_id,assigned_agent_id,created_at,updated_at",
        tenant_id: `eq.${workspace.id}`,
        order: "updated_at.desc",
        limit: String(clampLimit(args.max_anzahl, 10, 25)),
      };
      if (scope === "mine") params.assigned_agent_id = `eq.${session.userId}`;
      if (scope === "unassigned") params.assigned_agent_id = "is.null";
      if (scope === "open" || scope === "unassigned") {
        const closed = statuses
          .filter((status) => status.is_closed === true)
          .map((status) => String(status.id))
          .filter(isUuid);
        if (closed.length > 0)
          params.status_id = `not.in.(${closed.join(",")})`;
      }
      const text = filterText(args.suchbegriff);
      if (text) {
        params.or = `(subject.ilike.*${text}*,ticket_number.ilike.*${text}*,description.ilike.*${text}*)`;
      }
      const rows = await rest(config, session, "tickets", params);
      const statusLabel = new Map(statuses.map((s) => [s.id, s.label]));
      const priorityLabel = new Map(priorities.map((p) => [p.id, p.label]));
      return textResult({
        workspace: workspace.slug,
        count: rows.length,
        tickets: rows.map((ticket) => ({
          number: ticket.ticket_number,
          subject: ticket.subject,
          status: statusLabel.get(ticket.status_id) ?? null,
          priority: priorityLabel.get(ticket.priority_id) ?? null,
          assignedToMe: ticket.assigned_agent_id === session.userId,
          unassigned: ticket.assigned_agent_id === null,
          updatedAt: ticket.updated_at,
        })),
      });
    },
  },
  {
    name: "ticket_anzeigen",
    description:
      "Zeigt ein Ticket mit Beschreibung und Verlauf. ticket: Ticketnummer (z. B. ICT-2026-000011) oder ID.",
    annotations: { readOnlyHint: true, title: "Ticket anzeigen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: { type: "string" },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.ticket,
      );
      const data = await callFunction(config, session, "ticket-operations", {
        type: "getTicket",
        tenantId: workspace.id,
        ticketId,
      });
      const ticket = isRecord(data.ticket) ? data.ticket : null;
      if (!ticket) throw new ToolError("Ticket nicht verfügbar.");
      const label = (list: unknown, id: unknown) =>
        Array.isArray(list)
          ? ((
              list.find((entry) => isRecord(entry) && entry.id === id) as
                Json | undefined
            )?.label ?? null)
          : null;
      const requester = isRecord(data.requesterContact)
        ? data.requesterContact
        : null;
      const comments = Array.isArray(data.comments)
        ? data.comments.filter(isRecord)
        : [];
      const agent = isRecord(data.assignedAgent) ? data.assignedAgent : null;
      const timeEntries = records(data.timeEntries);
      return textResult({
        number: ticket.ticket_number,
        subject: ticket.subject,
        description: clip(ticket.description, 4000),
        status: label(data.statuses, ticket.status_id),
        priority: label(data.priorities, ticket.priority_id),
        requester: requester?.displayName ?? null,
        requesterId: requester?.id ?? null,
        assignedAgent: agent?.displayName ?? null,
        assignedToMe: ticket.assigned_agent_id === session.userId,
        watching: data.watching === true,
        createdAt: ticket.created_at,
        resolvedAt: ticket.resolved_at ?? null,
        checklist: records(data.checklistItems).map((item) => ({
          id: item.id,
          description: item.description,
          done: item.completed_at !== null && item.completed_at !== undefined,
        })),
        trackedMinutes: timeEntries.reduce(
          (sum, entry) =>
            sum + (typeof entry.minutes === "number" ? entry.minutes : 0),
          0,
        ),
        openEscalations: records(data.escalations).filter(
          (entry) => !entry.resolved_at,
        ).length,
        relations: records(data.relations).map((relation) => ({
          type: relation.relationType,
          number: relation.ticketNumber,
          subject: relation.subject,
          status: relation.statusLabel ?? null,
        })),
        comments: comments.slice(-20).map((comment) => ({
          author: comment.authorName ?? comment.author_name ?? null,
          visibility: comment.visibility ?? null,
          createdAt: comment.createdAt ?? comment.created_at ?? null,
          body: clip(comment.body, 2000),
        })),
      });
    },
  },
  {
    name: "wissen_suchen",
    description:
      "Durchsucht die Wissensdatenbank (Anleitungen und Lösungen der eigenen Organisation). Bei jeder IT-Frage zuerst verwenden, z. B. «Wie installiere ich Visio?», «VPN verbindet nicht», «Drucker einrichten». suchbegriff: Stichwörter wie «Visio» oder «VPN». Gibt es zu einem Programm keinen eigenen Artikel, sucht das Werkzeug selbst nach dem allgemeinen Weg (z. B. Unternehmensportal). Den vollen Text liefert wissensartikel_lesen.",
    annotations: { readOnlyHint: true, title: "Wissen durchsuchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Stichwörter, z. B. «Visio installieren».",
        },
        max_anzahl: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["suchbegriff"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const query = str(args.suchbegriff, 1, 120);
      if (!query) throw new ToolError('"suchbegriff" fehlt.');
      const search = async (text: string) =>
        records(
          (
            await callFunction(config, session, "knowledge-base", {
              type: "listArticles",
              tenantId: workspace.id,
              query: text,
            })
          ).articles,
        );
      let articles = await search(query);
      let searchedFor = [query];
      // Ganze Fragen finden oft nichts; dann einzeln nach den
      // aussagekräftigen Stichwörtern suchen (längste zuerst).
      if (articles.length === 0) {
        const words = [
          ...new Set(
            query
              .toLocaleLowerCase("de-CH")
              .split(/[^\p{L}\p{N}]+/u)
              .filter(
                (word) => Array.from(word).length >= 3 && !STOP_WORDS.has(word),
              ),
          ),
        ]
          .sort((a, b) => b.length - a.length)
          .slice(0, 4);
        if (words.length > 0) {
          searchedFor = words;
          const seen = new Set<unknown>();
          for (const list of await Promise.all(words.map(search))) {
            for (const article of list) {
              if (!seen.has(article.id)) {
                seen.add(article.id);
                articles.push(article);
              }
            }
          }
        }
      }
      // Zu einem bestimmten Programm gibt es oft keinen eigenen Artikel,
      // wohl aber eine Anleitung für den allgemeinen Weg (z. B. den Artikel
      // «Unternehmensportal»). Dann diese anbieten.
      let generalMatch = false;
      if (articles.length === 0 && SOFTWARE_WORDS.test(query)) {
        for (const fallback of SOFTWARE_FALLBACK_QUERIES) {
          articles = await search(fallback);
          if (articles.length > 0) {
            searchedFor = [...searchedFor, fallback];
            generalMatch = true;
            break;
          }
        }
      }
      articles = articles.slice(0, clampLimit(args.max_anzahl, 8, 20));
      return textResult({
        count: articles.length,
        searchedFor,
        ...(generalMatch
          ? {
              note: "Zum genannten Programm gibt es keinen eigenen Artikel. Diese Artikel beschreiben den allgemeinen Weg, Software zu beziehen; mit wissensartikel_lesen lesen und der Person danach erklären.",
            }
          : {}),
        articles: articles.map((article) => {
          const revision = isRecord(article.revision) ? article.revision : {};
          return {
            id: article.id,
            title: article.title,
            summary: clip(article.summary ?? revision.summary, 300) || null,
            excerpt: clip(revision.body, 600) || null,
            updatedAt: article.updated_at ?? article.updatedAt ?? null,
          };
        }),
        ...(articles.length === 0
          ? {
              hint: "Nichts gefunden. Keine allgemeine Anleitung erfinden; shop_katalog_anzeigen prüfen oder anbieten, ein Ticket zu erfassen.",
            }
          : {}),
      });
    },
  },
  {
    name: "wissensartikel_lesen",
    description: "Liest einen Wissensartikel (id aus wissen_suchen).",
    annotations: { readOnlyHint: true, title: "Wissensartikel lesen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const data = await callFunction(config, session, "knowledge-base", {
        type: "getArticle",
        tenantId: workspace.id,
        articleId: args.id,
      });
      const article = isRecord(data.article) ? data.article : null;
      const revision = isRecord(data.revision) ? data.revision : null;
      if (!article || !revision)
        throw new ToolError("Artikel nicht verfügbar.");
      return textResult({
        title: article.title,
        body: clip(revision.body, 12000),
      });
    },
  },
  {
    name: "geraet_suchen",
    description:
      "Sucht Geräte (Assets) nach Name, Inventarnummer, Asset-Tag oder Seriennummer.",
    annotations: { readOnlyHint: true, title: "Gerät suchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: { type: "string" },
        max_anzahl: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["suchbegriff"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const query = str(args.suchbegriff, 1, 120);
      if (!query) throw new ToolError('"suchbegriff" fehlt.');
      const data = await callFunction(config, session, "asset-registry", {
        type: "listAssets",
        tenantId: workspace.id,
        query,
      });
      const assets = Array.isArray(data.assets)
        ? data.assets.filter(isRecord)
        : [];
      return textResult({
        count: assets.length,
        assets: assets
          .slice(0, clampLimit(args.max_anzahl, 10, 20))
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            assetTag: asset.asset_tag ?? asset.assetTag ?? null,
            inventoryNumber:
              asset.inventory_number ?? asset.inventoryNumber ?? null,
            serialNumber: asset.serial_number ?? asset.serialNumber ?? null,
            manufacturer: asset.manufacturer ?? null,
            model: asset.model ?? null,
            kind: asset.kind ?? null,
            lifecycleState:
              asset.lifecycle_state ?? asset.lifecycleState ?? null,
          })),
      });
    },
  },
  {
    name: "ticket_erfassen",
    description:
      "Erfasst ein neues Ticket, für dich selbst oder für eine anfragende Person (anfragende_person aus anfragende_suchen). Frage vorher nach, ob das Ticket wirklich erfasst werden soll. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        betreff: { type: "string", minLength: 3, maxLength: 240 },
        beschreibung: { type: "string", maxLength: 8000 },
        prioritaet: { type: "string", enum: PRIORITY_KEYS },
        abteilung: {
          type: "string",
          description: "Abteilung (Name). Standard: die erste.",
        },
        anfragende_person: {
          type: "string",
          description:
            "ID der anfragenden Person aus anfragende_suchen. Ohne Angabe wird das Ticket für dich selbst erfasst.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
        },
        vorlage: {
          type: "string",
          description:
            "Ticketvorlage (Name oder ID aus ticketvorlagen_anzeigen). Füllt Betreff, Beschreibung, Priorität und Checkliste, soweit nicht angegeben.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.betreff === undefined && args.vorlage === undefined) {
        throw new ToolError('Gib "betreff" oder eine Vorlage ("vorlage") an.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const { departments, currentRequester: requester } =
        await formDepartments(config, session, workspace);
      const requested =
        typeof args.abteilung === "string"
          ? args.abteilung.trim().toLocaleLowerCase("de-CH")
          : "";
      const department = requested
        ? departments.find(
            (entry) =>
              String(entry.name).toLocaleLowerCase("de-CH") === requested,
          )
        : departments[0];
      if (!department || !isUuid(department.id)) {
        throw new ToolError(
          `Abteilung nicht gefunden. Verfügbar: ${departments.map((entry) => entry.name).join(", ")}.`,
        );
      }
      if (
        args.anfragende_person !== undefined &&
        !isUuid(args.anfragende_person)
      ) {
        throw new ToolError(
          '"anfragende_person" ist ungültig (ID aus anfragende_suchen).',
        );
      }
      const requesterId = isUuid(args.anfragende_person)
        ? args.anfragende_person
        : requester && typeof requester.id === "string"
          ? requester.id
          : null;
      if (!requesterId) {
        throw new ToolError(
          "Für dein Konto ist keine anfragende Person hinterlegt. Gib anfragende_person an (anfragende_suchen).", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
        );
      }
      let template: Json | null = null;
      if (args.vorlage !== undefined) {
        const data = await callFunction(config, session, "ticket-actions", {
          type: "listAvailableTemplates",
          tenantId: workspace.id,
          departmentId: department.id,
        });
        template = findByName(
          records(data.templates),
          args.vorlage,
          "name",
          "Vorlage",
        );
      }
      // Platzhalter der Vorlage, soweit sie hier bekannt sind.
      const fill = (value: unknown) =>
        typeof value === "string"
          ? value
              .replaceAll("{{abteilung}}", String(department.name ?? ""))
              .replaceAll(
                "{{heute}}",
                new Intl.DateTimeFormat("de-CH", {
                  timeZone: "Europe/Zurich",
                }).format(new Date()),
              )
              .replaceAll(
                "{{anfragende_person}}",
                !isUuid(args.anfragende_person) && requester
                  ? String(requester.displayName ?? requester.name ?? "")
                  : "",
              )
          : "";
      const subject =
        args.betreff === undefined && template
          ? str(fill(template.subjectTemplate), 3, 240)
          : str(args.betreff, 3, 240);
      if (!subject)
        throw new ToolError('"betreff" muss 3 bis 240 Zeichen lang sein.');
      const description =
        typeof args.beschreibung === "string" && args.beschreibung.trim()
          ? clip(args.beschreibung.trim(), 8000)
          : template && fill(template.descriptionTemplate).trim()
            ? clip(fill(template.descriptionTemplate).trim(), 8000)
            : subject;
      const priority =
        typeof args.prioritaet === "string"
          ? args.prioritaet
          : template && typeof template.priorityKey === "string"
            ? template.priorityKey
            : "normal";
      if (args.bestaetigt !== true) {
        return draftResult(
          "Ticket erfassen",
          {
            arbeitsbereich: workspace.name,
            abteilung: department.name,
            anfragendePerson: isUuid(args.anfragende_person)
              ? args.anfragende_person
              : (requester?.displayName ?? "du selbst"), // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
            betreff: subject,
            beschreibung: clip(description, 2000),
            prioritaet: priority,
            vorlage: template?.name ?? null,
          },
          [
            args.beschreibung === undefined &&
              !template &&
              "beschreibung (sonst wird der Betreff verwendet)",
            args.prioritaet === undefined &&
              !template &&
              "prioritaet (Standard normal)",
            args.abteilung === undefined && "abteilung (Standard: erste)",
          ],
        );
      }
      const created = await callFunction(config, session, "ticket-actions", {
        type: "createTicket",
        tenantId: workspace.id,
        departmentId: department.id,
        priorityKey: priority,
        requesterContactId: requesterId,
        subject,
        description: `${description}\n\n${CONNECTOR_NOTE}`,
        ...(template ? { templateId: template.id } : {}),
      });
      return textResult({
        created: true,
        number: created.ticketNumber ?? null,
        workspace: workspace.slug,
      });
    },
  },
  {
    name: "interne_notiz_hinzufuegen",
    description:
      "Fügt einem Ticket eine interne Notiz hinzu (für Anfragende nicht sichtbar).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Interne Notiz",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        text: { type: "string", minLength: 1, maxLength: 8000 },
      },
      required: ["ticket", "text"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const text = str(args.text, 1, 8000);
      if (!text)
        throw new ToolError('"text" muss 1 bis 8000 Zeichen lang sein.');
      const ticketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.ticket,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "addComment",
        tenantId: workspace.id,
        ticketId,
        body: `${text}\n\n${CONNECTOR_NOTE}`,
        visibility: "internal",
      });
      return textResult({ added: true });
    },
  },
  {
    name: "ticketstatus_aendern",
    description:
      "Ändert den Status eines Ticketauftrags. Für resolved (gelöst) und closed (geschlossen) muss die Person vorher ausdrücklich zugestimmt haben; setze dann bestaetigt auf true. Anfragende werden dabei von nextDesk informiert.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticketstatus ändern",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        status: { type: "string", enum: STATUS_KEYS },
        bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person das Lösen oder Schliessen ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const status = typeof args.status === "string" ? args.status : "";
      if (!STATUS_KEYS.includes(status)) {
        throw new ToolError(
          `Ungültiger Status. Erlaubt: ${STATUS_KEYS.join(", ")}.`,
        );
      }
      const closing = status === "resolved" || status === "closed";
      if (closing && args.bestaetigt !== true) {
        throw new ToolError(
          "Das Lösen oder Schliessen braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      const ticketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.ticket,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "updateTicket",
        tenantId: workspace.id,
        ticketId,
        statusKey: status,
        ...(closing ? { confirmClose: true } : {}),
      });
      return textResult({ updated: true, status });
    },
  },
  {
    name: "ticket_mir_zuweisen",
    description:
      "Weist ein Ticket dir selbst (der angemeldeten Person) zu. Das Zuweisen an andere Personen ist nicht möglich.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket mir zuweisen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.ticket,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "updateTicket",
        tenantId: workspace.id,
        ticketId,
        assignedAgentId: session.userId,
      });
      return textResult({ assigned: true });
    },
  },
  {
    name: "ticket_beantworten",
    description:
      "Antwortet im Ticket an die anfragende Person. Der Text ist für sie sichtbar und wird ihr in der Regel per E-Mail zugestellt. Zeige der Person den Text vorher und setze bestaetigt erst nach ihrer ausdrücklichen Zustimmung auf true. Für interne Hinweise interne_notiz_hinzufuegen verwenden. Ohne bestaetigt zeigt das Werkzeug zuerst den Entwurf.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Auf Ticket antworten",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        text: { type: "string", minLength: 1, maxLength: 8000 },
        bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person den Wortlaut ausdrücklich freigegeben hat.",
        },
      },
      required: ["ticket", "text"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const text = str(args.text, 1, 8000);
      if (!text)
        throw new ToolError('"text" muss 1 bis 8000 Zeichen lang sein.');
      const ticketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.ticket,
      );
      if (args.bestaetigt !== true) {
        return draftResult("Antwort an anfragende Person", {
          ticket: args.ticket,
          sichtbarFuer: "anfragende Person (in der Regel per E-Mail)",
          text,
        });
      }
      await callFunction(config, session, "ticket-operations", {
        type: "addComment",
        tenantId: workspace.id,
        ticketId,
        body: text,
        visibility: "external",
      });
      return textResult({ replied: true });
    },
  },
  {
    name: "prioritaet_aendern",
    description: "Ändert die Priorität eines Tickets.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Ticketpriorität ändern",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        prioritaet: { type: "string", enum: PRIORITY_KEYS },
      },
      required: ["ticket", "prioritaet"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const priority =
        typeof args.prioritaet === "string" ? args.prioritaet : "";
      if (!PRIORITY_KEYS.includes(priority)) {
        throw new ToolError(
          `Ungültige Priorität. Erlaubt: ${PRIORITY_KEYS.join(", ")}.`,
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "updateTicket",
        tenantId: workspace.id,
        ticketId,
        priorityKey: priority,
      });
      return textResult({ updated: true, priority });
    },
  },
  {
    name: "zeit_erfassen",
    description:
      "Erfasst Arbeitszeit auf einem Ticket (in Minuten). verrechnung: intern (Standard), verrechenbar oder kulanz.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Zeit erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        minuten: { type: "integer", minimum: 1, maximum: 1440 },
        verrechnung: { type: "string", enum: BILLING_KINDS },
        notiz: { type: "string", maxLength: 2900 },
      },
      required: ["ticket", "minuten"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const minutes = args.minuten;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 1440
      ) {
        throw new ToolError(
          '"minuten" muss eine ganze Zahl von 1 bis 1440 sein.',
        );
      }
      const billing =
        typeof args.verrechnung === "string" ? args.verrechnung : "internal";
      if (!BILLING_KINDS.includes(billing)) {
        throw new ToolError(
          `Ungültige Verrechnungsart. Erlaubt: ${BILLING_KINDS.join(", ")}.`,
        );
      }
      const note = args.notiz === undefined ? null : str(args.notiz, 1, 2900);
      if (args.notiz !== undefined && !note) {
        throw new ToolError('"notiz" muss 1 bis 2900 Zeichen lang sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "addTimeEntry",
        tenantId: workspace.id,
        ticketId,
        minutes,
        billingKind: billing,
        note: note ? `${note}\n${CONNECTOR_NOTE}` : CONNECTOR_NOTE,
      });
      return textResult({ added: true, minutes, billing });
    },
  },
  {
    name: "checklistenpunkt_hinzufuegen",
    description: "Fügt der Checkliste eines Tickets einen Punkt hinzu.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Checklistenpunkt hinzufügen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        text: { type: "string", minLength: 1, maxLength: 1000 },
      },
      required: ["ticket", "text"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const text = str(args.text, 1, 1000);
      if (!text)
        throw new ToolError('"text" muss 1 bis 1000 Zeichen lang sein.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "addChecklistItem",
        tenantId: workspace.id,
        ticketId,
        description: text,
      });
      return textResult({ added: true });
    },
  },
  {
    name: "checklistenpunkt_abhaken",
    description:
      "Hakt einen Checklistenpunkt eines Tickets ab oder öffnet ihn wieder. punkt: id aus ticket_anzeigen (checkliste).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Checklistenpunkt abhaken",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        punkt: { type: "string", description: "ID des Checklistenpunkts." },
        erledigt: { type: "boolean", description: "Standard: true." },
      },
      required: ["ticket", "punkt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.punkt)) throw new ToolError('"punkt" ist ungültig.');
      if (args.erledigt !== undefined && typeof args.erledigt !== "boolean") {
        throw new ToolError('"erledigt" muss true oder false sein.');
      }
      const done = args.erledigt !== false;
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "toggleChecklistItem",
        tenantId: workspace.id,
        ticketId,
        itemId: args.punkt,
        completed: done,
      });
      return textResult({ updated: true, done });
    },
  },
  {
    name: "ticket_beobachten",
    description:
      "Beobachtet ein Ticket (Benachrichtigungen bei Änderungen) oder beendet das Beobachten.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Ticket beobachten",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        beobachten: { type: "boolean", description: "Standard: true." },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        args.beobachten !== undefined &&
        typeof args.beobachten !== "boolean"
      ) {
        throw new ToolError('"beobachten" muss true oder false sein.');
      }
      const watching = args.beobachten !== false;
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "toggleWatch",
        tenantId: workspace.id,
        ticketId,
        watching,
      });
      return textResult({ watching });
    },
  },
  {
    name: "ueberall_suchen",
    description:
      "Durchsucht den Arbeitsbereich gleichzeitig nach Tickets, Wiedervorlagen, Wissensartikeln, Veranstaltungsräumen und Eintritten; für das zuständige Team auch nach Störungen und Sicherheitsfällen.",
    annotations: { readOnlyHint: true, title: "Überall suchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: { type: "string", minLength: 2, maxLength: 120 },
        max_anzahl: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["suchbegriff"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const query = str(args.suchbegriff, 2, 120);
      if (!query)
        throw new ToolError('"suchbegriff" muss 2 bis 120 Zeichen lang sein.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "global-search", {
        type: "search",
        tenantId: workspace.id,
        query,
      });
      const results = Array.isArray(data.results)
        ? data.results.filter(isRecord)
        : [];
      return textResult({
        count: results.length,
        results: results
          .slice(0, clampLimit(args.max_anzahl, 15, 30))
          .map((result) => ({
            section: result.section,
            type: result.resultType,
            id: result.entityId,
            title: result.title,
            detail: clip(result.detail, 200),
          })),
      });
    },
  },
  {
    name: "benachrichtigungen_anzeigen",
    description: "Listet deine nextDesk-Benachrichtigungen (neueste zuerst).", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Benachrichtigungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_ungelesene: { type: "boolean", description: "Standard: true." },
        max_anzahl: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "notification-center", {
        type: "list",
        tenantId: workspace.id,
        unreadOnly: args.nur_ungelesene !== false,
        limit: clampLimit(args.max_anzahl, 20, 50),
      });
      const notifications = Array.isArray(data.notifications)
        ? data.notifications.filter(isRecord)
        : [];
      return textResult({
        count: notifications.length,
        notifications: notifications.map((notification) => {
          const ticket = isRecord(notification.ticket)
            ? notification.ticket
            : null;
          return {
            id: notification.id,
            kind: notification.kind,
            read: notification.readAt !== null,
            createdAt: notification.createdAt,
            ticket: ticket
              ? { number: ticket.ticketNumber, subject: ticket.subject }
              : null,
            details: notification.payload ?? null,
          };
        }),
      });
    },
  },
  {
    name: "benachrichtigungen_gelesen",
    description:
      "Markiert eine Benachrichtigung (id aus benachrichtigungen_anzeigen) oder ohne id alle Benachrichtigungen des Arbeitsbereichs als gelesen.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Benachrichtigungen gelesen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        id: { type: "string", description: "Einzelne Benachrichtigung." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.id !== undefined) {
        if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
        await callFunction(config, session, "notification-center", {
          type: "markRead",
          notificationId: args.id,
        });
        return textResult({ marked: 1 });
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "notification-center", {
        type: "markAllRead",
        tenantId: workspace.id,
      });
      return textResult({ marked: data.markedReadCount ?? null });
    },
  },
  {
    name: "offene_freigaben_anzeigen",
    description:
      "Listet Ticketfreigaben, die auf deinen Entscheid warten (Genehmigungseingang).", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Offene Freigaben" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ticket-approvals", {
        type: "listInbox",
        tenantId: workspace.id,
      });
      const approvals = Array.isArray(data.approvals)
        ? data.approvals.filter(isRecord)
        : [];
      return textResult({
        count: approvals.length,
        approvals: approvals.map((entry) => {
          const ticket = isRecord(entry.ticket) ? entry.ticket : {};
          const approval = isRecord(entry.approval) ? entry.approval : {};
          return {
            id: approval.id,
            kind: approval.approvalKind,
            reason: clip(approval.reason, 1000),
            requestedAt: approval.requestedAt,
            approvals: `${approval.approvedDecisions ?? 0}/${approval.requiredApprovals ?? 1}`,
            ticket: { number: ticket.number, subject: ticket.subject },
          };
        }),
      });
    },
  },
  {
    name: "freigabe_entscheiden",
    description:
      "Genehmigt oder lehnt eine Ticketfreigabe ab (id aus offene_freigaben_anzeigen). Nur nach ausdrücklicher Zustimmung der Person; setze dann bestaetigt auf true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Freigabe entscheiden",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        freigabe: { type: "string", description: "ID der Freigabe." },
        entscheid: { type: "string", enum: ["approved", "rejected"] },
        kommentar: { type: "string", maxLength: 2000 },
        bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person den Entscheid ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "freigabe", "entscheid", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Ein Freigabeentscheid braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (!isUuid(args.freigabe))
        throw new ToolError('"freigabe" ist ungültig.');
      if (args.entscheid !== "approved" && args.entscheid !== "rejected") {
        throw new ToolError('"entscheid" muss approved oder rejected sein.');
      }
      const comment =
        args.kommentar === undefined ? null : str(args.kommentar, 1, 2000);
      if (args.kommentar !== undefined && !comment) {
        throw new ToolError('"kommentar" muss 1 bis 2000 Zeichen lang sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-approvals", {
        type: "decide",
        tenantId: workspace.id,
        ticketId,
        approvalId: args.freigabe,
        decision: args.entscheid,
        ...(comment ? { comment } : {}),
      });
      return textResult({ decided: true, decision: args.entscheid });
    },
  },
  {
    name: "serviceaufgaben_anzeigen",
    description:
      "Zeigt Serviceaufgaben: überfällige, heute fällige und kommende. bereich: mine (Standard), team, all.",
    annotations: { readOnlyHint: true, title: "Serviceaufgaben" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        bereich: { type: "string", enum: ["mine", "team", "all"] },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const scope = typeof args.bereich === "string" ? args.bereich : "mine";
      if (!["mine", "team", "all"].includes(scope)) {
        throw new ToolError("Ungültiger bereich.");
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-tasks", {
        type: "overview",
        tenantId: workspace.id,
        scope,
      });
      const tasks = (value: unknown) =>
        (Array.isArray(value) ? value.filter(isRecord) : [])
          .slice(0, 25)
          .map((task) => ({
            id: task.id,
            title: task.title,
            category: task.category ?? null,
            priority: task.priority ?? null,
            status: task.status,
            dueAt: task.dueAt,
            overdue: task.overdue === true,
            assignee: isRecord(task.assignee) ? task.assignee.name : null,
            requireNote: task.requireNote === true,
          }));
      return textResult({
        today: data.today ?? null,
        kpis: data.kpis ?? null,
        overdue: tasks(data.overdue),
        dueToday: tasks(data.dueToday),
        upcoming: tasks(data.upcoming),
      });
    },
  },
  {
    name: "serviceaufgabe_erledigen",
    description:
      "Schliesst eine Serviceaufgabe als erledigt ab (id aus serviceaufgaben_anzeigen). Manche Aufgaben verlangen eine Notiz zum Ergebnis.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Serviceaufgabe erledigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        aufgabe: { type: "string", description: "ID der Serviceaufgabe." },
        notiz: { type: "string", maxLength: 3900 },
      },
      required: ["aufgabe"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.aufgabe)) throw new ToolError('"aufgabe" ist ungültig.');
      const note = args.notiz === undefined ? null : str(args.notiz, 1, 3900);
      if (args.notiz !== undefined && !note) {
        throw new ToolError('"notiz" muss 1 bis 3900 Zeichen lang sein.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "service-tasks", {
        type: "updateOccurrence",
        tenantId: workspace.id,
        occurrenceId: args.aufgabe,
        action: "complete",
        ...(note ? { note: `${note}\n\n${CONNECTOR_NOTE}` } : {}),
      });
      return textResult({ completed: true });
    },
  },

  // ------------------------------------------------ Anfragende Personen
  {
    name: "anfragende_suchen",
    description:
      "Sucht anfragende Personen (Kundinnen und Kunden) nach Name. Die id wird für ticket_erfassen (anfragende_person) verwendet.",
    annotations: { readOnlyHint: true, title: "Anfragende suchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: { type: "string", minLength: 2, maxLength: 120 },
      },
      required: ["suchbegriff"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const query = str(args.suchbegriff, 2, 120);
      if (!query)
        throw new ToolError('"suchbegriff" muss 2 bis 120 Zeichen lang sein.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ticket-actions", {
        type: "searchRequesters",
        tenantId: workspace.id,
        query,
      });
      const requesters = records(data.requesters);
      return textResult({
        count: requesters.length,
        requesters: requesters.slice(0, 20).map((entry) => ({
          id: entry.id,
          name: entry.displayName,
        })),
      });
    },
  },

  // ------------------------------------------------ Wiedervorlagen
  {
    name: "wiedervorlagen_anzeigen",
    description:
      "Listet deine Wiedervorlagen (Erinnerungen), standardmässig nur offene. Optional nur die eines Tickets.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Wiedervorlagen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: {
          ...TICKET_PROPERTY,
          description: "Nur Wiedervorlagen dieses Tickets.",
        },
        mit_erledigten: { type: "boolean" },
        max_anzahl: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketId =
        args.ticket === undefined
          ? undefined
          : await ticketIdFromReference(
              config,
              session,
              workspace,
              args.ticket,
            );
      const data = await callFunction(config, session, "experience-hub", {
        type: "listFollowUps",
        tenantId: workspace.id,
        includeResolved: args.mit_erledigten === true,
        limit: clampLimit(args.max_anzahl, 30, 100),
        ...(ticketId ? { ticketId } : {}),
      });
      const followUps = records(data.followUps);
      const labels = await ticketLabels(
        config,
        session,
        workspace,
        followUps.map((entry) => entry.ticketId),
      );
      return textResult({
        count: followUps.length,
        followUps: followUps.map((entry) => ({
          id: entry.id,
          title: entry.title,
          description: clip(entry.description, 500) || null,
          dueAt: entry.dueAt,
          overdue:
            entry.resolvedAt === null &&
            typeof entry.dueAt === "string" &&
            Date.parse(entry.dueAt) < Date.now(),
          priority: entry.priority,
          resolved: entry.resolvedAt !== null,
          ticket:
            typeof entry.ticketId === "string"
              ? (labels.get(entry.ticketId) ?? null)
              : null,
        })),
      });
    },
  },
  {
    name: "wiedervorlage_erstellen",
    description:
      "Erstellt eine Wiedervorlage (Erinnerung) für dich, optional zu einem Ticket. faellig als Datum/Zeit mit Zeitzone, z. B. 2026-11-10T08:00:00+01:00.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wiedervorlage erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        titel: { type: "string", minLength: 1, maxLength: 240 },
        beschreibung: { type: "string", maxLength: 4900 },
        faellig: { type: "string", description: "Fälligkeit (ISO 8601)." },
        prioritaet: { type: "string", enum: ["low", "normal", "high"] },
        ticket: TICKET_PROPERTY,
      },
      required: ["titel"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.titel, 1, 240);
      if (!title)
        throw new ToolError('"titel" muss 1 bis 240 Zeichen lang sein.');
      const description =
        args.beschreibung === undefined
          ? null
          : str(args.beschreibung, 1, 4900);
      if (args.beschreibung !== undefined && !description) {
        throw new ToolError(
          '"beschreibung" muss 1 bis 4900 Zeichen lang sein.',
        );
      }
      const dueAt = args.faellig === undefined ? null : isoDate(args.faellig);
      if (args.faellig !== undefined && !dueAt) {
        throw new ToolError('"faellig" ist kein gültiges Datum.');
      }
      const priority =
        typeof args.prioritaet === "string" ? args.prioritaet : "normal";
      if (!["low", "normal", "high"].includes(priority)) {
        throw new ToolError(
          '"prioritaet" muss niedrig, normal oder hoch sein.',
        );
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketId =
        args.ticket === undefined
          ? null
          : await ticketIdFromReference(
              config,
              session,
              workspace,
              args.ticket,
            );
      const data = await callFunction(config, session, "experience-hub", {
        type: "saveFollowUp",
        tenantId: workspace.id,
        title,
        description: description
          ? `${description}\n\n${CONNECTOR_NOTE}`
          : CONNECTOR_NOTE,
        dueAt,
        priority,
        ticketId,
      });
      const followUp = isRecord(data.followUp) ? data.followUp : {};
      return textResult({ created: true, id: followUp.id ?? null, dueAt });
    },
  },
  {
    name: "wiedervorlage_erledigen",
    description:
      "Erledigt eine Wiedervorlage (id aus wiedervorlagen_anzeigen).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Wiedervorlage erledigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        id: { type: "string", description: "ID der Wiedervorlage." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "experience-hub", {
        type: "resolveFollowUp",
        tenantId: workspace.id,
        followUpId: args.id,
      });
      return textResult({ resolved: true });
    },
  },

  // ------------------------------------------------ Arbeitsplatz
  {
    name: "erwaehnungen_anzeigen",
    description:
      "Listet Erwähnungen von dir in Ticketnotizen (@-Erwähnungen), standardmässig nur ungelesene.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Erwähnungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_ungelesene: { type: "boolean", description: "Standard: true." },
        max_anzahl: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listMentions",
        tenantId: workspace.id,
        onlyMine: true,
      });
      const mentions = records(data.mentions)
        .filter(
          (entry) => args.nur_ungelesene === false || entry.read_at === null,
        )
        .slice(0, clampLimit(args.max_anzahl, 20, 50));
      const labels = await ticketLabels(
        config,
        session,
        workspace,
        mentions.map((entry) => entry.ticket_id),
      );
      return textResult({
        count: mentions.length,
        mentions: mentions.map((entry) => ({
          id: entry.id,
          read: entry.read_at !== null,
          createdAt: entry.created_at,
          ticket: labels.get(String(entry.ticket_id)) ?? null,
        })),
      });
    },
  },
  {
    name: "erwaehnung_gelesen",
    description:
      "Markiert eine Erwähnung (id aus erwaehnungen_anzeigen) als gelesen.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Erwähnung gelesen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "agent-workbench", {
        type: "markMentionRead",
        tenantId: workspace.id,
        mentionId: args.id,
      });
      return textResult({ read: true });
    },
  },
  {
    name: "meine_kennzahlen",
    description:
      "Deine persönlichen Kennzahlen: offene zugewiesene Tickets, heute gelöst, mittlere Erstreaktions- und Lösungszeit, fällige SLA.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Meine Kennzahlen" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "myMetrics",
        tenantId: workspace.id,
      });
      const metrics = isRecord(data.metrics) ? data.metrics : {};
      return textResult({
        openAssigned: metrics.open ?? null,
        solvedToday: metrics.solvedToday ?? null,
        medianFirstResponseMinutes: metrics.medianFirstResponseMinutes ?? null,
        medianResolutionMinutes: metrics.medianResolutionMinutes ?? null,
        dueFollowUps: metrics.dueFollowUps ?? null,
        slaDue: metrics.slaDue ?? null,
      });
    },
  },
  {
    name: "warteschlangen_anzeigen",
    description:
      "Zeigt die offenen Tickets je Abteilung und Team (Warteschlangen), die du sehen kannst.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Warteschlangen" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "teamQueues",
        tenantId: workspace.id,
      });
      const queues = records(data.queues)
        .map((entry) => ({
          department: entry.departmentName ?? null,
          team: entry.teamName ?? (entry.teamId ? null : "ohne Team"),
          openTickets: entry.openTickets,
        }))
        .sort((a, b) => Number(b.openTickets) - Number(a.openTickets));
      return textResult({ queues });
    },
  },

  // ------------------------------------------------ Ticketarbeit
  {
    name: "uebergaben_anzeigen",
    description:
      "Zeigt die Übergaben eines Tickets (Zusammenfassung, nächste Schritte, Risiko).",
    annotations: { readOnlyHint: true, title: "Übergaben" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "ticket-handovers", {
        type: "list",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        handovers: records(data.handovers).map((entry) => ({
          id: entry.id,
          summary: clip(entry.summary, 2000),
          nextSteps: clip(entry.nextSteps, 3000) || null,
          risk: entry.riskLevel,
          acknowledged: entry.acknowledgedAt !== null,
          resolved: entry.resolvedAt !== null,
          createdAt: entry.createdAt,
        })),
      });
    },
  },
  {
    name: "uebergabe_erstellen",
    description:
      "Erstellt eine Übergabe für ein Ticket (z. B. vor Abwesenheit oder Schichtwechsel). risiko: niedrig, mittel (Standard) oder hoch. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Übergabe erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        zusammenfassung: { type: "string", minLength: 3, maxLength: 2000 },
        naechste_schritte: { type: "string", maxLength: 3000 },
        risiko: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["ticket", "zusammenfassung"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const summary = str(args.zusammenfassung, 3, 2000);
      if (!summary)
        throw new ToolError(
          '"zusammenfassung" muss 3 bis 2000 Zeichen lang sein.',
        );
      const nextSteps =
        args.naechste_schritte === undefined
          ? null
          : str(args.naechste_schritte, 1, 3000);
      if (args.naechste_schritte !== undefined && !nextSteps) {
        throw new ToolError(
          '"naechste_schritte" muss 1 bis 3000 Zeichen lang sein.',
        );
      }
      const risk = typeof args.risiko === "string" ? args.risiko : "medium";
      if (!["low", "medium", "high"].includes(risk)) {
        throw new ToolError('"risiko" muss niedrig, mittel oder hoch sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      if (args.bestaetigt !== true) {
        return draftResult(
          "Übergabe erstellen",
          {
            ticket: args.ticket,
            zusammenfassung: summary,
            naechsteSchritte: nextSteps,
            risiko: risk,
          },
          [args.naechste_schritte === undefined && "naechsteSchritte"],
        );
      }
      await callFunction(config, session, "ticket-handovers", {
        type: "create",
        tenantId: workspace.id,
        ticketId,
        summary,
        ...(nextSteps ? { nextSteps } : {}),
        riskLevel: risk,
      });
      return textResult({ created: true });
    },
  },
  {
    name: "uebergabe_bestaetigen",
    description:
      "Bestätigt den Empfang einer Übergabe (acknowledge) oder schliesst sie ab (resolve). id aus uebergaben_anzeigen.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Übergabe bestätigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        id: { type: "string", description: "ID der Übergabe." },
        aktion: {
          type: "string",
          enum: ["acknowledge", "resolve"],
          description: "Standard: acknowledge.",
        },
      },
      required: ["ticket", "id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const action = args.aktion === "resolve" ? "resolve" : "acknowledge";
      if (args.aktion !== undefined && args.aktion !== action) {
        throw new ToolError('"aktion" muss acknowledge oder resolve sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-handovers", {
        type: action,
        tenantId: workspace.id,
        ticketId,
        handoverId: args.id,
      });
      return textResult({ done: true, action });
    },
  },
  {
    name: "ticket_eskalieren",
    description:
      "Eskaliert ein Ticket. art: technical (fachlich), organizational (organisatorisch) oder sla. Eine Eskalation benachrichtigt weitere Personen; nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket eskalieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        art: { type: "string", enum: ["technical", "organizational", "sla"] },
        begruendung: { type: "string", minLength: 3, maxLength: 2000 },
        bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person die Eskalation ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "art", "begruendung", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Eine Eskalation braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (!["technical", "organizational", "sla"].includes(String(args.art))) {
        throw new ToolError(
          '"art" muss technical, organizational oder sla sein.',
        );
      }
      const reason = str(args.begruendung, 3, 2000);
      if (!reason)
        throw new ToolError('"begruendung" muss 3 bis 2000 Zeichen lang sein.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "openEscalation",
        tenantId: workspace.id,
        ticketId,
        kind: args.art,
        reason,
      });
      return textResult({ escalated: true, kind: args.art });
    },
  },
  {
    name: "tickets_verknuepfen",
    description:
      "Verknüpft zwei Tickets. beziehung: relates_to (Standard), duplicates, blocks, blocked_by, parent, child.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Tickets verknüpfen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        verknuepftes_ticket: TICKET_PROPERTY,
        beziehung: { type: "string", enum: RELATION_TYPES },
      },
      required: ["ticket", "verknuepftes_ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const relation =
        typeof args.beziehung === "string" ? args.beziehung : "relates_to";
      if (!RELATION_TYPES.includes(relation)) {
        throw new ToolError(
          `Ungültige Verknüpfung. Erlaubt: ${RELATION_TYPES.join(", ")}.`,
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const relatedTicketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.verknuepftes_ticket,
      );
      if (relatedTicketId === ticketId) {
        throw new ToolError(
          "Ein Ticket kann nicht mit sich selbst verknüpft werden.",
        );
      }
      await callFunction(config, session, "ticket-operations", {
        type: "createRelation",
        tenantId: workspace.id,
        ticketId,
        relatedTicketId,
        relationType: relation,
      });
      return textResult({ linked: true, relation });
    },
  },
  {
    name: "wissensartikel_verknuepfen",
    description:
      "Verknüpft einen Wissensartikel (id aus wissen_suchen) mit einem Ticket. sichtbarkeit: intern (Standard) oder extern (für Anfragende sichtbar, nur mit bestaetigt=true).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Wissensartikel verknüpfen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        wissensartikel: {
          type: "string",
          description: "ID des Wissensartikels.",
        },
        sichtbarkeit: { type: "string", enum: ["internal", "external"] },
        bestaetigt: { type: "boolean" },
      },
      required: ["ticket", "wissensartikel"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const visibility =
        args.sichtbarkeit === "external" ? "external" : "internal";
      if (args.sichtbarkeit !== undefined && args.sichtbarkeit !== visibility) {
        throw new ToolError('"sichtbarkeit" muss intern oder extern sein.');
      }
      if (visibility === "external" && args.bestaetigt !== true) {
        throw new ToolError(
          "Ein externer Artikel ist für die anfragende Person sichtbar. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-knowledge", {
        type: "attach",
        tenantId: workspace.id,
        ticketId,
        articleId: args.wissensartikel,
        visibility,
      });
      return textResult({ attached: true, visibility });
    },
  },

  // ------------------------------------------------ Betrieb und Verwaltung
  {
    name: "servicestatus_anzeigen",
    description:
      "Zeigt den aktuellen Status der IT-Services sowie laufende und geplante Wartungen.",
    annotations: { readOnlyHint: true, title: "Servicestatus" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_stoerungen: {
          type: "boolean",
          description: "Nur Services mit Störung oder Einschränkung.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-status", {
        type: "getStatusOverview",
        tenantId: workspace.id,
      });
      const services = records(data.services);
      const names = new Map(services.map((entry) => [entry.id, entry.name]));
      const now = Date.now();
      return textResult({
        services: services
          .filter(
            (entry) =>
              args.nur_stoerungen !== true || entry.status !== "operational",
          )
          .map((entry) => ({
            name: entry.name,
            category: Array.isArray(entry.categoryPath)
              ? entry.categoryPath.join(" / ")
              : null,
            status: entry.status,
            updatedAt: entry.updatedAt,
          })),
        maintenances: records(data.maintenances)
          .filter((entry) => Date.parse(String(entry.endsAt)) >= now)
          .map((entry) => ({
            title: entry.title,
            description: clip(entry.description, 500) || null,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            state: entry.state,
            services: Array.isArray(entry.serviceIds)
              ? entry.serviceIds.map((id) => names.get(id) ?? id)
              : [],
          })),
      });
    },
  },
  {
    name: "lager_nachschlagen",
    description:
      "Sucht einen Lagerartikel oder Lagerort über Artikelnummer, Barcode oder QR-Code und zeigt den Bestand.",
    annotations: { readOnlyHint: true, title: "Lager nachschlagen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        code: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["code"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const code = str(args.code, 1, 120);
      if (!code) throw new ToolError('"code" fehlt.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "inventory", {
        type: "lookupCode",
        tenantId: workspace.id,
        code,
      });
      const text = JSON.stringify(data);
      return textResult(
        text.length > 12000
          ? { truncated: true, result: clip(text, 12000) }
          : data,
      );
    },
  },
  {
    name: "lizenzen_anzeigen",
    description:
      "Listet Softwarelizenzen. Mit ablauf_in_tagen nur solche, die in den nächsten Tagen ablaufen.",
    annotations: { readOnlyHint: true, title: "Lizenzen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Filter nach Titel, Hersteller oder Referenz.",
        },
        ablauf_in_tagen: { type: "integer", minimum: 1, maximum: 730 },
        max_anzahl: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "licenses", {
        type: "list",
        tenantId: workspace.id,
        includeArchived: false,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const within = clampLimit(args.ablauf_in_tagen, 0, 730);
      const licenses = records(data.licenses)
        .map((entry) => ({ entry, days: daysUntil(entry.endsOn) }))
        .filter(
          ({ entry, days }) =>
            matches(
              query,
              entry.title,
              entry.vendorName,
              entry.referenceNumber,
            ) &&
            (!within || (days !== null && days <= within)),
        )
        .slice(0, clampLimit(args.max_anzahl, 30, 100));
      return textResult({
        count: licenses.length,
        licenses: licenses.map(({ entry, days }) => ({
          title: entry.title,
          vendor: entry.vendorName ?? null,
          reference: entry.referenceNumber ?? null,
          type: entry.licenseType ?? null,
          quantity: entry.quantity ?? null,
          status: entry.status,
          endsOn: entry.endsOn ?? null,
          daysUntilEnd: days,
          noticePeriodDays: entry.noticePeriodDays ?? null,
        })),
      });
    },
  },
  {
    name: "vertraege_anzeigen",
    description:
      "Listet Verträge mit Laufzeit, Kündigungsfrist und Kosten. Mit ablauf_in_tagen nur solche, die bald enden.",
    annotations: { readOnlyHint: true, title: "Verträge" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Filter nach Titel, Vertragspartner oder Referenz.",
        },
        ablauf_in_tagen: { type: "integer", minimum: 1, maximum: 730 },
        max_anzahl: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "contracts", {
        type: "list",
        tenantId: workspace.id,
        includeArchived: false,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const within = clampLimit(args.ablauf_in_tagen, 0, 730);
      const contracts = records(data.contracts)
        .map((entry) => ({ entry, days: daysUntil(entry.endsOn) }))
        .filter(
          ({ entry, days }) =>
            matches(
              query,
              entry.title,
              entry.counterpartyName,
              entry.referenceNumber,
            ) &&
            (!within || (days !== null && days <= within)),
        )
        .slice(0, clampLimit(args.max_anzahl, 30, 100));
      return textResult({
        count: contracts.length,
        contracts: contracts.map(({ entry, days }) => ({
          title: entry.title,
          counterparty: entry.counterpartyName ?? null,
          reference: entry.referenceNumber ?? null,
          type: entry.contractType ?? null,
          status: entry.status,
          startsOn: entry.startsOn ?? null,
          endsOn: entry.endsOn ?? null,
          daysUntilEnd: days,
          noticePeriodDays: entry.noticePeriodDays ?? null,
          cancelled: entry.cancelled === true,
          autoRenew: entry.autoRenew === true,
          cost:
            entry.costAmount === null
              ? null
              : `${entry.costAmount} ${entry.costCurrency ?? "CHF"}${entry.costPeriod ? ` (${entry.costPeriod})` : ""}`,
        })),
      });
    },
  },
  // ------------------------------------------------ Makros und Wissen
  {
    name: "makros_anzeigen",
    description:
      "Listet die Antwortmakros (Textbausteine) des Arbeitsbereichs. Den Text eines Makros liefert makrotext_holen.",
    annotations: { readOnlyHint: true, title: "Makros" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: { type: "string", description: "Filter nach Name." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listMacros",
        tenantId: workspace.id,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const macros = records(data.macros).filter((entry) =>
        matches(query, entry.name),
      );
      return textResult({
        count: macros.length,
        macros: macros.slice(0, 100).map((entry) => ({
          id: entry.id,
          name: entry.name,
          preview: clip(entry.response_text, 160) || null,
        })),
      });
    },
  },
  {
    name: "makrotext_holen",
    description:
      "Liefert den vollständigen Antworttext eines Makros (id aus makros_anzeigen), optional für ein bestimmtes Ticket. Zum Versenden danach ticket_beantworten verwenden.",
    annotations: { readOnlyHint: true, title: "Makrotext" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        makro: { type: "string", description: "ID des Makros." },
        ticket: TICKET_PROPERTY,
      },
      required: ["makro"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.makro)) throw new ToolError('"makro" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketId =
        args.ticket === undefined
          ? undefined
          : await ticketIdFromReference(
              config,
              session,
              workspace,
              args.ticket,
            );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "previewMacro",
        tenantId: workspace.id,
        macroId: args.makro,
        ...(ticketId ? { ticketId } : {}),
      });
      const preview = isRecord(data.preview) ? data.preview : {};
      return textResult({ text: preview.responseText ?? null });
    },
  },
  {
    name: "wissensentwurf_aus_ticket",
    description:
      "Erstellt aus einem Ticket einen Entwurf für einen Wissensartikel. Der Entwurf geht in die Prüfung und wird nicht direkt veröffentlicht. inhalt in Markdown; ohne Angabe wird die Ticketbeschreibung verwendet.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wissensentwurf erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        titel: { type: "string", minLength: 3, maxLength: 240 },
        inhalt: { type: "string", maxLength: 50000 },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = args.titel === undefined ? null : str(args.titel, 3, 240);
      if (args.titel !== undefined && !title) {
        throw new ToolError('"titel" muss 3 bis 240 Zeichen lang sein.');
      }
      const body =
        args.inhalt === undefined ? null : str(args.inhalt, 1, 50000);
      if (args.inhalt !== undefined && !body) {
        throw new ToolError('"inhalt" muss 1 bis 50000 Zeichen lang sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "knowledgeDraftFromTicket",
        tenantId: workspace.id,
        ticketId,
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
      });
      const article = isRecord(data.article) ? data.article : {};
      return textResult({
        created: true,
        id: article.id ?? null,
        title: article.title ?? title,
        status: article.status ?? "review",
        published: false,
      });
    },
  },

  // ------------------------------------------------ Veranstaltungsräume
  {
    name: "raumbuchungen_anzeigen",
    description:
      "Zeigt die Räume und die Raumbuchungen (Veranstaltungen, Sitzungen) der letzten zwei Tage und der nächsten rund 13 Monate mit Status und Aufgaben. Optional gefiltert nach Raum oder Zeitraum.",
    annotations: { readOnlyHint: true, title: "Raumbuchungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        raum: { type: "string", description: "Raumname oder ID." },
        von: { type: "string", description: "Ab Datum/Zeit (ISO 8601)." },
        nach: { type: "string", description: "Bis Datum/Zeit (ISO 8601)." },
        max_anzahl: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const from = args.von === undefined ? null : isoDate(args.von);
      const to = args.nach === undefined ? null : isoDate(args.nach);
      if (
        (args.von !== undefined && !from) ||
        (args.nach !== undefined && !to)
      ) {
        throw new ToolError('"von" oder "nach" ist kein gültiges Datum.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await eventWorkspace(config, session, workspace);
      const rooms = data.rooms;
      const room = args.raum === undefined ? null : findRoom(rooms, args.raum);
      const roomName = new Map(rooms.map((entry) => [entry.id, entry.name]));
      const matching = data.requests.filter(
        (entry) =>
          (!room || entry.spaceId === room.id) &&
          (!from || String(entry.endsAt) >= from) &&
          (!to || String(entry.startsAt) <= to),
      );
      const bookings = matching.slice(0, clampLimit(args.max_anzahl, 30, 100));
      return textResult({
        count: matching.length,
        rooms: rooms.map((entry) => ({
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          location: entry.location,
          capacity: entry.capacity,
        })),
        bookings: bookings.map((entry) => ({
          id: entry.id,
          title: entry.title,
          room: roomName.get(entry.spaceId) ?? null,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          status: entry.status,
          organizer: entry.organizer ?? null,
          requester: entry.requesterName ?? null,
          participants: entry.expectedParticipants ?? null,
          equipment: entry.equipment ?? [],
          series:
            entry.recurrence && entry.recurrence !== "none"
              ? { recurrence: entry.recurrence, index: entry.seriesIndex }
              : null,
          tasks: records(entry.tasks).map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
          })),
        })),
        moreAvailable: matching.length > bookings.length || !data.complete,
        hint:
          matching.length > bookings.length
            ? "Weitere Buchungen vorhanden: Zeitraum oder Raum eingrenzen oder max_anzahl erhöhen."
            : undefined,
      });
    },
  },
  {
    name: "raum_buchen",
    description: `Bucht einen Raum, einmalig oder als Serie (wiederholung weekly mit anzahl_termine 2-52 Terminen, monthly mit anzahl_termine 2-12; gleiche Uhrzeit, Zürcher Zeit). Prüft vorher auf Überschneidungen; bei einer Überschneidung wird nicht gebucht, ausser die Person bestätigt sie ausdrücklich (ueberschneidung_bestaetigt=true). ausstattung: ${EVENT_EQUIPMENT.join(", ")}. Ohne bestaetigt zeigt das Werkzeug zuerst die Buchung mit Überschneidungsprüfung als Entwurf; erst mit bestaetigt=true wird gebucht.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Raum buchen",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        raum: { type: "string", description: "Raumname oder ID." },
        titel: { type: "string", minLength: 3, maxLength: 240 },
        beginn: { type: "string", description: "Beginn (ISO 8601)." },
        ende: { type: "string", description: "Ende (ISO 8601)." },
        veranstalter: { type: "string", maxLength: 160 },
        teilnehmende: { type: "integer", minimum: 1, maximum: 10000 },
        wiederholung: {
          type: "string",
          enum: ["none", "weekly", "monthly"],
          description: "Standard: none (einmalig).",
        },
        anzahl_termine: {
          type: "integer",
          minimum: 2,
          maximum: 52,
          description:
            "Anzahl Termine der Serie inklusive des ersten (nur mit wiederholung).",
        },
        ausstattung: {
          type: "array",
          items: { type: "string", enum: EVENT_EQUIPMENT },
        },
        ueberschneidung_bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person eine gemeldete Überschneidung ausdrücklich akzeptiert hat.",
        },
      },
      required: ["raum", "titel", "beginn", "ende"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.titel, 3, 240);
      if (!title)
        throw new ToolError('"titel" muss 3 bis 240 Zeichen lang sein.');
      const startsAt = isoDate(args.beginn);
      const endsAt = isoDate(args.ende);
      if (!startsAt || !endsAt) {
        throw new ToolError('"beginn" oder "ende" ist kein gültiges Datum.');
      }
      const organizer =
        args.veranstalter === undefined ? null : str(args.veranstalter, 2, 160);
      if (args.veranstalter !== undefined && !organizer) {
        throw new ToolError('"veranstalter" muss 2 bis 160 Zeichen lang sein.');
      }
      if (
        args.teilnehmende !== undefined &&
        (typeof args.teilnehmende !== "number" ||
          !Number.isInteger(args.teilnehmende) ||
          args.teilnehmende < 1)
      ) {
        throw new ToolError(
          '"teilnehmende" muss eine positive ganze Zahl sein.',
        );
      }
      const equipment = Array.isArray(args.ausstattung) ? args.ausstattung : [];
      if (
        args.ausstattung !== undefined &&
        (!Array.isArray(args.ausstattung) ||
          !equipment.every((key) => EVENT_EQUIPMENT.includes(String(key))))
      ) {
        throw new ToolError(
          `Ungültige Ausstattung. Erlaubt: ${EVENT_EQUIPMENT.join(", ")}.`,
        );
      }
      const recurrence =
        args.wiederholung === "weekly" || args.wiederholung === "monthly"
          ? args.wiederholung
          : "none";
      if (args.wiederholung !== undefined && args.wiederholung !== recurrence) {
        throw new ToolError(
          '"wiederholung" muss none, weekly oder monthly sein.',
        );
      }
      const maxCount = recurrence === "monthly" ? 12 : 52;
      const count = args.anzahl_termine;
      if (
        recurrence !== "none" &&
        (typeof count !== "number" ||
          !Number.isInteger(count) ||
          count < 2 ||
          count > maxCount)
      ) {
        throw new ToolError(
          `"anzahl_termine" muss für eine ${recurrence === "monthly" ? "monatliche" : "wöchentliche"} Serie eine ganze Zahl von 2 bis ${maxCount} sein.`,
        );
      }
      if (recurrence === "none" && count !== undefined) {
        throw new ToolError(
          '"anzahl_termine" gilt nur zusammen mit wiederholung.',
        );
      }
      const duration = Date.parse(endsAt) - Date.parse(startsAt);
      if (duration < 15 * 60_000 || duration > 24 * 60 * 60_000) {
        throw new ToolError(
          "Ein Termin muss mindestens 15 Minuten und höchstens 24 Stunden dauern.",
        );
      }
      const occurrences = seriesOccurrences(
        startsAt,
        endsAt,
        recurrence,
        typeof count === "number" ? count : 1,
      );
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const overview = await callFunction(config, session, "event-spaces", {
        type: "listWorkspace",
        tenantId: workspace.id,
        offset: 0,
      });
      const room = findRoom(records(overview.rooms), args.raum);
      const input = {
        tenantId: workspace.id,
        spaceId: room.id,
        title,
        organizer,
        expectedParticipants:
          typeof args.teilnehmende === "number" ? args.teilnehmende : null,
        responsibleUserId: session.userId,
        equipmentKeys: [...new Set(equipment.map(String))],
        recurrence,
        occurrences,
      };
      const preview = await callFunction(config, session, "event-spaces", {
        type: "previewConflicts",
        ...input,
      });
      const conflicts = isRecord(preview.conflicts) ? preview.conflicts : {};
      const hasConflicts = conflicts.hasConflicts === true;
      if (args.bestaetigt !== true) {
        return draftResult(
          "Raum buchen",
          {
            raum: room.name,
            titel: title,
            wiederholung: recurrence,
            termine: occurrences.length,
            ersterTermin: zurichLabel(occurrences[0]!),
            letzterTermin: zurichLabel(occurrences[occurrences.length - 1]!),
            veranstalter: organizer,
            teilnehmende: input.expectedParticipants,
            ausstattung: input.equipmentKeys,
            ueberschneidungen: hasConflicts
              ? {
                  raum: conflicts.roomConflictCount ?? 0,
                  ausstattung: conflicts.equipmentConflictCount ?? 0,
                  hinweis:
                    "Trotzdem buchen nur mit ueberschneidung_bestaetigt=true nach ausdrücklicher Zustimmung.",
                }
              : "keine",
          },
          [
            args.teilnehmende === undefined && "teilnehmende",
            args.ausstattung === undefined && "ausstattung",
            args.veranstalter === undefined && "veranstalter",
          ],
        );
      }
      if (hasConflicts && args.ueberschneidung_bestaetigt !== true) {
        return textResult({
          booked: false,
          conflicts: {
            room: conflicts.roomConflictCount ?? 0,
            equipment: conflicts.equipmentConflictCount ?? 0,
          },
          hint: "Es gibt Überschneidungen. Frage die Person, ob trotzdem gebucht werden soll (ueberschneidung_bestaetigt=true), oder wähle einen anderen Raum oder Zeitpunkt.",
        });
      }
      await callFunction(config, session, "event-spaces", {
        type: "createRequest",
        ...input,
        confirmConflicts: hasConflicts,
        conflictSnapshot: hasConflicts
          ? (preview.conflictSnapshot ?? null)
          : null,
      });
      return textResult({
        booked: true,
        room: room.name,
        recurrence,
        occurrences: occurrences.length,
        first: occurrences[0],
        last: occurrences[occurrences.length - 1],
        conflictsAccepted: hasConflicts,
      });
    },
  },
  {
    name: "raumbuchung_aktualisieren",
    description:
      "Ändert den Status einer Raumbuchung (id aus raumbuchungen_anzeigen): planned, in_preparation, ready, conducted, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Raumbuchung aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        buchung: { type: "string", description: "ID der Raumbuchung." },
        status: { type: "string", enum: EVENT_REQUEST_STATUSES },
      },
      required: ["buchung", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.buchung)) throw new ToolError('"buchung" ist ungültig.');
      if (!EVENT_REQUEST_STATUSES.includes(String(args.status))) {
        throw new ToolError(
          `Ungültiger Status. Erlaubt: ${EVENT_REQUEST_STATUSES.join(", ")}.`,
        );
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "event-spaces", {
        type: "updateRequestStatus",
        tenantId: workspace.id,
        requestId: args.buchung,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },
  {
    name: "raumaufgabe_aktualisieren",
    description:
      "Setzt den Status einer Aufgabe zu einer Raumbuchung (id aus raumbuchungen_anzeigen): open, in_progress, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Raumaufgabe aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        aufgabe: { type: "string", description: "ID der Aufgabe." },
        status: { type: "string", enum: ["open", "in_progress", "completed"] },
      },
      required: ["aufgabe", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.aufgabe)) throw new ToolError('"aufgabe" ist ungültig.');
      if (!["open", "in_progress", "completed"].includes(String(args.status))) {
        throw new ToolError(
          '"status" muss open, in_progress oder completed sein.',
        );
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "event-spaces", {
        type: "updateTaskStatus",
        tenantId: workspace.id,
        taskId: args.aufgabe,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },

  // ------------------------------------------------ Eintritte (Onboarding)
  {
    name: "eintritte_anzeigen",
    description:
      "Zeigt die Eintritte und Austritte von Mitarbeitenden mit Startdatum, Verantwortlichen und offenen Aufgaben, dazu die verfügbaren Vorlagen und Personen.",
    annotations: { readOnlyHint: true, title: "Eintritte" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Filter nach Name oder Einheit.",
        },
        art: {
          type: "string",
          enum: ["onboarding", "offboarding"],
          description: "Nur eintritt oder nur austritt.",
        },
        nur_offene_aufgaben: {
          type: "boolean",
          description: "Nur nicht erledigte Aufgaben anzeigen.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "onboarding", {
        type: "listWorkspace",
        tenantId: workspace.id,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const entries = records(data.entries).filter(
        (entry) =>
          matches(query, entry.employeeName, entry.organisationUnit) &&
          (args.art === undefined || entry.kind === args.art),
      );
      return textResult({
        entries: entries.slice(0, 50).map((entry) => ({
          id: entry.id,
          kind: entry.kind ?? "onboarding",
          employee: entry.employeeName,
          startsOn: entry.startsOn,
          daysUntilStart: daysUntil(entry.startsOn),
          unit: entry.organisationUnit,
          location: entry.location,
          manager: entry.managerName,
          ictResponsible: entry.ictResponsibleName,
          tasks: records(entry.tasks)
            .filter(
              (task) =>
                args.nur_offene_aufgaben !== true ||
                task.status !== "completed",
            )
            .map((task) => ({
              id: task.id,
              title: task.title,
              dueOn: task.dueOn,
              responsible: task.responsibleName,
              status: task.status,
              canUpdate: task.canUpdate === true,
            })),
        })),
        templates: records(data.templates).map((entry) => ({
          id: entry.id,
          name: entry.name,
        })),
        people: records(data.people)
          .slice(0, 200)
          .map((entry) => ({ id: entry.id, name: entry.displayName })),
      });
    },
  },
  {
    name: "eintritt_erfassen",
    description:
      "Erfasst einen Eintritt (neue mitarbeitende Person) oder mit art austritt einen Austritt. Vorlage, Führungsperson und ICT-Verantwortung als Name oder ID aus eintritte_anzeigen. Frage vorher nach, ob der Eintritt erfasst werden soll. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Eintritt erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        art: {
          type: "string",
          enum: ["onboarding", "offboarding"],
          description: "eintritt (Standard) oder austritt.",
        },
        name: { type: "string", minLength: 2, maxLength: 160 },
        von_datum: {
          type: "string",
          description:
            "Erster Arbeitstag, bei Austritt der Austrittstag (JJJJ-MM-TT).",
        },
        einheit: {
          type: "string",
          minLength: 2,
          maxLength: 160,
          description: "Organisationseinheit.",
        },
        standort: { type: "string", minLength: 2, maxLength: 160 },
        fuehrungsperson: { type: "string", description: "Führungsperson." },
        ict_verantwortung: {
          type: "string",
          description: "ICT-Verantwortung. Standard: du selbst.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
        },
        vorlage: {
          type: "string",
          description: "Vorlage. Standard: die erste.",
        },
      },
      required: ["name", "von_datum", "einheit", "standort", "fuehrungsperson"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const employeeName = str(args.name, 2, 160);
      const unit = str(args.einheit, 2, 160);
      const location = str(args.standort, 2, 160);
      if (!employeeName || !unit || !location) {
        throw new ToolError(
          '"name", "einheit" und "standort" müssen 2 bis 160 Zeichen lang sein.',
        );
      }
      const startsOn = typeof args.von_datum === "string" ? args.von_datum : "";
      if (isoDate(`${startsOn}T00:00:00Z`)?.slice(0, 10) !== startsOn) {
        throw new ToolError('"von_datum" muss ein Datum JJJJ-MM-TT sein.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "onboarding", {
        type: "listWorkspace",
        tenantId: workspace.id,
      });
      const people = records(data.people);
      const templates = records(data.templates);
      const manager = findByName(
        people,
        args.fuehrungsperson,
        "displayName",
        "Person",
      );
      const ict =
        args.ict_verantwortung === undefined
          ? { id: session.userId }
          : findByName(people, args.ict_verantwortung, "displayName", "Person");
      const template =
        args.vorlage === undefined
          ? templates[0]
          : findByName(templates, args.vorlage, "name", "Vorlage");
      if (!template) {
        throw new ToolError("Es ist keine Vorlage für Eintritte vorhanden.");
      }
      if (args.bestaetigt !== true) {
        return draftResult(
          args.art === "offboarding"
            ? "Austritt erfassen"
            : "Eintritt erfassen",
          {
            art: args.art === "offboarding" ? "austritt" : "eintritt",
            mitarbeitende: employeeName,
            startdatum: startsOn,
            einheit: unit,
            standort: location,
            fuehrungsperson: manager.displayName,
            ictVerantwortung:
              "displayName" in ict ? ict.displayName : "du selbst", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
            vorlage: template.name,
          },
        );
      }
      const created = await callFunction(config, session, "onboarding", {
        type: "createEntry",
        tenantId: workspace.id,
        employeeName,
        startsOn,
        organisationUnit: unit,
        location,
        managerUserId: manager.id,
        ictResponsibleUserId: ict.id,
        templateId: template.id,
        kind: args.art === "offboarding" ? "offboarding" : "onboarding",
      });
      return textResult({
        created: true,
        id: created.entryId ?? null,
        employee: employeeName,
        startsOn,
      });
    },
  },
  {
    name: "eintrittsaufgabe_aktualisieren",
    description:
      "Setzt den Status einer Eintrittsaufgabe (id aus eintritte_anzeigen): open, in_progress, blocked, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Eintrittsaufgabe aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        aufgabe: { type: "string", description: "ID der Aufgabe." },
        status: {
          type: "string",
          enum: ["open", "in_progress", "blocked", "completed"],
        },
      },
      required: ["aufgabe", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.aufgabe)) throw new ToolError('"aufgabe" ist ungültig.');
      if (
        !["open", "in_progress", "blocked", "completed"].includes(
          String(args.status),
        )
      ) {
        throw new ToolError(
          '"status" muss open, in_progress, blocked oder completed sein.',
        );
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "onboarding", {
        type: "updateTaskStatus",
        tenantId: workspace.id,
        taskId: args.aufgabe,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },
  // ------------------------------------------------ Ticketsteuerung
  {
    name: "ticket_zuweisen",
    description:
      'Weist ein Ticket einer anderen Agentin oder einem anderen Agenten zu (Name oder ID) oder hebt die Zuweisung auf (person: "none"). Ohne person werden die möglichen Personen aufgelistet. Nur möglich mit dem Recht zum Zuweisen in nextDesk.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Ticket zuweisen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        person: {
          type: "string",
          description: 'Name oder ID der Person, oder "none" zum Aufheben.',
        },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(
        config,
        session,
        "ticket-agent-assignment",
        { type: "list", tenantId: workspace.id, ticketId },
      );
      const agents = records(data.agents);
      if (args.person === undefined) {
        return textResult({
          agents: agents.map((entry) => ({
            id: entry.id,
            name: entry.displayName,
          })),
        });
      }
      const none =
        typeof args.person === "string" &&
        ["none", "niemand", "keine", "-"].includes(
          args.person.trim().toLowerCase(),
        );
      const agent = none
        ? null
        : findByName(agents, args.person, "displayName", "Person");
      const result = await callFunction(
        config,
        session,
        "ticket-agent-assignment",
        {
          type: "assign",
          tenantId: workspace.id,
          ticketId,
          assignedAgentId: agent ? agent.id : null,
        },
      );
      return textResult({
        updated: result.updated === true,
        assignedTo: agent ? agent.displayName : null,
      });
    },
  },
  {
    name: "ticket_team_zuweisen",
    description:
      'Weist ein Ticket einem Team zu (Name oder ID) oder entfernt die Teamzuweisung (team: "none"). Ohne team werden die Teams aufgelistet.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Team zuweisen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        team: { type: "string", description: 'Teamname, ID oder "none".' },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const [data, departmentId] = await Promise.all([
        callFunction(config, session, "ticket-agent-assignment", {
          type: "listTeams",
          tenantId: workspace.id,
        }),
        ticketDepartmentId(config, session, workspace, ticketId),
      ]);
      const teams = records(data.teams).filter(
        (entry) => entry.departmentId === departmentId,
      );
      if (args.team === undefined) {
        return textResult({
          teams: teams.map((entry) => ({ id: entry.id, name: entry.name })),
        });
      }
      const none =
        typeof args.team === "string" &&
        ["none", "kein", "keines", "-"].includes(
          args.team.trim().toLowerCase(),
        );
      const team = none ? null : findByName(teams, args.team, "name", "Team");
      await callFunction(config, session, "ticket-operations", {
        type: "updateTicket",
        tenantId: workspace.id,
        ticketId,
        assignedTeamId: team ? team.id : null,
      });
      return textResult({ updated: true, team: team ? team.name : null });
    },
  },
  {
    name: "abteilung_wechseln",
    description:
      "Verschiebt ein Ticket in eine andere Abteilung. Dabei werden Kategorie, Team und zuständige Person zurückgesetzt. Nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Abteilung wechseln",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        abteilung: { type: "string", description: "Name oder ID." },
        bestaetigt: { type: "boolean" },
      },
      required: ["ticket", "abteilung", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Der Abteilungswechsel setzt Kategorie, Team und zuständige Person zurück. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const { departments } = await formDepartments(config, session, workspace);
      const department = findByName(
        departments,
        args.abteilung,
        "name",
        "Abteilung",
      );
      const result = await callFunction(
        config,
        session,
        "ticket-department-change",
        { tenantId: workspace.id, ticketId, departmentId: department.id },
      );
      return textResult({
        changed: result.changed === true,
        department: department.name,
      });
    },
  },
  {
    name: "kategorie_setzen",
    description:
      'Setzt Kategorie und optional Unterkategorie eines Tickets (Namen oder IDs). Ohne kategorie werden die Kategorien der Ticketabteilung aufgelistet; kategorie "none" entfernt sie.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Kategorie setzen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        kategorie: { type: "string" },
        unterkategorie: { type: "string" },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const departmentId = await ticketDepartmentId(
        config,
        session,
        workspace,
        ticketId,
      );
      const data = await callFunction(config, session, "ticket-actions", {
        type: "getCategories",
        tenantId: workspace.id,
        departmentId,
      });
      const categories = records(data.categories);
      const top = categories.filter((entry) => entry.parentId === null);
      if (args.kategorie === undefined) {
        return textResult({
          categories: top.map((entry) => ({
            id: entry.id,
            name: entry.name,
            subcategories: categories
              .filter((sub) => sub.parentId === entry.id)
              .map((sub) => ({ id: sub.id, name: sub.name })),
          })),
        });
      }
      const none =
        typeof args.kategorie === "string" &&
        ["none", "keine", "-"].includes(args.kategorie.trim().toLowerCase());
      if (none && args.unterkategorie !== undefined) {
        throw new ToolError("Ohne Kategorie ist keine Unterkategorie möglich.");
      }
      const category = none
        ? null
        : findByName(top, args.kategorie, "name", "Kategorie");
      const subcategory =
        category && args.unterkategorie !== undefined
          ? findByName(
              categories.filter((entry) => entry.parentId === category.id),
              args.unterkategorie,
              "name",
              "Unterkategorie",
            )
          : null;
      await callFunction(config, session, "ticket-category-selection", {
        tenantId: workspace.id,
        ticketId,
        categoryId: category ? category.id : null,
        subcategoryId: subcategory ? subcategory.id : null,
      });
      return textResult({
        updated: true,
        category: category ? category.name : null,
        subcategory: subcategory ? subcategory.name : null,
      });
    },
  },
  {
    name: "tickets_zusammenfuehren",
    description:
      "Führt ein Ticket (ticket) in ein Haupt-Ticket (in_ticket) zusammen. Das zusammengeführte Ticket wird dabei in der Regel geschlossen. Ohne in_ticket werden mögliche Ziele gesucht (suchbegriff). Zusammenführen nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      title: "Tickets zusammenführen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        in_ticket: { ...TICKET_PROPERTY, description: "Haupt-Ticket." },
        suchbegriff: {
          type: "string",
          description: "Suchtext im Betreff, um Ziele zu finden.",
        },
        bestaetigt: { type: "boolean" },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.in_ticket !== undefined && args.bestaetigt !== true) {
        throw new ToolError(
          "Das Zusammenführen lässt sich nicht einfach rückgängig machen. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      if (args.in_ticket === undefined) {
        const query = str(args.suchbegriff, 2, 240);
        if (!query) {
          throw new ToolError(
            'Gib "in_ticket" (Haupt-Ticket) oder "suchbegriff" (Suchtext) an.',
          );
        }
        const data = await callFunction(config, session, "ticket-operations", {
          type: "searchMergeTargets",
          tenantId: workspace.id,
          ticketId,
          query,
        });
        return textResult({
          targets: records(data.mergeTargets).map((entry) => ({
            number: entry.ticketNumber,
            subject: entry.subject,
            status: entry.statusLabel ?? null,
          })),
        });
      }
      const primaryTicketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.in_ticket,
      );
      const result = await callFunction(config, session, "ticket-operations", {
        type: "markMerged",
        tenantId: workspace.id,
        ticketId,
        primaryTicketId,
      });
      return textResult({
        merged: result.merged === true,
        closed: result.statusAutomaticallyUpdated === true,
      });
    },
  },
  {
    name: "verknuepfung_entfernen",
    description:
      "Entfernt eine Verknüpfung zwischen zwei Tickets (beziehung wie bei tickets_verknuepfen, Standard relates_to).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      title: "Verknüpfung entfernen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        verknuepftes_ticket: TICKET_PROPERTY,
        beziehung: { type: "string", enum: RELATION_TYPES },
      },
      required: ["ticket", "verknuepftes_ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const relation =
        typeof args.beziehung === "string" ? args.beziehung : "relates_to";
      if (!RELATION_TYPES.includes(relation)) {
        throw new ToolError(
          `Ungültige Verknüpfung. Erlaubt: ${RELATION_TYPES.join(", ")}.`,
        );
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const relatedTicketId = await ticketIdFromReference(
        config,
        session,
        workspace,
        args.verknuepftes_ticket,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "deleteRelation",
        tenantId: workspace.id,
        ticketId,
        relatedTicketId,
        relationType: relation,
      });
      return textResult({ deleted: true, relation });
    },
  },
  {
    name: "ticketvorlagen_anzeigen",
    description:
      "Listet die Ticketvorlagen einer Abteilung (Standard: alle Abteilungen, in denen du Tickets erfassen kannst). Eine Vorlage lässt sich bei ticket_erfassen mit vorlage verwenden.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Ticketvorlagen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        abteilung: { type: "string", description: "Name oder ID." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const { departments } = await formDepartments(config, session, workspace);
      const selected =
        args.abteilung === undefined
          ? departments.filter((entry) => isUuid(entry.id)).slice(0, 10)
          : [findByName(departments, args.abteilung, "name", "Abteilung")];
      const result = await Promise.all(
        selected.map(async (department) => {
          const data = await callFunction(config, session, "ticket-actions", {
            type: "listAvailableTemplates",
            tenantId: workspace.id,
            departmentId: department.id,
          });
          return {
            department: department.name,
            templates: records(data.templates).map((entry) => ({
              id: entry.id,
              name: entry.name,
              subject: entry.subjectTemplate,
              priority: entry.priorityKey ?? null,
              checklist: records(entry.checklistItems).length,
            })),
          };
        }),
      );
      return textResult({ departments: result });
    },
  },
  // ------------------------------------------------ Wissensdatenbank (Pflege)
  {
    name: "wissensartikel_speichern",
    description:
      "Erstellt einen neuen Wissensartikel oder speichert eine neue Fassung eines bestehenden (wissensartikel: ID). Der Artikel ist danach ein Entwurf und muss zur Prüfung gegeben werden (wissenspruefung_anfordern). Braucht das Recht zur Wissenspflege in nextDesk. Frage vorher nach. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wissensartikel speichern",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        wissensartikel: {
          type: "string",
          description: "ID eines bestehenden Artikels; leer für neu.",
        },
        titel: { type: "string", minLength: 3, maxLength: 240 },
        inhalt: {
          type: "string",
          maxLength: 100000,
          description: "Inhalt in Markdown.",
        },
        sichtbarkeit: {
          type: "string",
          enum: ["internal", "external"],
          description: "intern (Standard) oder extern (für Anfragende).",
        },
        abteilung: {
          type: "string",
          description: "Abteilung (Name oder ID).",
        },
      },
      required: ["titel", "inhalt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.titel, 3, 240);
      if (!title)
        throw new ToolError('"titel" muss 3 bis 240 Zeichen lang sein.');
      if (typeof args.inhalt !== "string" || args.inhalt.length > 100000) {
        throw new ToolError(
          '"inhalt" muss Text mit höchstens 100000 Zeichen sein.',
        );
      }
      if (args.wissensartikel !== undefined && !isUuid(args.wissensartikel)) {
        throw new ToolError('"wissensartikel" ist ungültig.');
      }
      const visibility =
        args.sichtbarkeit === "external" ? "external" : "internal";
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      let departmentId: string | undefined;
      if (args.abteilung !== undefined) {
        const { departments } = await formDepartments(
          config,
          session,
          workspace,
        );
        departmentId = findByName(
          departments,
          args.abteilung,
          "name",
          "Abteilung",
        ).id;
      }
      if (args.bestaetigt !== true) {
        return draftResult(
          isUuid(args.wissensartikel)
            ? "Wissensartikel: neue Fassung"
            : "Wissensartikel erstellen",
          {
            titel: title,
            sichtbarkeit: visibility,
            abteilung: args.abteilung ?? null,
            inhaltVorschau: clip(args.inhalt, 1500),
            zeichen: Array.from(String(args.inhalt)).length,
          },
          [args.abteilung === undefined && "abteilung"],
        );
      }
      const data = await callFunction(config, session, "knowledge-base", {
        type: "saveArticle",
        tenantId: workspace.id,
        ...(isUuid(args.wissensartikel)
          ? { articleId: args.wissensartikel }
          : {}),
        title,
        bodyMarkdown: args.inhalt,
        visibility,
        ...(departmentId ? { departmentId } : {}),
      });
      const article = isRecord(data.article) ? data.article : {};
      return textResult({
        saved: true,
        id: article.id ?? null,
        status: article.status ?? "draft",
        hint: "Entwurf gespeichert. Zum Veröffentlichen wissenspruefung_anfordern verwenden.",
      });
    },
  },
  {
    name: "wissenspruefung_anfordern",
    description:
      "Gibt einen Wissensartikel-Entwurf zur Prüfung (Freigabe vor der Veröffentlichung).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Prüfung anfordern",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        wissensartikel: { type: "string" },
      },
      required: ["wissensartikel"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "knowledge-base", {
        type: "requestReview",
        tenantId: workspace.id,
        articleId: args.wissensartikel,
      });
      const article = isRecord(data.article) ? data.article : {};
      return textResult({ requested: true, status: article.status ?? null });
    },
  },
  {
    name: "wissensartikel_freigeben",
    description:
      "Entscheidet über einen Wissensartikel in Prüfung: approved veröffentlicht ihn, rejected setzt ihn auf Entwurf zurück. Braucht das Recht zum Veröffentlichen in nextDesk und die ausdrückliche Zustimmung der Person (bestaetigt=true).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wissensartikel freigeben",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        wissensartikel: { type: "string" },
        entscheid: { type: "string", enum: ["approved", "rejected"] },
        notiz: { type: "string", maxLength: 120 },
        bestaetigt: { type: "boolean" },
      },
      required: ["wissensartikel", "entscheid", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Eine Freigabe veröffentlicht den Artikel. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      if (args.entscheid !== "approved" && args.entscheid !== "rejected") {
        throw new ToolError('"entscheid" muss approved oder rejected sein.');
      }
      const note = args.notiz === undefined ? null : str(args.notiz, 1, 120);
      if (args.notiz !== undefined && !note) {
        throw new ToolError('"notiz" muss 1 bis 120 Zeichen lang sein.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "knowledge-base", {
        type: "decideReview",
        tenantId: workspace.id,
        articleId: args.wissensartikel,
        decision: args.entscheid,
        ...(note ? { note } : {}),
      });
      const article = isRecord(data.article) ? data.article : {};
      return textResult({ decided: true, status: article.status ?? null });
    },
  },
  {
    name: "wissensartikel_archivieren",
    description:
      "Archiviert einen Wissensartikel (er ist danach nicht mehr auffindbar). Nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      title: "Wissensartikel archivieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        wissensartikel: { type: "string" },
        bestaetigt: { type: "boolean" },
      },
      required: ["wissensartikel", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Archivieren entfernt den Artikel aus der Wissensdatenbank. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "knowledge-base", {
        type: "archiveArticle",
        tenantId: workspace.id,
        articleId: args.wissensartikel,
      });
      return textResult({ archived: true });
    },
  },
  {
    name: "wissenssammlungen_anzeigen",
    description: "Listet die Sammlungen (Ordner) der Wissensdatenbank.",
    annotations: { readOnlyHint: true, title: "Wissenssammlungen" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "knowledge-base", {
        type: "listCollections",
        tenantId: workspace.id,
      });
      return textResult({
        collections: records(data.collections).map((entry) => ({
          id: entry.id,
          name: entry.name,
          parentId: entry.parent_id ?? null,
        })),
      });
    },
  },
  {
    name: "artikelversionen_anzeigen",
    description:
      "Zeigt die Fassungen (Versionen) eines Wissensartikels. Braucht das Recht zur Wissenspflege.",
    annotations: { readOnlyHint: true, title: "Artikelversionen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        wissensartikel: { type: "string" },
      },
      required: ["wissensartikel"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "knowledge-base", {
        type: "listRevisions",
        tenantId: workspace.id,
        articleId: args.wissensartikel,
      });
      return textResult({
        revisions: records(data.revisions).map((entry) => ({
          revision: entry.revision,
          summary: clip(entry.summary, 300) || null,
          createdAt: entry.created_at,
        })),
      });
    },
  },
  {
    name: "ticketwissen_anzeigen",
    description:
      "Zeigt die mit einem Ticket verknüpften Wissensartikel (intern oder an Anfragende gesendet).",
    annotations: { readOnlyHint: true, title: "Wissen am Ticket" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "ticket-knowledge", {
        type: "list",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        links: records(data.links).map((entry) => {
          const article = isRecord(entry.article) ? entry.article : {};
          return {
            articleId: entry.articleId,
            title: article.title ?? null,
            visibility: entry.visibility,
            sentToRequester:
              entry.sentAt !== null && entry.sentAt !== undefined,
            summary: clip(article.summary, 300) || null,
          };
        }),
      });
    },
  },
  {
    name: "wissensartikel_loesen",
    description:
      "Entfernt die Verknüpfung eines Wissensartikels mit einem Ticket.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      title: "Wissensartikel lösen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        wissensartikel: { type: "string" },
      },
      required: ["ticket", "wissensartikel"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-knowledge", {
        type: "detach",
        tenantId: workspace.id,
        ticketId,
        articleId: args.wissensartikel,
      });
      return textResult({ detached: true });
    },
  },
  {
    name: "wissensartikel_senden",
    description:
      "Sendet einen verknüpften, externen und veröffentlichten Wissensartikel als Antwort an die anfragende Person. Nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Artikel an Anfragende senden",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        wissensartikel: { type: "string" },
        bestaetigt: { type: "boolean" },
      },
      required: ["ticket", "wissensartikel", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Der Artikel wird der anfragenden Person zugestellt. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (!isUuid(args.wissensartikel))
        throw new ToolError('"wissensartikel" ist ungültig.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "ticket-knowledge", {
        type: "sendToRequester",
        tenantId: workspace.id,
        ticketId,
        articleId: args.wissensartikel,
      });
      return textResult({
        sent: true,
        alreadySent: data.alreadySent === true,
      });
    },
  },

  // ------------------------------------------------ Serviceaufgaben (Detail)
  {
    name: "serviceaufgabe_anzeigen",
    description:
      "Zeigt eine Serviceaufgabe mit Anleitung, Checkliste (IDs für serviceaufgabe_bearbeiten), Notiz und Verlauf.",
    annotations: { readOnlyHint: true, title: "Serviceaufgabe" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        aufgabe: { type: "string" },
      },
      required: ["aufgabe"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.aufgabe)) throw new ToolError('"aufgabe" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-tasks", {
        type: "getOccurrence",
        tenantId: workspace.id,
        occurrenceId: args.aufgabe,
      });
      return textResult(serviceTaskDetail(data));
    },
  },
  {
    name: "serviceaufgabe_bearbeiten",
    description:
      'Bearbeitet eine Serviceaufgabe. aktion: start, skip (mit begruendung), notiz (Notiz speichern), check (Checklistenpunkt punkt_id, erledigt), reopen, reschedule (faellig_am JJJJ-MM-TT, braucht Verwaltungsrecht), assign (zustaendig: "me", "none" oder Personen-ID, braucht Verwaltungsrecht). Zum Abschliessen serviceaufgabe_erledigen verwenden.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Serviceaufgabe bearbeiten",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        aufgabe: { type: "string" },
        aktion: {
          type: "string",
          enum: [
            "start",
            "skip",
            "note",
            "check",
            "reopen",
            "reschedule",
            "assign",
          ],
        },
        begruendung: { type: "string", maxLength: 500 },
        notiz: { type: "string", maxLength: 4000 },
        punkt_id: { type: "string" },
        erledigt: { type: "boolean" },
        faellig_am: { type: "string" },
        zustaendig: { type: "string" },
      },
      required: ["aufgabe", "aktion"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.aufgabe)) throw new ToolError('"aufgabe" ist ungültig.');
      const body: Json = {};
      switch (args.aktion) {
        case "start":
        case "reopen":
          body.action = args.aktion;
          break;
        case "skip": {
          const reason = str(args.begruendung, 1, 500);
          if (!reason)
            throw new ToolError('Zum Überspringen braucht es "begruendung".');
          body.action = "skip";
          body.reason = reason;
          break;
        }
        case "note": {
          const note =
            args.notiz === undefined || args.notiz === ""
              ? ""
              : str(args.notiz, 1, 4000);
          if (note === null)
            throw new ToolError('"notiz" darf höchstens 4000 Zeichen haben.');
          body.action = "saveNote";
          body.note = note;
          break;
        }
        case "check":
          if (typeof args.punkt_id !== "string" || !args.punkt_id) {
            throw new ToolError(
              '"punkt_id" fehlt (aus serviceaufgabe_anzeigen).',
            );
          }
          body.action = "toggleCheck";
          body.checkId = args.punkt_id;
          body.done = args.erledigt !== false;
          break;
        case "reschedule":
          if (
            typeof args.faellig_am !== "string" ||
            isoDate(`${args.faellig_am}T00:00:00Z`)?.slice(0, 10) !==
              args.faellig_am
          ) {
            throw new ToolError('"faellig_am" muss ein Datum JJJJ-MM-TT sein.');
          }
          body.action = "reschedule";
          body.dueOn = args.faellig_am;
          break;
        case "assign": {
          const value =
            typeof args.zustaendig === "string" ? args.zustaendig.trim() : "";
          const assigneeId =
            value === "me"
              ? session.userId
              : value === "none" || value === ""
                ? null
                : value;
          if (assigneeId !== null && !isUuid(assigneeId)) {
            throw new ToolError(
              '"zustaendig" muss "me", "none" oder eine Personen-ID sein.',
            );
          }
          body.action = "assign";
          body.assigneeId = assigneeId;
          break;
        }
        default:
          throw new ToolError("Ungültige aktion.");
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-tasks", {
        type: "updateOccurrence",
        tenantId: workspace.id,
        occurrenceId: args.aufgabe,
        ...body,
      });
      return textResult({ updated: true, task: serviceTaskDetail(data) });
    },
  },
  {
    name: "serviceaufgaben_kalender",
    description:
      "Zeigt den Kalender der Serviceaufgaben für einen Monat (JJJJ-MM), inklusive geplanter künftiger Termine.",
    annotations: { readOnlyHint: true, title: "Serviceaufgaben-Kalender" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        monat: { type: "string", description: "Monat JJJJ-MM." },
      },
      required: ["monat"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        typeof args.monat !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.monat)
      ) {
        throw new ToolError('"monat" muss die Form JJJJ-MM haben.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-tasks", {
        type: "calendar",
        tenantId: workspace.id,
        month: args.monat,
      });
      return textResult({
        month: data.month,
        entries: records(data.entries)
          .slice(0, 200)
          .map((entry) => ({
            id: entry.projected === true ? null : entry.id,
            title: entry.title,
            dueOn: entry.dueOn,
            status: entry.status,
            assignee: isRecord(entry.assignee) ? entry.assignee.name : null,
            planned: entry.projected === true,
          })),
      });
    },
  },

  // ------------------------------------------------ Freigaben anfordern
  {
    name: "ticketfreigaben_anzeigen",
    description:
      "Zeigt die Freigaben (Genehmigungen) eines Tickets mit Status und Entscheiden.",
    annotations: { readOnlyHint: true, title: "Freigaben am Ticket" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "ticket-approvals", {
        type: "list",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        canRequest: data.canRequest === true,
        canDecide: data.canDecide === true,
        approvals: records(data.approvals).map((entry) => ({
          id: entry.id,
          kind: entry.approvalKind,
          status: entry.status,
          reason: clip(entry.reason, 1000),
          requiredApprovals: entry.requiredApprovals,
          requestedBy: entry.requestedByName,
          requestedAt: entry.requestedAt,
          decisions: records(entry.decisions).map((decision) => ({
            by: decision.approverName ?? null,
            decision: decision.decision,
            comment: decision.comment ?? null,
          })),
        })),
      });
    },
  },
  {
    name: "freigabe_anfordern",
    description:
      'Fordert für ein Ticket eine Freigabe an (z. B. art "beschaffung"). noetige_zustimmungen: Anzahl nötiger Zustimmungen (1-10, Standard 1). Frage vorher nach. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Freigabe anfordern",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        art: {
          type: "string",
          description: "Art der Freigabe, Kleinbuchstaben, z. B. beschaffung.",
        },
        begruendung: { type: "string", minLength: 3, maxLength: 2000 },
        noetige_zustimmungen: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["ticket", "art", "begruendung"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const kind =
        typeof args.art === "string"
          ? args.art
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, "_")
          : "";
      if (!/^[a-z][a-z0-9_]{1,62}$/.test(kind)) {
        throw new ToolError(
          '"art" muss mit einem Buchstaben beginnen (a-z, 0-9, _; 2-63 Zeichen).',
        );
      }
      const reason = str(args.begruendung, 3, 2000);
      if (!reason)
        throw new ToolError('"begruendung" muss 3 bis 2000 Zeichen lang sein.');
      const required =
        args.noetige_zustimmungen === undefined ? 1 : args.noetige_zustimmungen;
      if (
        typeof required !== "number" ||
        !Number.isInteger(required) ||
        required < 1 ||
        required > 10
      ) {
        throw new ToolError('"noetige_zustimmungen" muss 1 bis 10 sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      if (args.bestaetigt !== true) {
        return draftResult("Freigabe anfordern", {
          ticket: args.ticket,
          art: kind,
          begruendung: reason,
          noetigeZustimmungen: required,
        });
      }
      const data = await callFunction(config, session, "ticket-approvals", {
        type: "request",
        tenantId: workspace.id,
        ticketId,
        approvalKind: kind,
        reason,
        requiredApprovals: required,
      });
      return textResult({
        requested: true,
        id: data.approvalId ?? null,
        status: data.status ?? null,
      });
    },
  },
  {
    name: "freigabe_zurueckziehen",
    description:
      "Zieht eine offene Freigabe-Anforderung zurück (id aus ticketfreigaben_anzeigen).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      title: "Freigabe zurückziehen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        freigabe: { type: "string" },
      },
      required: ["ticket", "freigabe"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.freigabe))
        throw new ToolError('"freigabe" ist ungültig.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      // Die Freigabe muss zu diesem Ticket gehören.
      const list = await callFunction(config, session, "ticket-approvals", {
        type: "list",
        tenantId: workspace.id,
        ticketId,
      });
      if (
        !records(list.approvals).some((entry) => entry.id === args.freigabe)
      ) {
        throw new ToolError("Diese Freigabe gehört nicht zu diesem Ticket.");
      }
      await callFunction(config, session, "ticket-approvals", {
        type: "cancel",
        tenantId: workspace.id,
        ticketId,
        approvalId: args.freigabe,
      });
      return textResult({ cancelled: true });
    },
  },

  // ------------------------------------------------ Stellvertretung
  {
    name: "stellvertretungen_anzeigen",
    description:
      "Zeigt deine Stellvertretungen (wer dich wann vertritt). Mit person die einer anderen Person, sofern du sie führst.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Stellvertretungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        person: { type: "string", description: "Name oder ID (optional)." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const people = records(
        (
          await callFunction(config, session, "agent-workbench", {
            type: "listDelegationAgents",
            tenantId: workspace.id,
          })
        ).agents,
      );
      const agent =
        args.person === undefined
          ? null
          : findByName(people, args.person, "displayName", "Person");
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listDelegations",
        tenantId: workspace.id,
        ...(agent ? { agentId: agent.id } : {}),
      });
      const name = new Map(
        people.map((entry) => [entry.id, entry.displayName]),
      );
      return textResult({
        delegations: records(data.delegations).map((entry) => ({
          id: entry.id,
          delegate: name.get(entry.delegate_id) ?? entry.delegate_id,
          startsAt: entry.starts_at,
          endsAt: entry.ends_at,
          ended: entry.ended_at !== null,
          note: entry.note ?? null,
        })),
      });
    },
  },
  {
    name: "stellvertretung_einrichten",
    description:
      "Richtet eine Stellvertretung ein: vertretung vertritt dich (oder person, sofern du die Person führst) von beginn bis ende (ISO 8601). Frage vorher nach. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Stellvertretung einrichten",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        vertretung: {
          type: "string",
          description: "Vertretung (Name oder ID).",
        },
        person: {
          type: "string",
          description: "Vertretene Person (optional).",
        },
        beginn: { type: "string" },
        ende: { type: "string" },
        notiz: { type: "string", maxLength: 2000 },
      },
      required: ["vertretung", "beginn", "ende"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const startsAt = isoDate(args.beginn);
      const endsAt = isoDate(args.ende);
      if (!startsAt || !endsAt || endsAt <= startsAt) {
        throw new ToolError(
          '"beginn" und "ende" müssen gültige Zeitpunkte sein, das Ende nach dem Beginn.',
        );
      }
      const note = args.notiz === undefined ? null : str(args.notiz, 1, 2000);
      if (args.notiz !== undefined && !note) {
        throw new ToolError('"notiz" muss 1 bis 2000 Zeichen lang sein.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const people = records(
        (
          await callFunction(config, session, "agent-workbench", {
            type: "listDelegationAgents",
            tenantId: workspace.id,
          })
        ).agents,
      );
      const delegate = findByName(
        people,
        args.vertretung,
        "displayName",
        "Person",
      );
      const agent =
        args.person === undefined
          ? null
          : findByName(people, args.person, "displayName", "Person");
      if (args.bestaetigt !== true) {
        return draftResult(
          "Stellvertretung einrichten",
          {
            vertretenePerson: agent ? agent.displayName : "du selbst", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
            vertretung: delegate.displayName,
            von: startsAt,
            bis: endsAt,
            notiz: note,
          },
          [args.notiz === undefined && "notiz"],
        );
      }
      await callFunction(config, session, "agent-workbench", {
        type: "saveDelegation",
        tenantId: workspace.id,
        ...(agent ? { agentId: agent.id } : {}),
        delegateId: delegate.id,
        startsAt,
        endsAt,
        note,
      });
      return textResult({
        saved: true,
        delegate: delegate.displayName,
        startsAt,
        endsAt,
      });
    },
  },
  {
    name: "stellvertretung_beenden",
    description:
      "Beendet eine Stellvertretung sofort (id aus stellvertretungen_anzeigen).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Stellvertretung beenden",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "endDelegation",
        tenantId: workspace.id,
        delegationId: args.id,
      });
      return textResult({ ended: true, changed: data.changed === true });
    },
  },

  // ------------------------------------------------ Störungsmeldungen
  {
    name: "stoerungsmeldungen_anzeigen",
    description:
      "Listet die internen Störungsmeldungen (laufende und behobene Störungen).",
    annotations: { readOnlyHint: true, title: "Störungsmeldungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_offene: { type: "boolean", description: "Nur nicht behobene." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listIncidentNotices",
        tenantId: workspace.id,
      });
      return textResult({
        notices: records(data.notices)
          .filter(
            (entry) => args.nur_offene !== true || entry.status !== "resolved",
          )
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            status: entry.status,
            description: clip(entry.description, 1000),
            startsAt: entry.starts_at,
            resolvedAt: entry.resolved_at ?? null,
          })),
      });
    },
  },
  {
    name: "stoerungsmeldung_speichern",
    description:
      "Erfasst eine Störungsmeldung oder aktualisiert sie (meldung: ID). status: wird_untersucht, ursache_bekannt, wird_beobachtet oder behoben. Braucht das Verwaltungsrecht für Tickets. Frage vorher nach. Ohne bestaetigt zeigt das Werkzeug zuerst einen Entwurf zum Prüfen und Ergänzen; erst mit bestaetigt=true wird abgeschickt.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Störungsmeldung speichern",
    },
    inputSchema: {
      type: "object",
      properties: {
        bestaetigt: CONFIRM_PROPERTY,
        arbeitsbereich: WORKSPACE_PROPERTY,
        meldung: { type: "string", description: "ID zum Aktualisieren." },
        titel: { type: "string", minLength: 3, maxLength: 240 },
        beschreibung: { type: "string", minLength: 3, maxLength: 10000 },
        status: {
          type: "string",
          enum: ["investigating", "identified", "monitoring", "resolved"],
        },
        abteilung: { type: "string", description: "Abteilung (optional)." },
        beginn: { type: "string", description: "Beginn (ISO 8601)." },
      },
      required: ["titel", "beschreibung", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.titel, 3, 240);
      const description = str(args.beschreibung, 3, 10000);
      if (!title || !description) {
        throw new ToolError(
          '"titel" (3-240) und "beschreibung" (3-10000 Zeichen) sind nötig.',
        );
      }
      if (
        !["investigating", "identified", "monitoring", "resolved"].includes(
          String(args.status),
        )
      ) {
        throw new ToolError("Ungültiger status.");
      }
      if (args.meldung !== undefined && !isUuid(args.meldung)) {
        throw new ToolError('"meldung" ist ungültig.');
      }
      const startsAt =
        args.beginn === undefined ? undefined : isoDate(args.beginn);
      if (startsAt === null) throw new ToolError('"beginn" ist ungültig.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      let departmentId: string | null = null;
      if (args.abteilung !== undefined) {
        const { departments } = await formDepartments(
          config,
          session,
          workspace,
        );
        departmentId = findByName(
          departments,
          args.abteilung,
          "name",
          "Abteilung",
        ).id;
      }
      if (args.bestaetigt !== true) {
        return draftResult(
          isUuid(args.meldung)
            ? "Störungsmeldung aktualisieren"
            : "Störungsmeldung erfassen",
          {
            titel: title,
            beschreibung: clip(description, 2000),
            status: args.status,
            abteilung: args.abteilung ?? null,
            beginn: startsAt ?? "jetzt",
          },
        );
      }
      const data = await callFunction(config, session, "agent-workbench", {
        type: "saveIncidentNotice",
        tenantId: workspace.id,
        ...(isUuid(args.meldung) ? { noticeId: args.meldung } : {}),
        title,
        description,
        status: args.status,
        ...(startsAt ? { startsAt } : {}),
        categoryId: null,
        departmentId,
      });
      const notice = isRecord(data.notice) ? data.notice : {};
      return textResult({ saved: true, id: notice.id ?? null });
    },
  },

  // ------------------------------------------------ Störungen und Sicherheitsfälle
  {
    name: "stoerungen_anzeigen",
    description:
      "Listet Monitoring-Störungen (PRTG) des Arbeitsbereichs. Nur für das in den Monitoring-Einstellungen zuständige Team (ohne Team: alle Agenten).",
    annotations: { readOnlyHint: true, title: "Störungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_offene: {
          type: "boolean",
          description: "Nur nicht geschlossene Störungen (Standard).",
        },
        max_anzahl: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await rpcCall(config, session, "list_operations_incidents", {
        p_tenant_id: workspace.id,
        p_only_open: args.nur_offene !== false,
        p_limit: clampLimit(args.max_anzahl, 20, 50),
      });
      return textResult({ incidents: records(data) });
    },
  },
  {
    name: "sicherheitsfaelle_anzeigen",
    description:
      "Listet die Sicherheitsfälle (gemeldete Phishing-Mails). Nur für das Phishing-Team aus den Phishing-Einstellungen.",
    annotations: { readOnlyHint: true, title: "Sicherheitsfälle" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        status: {
          type: "string",
          enum: ["triage", "actions", "closed", "all"],
          description:
            "triage = zu beurteilen (Standard), actions = Massnahmen offen, closed = abgeschlossen, all = alle.",
        },
        max_anzahl: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const state = ["triage", "actions", "closed", "all"].includes(
        String(args.status),
      )
        ? String(args.status)
        : "triage";
      const data = await callFunction(config, session, "security-cases", {
        type: "list",
        tenantId: workspace.id,
        state,
      });
      return textResult({
        cases: records(data.cases)
          .slice(0, clampLimit(args.max_anzahl, 20, 50))
          .map((entry) => ({
            id: entry.ticketId,
            number: entry.ticketNumber,
            subject: clip(entry.subject, 200),
            from: entry.from,
            state: SECURITY_STATE_LABELS[String(entry.state)] ?? entry.state,
            verdict: entry.verdict,
            risk: entry.riskLevel,
            reporters: entry.reporters,
            overdue: entry.overdue,
            assignedTo: entry.assignedAgentName,
            firstReportedAt: entry.firstReportedAt,
          })),
      });
    },
  },
  {
    name: "sicherheitsfall_anzeigen",
    description:
      "Zeigt einen Sicherheitsfall mit Analyse (Links entschärft), Urteil, Massnahmen, Kampagne und IOC-Treffern. Nur für das Phishing-Team.",
    annotations: { readOnlyHint: true, title: "Sicherheitsfall" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        fall: {
          type: "string",
          description: "Fallnummer (z. B. SEC-2026-0012) oder ID.",
        },
      },
      required: ["fall"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const reference = str(args.fall, 1, 80);
      if (!reference) throw new ToolError('"fall" fehlt.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      let ticketId = isUuid(reference) ? reference : null;
      if (!ticketId) {
        const list = await callFunction(config, session, "security-cases", {
          type: "list",
          tenantId: workspace.id,
          state: "all",
        });
        const match = records(list.cases).find(
          (entry) =>
            String(entry.ticketNumber ?? "").toLowerCase() ===
            reference.toLowerCase(),
        );
        if (!match || !isUuid(match.ticketId)) {
          throw new ToolError(`Sicherheitsfall «${reference}» nicht gefunden.`);
        }
        ticketId = match.ticketId;
      }
      const data = await callFunction(config, session, "security-cases", {
        type: "get",
        tenantId: workspace.id,
        ticketId,
      });
      const analysis = isRecord(data.analysis) ? data.analysis : {};
      return textResult({
        id: data.ticketId,
        number: data.ticketNumber,
        state: SECURITY_STATE_LABELS[String(data.state)] ?? data.state,
        verdict: data.verdict,
        decisionDueAt: data.decisionDueAt,
        clickedAt: data.clickedAt,
        assignedTo: data.assignedAgentName,
        mail: {
          from: analysis.from,
          subject: analysis.subject,
          sendingIp: analysis.sendingIp,
          risk: analysis.level,
          score: analysis.score,
          auth: analysis.auth,
          findings: records(analysis.findings)
            .slice(0, 15)
            .map((entry) => entry.message),
          links: records(analysis.links)
            .slice(0, 15)
            .map((entry) => entry.href),
        },
        reporters: records(data.reporters).map((entry) => ({
          name: entry.name,
          answer: entry.answer,
        })),
        checklist: records(data.actions).map((entry) => ({
          label: entry.label,
          done: Boolean(entry.doneAt),
        })),
        measures: records(data.measures).map((entry) => ({
          label: entry.label,
          target: entry.target,
          status: entry.status,
          at: entry.createdAt,
        })),
        campaign: isRecord(data.campaign)
          ? {
              reports: data.campaign.reports,
              reporters: data.campaign.reporters,
              cases: data.campaign.caseCount,
            }
          : null,
        iocHits: records(data.iocHits).map((entry) => ({
          kind: entry.kind,
          value: entry.value,
          verdict: entry.verdict,
        })),
      });
    },
  },

  // ------------------------------------------------ Hilfen zum Ticket
  {
    name: "zuweisung_vorschlagen",
    description:
      "Schlägt passende Personen für die Bearbeitung eines Tickets vor (mit Begründung). Weist nicht zu.",
    annotations: { readOnlyHint: true, title: "Zuweisung vorschlagen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "suggestAssignees",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        suggestions: records(data.suggestions)
          .slice(0, 10)
          .map((entry) => ({
            name: entry.displayName,
            current: entry.isCurrentAssignee === true,
            score: entry.score,
            reasons: entry.reasons ?? [],
          })),
      });
    },
  },
  {
    name: "ticketumfeld_anzeigen",
    description:
      "Zeigt das Umfeld eines Tickets: weitere Tickets der anfragenden Person, ihre Geräte mit Verlauf, Erreichbarkeit und Beobachtende.",
    annotations: { readOnlyHint: true, title: "Ticketumfeld" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "agent-workbench", {
        type: "ticketContext",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        requesterTickets: records(data.requesterTickets)
          .slice(0, 20)
          .map((entry) => ({
            number: entry.ticket_number,
            subject: entry.subject,
            createdAt: entry.created_at,
            resolved: entry.resolved_at !== null,
          })),
        assets: records(data.assets).map((entry) => ({
          name: entry.name,
          assetTag: entry.asset_tag ?? null,
          state: entry.lifecycle_state ?? null,
        })),
        assetHistory: records(data.assetHistory).slice(0, 20),
        requesterAvailability: data.requesterAvailability ?? null,
        watchers: Array.isArray(data.watchers) ? data.watchers : [],
      });
    },
  },
  // ------------------------------------------------ Auswertungen und SLA
  {
    name: "servicebericht",
    description:
      "Kennzahlen des Service: eingegangene, gelöste und offene Tickets, SLA-Einhaltung, Reaktions- und Lösungszeiten, Zufriedenheit und Werte je Person, mit Vergleich zur Vorperiode. zeitraum: 7d, 30d (Standard), 90d oder custom mit von_datum/bis_datum. Braucht das Recht für Berichte in nextDesk.",
    annotations: { readOnlyHint: true, title: "Servicebericht" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        zeitraum: { type: "string", enum: ["7d", "30d", "90d", "custom"] },
        von_datum: { type: "string", description: "JJJJ-MM-TT (custom)." },
        bis_datum: { type: "string", description: "JJJJ-MM-TT (custom)." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const period = typeof args.zeitraum === "string" ? args.zeitraum : "30d";
      if (!["7d", "30d", "90d", "custom"].includes(period)) {
        throw new ToolError('"zeitraum" muss 7d, 30d, 90d oder custom sein.');
      }
      if (
        period === "custom" &&
        (typeof args.von_datum !== "string" ||
          typeof args.bis_datum !== "string")
      ) {
        throw new ToolError(
          'Für custom braucht es "von_datum" und "bis_datum".',
        );
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "service-reporting", {
        type: "getInsights",
        tenantId: workspace.id,
        period,
        ...(period === "custom"
          ? { startsOn: args.von_datum, endsOn: args.bis_datum }
          : {}),
      });
      const overview = isRecord(data.overview) ? data.overview : {};
      const satisfaction = isRecord(data.satisfaction) ? data.satisfaction : {};
      const agents = isRecord(data.agents) ? data.agents : {};
      return textResult({
        period: data.period ?? null,
        current: overview.current ?? null,
        previous: overview.previous ?? null,
        satisfaction: {
          responses: satisfaction.responses ?? null,
          happyPercent: satisfaction.happyPercent ?? null,
          neutralPercent: satisfaction.neutralPercent ?? null,
          unhappyPercent: satisfaction.unhappyPercent ?? null,
          surveysSent: satisfaction.surveysSent ?? null,
        },
        agents: records(agents.rows)
          .slice(0, 30)
          .map((row) => ({
            name: row.name,
            resolved: row.resolved,
            resolutionSlaCompliance: row.resolutionSlaCompliance,
            averageResolutionMinutes: row.averageResolutionMinutes,
            averageFirstResponseMinutes: row.averageFirstResponseMinutes,
            happyPercent: row.happyPercent,
          })),
        total: agents.total ?? null,
      });
    },
  },
  {
    name: "sla_eskalationen_anzeigen",
    description:
      "Listet die neuesten SLA- und Ticket-Eskalationen der Abteilungen, die du sehen darfst.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "SLA-Eskalationen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_offene: {
          type: "boolean",
          description: "Nur offene Eskalationen.",
        },
        max_anzahl: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "sla-management", {
        type: "listEscalations",
        tenantId: workspace.id,
        limit: clampLimit(args.max_anzahl, 50, 100),
      });
      return textResult({
        escalations: records(data.escalations)
          .filter((entry) => args.nur_offene !== true || !entry.resolvedAt)
          .map((entry) => {
            const ticket = isRecord(entry.ticket) ? entry.ticket : {};
            return {
              ticket: ticket.ticketNumber ?? null,
              subject: ticket.subject ?? null,
              kind: entry.kind,
              level: entry.level,
              reason: clip(entry.reason, 500),
              openedAt: entry.openedAt,
              resolved: Boolean(entry.resolvedAt),
            };
          }),
      });
    },
  },
  {
    name: "sla_regeln_anzeigen",
    description:
      "Zeigt die SLA-Regeln (Reaktions- und Lösungszeiten je Priorität und Servicezeiten).",
    annotations: { readOnlyHint: true, title: "SLA-Regeln" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "sla-management", {
        type: "listRules",
        tenantId: workspace.id,
      });
      return textResult({
        rules: records(data.rules)
          .filter((entry) => entry.active === true)
          .map((entry) => ({
            name: entry.name,
            priority: entry.priorityKey,
            responseMinutes: entry.responseMinutes,
            resolutionMinutes: entry.resolutionMinutes,
            serviceHours: entry.serviceHours,
          })),
      });
    },
  },

  // ------------------------------------------------ Teamführung
  {
    name: "teamuebersicht",
    description:
      "Für Vorgesetzte: Auslastung der geführten Agentinnen und Agenten (offene, überfällige, gefährdete Tickets, Abwesenheiten) und die offenen Tickets ihrer Abteilungen.",
    annotations: { readOnlyHint: true, title: "Teamübersicht" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        nur_kritische: {
          type: "boolean",
          description:
            "Nur überfällige, gefährdete oder unbeantwortete Tickets.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "team-supervision", {
        type: "overview",
        tenantId: workspace.id,
      });
      const agents = records(data.agents);
      const name = new Map(
        agents.map((entry) => [entry.id, entry.displayName]),
      );
      return textResult({
        agents: agents.map((entry) => ({
          name: entry.displayName,
          openTickets: entry.openTickets,
          overdue: entry.overdue,
          atRisk: entry.atRisk,
          noFirstResponse: entry.noFirstResponse,
          resolvedLast30Days: entry.resolvedLast30Days,
          absence: isRecord(entry.absence)
            ? {
                until: entry.absence.endsAt,
                delegate: entry.absence.delegateName ?? null,
              }
            : null,
        })),
        tickets: records(data.tickets)
          .filter(
            (entry) =>
              args.nur_kritische !== true ||
              entry.overdue === true ||
              entry.atRisk === true ||
              entry.noFirstResponse === true,
          )
          .slice(0, 100)
          .map((entry) => ({
            number: entry.ticketNumber,
            subject: entry.subject,
            assignedTo: name.get(entry.assignedAgentId) ?? null,
            status: entry.statusLabel,
            priority: entry.priorityLabel,
            overdue: entry.overdue === true,
            atRisk: entry.atRisk === true,
            noFirstResponse: entry.noFirstResponse === true,
          })),
      });
    },
  },
  {
    name: "pruefliste_anzeigen",
    description:
      "Für Vorgesetzte: bis zu fünf zufällig gewählte, kürzlich gelöste Tickets zur Qualitätsprüfung (Bewertung mit ticket_bewerten).",
    annotations: { readOnlyHint: true, title: "Prüfliste" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "team-supervision", {
        type: "reviewQueue",
        tenantId: workspace.id,
      });
      return textResult({
        tickets: records(data.tickets).map((entry) => ({
          number: entry.ticketNumber,
          subject: entry.subject,
          agent: entry.agentName,
          resolvedAt: entry.resolvedAt,
          description: entry.description,
          lastReply: entry.lastReply ?? null,
        })),
      });
    },
  },
  {
    name: "ticket_bewerten",
    description:
      "Für Vorgesetzte: bewertet die Bearbeitung eines gelösten Tickets (bewertung 1-5, Lösung korrekt, Ton angemessen, Kommentar).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket bewerten",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        bewertung: { type: "integer", minimum: 1, maximum: 5 },
        loesung_korrekt: { type: "boolean" },
        ton_angemessen: { type: "boolean" },
        kommentar: { type: "string", maxLength: 2000 },
      },
      required: ["ticket", "bewertung", "loesung_korrekt", "ton_angemessen"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        typeof args.bewertung !== "number" ||
        !Number.isInteger(args.bewertung) ||
        args.bewertung < 1 ||
        args.bewertung > 5
      ) {
        throw new ToolError('"bewertung" muss 1 bis 5 sein.');
      }
      if (
        typeof args.loesung_korrekt !== "boolean" ||
        typeof args.ton_angemessen !== "boolean"
      ) {
        throw new ToolError(
          '"loesung_korrekt" und "ton_angemessen" müssen true oder false sein.',
        );
      }
      const comment =
        args.kommentar === undefined ? null : str(args.kommentar, 0, 2000);
      if (args.kommentar !== undefined && comment === null) {
        throw new ToolError('"kommentar" darf höchstens 2000 Zeichen haben.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "team-supervision", {
        type: "saveReview",
        tenantId: workspace.id,
        ticketId,
        rating: args.bewertung,
        solutionCorrect: args.loesung_korrekt,
        toneAppropriate: args.ton_angemessen,
        comment: comment || null,
      });
      return textResult({ saved: true });
    },
  },
  {
    name: "monatsbericht",
    description:
      "Für Vorgesetzte: Monatsbericht je Person (zugewiesen, gelöst, Reaktions- und Lösungszeit, SLA, Zufriedenheit, Qualität, Wissensartikel). monat: JJJJ-MM.",
    annotations: { readOnlyHint: true, title: "Monatsbericht" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        monat: { type: "string" },
      },
      required: ["monat"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        typeof args.monat !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.monat)
      ) {
        throw new ToolError('"monat" muss die Form JJJJ-MM haben.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "team-supervision", {
        type: "monthlyReport",
        tenantId: workspace.id,
        month: args.monat,
      });
      return textResult({
        month: data.month,
        agents: records(data.agents).map(({ id: _id, ...rest }) => rest),
      });
    },
  },
  {
    name: "tickets_umverteilen",
    description:
      'Für Vorgesetzte: weist mehrere Tickets (bis 100) einer Person aus dem geführten Team zu (person: Name oder ID) oder hebt die Zuweisung auf (person: "none"). Nur nach ausdrücklicher Zustimmung der Person mit bestaetigt=true.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Tickets umverteilen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        tickets: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
        },
        person: { type: "string" },
        bestaetigt: { type: "boolean" },
      },
      required: ["tickets", "person", "bestaetigt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.bestaetigt !== true) {
        throw new ToolError(
          "Das Umverteilen ändert die Zuständigkeit mehrerer Tickets. Frage nach und wiederhole den Aufruf danach mit bestaetigt=true.",
        );
      }
      if (
        !Array.isArray(args.tickets) ||
        args.tickets.length < 1 ||
        args.tickets.length > 100
      ) {
        throw new ToolError('"tickets" muss 1 bis 100 Tickets enthalten.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const ticketIds = [
        ...new Set(
          await Promise.all(
            args.tickets.map((reference) =>
              ticketIdFromReference(config, session, workspace, reference),
            ),
          ),
        ),
      ];
      const none =
        typeof args.person === "string" &&
        ["none", "niemand", "-"].includes(args.person.trim().toLowerCase());
      let agent: (Json & { id: string }) | null = null;
      if (!none) {
        const overview = await callFunction(
          config,
          session,
          "team-supervision",
          { type: "overview", tenantId: workspace.id },
        );
        agent = findByName(
          records(overview.agents),
          args.person,
          "displayName",
          "Person",
        );
      }
      const data = await callFunction(config, session, "team-supervision", {
        type: "reassign",
        tenantId: workspace.id,
        ticketIds,
        agentId: agent ? agent.id : null,
      });
      return textResult({
        reassigned: data.reassigned ?? ticketIds.length,
        to: agent ? agent.displayName : null,
      });
    },
  },

  // ------------------------------------------------ Personen und Organisationen
  {
    name: "anfragende_profil_anzeigen",
    description:
      "Zeigt das Profil einer anfragenden Person (Standort, Abteilung, Angebot, Sprache, bevorzugter Kontaktweg, wichtige Hinweise). anfragende_person: ID aus anfragende_suchen oder aus ticket_anzeigen (Angabe anfragende_person_id). Braucht das Recht zur Pflege von Anfragenden.",
    annotations: { readOnlyHint: true, title: "Profil Anfragende" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        anfragende_person: { type: "string" },
      },
      required: ["anfragende_person"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        typeof args.anfragende_person !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          args.anfragende_person,
        )
      ) {
        throw new ToolError('"anfragende_person" ist ungültig.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ticket-requesters", {
        type: "getProfile",
        tenantId: workspace.id,
        requesterContactId: args.anfragende_person,
      });
      return textResult({ profile: data.profile ?? null });
    },
  },
  {
    name: "kundenorganisationen_anzeigen",
    description:
      "Listet die Kundenorganisationen; mit organisation (Name oder ID) zusätzlich deren Mitglieder. Braucht Verwaltungsrechte für Benutzer oder Einstellungen.",
    annotations: { readOnlyHint: true, title: "Kundenorganisationen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        organisation: { type: "string" },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(
        config,
        session,
        "customer-organizations",
        { type: "list", tenantId: workspace.id },
      );
      const organizations = records(data.organizations);
      if (args.organisation === undefined) {
        return textResult({
          organizations: organizations.map((entry) => ({
            id: entry.id,
            name: entry.name,
            ticketAccess: entry.ticket_access,
            active: entry.active,
          })),
        });
      }
      const organization = findByName(
        organizations,
        args.organisation,
        "name",
        "Organisation",
      );
      const members = await callFunction(
        config,
        session,
        "customer-organizations",
        {
          type: "listMembers",
          tenantId: workspace.id,
          organizationId: organization.id,
        },
      );
      return textResult({
        organization: {
          name: organization.name,
          ticketAccess: organization.ticket_access,
        },
        members: records(members.members).map((entry) => ({
          userId: entry.user_id,
          access: entry.access,
        })),
      });
    },
  },

  // ------------------------------------------------ Geräte
  {
    name: "geraet_anzeigen",
    description:
      "Zeigt ein Gerät mit Details, Standort, zugehörigen Tickets und (mit Verwaltungsrecht) Intune-Daten und Lebenszyklus. geraet: ID aus geraet_suchen, oder code: Inventarnummer, Asset-Tag oder Seriennummer.",
    annotations: { readOnlyHint: true, title: "Gerät anzeigen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        geraet: { type: "string" },
        code: { type: "string", maxLength: 200 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.geraet) && !str(args.code, 1, 200)) {
        throw new ToolError('Gib "geraet" (ID) oder "code" an.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      let data: Json;
      try {
        data = await callFunction(
          config,
          session,
          "asset-registry",
          isUuid(args.geraet)
            ? { type: "getAsset", tenantId: workspace.id, assetId: args.geraet }
            : {
                type: "lookupAsset",
                tenantId: workspace.id,
                code: str(args.code, 1, 200),
              },
        );
      } catch (error) {
        if (error instanceof ToolError && error.message.includes("http_409")) {
          throw new ToolError(
            "Der Code passt auf mehrere Geräte. Suche mit geraet_suchen und verwende die ID.",
          );
        }
        throw error;
      }
      const asset = isRecord(data.asset) ? data.asset : {};
      return textResult({
        asset: {
          id: asset.id,
          name: asset.name,
          assetTag: asset.asset_tag ?? null,
          inventoryNumber: asset.inventory_number ?? null,
          serialNumber: asset.serial_number ?? null,
          manufacturer: asset.manufacturer ?? null,
          model: asset.model ?? null,
          operatingSystem: asset.operating_system ?? null,
          kind: asset.kind ?? null,
          status: asset.status ?? null,
          lifecycleState: asset.lifecycle_state ?? null,
        },
        location: isRecord(data.location) ? data.location.name : null,
        tickets: records(data.tickets).map((entry) => {
          const ticket = isRecord(entry.tickets) ? entry.tickets : entry;
          return {
            number: ticket.ticket_number,
            subject: ticket.subject,
            status: isRecord(ticket.status) ? ticket.status.label : null,
          };
        }),
        intune: data.integration ?? null,
        assignments: data.assignments ?? null,
        lifecycle: records(data.lifecycle).slice(0, 10),
      });
    },
  },
  {
    name: "geraete_zum_ticket",
    description:
      "Zeigt die Geräte der anfragenden Person eines Tickets (aus Zuweisung und Intune).",
    annotations: { readOnlyHint: true, title: "Geräte zum Ticket" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "asset-registry", {
        type: "ticketPersonDevices",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        devices: records(data.devices).map((entry) => ({
          id: entry.id,
          name: entry.name,
          assetTag: entry.asset_tag ?? null,
          manufacturer: entry.manufacturer ?? null,
          model: entry.model ?? null,
          operatingSystem: entry.operating_system ?? null,
          status: entry.status ?? null,
          sources: entry.sources ?? [],
        })),
      });
    },
  },

  // ------------------------------------------------ Lager
  {
    name: "lageruebersicht",
    description:
      "Zeigt das Lager: Artikel mit Bestand (physisch, reserviert, verfügbar), knappe Artikel, Lagerorte und letzte Bewegungen. Optional nach Artikel gefiltert (suchbegriff).",
    annotations: { readOnlyHint: true, title: "Lagerübersicht" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Name oder Artikelnummer.",
        },
        nur_knappe: { type: "boolean" },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "inventory", {
        type: "workspace",
        tenantId: workspace.id,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const source =
        args.nur_knappe === true
          ? records(data.lowStockItems)
          : records(data.items);
      const items = source
        .filter((entry) => matches(query, entry.name, entry.articleNumber))
        .slice(0, 60);
      return textResult({
        permissions: data.permissions ?? null,
        summary: data.summary ?? null,
        items: items.map((entry) => ({
          id: entry.id,
          name: entry.name,
          articleNumber: entry.articleNumber,
          unit: entry.unit,
          physical: entry.physicalQuantity,
          reserved: entry.reservedQuantity,
          available: entry.availableQuantity,
          minimum: entry.minQuantity,
          location: entry.locationName ?? null,
        })),
        locations: records(data.locations)
          .filter((entry) => entry.active !== false)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            code: entry.code,
          })),
        recentEvents: records(data.recentEvents).slice(0, 15),
      });
    },
  },
  {
    name: "lagerbewegung_buchen",
    description:
      "Bucht eine Lagerbewegung. bewegungsart: receipt (Eingang, nach), issue (Ausgabe, von), transfer (von und nach), defect, loss, adjustment_out (von), adjustment_in (nach). Artikel und Lagerorte als Name, Nummer/Code oder ID. Frage vorher nach.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Lagerbewegung buchen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        bewegungsart: {
          type: "string",
          enum: [
            "receipt",
            "issue",
            "transfer",
            "defect",
            "loss",
            "adjustment_in",
            "adjustment_out",
          ],
        },
        punkt: { type: "string" },
        menge: { type: "number", exclusiveMinimum: 0 },
        von: { type: "string", description: "Lagerort (Quelle)." },
        nach: { type: "string", description: "Lagerort (Ziel)." },
      },
      required: ["bewegungsart", "punkt", "menge"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const type = String(args.bewegungsart);
      const needsFrom = [
        "issue",
        "transfer",
        "defect",
        "loss",
        "adjustment_out",
      ].includes(type);
      const needsTo = ["receipt", "transfer", "adjustment_in"].includes(type);
      if (!needsFrom && !needsTo)
        throw new ToolError("Ungültiger bewegungsart.");
      if (needsFrom !== (args.von !== undefined)) {
        throw new ToolError(
          needsFrom
            ? `Für ${type} braucht es "von".`
            : `Für ${type} ist kein "von" erlaubt.`,
        );
      }
      if (needsTo !== (args.nach !== undefined)) {
        throw new ToolError(
          needsTo
            ? `Für ${type} braucht es "nach".`
            : `Für ${type} ist kein "nach" erlaubt.`,
        );
      }
      const quantity = validQuantity(args.menge);
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const { item, location } = await inventoryRefs(
        config,
        session,
        workspace,
      );
      const itemRow = item(args.punkt);
      const fromRow = needsFrom ? location(args.von) : null;
      const toRow = needsTo ? location(args.nach) : null;
      if (fromRow && toRow && fromRow.id === toRow.id) {
        throw new ToolError("Quelle und Ziel müssen verschieden sein.");
      }
      await callFunction(config, session, "inventory", {
        type: "postMovement",
        tenantId: workspace.id,
        movementType: type,
        itemId: itemRow.id,
        quantity,
        ...(fromRow ? { fromLocationId: fromRow.id } : {}),
        ...(toRow ? { toLocationId: toRow.id } : {}),
        clientRequestId: crypto.randomUUID(),
      });
      return textResult({
        posted: true,
        type,
        item: itemRow.name,
        quantity,
        from: fromRow?.name ?? null,
        to: toRow?.name ?? null,
      });
    },
  },
  {
    name: "material_reservieren",
    description:
      "Reserviert Lagermaterial an einem Lagerort, optional für ein Ticket. Artikel und Lagerort als Name, Nummer/Code oder ID.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Material reservieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        punkt: { type: "string" },
        standort: { type: "string" },
        menge: { type: "number", exclusiveMinimum: 0 },
        ticket: TICKET_PROPERTY,
      },
      required: ["punkt", "standort", "menge"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const quantity = validQuantity(args.menge);
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const { item, location } = await inventoryRefs(
        config,
        session,
        workspace,
      );
      const itemRow = item(args.punkt);
      const locationRow = location(args.standort);
      const ticketId =
        args.ticket === undefined
          ? undefined
          : await ticketIdFromReference(
              config,
              session,
              workspace,
              args.ticket,
            );
      await callFunction(config, session, "inventory", {
        type: "reserve",
        tenantId: workspace.id,
        itemId: itemRow.id,
        locationId: locationRow.id,
        quantity,
        ...(ticketId ? { ticketId } : {}),
        clientRequestId: crypto.randomUUID(),
      });
      return textResult({
        reserved: true,
        item: itemRow.name,
        location: locationRow.name,
        quantity,
      });
    },
  },
  {
    name: "reservationen_anzeigen",
    description: "Listet die offenen Materialreservationen.",
    annotations: { readOnlyHint: true, title: "Reservationen" },
    inputSchema: {
      type: "object",
      properties: { arbeitsbereich: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "inventory", {
        type: "listOpenReservations",
        tenantId: workspace.id,
      });
      return textResult({
        reservations: records(data.reservations)
          .slice(0, 100)
          .map((entry) => ({
            id: entry.id,
            item: entry.itemName,
            location: entry.locationName,
            quantity: entry.quantity,
            createdAt: entry.createdAt,
          })),
      });
    },
  },
  {
    name: "reservation_freigeben",
    description:
      "Gibt eine Materialreservation frei (id aus reservationen_anzeigen).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      title: "Reservation freigeben",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        reservation: { type: "string" },
      },
      required: ["reservation"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.reservation)) {
        throw new ToolError('"reservation" ist ungültig.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      await callFunction(config, session, "inventory", {
        type: "releaseReservation",
        tenantId: workspace.id,
        reservationId: args.reservation,
        clientRequestId: crypto.randomUUID(),
      });
      return textResult({ released: true });
    },
  },
  // ------------------------------------------------ Shop
  {
    name: "shop_katalog_anzeigen",
    description:
      "Durchsucht den Self-Service-Shop (Software, Lizenzen, Geräte, Zubehör, Ausleihartikel), den Mitarbeitende selbst bestellen können. suchbegriff: z. B. «Visio».",
    annotations: { readOnlyHint: true, title: "Shop-Katalog" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suchbegriff: {
          type: "string",
          description: "Name, Kategorie oder Stichwort.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "shop", {
        type: "listCatalog",
        tenantId: workspace.id,
      });
      const query =
        typeof args.suchbegriff === "string" ? args.suchbegriff.trim() : "";
      const items = records(data.items).filter((entry) =>
        matches(
          query,
          entry.name,
          entry.description,
          entry.category,
          ...(Array.isArray(entry.categoryNames) ? entry.categoryNames : []),
        ),
      );
      return textResult({
        count: items.length,
        items: items.slice(0, 40).map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: clip(entry.description, 400) || null,
          category: Array.isArray(entry.categoryNames)
            ? entry.categoryNames.join(", ")
            : (entry.category ?? null),
          kind: entry.kind,
          requiresApproval: entry.requiresApproval === true,
          maxQuantity: entry.maxQuantity ?? null,
          maxLoanDays: entry.maxLoanDays ?? null,
        })),
      });
    },
  },
  {
    name: "im_shop_bestellen",
    description:
      "Bestellt Artikel im Self-Service-Shop für dich (positionen: Name oder ID aus shop_katalog_anzeigen, mit Menge). begruendung ist Pflicht, ausser bei reinen Ausleihartikeln; bei Ausleihe ausleihe_von/ausleihe_bis (JJJJ-MM-TT) angeben. Je nach Artikel braucht es eine Freigabe. Ohne bestaetigt zeigt das Werkzeug zuerst die Bestellung als Entwurf; erst mit bestaetigt=true wird bestellt.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Im Shop bestellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        positionen: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              artikel: { type: "string" },
              menge: { type: "integer", minimum: 1, maximum: 100 },
            },
            required: ["artikel"],
            additionalProperties: false,
          },
        },
        begruendung: { type: "string", minLength: 3, maxLength: 500 },
        kommentar: { type: "string", maxLength: 2000 },
        ausleihe_von: { type: "string" },
        ausleihe_bis: { type: "string" },
        lieferung: {
          type: "string",
          enum: ["pickup", "desk"],
          description: "abholung (Standard) oder an_den_platz.",
        },
        bestaetigt: { type: "boolean" },
      },
      required: ["positionen"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (
        !Array.isArray(args.positionen) ||
        args.positionen.length < 1 ||
        args.positionen.length > 30
      ) {
        throw new ToolError('"positionen" muss 1 bis 30 Positionen enthalten.');
      }
      for (const key of ["ausleihe_von", "ausleihe_bis"] as const) {
        const value = args[key];
        if (
          value !== undefined &&
          (typeof value !== "string" ||
            isoDate(`${value}T00:00:00Z`)?.slice(0, 10) !== value)
        ) {
          throw new ToolError(`"${key}" muss ein Datum JJJJ-MM-TT sein.`);
        }
      }
      const reason =
        args.begruendung === undefined ? null : str(args.begruendung, 3, 500);
      if (args.begruendung !== undefined && !reason) {
        throw new ToolError('"begruendung" muss 3 bis 500 Zeichen lang sein.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const catalog = records(
        (
          await callFunction(config, session, "shop", {
            type: "listCatalog",
            tenantId: workspace.id,
          })
        ).items,
      );
      const lines = args.positionen.map((entry) => {
        if (!isRecord(entry)) throw new ToolError("Ungültige Position.");
        const quantity = entry.menge === undefined ? 1 : entry.menge;
        if (
          typeof quantity !== "number" ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        ) {
          throw new ToolError('"menge" muss 1 bis 100 sein.');
        }
        const item = findByName(catalog, entry.artikel, "name", "Artikel");
        return { item, quantity };
      });
      const onlyLoans = lines.every(({ item }) => item.kind === "loan");
      if (!onlyLoans && !reason) {
        throw new ToolError(
          'Für diese Bestellung braucht es einen Grund ("begruendung").',
        );
      }
      if (args.bestaetigt !== true) {
        return draftResult(
          "Shop-Bestellung",
          {
            artikel: lines.map(
              ({ item, quantity }) => `${quantity}× ${item.name}`,
            ),
            grund: reason,
            lieferung: args.lieferung === "desk" ? "an den Platz" : "Abholung",
            ausleiheVon: args.ausleihe_von ?? null,
            ausleiheBis: args.ausleihe_bis ?? null,
            freigabeNoetig: lines.some(
              ({ item }) => item.requiresApproval === true,
            ),
          },
          [args.kommentar === undefined && "kommentar"],
        );
      }
      const data = await callFunction(config, session, "shop", {
        type: "submitOrder",
        tenantId: workspace.id,
        clientRequestId: crypto.randomUUID(),
        lines: lines.map(({ item, quantity }) => ({
          catalogItemId: item.id,
          quantity,
          ...(item.kind === "loan" && args.ausleihe_von
            ? { loanFrom: args.ausleihe_von, loanUntil: args.ausleihe_bis }
            : {}),
        })),
        ...(reason ? { reason } : {}),
        ...(args.kommentar !== undefined
          ? { comment: str(args.kommentar, 0, 2000) }
          : {}),
        deliveryMethod: args.lieferung === "desk" ? "desk" : "pickup",
        ...(args.ausleihe_von ? { loanFrom: args.ausleihe_von } : {}),
        ...(args.ausleihe_bis ? { loanUntil: args.ausleihe_bis } : {}),
      });
      return textResult({
        ordered: true,
        orderId: data.orderId ?? null,
        items: lines.map(({ item, quantity }) => `${quantity}× ${item.name}`),
        approvalNeeded: lines.some(
          ({ item }) => item.requiresApproval === true,
        ),
      });
    },
  },
  {
    name: "shop_bestellungen_anzeigen",
    description:
      "Zeigt deine Shop-Bestellungen mit Status (bereich: mine, Standard). Mit bereich approvals die Bestellungen, die auf deine Freigabe warten.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    annotations: { readOnlyHint: true, title: "Shop-Bestellungen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        bereich: { type: "string", enum: ["mine", "approvals"] },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "shop", {
        type: "listOrders",
        tenantId: workspace.id,
        scope: args.bereich === "approvals" ? "approvals" : "mine",
      });
      return textResult({
        orders: records(data.orders)
          .slice(0, 50)
          .map((entry) => ({
            number: entry.orderNumber,
            status: entry.status,
            items: entry.itemsLabel,
            requester: entry.requesterName ?? null,
            approver: entry.approverName ?? null,
            neededBy: entry.neededBy ?? null,
            overdue: entry.overdue === true,
          })),
      });
    },
  },
  // ------------------------------------------------ IP-Adressverwaltung (IPAM)
  {
    name: "netzwerk_fragen",
    description:
      "Beantwortet Fragen zur IP-Adressverwaltung aus den dokumentierten Daten, z. B. «Freie IP im VLAN 67 in Baar?», «Was hängt an SW-A2-01 Port 14?», «Welche IP hat DRU-A2-KOPIE?», «Welche Subnetze sind fast voll?». Die Antwort stammt aus nextDesk; nie IP-Adressen erfinden. Eine gefundene freie IP ist nur ein Vorschlag (Reservieren mit ip_reservieren).",
    annotations: { readOnlyHint: true, title: "Netzwerk fragen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        frage: { type: "string", minLength: 2, maxLength: 500 },
      },
      required: ["frage"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const question = str(args.frage, 2, 500);
      if (!question) throw new ToolError('"frage" fehlt.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "ask",
        tenantId: workspace.id,
        question,
      });
      return textResult({
        answer: data.answer,
        query: data.intent,
        results: data.results,
      });
    },
  },
  {
    name: "freie_ip_suchen",
    description:
      "Sucht die nächste freie IP-Adresse in den Subnetzen eines VLAN (vlan: Nummer, oder vlan_name z. B. «Drucker») und optional an einem Standort. Reserviert nichts; die Reservierung braucht ip_reservieren mit Bestätigung.",
    annotations: { readOnlyHint: true, title: "Freie IP suchen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        vlan: { type: "integer", minimum: 1, maximum: 4094 },
        vlan_name: { type: "string", maxLength: 60 },
        standort: { type: "string", maxLength: 60 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const vlan = typeof args.vlan === "number" ? Math.trunc(args.vlan) : null;
      const vlanName = str(args.vlan_name, 1, 60);
      const site = str(args.standort, 1, 60);
      if (vlan === null && !vlanName && !site) {
        throw new ToolError('Gib "vlan", "vlan_name" oder "standort" an.');
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "freeAddress",
        tenantId: workspace.id,
        vlan,
        vlanName,
        site,
      });
      return textResult({
        answer: data.answer,
        free: isRecord(data.results) ? data.results.free : [],
        next: "Zum Reservieren die Person fragen und ip_reservieren mit subnetz_id und adresse sowie bestaetigt=true aufrufen.",
      });
    },
  },
  {
    name: "switchport_anzeigen",
    description:
      "Zeigt, welche dokumentierten Geräte an einem Switch-Port hängen (switch: Name wie SW-A2-01, port: z. B. 14 oder Gi1/0/14).",
    annotations: { readOnlyHint: true, title: "Switch-Port anzeigen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        switch: { type: "string", minLength: 1, maxLength: 160 },
        port: { type: "string", minLength: 1, maxLength: 80 },
      },
      required: ["switch", "port"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const switchName = str(args.switch, 1, 160);
      const port = str(args.port, 1, 80);
      if (!switchName || !port)
        throw new ToolError('"switch" und "port" angeben.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "switchPort",
        tenantId: workspace.id,
        switchName,
        port,
      });
      return textResult({ answer: data.answer, results: data.results });
    },
  },
  {
    name: "ip_nachschlagen",
    description:
      "Schlägt einen Hostnamen, eine IP- oder MAC-Adresse in der IP-Adressverwaltung nach: Status, Hostname, VLAN, Subnetz, Standort, Switch-Port, zuletzt gesehen, verknüpftes Gerät und offene Funde.",
    annotations: { readOnlyHint: true, title: "IP nachschlagen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        suche: { type: "string", minLength: 1, maxLength: 253 },
      },
      required: ["suche"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const query = str(args.suche, 1, 253);
      if (!query) throw new ToolError('"suche" fehlt.');
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "hostLookup",
        tenantId: workspace.id,
        query,
      });
      return textResult({ answer: data.answer, results: data.results });
    },
  },
  {
    name: "volle_subnetze_anzeigen",
    description:
      "Listet Subnetze, deren Belegung (inkl. DHCP-Bereich) über der Warnschwelle liegt; optional eigene schwelle in Prozent.",
    annotations: { readOnlyHint: true, title: "Volle Subnetze anzeigen" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        schwelle: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "fullPrefixes",
        tenantId: workspace.id,
        threshold:
          typeof args.schwelle === "number" ? Math.trunc(args.schwelle) : null,
      });
      return textResult({ answer: data.answer, results: data.results });
    },
  },
  {
    name: "netzwerk_zum_ticket",
    description:
      "Erkennt IP-, MAC-Adressen und Gerätenamen im Ticket (Betreff, Beschreibung, Verlauf) und zeigt die dazu dokumentierten Netzwerkdaten.",
    annotations: { readOnlyHint: true, title: "Netzwerk zum Ticket" },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "ticketLookup",
        tenantId: workspace.id,
        ticketId,
      });
      return textResult({
        detected: data.candidates,
        addresses: data.addresses,
        prefixes: data.prefixes,
      });
    },
  },
  {
    name: "ip_reservieren",
    description:
      "Reserviert eine bestimmte IP-Adresse in einem Subnetz (subnetz_id und adresse aus freie_ip_suchen). Ohne bestaetigt zeigt das Werkzeug nur den Vorschlag; erst mit bestaetigt=true nach ausdrücklicher Zustimmung der Person wird reserviert. Braucht das Recht zur IPAM-Verwaltung.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "IP reservieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        arbeitsbereich: WORKSPACE_PROPERTY,
        subnetz_id: { type: "string" },
        adresse: { type: "string", minLength: 2, maxLength: 45 },
        hostname: { type: "string", maxLength: 253 },
        beschreibung: { type: "string", maxLength: 1000 },
        bestaetigt: {
          type: "boolean",
          description:
            "Nur true, wenn die Person die Reservierung ausdrücklich bestätigt hat.",
        },
      },
      required: ["subnetz_id", "adresse"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.subnetz_id))
        throw new ToolError('"subnetz_id" fehlt (ID aus freie_ip_suchen).');
      const address = str(args.adresse, 2, 45);
      if (!address) throw new ToolError('"adresse" fehlt.');
      const hostname = str(args.hostname, 1, 253);
      const description = str(args.beschreibung, 1, 1000);
      if (args.bestaetigt !== true) {
        return draftResult("ip_reservieren", {
          subnetz_id: args.subnetz_id,
          adresse: address,
          hostname,
          beschreibung: description,
        });
      }
      const workspace = await resolveWorkspace(
        config,
        session,
        args.arbeitsbereich,
      );
      const data = await callFunction(config, session, "ipam-sync", {
        type: "reserveAddress",
        tenantId: workspace.id,
        prefixId: args.subnetz_id,
        address,
        hostname,
        description,
        confirmed: true,
      });
      return textResult({ reserved: true, reservation: data.reservation });
    },
  },
];

// ---------------------------------------------------------------- Vorlagen
//
// MCP-Prompts erscheinen in Clients wie der Gemini CLI als Slash-Befehle mit
// Feldern zum Ausfüllen (z. B. /ticket_erfassen). Sie füllen das passende
// Werkzeug zuerst als Entwurf aus; abgeschickt wird erst nach Bestätigung.

type PromptArgument = { name: string; description: string; required?: boolean };
type Prompt = {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** Was zu tun ist, bevor das Formular ausgefüllt wird (optional). */
  intro?: string;
  tool: string;
};

const DRAFT_FLOW =
  "Rufe das Werkzeug zuerst ohne bestaetigt=true auf, zeige mir den Entwurf, frage nach fehlenden Pflichtangaben und schicke erst nach meiner ausdrücklichen Bestätigung mit bestaetigt=true ab.";

const PROMPTS: Prompt[] = [
  {
    name: "it_frage",
    title: "IT-Frage stellen",
    description:
      "Frage zu Software, Geräten, Zugängen oder einem Problem. Sucht zuerst in der Wissensdatenbank und im Shop, bietet sonst ein Ticket an.",
    arguments: [
      {
        name: "frage",
        description: "Deine Frage, z. B. «Wie bekomme ich Visio?»", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
        required: true,
      },
    ],
    intro:
      "Beantworte meine IT-Frage ausschliesslich mit dem Wissen aus nextDesk: zuerst wissen_suchen (und wissensartikel_lesen für den vollen Text), bei Software oder Material zusätzlich shop_katalog_anzeigen. Erfinde keine allgemeinen Anleitungen aus dem Web. Findest du nichts, sag das und biete an, mit der Vorlage ticket_erfassen ein Ticket zu erfassen.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    tool: "wissen_suchen",
  },
  {
    name: "ticket_erfassen",
    title: "Ticket erfassen",
    description: "Neues Ticket für dich oder eine andere Person erfassen.", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    arguments: [
      { name: "betreff", description: "Kurzer Betreff", required: true },
      {
        name: "beschreibung",
        description: "Was ist passiert, seit wann, welches Gerät?",
      },
      {
        name: "prioritaet",
        description: "niedrig, normal, hoch oder dringend",
      },
      { name: "abteilung", description: "Zuständige Abteilung (Name)" },
      {
        name: "fuer_person",
        description: "Name der anfragenden Person, falls nicht du", // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
      },
      { name: "vorlage", description: "Ticketvorlage (Name)" },
    ],
    intro:
      "Falls fuer_person angegeben ist, suche die Person mit anfragende_suchen und verwende deren id als anfragende_person. Falls eine Vorlage genannt ist, prüfe sie mit ticketvorlagen_anzeigen.",
    tool: "ticket_erfassen",
  },
  {
    name: "problem_melden",
    title: "IT-Problem melden",
    description:
      "Ein IT-Problem melden. Prüft zuerst die Wissensdatenbank auf eine Lösung und erfasst sonst ein Ticket.",
    arguments: [
      {
        name: "was_ist_passiert",
        description: "Beschreibung des Problems",
        required: true,
      },
      { name: "seit_wann", description: "Seit wann besteht das Problem?" },
      { name: "geraet", description: "Betroffenes Gerät oder Programm" },
      {
        name: "dringlichkeit",
        description: "niedrig, normal, hoch oder dringend",
      },
    ],
    intro:
      "Suche zuerst mit wissen_suchen nach einer Lösung und zeige sie mir. Hilft sie nicht oder gibt es keine, erfasse ein Ticket: Betreff kurz aus der Beschreibung, Beschreibung mit allen Angaben (was, seit wann, Gerät), Priorität aus der Dringlichkeit. Schau mit servicestatus_anzeigen nach, ob eine bekannte Störung vorliegt, und erwähne sie.",
    tool: "ticket_erfassen",
  },
  {
    name: "software_anfordern",
    title: "Software anfordern",
    description:
      "Software oder Lizenz anfordern: zeigt den Weg aus der Wissensdatenbank (z. B. Unternehmensportal), bestellt im Shop oder erfasst ein Ticket.",
    arguments: [
      {
        name: "programm",
        description: "Name der Software, z. B. Visio",
        required: true,
      },
      { name: "grund", description: "Wofür brauchst du sie?" }, // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
    ],
    intro:
      "Suche zuerst mit wissen_suchen, wie man diese Software bekommt (z. B. über das Unternehmensportal), und erkläre mir den Weg. Ist sie im Shop (shop_katalog_anzeigen) bestellbar, biete die Bestellung mit im_shop_bestellen an. Gibt es beides nicht, erfasse ein Ticket mit dem Grund.",
    tool: "im_shop_bestellen",
  },
  {
    name: "antwort_schreiben",
    title: "Antwort an Anfragende",
    description: "Antwort an die anfragende Person eines Tickets schreiben.",
    arguments: [
      { name: "ticket", description: "Ticketnummer", required: true },
      {
        name: "nachricht",
        description: "Inhalt oder Stichworte der Antwort",
        required: true,
      },
      {
        name: "makro",
        description: "Antwortmakro (Name), das als Grundlage dient",
      },
    ],
    intro:
      "Lies das Ticket mit ticket_anzeigen. Falls ein Makro genannt ist, hole den Text mit makros_anzeigen und makrotext_holen. Formuliere eine freundliche, klare Antwort in der Sprache der anfragenden Person.",
    tool: "ticket_beantworten",
  },
  {
    name: "raum_buchen",
    title: "Raum buchen",
    description:
      "Raum einmalig oder als Serie buchen, mit Überschneidungsprüfung.",
    arguments: [
      { name: "raum", description: "Raumname", required: true },
      { name: "titel", description: "Anlass", required: true },
      { name: "datum", description: "Datum, z. B. 2026-11-20", required: true },
      { name: "von", description: "Beginn, z. B. 09:00", required: true },
      { name: "bis", description: "Ende, z. B. 10:30", required: true },
      {
        name: "wiederholung",
        description: "keine, woechentlich oder monatlich",
      },
      { name: "anzahl", description: "Anzahl Termine bei Wiederholung" },
      { name: "teilnehmende", description: "Erwartete Anzahl Personen" },
      {
        name: "ausstattung",
        description: "z. B. Beamer, Videocall, Mikrofone",
      },
    ],
    intro:
      "Datum und Zeiten sind Schweizer Zeit (Europe/Zurich); rechne sie in ISO 8601 mit Zeitzone um. Wähle für die Ausstattung die passenden Werte des Felds ausstattung (z. B. beamer, videokonferenz, mikrofone).",
    tool: "raum_buchen",
  },
  {
    name: "eintritt_erfassen",
    title: "Eintritt oder Austritt erfassen",
    description:
      "Eintritt (Onboarding) oder Austritt (Offboarding) einer Person erfassen.",
    arguments: [
      {
        name: "art",
        description: "eintritt oder austritt (Standard eintritt)",
      },
      { name: "name", description: "Vor- und Nachname", required: true },
      {
        name: "startdatum",
        description: "Erster Arbeitstag bzw. Austrittstag (JJJJ-MM-TT)",
        required: true,
      },
      { name: "einheit", description: "Organisationseinheit", required: true },
      { name: "standort", description: "Arbeitsort", required: true },
      {
        name: "fuehrungsperson",
        description: "Name der Führungsperson",
        required: true,
      },
      { name: "ict_verantwortung", description: "Name (Standard: du)" }, // formality-ok: MCP-Beschreibung für KI-Clients, mandantenunabhängig
      { name: "vorlage", description: "Onboarding-Vorlage (Name)" },
    ],
    tool: "eintritt_erfassen",
  },
  {
    name: "shop_bestellung",
    title: "Im Shop bestellen",
    description: "Artikel aus dem Self-Service-Shop bestellen.",
    arguments: [
      {
        name: "artikel",
        description: "Artikel (Name), mehrere mit Komma",
        required: true,
      },
      { name: "menge", description: "Menge (Standard 1)" },
      { name: "grund", description: "Wofür wird es gebraucht?" },
      { name: "lieferung", description: "abholung oder an_den_platz" },
    ],
    intro: "Suche die Artikel zuerst mit shop_katalog_anzeigen.",
    tool: "im_shop_bestellen",
  },
  {
    name: "abwesenheit_vertretung",
    title: "Abwesenheit: Stellvertretung",
    description: "Stellvertretung für eine Abwesenheit einrichten.",
    arguments: [
      {
        name: "vertretung",
        description: "Name der Person, die vertritt",
        required: true,
      },
      { name: "von", description: "Beginn (Datum und Zeit)", required: true },
      { name: "bis", description: "Ende (Datum und Zeit)", required: true },
      { name: "notiz", description: "Hinweis für die Vertretung" },
    ],
    intro:
      "Zeiten sind Schweizer Zeit (Europe/Zurich); rechne sie in ISO 8601 mit Zeitzone um. Biete danach an, für meine offenen Tickets mit uebergabe_erstellen Übergaben zu erstellen.",
    tool: "stellvertretung_einrichten",
  },
  {
    name: "uebergabe_erstellen",
    title: "Übergabe erstellen",
    description:
      "Übergabe eines Tickets (z. B. vor Abwesenheit oder Schichtwechsel).",
    arguments: [
      { name: "ticket", description: "Ticketnummer", required: true },
      { name: "zusammenfassung", description: "Stand der Dinge" },
      {
        name: "naechste_schritte",
        description: "Was ist als Nächstes zu tun?",
      },
      { name: "risiko", description: "niedrig, mittel oder hoch" },
    ],
    intro:
      "Fehlt die Zusammenfassung, schlage aus ticket_anzeigen eine vor und lass sie mich bestätigen.",
    tool: "uebergabe_erstellen",
  },
  {
    name: "freigabe_anfordern",
    title: "Freigabe anfordern",
    description: "Für ein Ticket eine Freigabe (Genehmigung) anfordern.",
    arguments: [
      { name: "ticket", description: "Ticketnummer", required: true },
      { name: "art", description: "Art, z. B. beschaffung", required: true },
      {
        name: "begruendung",
        description: "Warum wird die Freigabe gebraucht?",
        required: true,
      },
      {
        name: "anzahl_zustimmungen",
        description: "Wie viele Zustimmungen (Standard 1)",
      },
    ],
    tool: "freigabe_anfordern",
  },
  {
    name: "wissensartikel_erstellen",
    title: "Wissensartikel erstellen",
    description:
      "Neuen Wissensartikel schreiben, optional aus einer Ticketlösung.",
    arguments: [
      { name: "titel", description: "Titel des Artikels", required: true },
      { name: "inhalt", description: "Inhalt oder Stichworte" },
      {
        name: "aus_ticket",
        description: "Ticketnummer, deren Lösung als Grundlage dient",
      },
      {
        name: "sichtbarkeit",
        description: "intern oder extern (für Anfragende)",
      },
    ],
    intro:
      "Falls aus_ticket angegeben ist, lies das Ticket mit ticket_anzeigen und formuliere daraus eine Schritt-für-Schritt-Anleitung in Markdown. Biete nach dem Speichern an, den Artikel mit wissenspruefung_anfordern zur Prüfung zu geben.",
    tool: "wissensartikel_speichern",
  },
  {
    name: "stoerung_melden",
    title: "Störungsmeldung erfassen",
    description: "Interne Störungsmeldung erfassen (für das Service-Team).",
    arguments: [
      { name: "titel", description: "Kurzer Titel", required: true },
      {
        name: "beschreibung",
        description: "Was ist betroffen, welche Auswirkungen?",
        required: true,
      },
      {
        name: "status",
        description:
          "wird_untersucht, ursache_bekannt, wird_beobachtet oder behoben",
      },
      { name: "abteilung", description: "Betroffene Abteilung" },
    ],
    tool: "stoerungsmeldung_speichern",
  },
  {
    name: "zeit_erfassen",
    title: "Zeit erfassen",
    description: "Arbeitszeit auf einem Ticket erfassen.",
    arguments: [
      { name: "ticket", description: "Ticketnummer", required: true },
      { name: "minuten", description: "Dauer in Minuten", required: true },
      { name: "verrechnung", description: "intern, verrechenbar oder kulanz" },
      { name: "notiz", description: "Was wurde gemacht?" },
    ],
    intro: "Zeige mir die Angaben kurz und erfasse nach meiner Bestätigung.",
    tool: "zeit_erfassen",
  },
];

function promptMessage(prompt: Prompt, args: Json): string {
  const filled = prompt.arguments
    .map((argument) => {
      const value =
        typeof args[argument.name] === "string"
          ? String(args[argument.name]).trim()
          : "";
      return `- ${argument.description} (${argument.name}): ${value || (argument.required ? "FEHLT – bitte nachfragen" : "nicht angegeben")}`;
    })
    .join("\n");
  return [
    `Vorlage «${prompt.title}» in nextDesk.`,
    prompt.intro ?? "",
    `Verwende dafür das Werkzeug ${prompt.tool}. Angaben:`,
    filled,
    prompt.tool === "wissen_suchen" ? "" : DRAFT_FLOW,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------- Deutsch
//
// Gemini zeigt Werkzeugnamen, Felder, Auswahlwerte und Antworten an. Die
// Werkzeuge arbeiten intern mit den Schlüsseln von nextDesk (z. B.
// "in_progress"); diese Schicht zeigt sie deutsch an und übersetzt deutsche
// Eingaben vor der Ausführung zurück. Englische Werte bleiben gültig.

/** Auswahllisten: [nextDesk-Werte, deutsche Werte] in gleicher Reihenfolge. */
const ENUM_SETS: [readonly string[], readonly string[]][] = [
  [
    ["new", "in_progress", "waiting", "waiting_customer", "resolved", "closed"],
    [
      "neu",
      "in_bearbeitung",
      "wartend",
      "wartet_auf_kunde",
      "geloest",
      "geschlossen",
    ],
  ],
  [
    ["low", "normal", "high", "urgent"],
    ["niedrig", "normal", "hoch", "dringend"],
  ],
  [
    ["low", "normal", "high"],
    ["niedrig", "normal", "hoch"],
  ],
  [
    ["low", "medium", "high"],
    ["niedrig", "mittel", "hoch"],
  ],
  [
    ["mine", "open", "unassigned", "all"],
    ["meine", "offene", "nicht_zugewiesene", "alle"],
  ],
  [
    ["mine", "team", "all"],
    ["meine", "team", "alle"],
  ],
  [
    ["mine", "approvals"],
    ["meine", "freigaben"],
  ],
  [
    ["internal", "billable", "goodwill"],
    ["intern", "verrechenbar", "kulanz"],
  ],
  [
    ["internal", "external"],
    ["intern", "extern"],
  ],
  [
    ["approved", "rejected"],
    ["genehmigt", "abgelehnt"],
  ],
  [
    ["acknowledge", "resolve"],
    ["bestaetigen", "abschliessen"],
  ],
  [
    ["technical", "organizational", "sla"],
    ["fachlich", "organisatorisch", "sla"],
  ],
  [
    ["relates_to", "duplicates", "blocks", "blocked_by", "parent", "child"],
    [
      "verwandt",
      "dupliziert",
      "blockiert",
      "blockiert_durch",
      "uebergeordnet",
      "untergeordnet",
    ],
  ],
  [
    ["none", "weekly", "monthly"],
    ["keine", "woechentlich", "monatlich"],
  ],
  [
    [
      "ict_material",
      "internet_access",
      "sobe_network_access",
      "projector",
      "connections",
      "display",
      "audio",
      "videocall",
      "microphones",
      "screen",
      "reception_laptop",
    ],
    [
      "ict_material",
      "internetzugang",
      "sobe_netzwerk",
      "beamer",
      "anschluesse",
      "bildschirm",
      "audio",
      "videokonferenz",
      "mikrofone",
      "leinwand",
      "empfangs_laptop",
    ],
  ],
  [
    ["open", "in_progress", "completed"],
    ["offen", "in_bearbeitung", "erledigt"],
  ],
  [
    ["open", "in_progress", "blocked", "completed"],
    ["offen", "in_bearbeitung", "blockiert", "erledigt"],
  ],
  [
    ["planned", "in_preparation", "ready", "conducted", "completed"],
    ["geplant", "in_vorbereitung", "bereit", "durchgefuehrt", "abgeschlossen"],
  ],
  [
    ["start", "skip", "note", "check", "reopen", "reschedule", "assign"],
    [
      "starten",
      "ueberspringen",
      "notiz",
      "abhaken",
      "wieder_oeffnen",
      "neu_planen",
      "zuweisen",
    ],
  ],
  [
    ["investigating", "identified", "monitoring", "resolved"],
    ["wird_untersucht", "ursache_bekannt", "wird_beobachtet", "behoben"],
  ],
  [
    ["7d", "30d", "90d", "custom"],
    ["7_tage", "30_tage", "90_tage", "eigener"],
  ],
  [
    [
      "receipt",
      "issue",
      "transfer",
      "defect",
      "loss",
      "adjustment_in",
      "adjustment_out",
    ],
    [
      "eingang",
      "ausgabe",
      "umlagerung",
      "defekt",
      "verlust",
      "korrektur_plus",
      "korrektur_minus",
    ],
  ],
  [
    ["pickup", "desk"],
    ["abholung", "an_den_platz"],
  ],
  [
    ["onboarding", "offboarding"],
    ["eintritt", "austritt"],
  ],
];

/** Statuswerte aus nextDesk, die in Antworten vorkommen. */
const VALUE_DE: Record<string, string> = {
  operational: "in_betrieb",
  degraded: "eingeschraenkt",
  partial_outage: "teilausfall",
  major_outage: "ausfall",
  maintenance: "wartung",
  scheduled: "geplant",
  active: "aktiv",
  cancelled: "storniert",
  pending: "ausstehend",
  pending_approval: "wartet_auf_freigabe",
  loaned: "ausgeliehen",
  returned: "zurueckgegeben",
  reserved: "reserviert",
  backorder: "nachbestellt",
  issued: "ausgegeben",
  done: "erledigt",
  skipped: "uebersprungen",
  draft: "entwurf",
  review: "in_pruefung",
  published: "veroeffentlicht",
  archived: "archiviert",
  loan: "ausleihe",
};
for (const [english, german] of ENUM_SETS) {
  english.forEach((value, index) => {
    VALUE_DE[value] ??= german[index]!;
  });
}

/** Felder, deren Werte Auswahlwerte sind (vor und nach der Übersetzung). */
const VALUE_KEYS = new Set([
  "status",
  "priority",
  "prioritaet",
  "risk",
  "risiko",
  "recurrence",
  "wiederholung",
  "visibility",
  "sichtbarkeit",
  "billing",
  "verrechnung",
  "kind",
  "art",
  "type",
  "relation",
  "beziehung",
  "decision",
  "entscheid",
  "action",
  "aktion",
  "state",
  "zustand",
  "lieferung",
  "equipment",
  "ausstattung",
  "relationType",
]);

/** Feldnamen in Antworten an Gemini. */
const OUTPUT_KEYS: Record<string, string> = {
  absence: "abwesenheit",
  access: "zugang",
  acknowledged: "bestaetigt",
  action: "aktion",
  active: "aktiv",
  added: "hinzugefuegt",
  agent: "person",
  agents: "personen",
  alreadySent: "bereits_gesendet",
  approvalNeeded: "freigabe_noetig",
  approvals: "freigaben",
  approver: "freigebende_person",
  archived: "archiviert",
  articleId: "artikel_id",
  articleNumber: "artikelnummer",
  articles: "artikel",
  asset: "geraet",
  assetHistory: "geraeteverlauf",
  assets: "geraete",
  assigned: "zugewiesen",
  assignedAgent: "zustaendige_person",
  assignedTo: "zugewiesen_an",
  assignedToMe: "mir_zugewiesen",
  assignee: "zustaendig",
  assignments: "zuweisungen",
  atRisk: "gefaehrdet",
  attached: "verknuepft",
  author: "verfasser",
  autoRenew: "automatische_verlaengerung",
  available: "verfuegbar",
  averageFirstResponseMinutes: "mittlere_erstreaktion_minuten",
  averageResolutionMinutes: "mittlere_loesungszeit_minuten",
  averageReactionMinutes: "mittlere_reaktionszeit_minuten",
  billing: "verrechnung",
  body: "inhalt",
  booked: "gebucht",
  bookings: "buchungen",
  by: "von",
  canDecide: "darf_entscheiden",
  canRequest: "darf_anfordern",
  canUpdate: "darf_bearbeiten",
  canRead: "darf_lesen",
  canManage: "darf_verwalten",
  canMove: "darf_bewegen",
  canAdjust: "darf_korrigieren",
  canCloseInventoryCount: "darf_inventur_abschliessen",
  cancelled: "zurueckgezogen",
  candidates: "kandidaten",
  capacity: "kapazitaet",
  categories: "kategorien",
  category: "kategorie",
  changed: "geaendert",
  checklist: "checkliste",
  closed: "geschlossen",
  collections: "sammlungen",
  comment: "kommentar",
  comments: "kommentare",
  completed: "erledigt",
  conflicts: "ueberschneidungen",
  conflictsAccepted: "ueberschneidungen_akzeptiert",
  contracts: "vertraege",
  cost: "kosten",
  count: "anzahl",
  counterparty: "vertragspartner",
  created: "erstellt",
  createdAt: "erstellt_am",
  current: "aktuell",
  days: "tage",
  daysUntilEnd: "tage_bis_ende",
  daysUntilStart: "tage_bis_start",
  decided: "entschieden",
  decision: "entscheid",
  decisions: "entscheide",
  delegate: "vertretung",
  delegations: "stellvertretungen",
  deleted: "entfernt",
  department: "abteilung",
  departments: "abteilungen",
  description: "beschreibung",
  detached: "geloest",
  devices: "geraete",
  displayName: "name",
  done: "erledigt",
  draft: "entwurf",
  dueAt: "faellig",
  dueFollowUps: "faellige_wiedervorlagen",
  dueOn: "faellig_am",
  dueToday: "heute_faellig",
  employee: "mitarbeitende_person",
  end: "ende",
  ended: "beendet",
  endsAt: "ende",
  endsOn: "endet_am",
  entries: "eintraege",
  entry: "eintrag",
  equipment: "ausstattung",
  escalated: "eskaliert",
  escalations: "eskalationen",
  excerpt: "auszug",
  externalReplies: "externe_antworten",
  fields: "felder",
  first: "erster_termin",
  firstContactResolutionRate: "erstloesungsquote",
  firstResponseSlaCompliance: "sla_einhaltung_erstreaktion",
  followUps: "wiedervorlagen",
  from: "von",
  fulfillment: "erfuellung",
  handovers: "uebergaben",
  happyPercent: "zufrieden_prozent",
  hint: "hinweis",
  ictResponsible: "ict_verantwortung",
  importantNote: "wichtiger_hinweis",
  index: "nummer",
  inventoryNumber: "inventarnummer",
  item: "artikel",
  itemName: "artikel",
  items: "artikel",
  key: "schluessel",
  kind: "art",
  knowledgeArticles: "wissensartikel",
  kpis: "kennzahlen",
  label: "bezeichnung",
  language: "sprache",
  last: "letzter_termin",
  lastReply: "letzte_antwort",
  level: "stufe",
  licenses: "lizenzen",
  lifecycle: "lebenszyklus",
  lifecycleState: "lebenszyklus_status",
  linked: "verknuepft",
  links: "verknuepfungen",
  location: "standort",
  locationName: "lagerort",
  locations: "lagerorte",
  macros: "makros",
  maintenances: "wartungen",
  manager: "fuehrungsperson",
  manufacturer: "hersteller",
  marked: "markiert",
  maxLoanDays: "max_ausleihtage",
  maxQuantity: "max_menge",
  medianFirstResponseMinutes: "median_erstreaktion_minuten",
  medianResolutionMinutes: "median_loesungszeit_minuten",
  members: "mitglieder",
  mentions: "erwaehnungen",
  merged: "zusammengefuehrt",
  minimum: "mindestbestand",
  minutes: "minuten",
  mode: "modus",
  model: "modell",
  month: "monat",
  moreAvailable: "weitere_vorhanden",
  neededBy: "benoetigt_bis",
  neutralPercent: "neutral_prozent",
  next: "naechster_schritt",
  nextDueOn: "naechste_faelligkeit",
  noFirstResponse: "ohne_erstreaktion",
  note: "notiz",
  noticePeriodDays: "kuendigungsfrist_tage",
  notices: "meldungen",
  notifications: "benachrichtigungen",
  number: "nummer",
  occurredAt: "zeitpunkt",
  occurrences: "termine",
  offer: "angebot",
  openAssigned: "offen_zugewiesen",
  openEscalations: "offene_eskalationen",
  openReservationCount: "offene_reservationen",
  openTickets: "offene_tickets",
  openedAt: "eroeffnet_am",
  operatingSystem: "betriebssystem",
  optionalNotFilled: "optional_nicht_ausgefuellt",
  orderId: "bestellung_id",
  ordered: "bestellt",
  orders: "bestellungen",
  organization: "organisation",
  organizations: "organisationen",
  organizer: "veranstalter",
  overdue: "ueberfaellig",
  parentId: "uebergeordnet_id",
  participants: "teilnehmende",
  people: "personen",
  period: "zeitraum",
  permissions: "rechte",
  physical: "physisch",
  physicalDelta: "veraenderung",
  planned: "geplant",
  posted: "gebucht",
  preferredContactChannel: "bevorzugter_kontaktweg",
  preview: "vorschau",
  previous: "vorperiode",
  priority: "prioritaet",
  profile: "profil",
  published: "veroeffentlicht",
  qualityAverage: "qualitaet_schnitt",
  qualityReviews: "qualitaet_bewertungen",
  quantity: "menge",
  queues: "warteschlangen",
  read: "gelesen",
  reason: "begruendung",
  reasons: "gruende",
  reassigned: "umverteilt",
  received: "eingegangen",
  recentEvents: "letzte_bewegungen",
  recurrence: "wiederholung",
  reference: "referenz",
  relation: "beziehung",
  relations: "verknuepfungen",
  released: "freigegeben",
  replied: "beantwortet",
  requested: "angefordert",
  requestedAt: "angefordert_am",
  requestedBy: "angefordert_von",
  requester: "anfragende_person",
  requesterAvailability: "erreichbarkeit",
  requesterContactId: "anfragende_person_id",
  requesterId: "anfragende_person_id",
  requesterTickets: "tickets_der_person",
  requesters: "anfragende",
  requiredApprovals: "noetige_zustimmungen",
  requiresApproval: "freigabe_noetig",
  reservations: "reservationen",
  reserved: "reserviert",
  reservedDelta: "veraenderung_reserviert",
  resolutionMinutes: "loesungszeit_minuten",
  resolutionSlaCompliance: "sla_einhaltung_loesung",
  resolved: "geloest",
  resolvedAt: "geloest_am",
  resolvedLast30Days: "geloest_letzte_30_tage",
  responseMinutes: "reaktionszeit_minuten",
  responses: "antworten",
  responsible: "verantwortlich",
  result: "ergebnis",
  results: "ergebnisse",
  revision: "fassung",
  revisions: "fassungen",
  risk: "risiko",
  room: "raum",
  rooms: "raeume",
  rules: "regeln",
  satisfaction: "zufriedenheit",
  satisfactionAverage: "zufriedenheit_schnitt",
  satisfactionResponses: "zufriedenheit_antworten",
  saved: "gespeichert",
  score: "punktzahl",
  searchedFor: "gesucht_nach",
  section: "bereich",
  sent: "gesendet",
  sentToRequester: "an_anfragende_gesendet",
  serialNumber: "seriennummer",
  series: "serie",
  serviceHours: "servicezeiten",
  slaCompliancePercent: "sla_einhaltung_prozent",
  slaDue: "sla_faellig",
  solvedToday: "heute_geloest",
  sources: "quellen",
  start: "beginn",
  startsAt: "beginn",
  startsOn: "beginnt_am",
  state: "zustand",
  subcategories: "unterkategorien",
  subcategory: "unterkategorie",
  subject: "betreff",
  suggestions: "vorschlaege",
  summary: "zusammenfassung",
  surveysSent: "umfragen_gesendet",
  targets: "ziele",
  task: "aufgabe",
  tasks: "aufgaben",
  template: "vorlage",
  templates: "vorlagen",
  thisWeek: "diese_woche",
  ticketAccess: "ticketzugriff",
  ticketsAssigned: "tickets_zugewiesen",
  ticketsResolved: "tickets_geloest",
  title: "titel",
  to: "nach",
  today: "heute",
  total: "gesamt",
  trackedMinutes: "erfasste_minuten",
  truncated: "gekuerzt",
  type: "art",
  unassigned: "nicht_zugewiesen",
  unhappyPercent: "unzufrieden_prozent",
  unit: "einheit",
  unresolved: "ungeloest",
  until: "bis",
  upcoming: "anstehend",
  updated: "aktualisiert",
  updatedAt: "aktualisiert_am",
  userId: "person_id",
  vendor: "hersteller",
  visibility: "sichtbarkeit",
  watchers: "beobachtende",
  watching: "beobachtet",
  weekMinutes: "wochenminuten",
  weekdays: "wochentage",
  workspace: "arbeitsbereich",
  workspaces: "arbeitsbereiche",
};

function germanEnum(values: readonly unknown[]): readonly string[] | null {
  const key = JSON.stringify(values);
  const set = ENUM_SETS.find(([english]) => JSON.stringify(english) === key);
  return set ? set[1] : null;
}

/** Englische Auswahlwerte eines Werkzeugs im Text durch deutsche ersetzen. */
function localizeText(text: string, pairs: [string, string][]): string {
  let result = text;
  for (const [english, german] of pairs) {
    if (english === german) continue;
    result = result.replace(
      new RegExp(`(?<![\\w-])${english}(?![\\w-])`, "g"),
      german,
    );
  }
  return result;
}

function enumPairs(schema: unknown, pairs: [string, string][] = []) {
  if (!isRecord(schema)) return pairs;
  if (Array.isArray(schema.enum)) {
    const german = germanEnum(schema.enum);
    if (german) {
      schema.enum.forEach((value, index) =>
        pairs.push([String(value), german[index]!]),
      );
    }
  }
  for (const value of Object.values(schema)) {
    if (isRecord(value)) enumPairs(value, pairs);
  }
  return pairs;
}

/** Schema mit deutschen Auswahlwerten und Beschreibungen (tiefe Kopie). */
function localizeSchema(schema: unknown, pairs: [string, string][]): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => localizeSchema(entry, pairs));
  }
  if (!isRecord(schema)) return schema;
  const result: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enum" && Array.isArray(value)) {
      result.enum = germanEnum(value) ?? value;
    } else if (key === "description" && typeof value === "string") {
      result.description = localizeText(value, pairs);
    } else {
      result[key] = localizeSchema(value, pairs);
    }
  }
  return result;
}

/** Deutsche Auswahlwerte in Eingaben auf die Werte von nextDesk abbilden. */
function translateInput(
  schema: unknown,
  value: unknown,
  field: string,
): unknown {
  if (!isRecord(schema)) return value;
  if (Array.isArray(schema.enum) && typeof value === "string") {
    const english = schema.enum.map(String);
    const german = germanEnum(schema.enum) ?? english;
    const normalized = value
      .trim()
      .toLocaleLowerCase("de-CH")
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replace(/[\s-]+/g, "_");
    const index = german.indexOf(normalized);
    if (index >= 0) return english[index];
    if (english.includes(value)) return value;
    throw new ToolError(
      `Ungültiger Wert für "${field}". Erlaubt: ${german.join(", ")}.`,
    );
  }
  if (Array.isArray(value) && isRecord(schema.items)) {
    return value.map((entry) => translateInput(schema.items, entry, field));
  }
  if (isRecord(value) && isRecord(schema.properties)) {
    const result: Json = { ...value };
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (key in result) {
        result[key] = translateInput(propertySchema, result[key], key);
      }
    }
    return result;
  }
  return value;
}

/** Antworten: deutsche Feldnamen und Auswahlwerte. */
function localizeOutput(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => localizeOutput(entry, key));
  }
  if (isRecord(value)) {
    const result: Json = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[OUTPUT_KEYS[entryKey] ?? entryKey] = localizeOutput(
        entryValue,
        entryKey,
      );
    }
    return result;
  }
  if (typeof value === "string" && VALUE_KEYS.has(key)) {
    return VALUE_DE[value] ?? value;
  }
  return value;
}

// ---------------------------------------------------------------- JSON-RPC

function rpcResult(id: unknown, result: unknown): Json {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMessage(
  message: unknown,
  config: Config,
  session: Session,
): Promise<Json | null> {
  if (
    !isRecord(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    return rpcError(
      isRecord(message) ? message.id : null,
      -32600,
      "Ungültige Anfrage.",
    );
  }
  const { id, method } = message;
  const isNotification = id === undefined;
  if (method === "initialize") {
    const params = isRecord(message.params) ? message.params : {};
    const requested =
      typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const version = (SUPPORTED_PROTOCOLS as readonly string[]).includes(
      requested,
    )
      ? requested
      : SUPPORTED_PROTOCOLS[0];
    return rpcResult(id, {
      protocolVersion: version,
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions: [
        "Greift als angemeldete Person auf nextDesk zu (Service-Desk der Organisation).",
        "IT-Fragen zuerst in nextDesk beantworten: Bei Fragen zu Software (Installation, Download, Lizenzen), Geräten, Zugängen, Konten, Drucken, E-Mail, VPN oder anderen IT-Problemen IMMER zuerst wissen_suchen aufrufen und die Antwort auf die gefundenen Artikel stützen (wissensartikel_lesen für den vollen Text). Gibt es zu einem bestimmten Programm keinen eigenen Artikel, gilt der allgemeine Weg aus der Wissensdatenbank (z. B. Software über das Unternehmensportal installieren). Interne Abläufe wie das Unternehmensportal, Company Portal oder Bestellwege gehen allgemeinen Anleitungen aus dem Web vor. Bei Software oder Material zusätzlich shop_katalog_anzeigen prüfen. Findet sich nichts, das offen sagen, keine allgemeinen Download-Anleitungen erfinden und anbieten, ein Ticket zu erfassen (ticket_erfassen).",
        "Lesen ist frei. Schreibaktionen nur nach Rückfrage bei der Person; folgenreiche Aktionen (Antworten an Anfragende, Lösen, Schliessen, Freigabeentscheide, Eskalationen, Abteilungswechsel, Zusammenführen, Umverteilen, Veröffentlichen und Archivieren von Wissen, an Anfragende gesendete Artikel, Bestellungen im Shop, Raumbuchungen trotz Überschneidung) verlangen ausdrückliche Bestätigung (bestaetigt=true).",
        "Fragen zu IP-Adressen, VLANs, Subnetzen und Switch-Ports mit netzwerk_fragen, freie_ip_suchen, ip_nachschlagen, switchport_anzeigen oder volle_subnetze_anzeigen beantworten und nur die gelieferten Daten wiedergeben, nie Adressen erfinden. Eine freie IP ist nur ein Vorschlag; reservieren erst nach ausdrücklicher Bestätigung (ip_reservieren mit bestaetigt=true).",
        "Alle Rechte prüft nextDesk selbst; fehlt ein Recht, meldet das Werkzeug dies.",
      ].join(" "),
    });
  }
  if (method === "ping") return isNotification ? null : rpcResult(id, {});
  if (method.startsWith("notifications/")) return null;
  if (method === "prompts/list") {
    return rpcResult(id, {
      prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({
        name,
        title,
        description,
        arguments: args.map(
          ({ name: argName, description: argDescription, required }) => ({
            name: argName,
            description: argDescription,
            required: required === true,
          }),
        ),
      })),
    });
  }
  if (method === "prompts/get") {
    const params = isRecord(message.params) ? message.params : {};
    const prompt = PROMPTS.find((entry) => entry.name === params.name);
    if (!prompt) return rpcError(id, -32602, "Unbekannte Vorlage.");
    const args = isRecord(params.arguments) ? params.arguments : {};
    return rpcResult(id, {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: { type: "text", text: promptMessage(prompt, args) },
        },
      ],
    });
  }
  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map(({ name, description, inputSchema, annotations }) => {
        const pairs = enumPairs(inputSchema);
        return {
          name,
          // Deutscher Anzeigename für Clients, die das Feld title auswerten.
          ...(typeof annotations.title === "string"
            ? { title: annotations.title }
            : {}),
          description: localizeText(description, pairs),
          inputSchema: localizeSchema(inputSchema, pairs),
          annotations,
        };
      }),
    });
  }
  if (method === "tools/call") {
    const params = isRecord(message.params) ? message.params : {};
    const tool = TOOLS.find((entry) => entry.name === params.name);
    if (!tool) return rpcError(id, -32602, "Unbekanntes Werkzeug.");
    const raw = isRecord(params.arguments) ? params.arguments : {};
    try {
      const args = translateInput(tool.inputSchema, raw, "") as Json;
      return rpcResult(id, await tool.run(config, session, args));
    } catch (error) {
      const text =
        error instanceof ToolError
          ? error.message
          : "Die Aktion konnte nicht ausgeführt werden.";
      const result: ToolResult = {
        content: [{ type: "text", text }],
        isError: true,
      };
      return rpcResult(id, result);
    }
  }
  return isNotification
    ? null
    : rpcError(id, -32601, "Methode nicht unterstützt.");
}

// ---------------------------------------------------------------- HTTP

function readConfig(): Config | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  return supabaseUrl && anonKey
    ? { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey }
    : null;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extra: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function resourceUrl(config: Config): string {
  return `${config.supabaseUrl}/functions/v1/mcp`;
}

function unauthorized(config: Config): Response {
  return jsonResponse(
    { error: "unauthorized", error_description: "Anmeldung erforderlich." },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceUrl(config)}/.well-known/oauth-protected-resource"`,
    },
  );
}

/** Prüft das Zugriffstoken beim Auth-Server (auch widerrufene Sitzungen fallen durch). */
async function authenticate(
  request: Request,
  config: Config,
): Promise<Session | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const token = match[1]!;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) return null;
  const user: unknown = await response.json().catch(() => null);
  return isRecord(user) && isUuid(user.id) && user.is_anonymous !== true
    ? { token, userId: user.id }
    : null;
}

async function handler(request: Request): Promise<Response> {
  const config = readConfig();
  if (!config) return jsonResponse({ error: "not_configured" }, 503);
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    url.pathname.endsWith("/.well-known/oauth-protected-resource")
  ) {
    return jsonResponse({
      resource: resourceUrl(config),
      authorization_servers: [`${config.supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "nextDesk",
    });
  }
  // MCP-Clients wie die Gemini CLI fragen zuerst per HEAD oder GET, ob eine
  // Anmeldung nötig ist, und lesen den Hinweis auf die OAuth-Metadaten aus der
  // 401-Antwort.
  if (
    (request.method === "HEAD" || request.method === "GET") &&
    !request.headers.get("authorization")
  ) {
    return unauthorized(config);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      Allow: "POST, OPTIONS",
    });
  }

  const session = await authenticate(request, config);
  if (!session) return unauthorized(config);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return jsonResponse(rpcError(null, -32600, "Anfrage zu gross."), 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(rpcError(null, -32700, "Ungültiges JSON."), 400);
  }

  if (Array.isArray(body)) {
    const replies = (
      await Promise.all(
        body.slice(0, 20).map((entry) => handleMessage(entry, config, session)),
      )
    ).filter((reply): reply is Json => reply !== null);
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : jsonResponse(replies);
  }
  const reply = await handleMessage(body, config, session);
  return reply === null
    ? new Response(null, { status: 202 })
    : jsonResponse(reply);
}

export default {
  fetch(request: Request): Response | Promise<Response> {
    return handler(request);
  },
};
