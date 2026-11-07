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
const SERVER_INFO = { name: "nextdesk", version: "1.4.0" } as const;
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
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
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
    `Mehrere Arbeitsbereiche verfügbar, bitte "workspace" angeben: ${workspaces.map((workspace) => workspace.slug).join(", ")}.`,
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
  const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "list_workspaces",
    description:
      "Listet die Arbeitsbereiche (Mandanten), auf die du Zugriff hast.",
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
    name: "search_tickets",
    description:
      "Sucht Tickets. scope: mine (mir zugewiesen), open (offen, Standard), unassigned (nicht zugewiesen), all.",
    annotations: { readOnlyHint: true, title: "Tickets suchen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: {
          type: "string",
          description: "Suchtext in Nummer, Betreff oder Beschreibung.",
        },
        scope: { type: "string", enum: ["mine", "open", "unassigned", "all"] },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const scope = typeof args.scope === "string" ? args.scope : "open";
      if (!["mine", "open", "unassigned", "all"].includes(scope)) {
        throw new ToolError("Ungültiger scope.");
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
        limit: String(clampLimit(args.limit, 10, 25)),
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
      const text = filterText(args.query);
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
    name: "get_ticket",
    description:
      "Zeigt ein Ticket mit Beschreibung und Verlauf. ticket: Ticketnummer (z. B. ICT-2026-000011) oder ID.",
    annotations: { readOnlyHint: true, title: "Ticket anzeigen" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY, ticket: { type: "string" } },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "search_knowledge",
    description: "Durchsucht die Wissensdatenbank nach Artikeln.",
    annotations: { readOnlyHint: true, title: "Wissen durchsuchen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const query = str(args.query, 1, 120);
      if (!query) throw new ToolError('"query" fehlt.');
      const data = await callFunction(config, session, "knowledge-base", {
        type: "listArticles",
        tenantId: workspace.id,
        query,
      });
      const articles = Array.isArray(data.articles)
        ? data.articles.filter(isRecord)
        : [];
      return textResult({
        count: articles.length,
        articles: articles
          .slice(0, clampLimit(args.limit, 8, 20))
          .map((article) => ({
            id: article.id,
            title: article.title,
            summary: clip(article.summary, 300),
            updatedAt: article.updated_at ?? article.updatedAt ?? null,
          })),
      });
    },
  },
  {
    name: "get_knowledge_article",
    description: "Liest einen Wissensartikel (id aus search_knowledge).",
    annotations: { readOnlyHint: true, title: "Wissensartikel lesen" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY, id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "find_asset",
    description:
      "Sucht Geräte (Assets) nach Name, Inventarnummer, Asset-Tag oder Seriennummer.",
    annotations: { readOnlyHint: true, title: "Gerät suchen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const query = str(args.query, 1, 120);
      if (!query) throw new ToolError('"query" fehlt.');
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
          .slice(0, clampLimit(args.limit, 10, 20))
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
    name: "create_ticket",
    description:
      "Erfasst ein neues Ticket, für dich selbst oder für eine anfragende Person (requester aus search_requesters). Frage vorher nach, ob das Ticket wirklich erfasst werden soll.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        subject: { type: "string", minLength: 3, maxLength: 240 },
        description: { type: "string", maxLength: 8000 },
        priority: { type: "string", enum: PRIORITY_KEYS },
        department: {
          type: "string",
          description: "Abteilung (Name). Standard: die erste.",
        },
        requester: {
          type: "string",
          description:
            "ID der anfragenden Person aus search_requesters. Ohne Angabe wird das Ticket für dich selbst erfasst.",
        },
      },
      required: ["subject"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const subject = str(args.subject, 3, 240);
      if (!subject)
        throw new ToolError('"subject" muss 3 bis 240 Zeichen lang sein.');
      const description =
        typeof args.description === "string" && args.description.trim()
          ? clip(args.description.trim(), 8000)
          : subject;
      const options = await callFunction(config, session, "ticket-actions", {
        type: "getFormOptions",
        tenantId: workspace.id,
      });
      const departments = Array.isArray(options.departments)
        ? options.departments.filter(isRecord)
        : [];
      const requester = isRecord(options.currentRequester)
        ? options.currentRequester
        : null;
      const requested =
        typeof args.department === "string"
          ? args.department.trim().toLocaleLowerCase("de-CH")
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
      if (args.requester !== undefined && !isUuid(args.requester)) {
        throw new ToolError(
          '"requester" ist ungültig (ID aus search_requesters).',
        );
      }
      const requesterId = isUuid(args.requester)
        ? args.requester
        : requester && typeof requester.id === "string"
          ? requester.id
          : null;
      if (!requesterId) {
        throw new ToolError(
          "Für dein Konto ist keine anfragende Person hinterlegt. Gib requester an (search_requesters).",
        );
      }
      const priority =
        typeof args.priority === "string" ? args.priority : "normal";
      const created = await callFunction(config, session, "ticket-actions", {
        type: "createTicket",
        tenantId: workspace.id,
        departmentId: department.id,
        priorityKey: priority,
        requesterContactId: requesterId,
        subject,
        description: `${description}\n\n${CONNECTOR_NOTE}`,
      });
      return textResult({
        created: true,
        number: created.ticketNumber ?? null,
        workspace: workspace.slug,
      });
    },
  },
  {
    name: "add_internal_note",
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
        workspace: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        text: { type: "string", minLength: 1, maxLength: 8000 },
      },
      required: ["ticket", "text"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "update_ticket_status",
    description:
      "Ändert den Status eines Ticketauftrags. Für resolved (gelöst) und closed (geschlossen) muss die Person vorher ausdrücklich zugestimmt haben; setze dann confirm auf true. Anfragende werden dabei von nextDesk informiert.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticketstatus ändern",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        status: { type: "string", enum: STATUS_KEYS },
        confirm: {
          type: "boolean",
          description:
            "Nur true, wenn die Person das Lösen oder Schliessen ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const status = typeof args.status === "string" ? args.status : "";
      if (!STATUS_KEYS.includes(status)) {
        throw new ToolError(
          `Ungültiger Status. Erlaubt: ${STATUS_KEYS.join(", ")}.`,
        );
      }
      const closing = status === "resolved" || status === "closed";
      if (closing && args.confirm !== true) {
        throw new ToolError(
          "Das Lösen oder Schliessen braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit confirm=true.",
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
    name: "assign_ticket_to_me",
    description:
      "Weist ein Ticket dir selbst (der angemeldeten Person) zu. Das Zuweisen an andere Personen ist nicht möglich.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket mir zuweisen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "reply_to_ticket",
    description:
      "Antwortet im Ticket an die anfragende Person. Der Text ist für sie sichtbar und wird ihr in der Regel per E-Mail zugestellt. Zeige der Person den Text vorher und setze confirm erst nach ihrer ausdrücklichen Zustimmung auf true. Für interne Hinweise add_internal_note verwenden.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Auf Ticket antworten",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: { type: "string", description: "Ticketnummer oder ID." },
        text: { type: "string", minLength: 1, maxLength: 8000 },
        confirm: {
          type: "boolean",
          description:
            "Nur true, wenn die Person den Wortlaut ausdrücklich freigegeben hat.",
        },
      },
      required: ["ticket", "text", "confirm"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.confirm !== true) {
        throw new ToolError(
          "Die Antwort ist für die anfragende Person sichtbar. Zeige der Person den Text, frage nach und wiederhole den Aufruf danach mit confirm=true.",
        );
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
        body: text,
        visibility: "external",
      });
      return textResult({ replied: true });
    },
  },
  {
    name: "set_ticket_priority",
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
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        priority: { type: "string", enum: PRIORITY_KEYS },
      },
      required: ["ticket", "priority"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const priority = typeof args.priority === "string" ? args.priority : "";
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
    name: "add_time_entry",
    description:
      "Erfasst Arbeitszeit auf einem Ticket (in Minuten). billing: internal (Standard), billable (verrechenbar) oder goodwill (Kulanz).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Zeit erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        minutes: { type: "integer", minimum: 1, maximum: 1440 },
        billing: { type: "string", enum: BILLING_KINDS },
        note: { type: "string", maxLength: 2900 },
      },
      required: ["ticket", "minutes"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const minutes = args.minutes;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 1440
      ) {
        throw new ToolError(
          '"minutes" muss eine ganze Zahl von 1 bis 1440 sein.',
        );
      }
      const billing =
        typeof args.billing === "string" ? args.billing : "internal";
      if (!BILLING_KINDS.includes(billing)) {
        throw new ToolError(
          `Ungültige Verrechnungsart. Erlaubt: ${BILLING_KINDS.join(", ")}.`,
        );
      }
      const note = args.note === undefined ? null : str(args.note, 1, 2900);
      if (args.note !== undefined && !note) {
        throw new ToolError('"note" muss 1 bis 2900 Zeichen lang sein.');
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
    name: "add_checklist_item",
    description: "Fügt der Checkliste eines Tickets einen Punkt hinzu.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Checklistenpunkt hinzufügen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
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
    name: "set_checklist_item",
    description:
      "Hakt einen Checklistenpunkt eines Tickets ab oder öffnet ihn wieder. item: id aus get_ticket (checklist).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Checklistenpunkt abhaken",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        item: { type: "string", description: "ID des Checklistenpunkts." },
        done: { type: "boolean", description: "Standard: true." },
      },
      required: ["ticket", "item"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.item)) throw new ToolError('"item" ist ungültig.');
      if (args.done !== undefined && typeof args.done !== "boolean") {
        throw new ToolError('"done" muss true oder false sein.');
      }
      const done = args.done !== false;
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "toggleChecklistItem",
        tenantId: workspace.id,
        ticketId,
        itemId: args.item,
        completed: done,
      });
      return textResult({ updated: true, done });
    },
  },
  {
    name: "watch_ticket",
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
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        watching: { type: "boolean", description: "Standard: true." },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.watching !== undefined && typeof args.watching !== "boolean") {
        throw new ToolError('"watching" muss true oder false sein.');
      }
      const watching = args.watching !== false;
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
    name: "global_search",
    description:
      "Durchsucht den Arbeitsbereich gleichzeitig nach Tickets, Wiedervorlagen, Wissensartikeln, Veranstaltungsräumen und Eintritten.",
    annotations: { readOnlyHint: true, title: "Überall suchen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: { type: "string", minLength: 2, maxLength: 120 },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const query = str(args.query, 2, 120);
      if (!query)
        throw new ToolError('"query" muss 2 bis 120 Zeichen lang sein.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "global-search", {
        tenantId: workspace.id,
        query,
      });
      const results = Array.isArray(data.results)
        ? data.results.filter(isRecord)
        : [];
      return textResult({
        count: results.length,
        results: results
          .slice(0, clampLimit(args.limit, 15, 30))
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
    name: "list_notifications",
    description: "Listet deine nextDesk-Benachrichtigungen (neueste zuerst).",
    annotations: { readOnlyHint: true, title: "Benachrichtigungen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        unreadOnly: { type: "boolean", description: "Standard: true." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "notification-center", {
        type: "list",
        tenantId: workspace.id,
        unreadOnly: args.unreadOnly !== false,
        limit: clampLimit(args.limit, 20, 50),
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
    name: "mark_notifications_read",
    description:
      "Markiert eine Benachrichtigung (id aus list_notifications) oder ohne id alle Benachrichtigungen des Arbeitsbereichs als gelesen.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Benachrichtigungen gelesen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
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
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "notification-center", {
        type: "markAllRead",
        tenantId: workspace.id,
      });
      return textResult({ marked: data.markedReadCount ?? null });
    },
  },
  {
    name: "list_pending_approvals",
    description:
      "Listet Ticketfreigaben, die auf deinen Entscheid warten (Genehmigungseingang).",
    annotations: { readOnlyHint: true, title: "Offene Freigaben" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "decide_approval",
    description:
      "Genehmigt oder lehnt eine Ticketfreigabe ab (id aus list_pending_approvals). Nur nach ausdrücklicher Zustimmung der Person; setze dann confirm auf true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Freigabe entscheiden",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        approval: { type: "string", description: "ID der Freigabe." },
        decision: { type: "string", enum: ["approved", "rejected"] },
        comment: { type: "string", maxLength: 2000 },
        confirm: {
          type: "boolean",
          description:
            "Nur true, wenn die Person den Entscheid ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "approval", "decision", "confirm"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.confirm !== true) {
        throw new ToolError(
          "Ein Freigabeentscheid braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit confirm=true.",
        );
      }
      if (!isUuid(args.approval))
        throw new ToolError('"approval" ist ungültig.');
      if (args.decision !== "approved" && args.decision !== "rejected") {
        throw new ToolError('"decision" muss approved oder rejected sein.');
      }
      const comment =
        args.comment === undefined ? null : str(args.comment, 1, 2000);
      if (args.comment !== undefined && !comment) {
        throw new ToolError('"comment" muss 1 bis 2000 Zeichen lang sein.');
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
        approvalId: args.approval,
        decision: args.decision,
        ...(comment ? { comment } : {}),
      });
      return textResult({ decided: true, decision: args.decision });
    },
  },
  {
    name: "list_service_tasks",
    description:
      "Zeigt Serviceaufgaben: überfällige, heute fällige und kommende. scope: mine (Standard), team, all.",
    annotations: { readOnlyHint: true, title: "Serviceaufgaben" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        scope: { type: "string", enum: ["mine", "team", "all"] },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const scope = typeof args.scope === "string" ? args.scope : "mine";
      if (!["mine", "team", "all"].includes(scope)) {
        throw new ToolError("Ungültiger scope.");
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "complete_service_task",
    description:
      "Schliesst eine Serviceaufgabe als erledigt ab (id aus list_service_tasks). Manche Aufgaben verlangen eine Notiz zum Ergebnis.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Serviceaufgabe erledigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        task: { type: "string", description: "ID der Serviceaufgabe." },
        note: { type: "string", maxLength: 3900 },
      },
      required: ["task"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.task)) throw new ToolError('"task" ist ungültig.');
      const note = args.note === undefined ? null : str(args.note, 1, 3900);
      if (args.note !== undefined && !note) {
        throw new ToolError('"note" muss 1 bis 3900 Zeichen lang sein.');
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      await callFunction(config, session, "service-tasks", {
        type: "updateOccurrence",
        tenantId: workspace.id,
        occurrenceId: args.task,
        action: "complete",
        ...(note ? { note: `${note}\n\n${CONNECTOR_NOTE}` } : {}),
      });
      return textResult({ completed: true });
    },
  },

  // ------------------------------------------------ Anfragende Personen
  {
    name: "search_requesters",
    description:
      "Sucht anfragende Personen (Kundinnen und Kunden) nach Name. Die id wird für create_ticket (requester) verwendet.",
    annotations: { readOnlyHint: true, title: "Anfragende suchen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: { type: "string", minLength: 2, maxLength: 120 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const query = str(args.query, 2, 120);
      if (!query)
        throw new ToolError('"query" muss 2 bis 120 Zeichen lang sein.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "list_follow_ups",
    description:
      "Listet deine Wiedervorlagen (Erinnerungen), standardmässig nur offene. Optional nur die eines Tickets.",
    annotations: { readOnlyHint: true, title: "Wiedervorlagen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: {
          ...TICKET_PROPERTY,
          description: "Nur Wiedervorlagen dieses Tickets.",
        },
        includeResolved: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
        includeResolved: args.includeResolved === true,
        limit: clampLimit(args.limit, 30, 100),
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
    name: "create_follow_up",
    description:
      "Erstellt eine Wiedervorlage (Erinnerung) für dich, optional zu einem Ticket. dueAt als Datum/Zeit mit Zeitzone, z. B. 2026-11-10T08:00:00+01:00.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wiedervorlage erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        title: { type: "string", minLength: 1, maxLength: 240 },
        description: { type: "string", maxLength: 4900 },
        dueAt: { type: "string", description: "Fälligkeit (ISO 8601)." },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        ticket: TICKET_PROPERTY,
      },
      required: ["title"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.title, 1, 240);
      if (!title)
        throw new ToolError('"title" muss 1 bis 240 Zeichen lang sein.');
      const description =
        args.description === undefined ? null : str(args.description, 1, 4900);
      if (args.description !== undefined && !description) {
        throw new ToolError('"description" muss 1 bis 4900 Zeichen lang sein.');
      }
      const dueAt = args.dueAt === undefined ? null : isoDate(args.dueAt);
      if (args.dueAt !== undefined && !dueAt) {
        throw new ToolError('"dueAt" ist kein gültiges Datum.');
      }
      const priority =
        typeof args.priority === "string" ? args.priority : "normal";
      if (!["low", "normal", "high"].includes(priority)) {
        throw new ToolError('"priority" muss low, normal oder high sein.');
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "resolve_follow_up",
    description: "Erledigt eine Wiedervorlage (id aus list_follow_ups).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Wiedervorlage erledigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        id: { type: "string", description: "ID der Wiedervorlage." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "list_mentions",
    description:
      "Listet Erwähnungen von dir in Ticketnotizen (@-Erwähnungen), standardmässig nur ungelesene.",
    annotations: { readOnlyHint: true, title: "Erwähnungen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        unreadOnly: { type: "boolean", description: "Standard: true." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listMentions",
        tenantId: workspace.id,
        onlyMine: true,
      });
      const mentions = records(data.mentions)
        .filter((entry) => args.unreadOnly === false || entry.read_at === null)
        .slice(0, clampLimit(args.limit, 20, 50));
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
    name: "mark_mention_read",
    description: "Markiert eine Erwähnung (id aus list_mentions) als gelesen.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Erwähnung gelesen",
    },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY, id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.id)) throw new ToolError('"id" ist ungültig.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
      await callFunction(config, session, "agent-workbench", {
        type: "markMentionRead",
        tenantId: workspace.id,
        mentionId: args.id,
      });
      return textResult({ read: true });
    },
  },
  {
    name: "my_metrics",
    description:
      "Deine persönlichen Kennzahlen: offene zugewiesene Tickets, heute gelöst, mittlere Erstreaktions- und Lösungszeit, fällige SLA.",
    annotations: { readOnlyHint: true, title: "Meine Kennzahlen" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "team_queues",
    description:
      "Zeigt die offenen Tickets je Abteilung und Team (Warteschlangen), die du sehen kannst.",
    annotations: { readOnlyHint: true, title: "Warteschlangen" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "list_handovers",
    description:
      "Zeigt die Übergaben eines Tickets (Zusammenfassung, nächste Schritte, Risiko).",
    annotations: { readOnlyHint: true, title: "Übergaben" },
    inputSchema: {
      type: "object",
      properties: { workspace: WORKSPACE_PROPERTY, ticket: TICKET_PROPERTY },
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
    name: "create_handover",
    description:
      "Erstellt eine Übergabe für ein Ticket (z. B. vor Abwesenheit oder Schichtwechsel). risk: low, medium (Standard), high.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Übergabe erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        summary: { type: "string", minLength: 3, maxLength: 2000 },
        nextSteps: { type: "string", maxLength: 3000 },
        risk: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["ticket", "summary"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const summary = str(args.summary, 3, 2000);
      if (!summary)
        throw new ToolError('"summary" muss 3 bis 2000 Zeichen lang sein.');
      const nextSteps =
        args.nextSteps === undefined ? null : str(args.nextSteps, 1, 3000);
      if (args.nextSteps !== undefined && !nextSteps) {
        throw new ToolError('"nextSteps" muss 1 bis 3000 Zeichen lang sein.');
      }
      const risk = typeof args.risk === "string" ? args.risk : "medium";
      if (!["low", "medium", "high"].includes(risk)) {
        throw new ToolError('"risk" muss low, medium oder high sein.');
      }
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
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
    name: "acknowledge_handover",
    description:
      "Bestätigt den Empfang einer Übergabe (acknowledge) oder schliesst sie ab (resolve). id aus list_handovers.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Übergabe bestätigen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        id: { type: "string", description: "ID der Übergabe." },
        action: {
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
      const action = args.action === "resolve" ? "resolve" : "acknowledge";
      if (args.action !== undefined && args.action !== action) {
        throw new ToolError('"action" muss acknowledge oder resolve sein.');
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
    name: "escalate_ticket",
    description:
      "Eskaliert ein Ticket. kind: technical (fachlich), organizational (organisatorisch) oder sla. Eine Eskalation benachrichtigt weitere Personen; nur nach ausdrücklicher Zustimmung der Person mit confirm=true.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ticket eskalieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        kind: { type: "string", enum: ["technical", "organizational", "sla"] },
        reason: { type: "string", minLength: 3, maxLength: 2000 },
        confirm: {
          type: "boolean",
          description:
            "Nur true, wenn die Person die Eskalation ausdrücklich bestätigt hat.",
        },
      },
      required: ["ticket", "kind", "reason", "confirm"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (args.confirm !== true) {
        throw new ToolError(
          "Eine Eskalation braucht die ausdrückliche Bestätigung der Person. Frage nach und wiederhole den Aufruf danach mit confirm=true.",
        );
      }
      if (!["technical", "organizational", "sla"].includes(String(args.kind))) {
        throw new ToolError(
          '"kind" muss technical, organizational oder sla sein.',
        );
      }
      const reason = str(args.reason, 3, 2000);
      if (!reason)
        throw new ToolError('"reason" muss 3 bis 2000 Zeichen lang sein.');
      const { workspace, ticketId } = await ticketContext(
        config,
        session,
        args,
      );
      await callFunction(config, session, "ticket-operations", {
        type: "openEscalation",
        tenantId: workspace.id,
        ticketId,
        kind: args.kind,
        reason,
      });
      return textResult({ escalated: true, kind: args.kind });
    },
  },
  {
    name: "link_tickets",
    description:
      "Verknüpft zwei Tickets. relation: relates_to (Standard), duplicates, blocks, blocked_by, parent, child.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Tickets verknüpfen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        relatedTicket: TICKET_PROPERTY,
        relation: { type: "string", enum: RELATION_TYPES },
      },
      required: ["ticket", "relatedTicket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const relation =
        typeof args.relation === "string" ? args.relation : "relates_to";
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
        args.relatedTicket,
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
    name: "attach_knowledge_article",
    description:
      "Verknüpft einen Wissensartikel (id aus search_knowledge) mit einem Ticket. visibility: internal (Standard) oder external (für Anfragende sichtbar, nur mit confirm=true).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Wissensartikel verknüpfen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        article: { type: "string", description: "ID des Wissensartikels." },
        visibility: { type: "string", enum: ["internal", "external"] },
        confirm: { type: "boolean" },
      },
      required: ["ticket", "article"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.article)) throw new ToolError('"article" ist ungültig.');
      const visibility =
        args.visibility === "external" ? "external" : "internal";
      if (args.visibility !== undefined && args.visibility !== visibility) {
        throw new ToolError('"visibility" muss internal oder external sein.');
      }
      if (visibility === "external" && args.confirm !== true) {
        throw new ToolError(
          "Ein externer Artikel ist für die anfragende Person sichtbar. Frage nach und wiederhole den Aufruf danach mit confirm=true.",
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
        articleId: args.article,
        visibility,
      });
      return textResult({ attached: true, visibility });
    },
  },

  // ------------------------------------------------ Betrieb und Verwaltung
  {
    name: "service_status",
    description:
      "Zeigt den aktuellen Status der IT-Services sowie laufende und geplante Wartungen.",
    annotations: { readOnlyHint: true, title: "Servicestatus" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        onlyIssues: {
          type: "boolean",
          description: "Nur Services mit Störung oder Einschränkung.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
              args.onlyIssues !== true || entry.status !== "operational",
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
    name: "inventory_lookup",
    description:
      "Sucht einen Lagerartikel oder Lagerort über Artikelnummer, Barcode oder QR-Code und zeigt den Bestand.",
    annotations: { readOnlyHint: true, title: "Lager nachschlagen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        code: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["code"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const code = str(args.code, 1, 120);
      if (!code) throw new ToolError('"code" fehlt.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
    name: "list_licenses",
    description:
      "Listet Softwarelizenzen. Mit expiringWithinDays nur solche, die in den nächsten Tagen ablaufen.",
    annotations: { readOnlyHint: true, title: "Lizenzen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: {
          type: "string",
          description: "Filter nach Titel, Hersteller oder Referenz.",
        },
        expiringWithinDays: { type: "integer", minimum: 1, maximum: 730 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "licenses", {
        type: "list",
        tenantId: workspace.id,
        includeArchived: false,
      });
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const within = clampLimit(args.expiringWithinDays, 0, 730);
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
        .slice(0, clampLimit(args.limit, 30, 100));
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
    name: "list_contracts",
    description:
      "Listet Verträge mit Laufzeit, Kündigungsfrist und Kosten. Mit expiringWithinDays nur solche, die bald enden.",
    annotations: { readOnlyHint: true, title: "Verträge" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: {
          type: "string",
          description: "Filter nach Titel, Vertragspartner oder Referenz.",
        },
        expiringWithinDays: { type: "integer", minimum: 1, maximum: 730 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "contracts", {
        type: "list",
        tenantId: workspace.id,
        includeArchived: false,
      });
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const within = clampLimit(args.expiringWithinDays, 0, 730);
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
        .slice(0, clampLimit(args.limit, 30, 100));
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
    name: "list_macros",
    description:
      "Listet die Antwortmakros (Textbausteine) des Arbeitsbereichs. Den Text eines Makros liefert get_macro_text.",
    annotations: { readOnlyHint: true, title: "Makros" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: { type: "string", description: "Filter nach Name." },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "agent-workbench", {
        type: "listMacros",
        tenantId: workspace.id,
      });
      const query = typeof args.query === "string" ? args.query.trim() : "";
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
    name: "get_macro_text",
    description:
      "Liefert den vollständigen Antworttext eines Makros (id aus list_macros), optional für ein bestimmtes Ticket. Zum Versenden danach reply_to_ticket verwenden.",
    annotations: { readOnlyHint: true, title: "Makrotext" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        macro: { type: "string", description: "ID des Makros." },
        ticket: TICKET_PROPERTY,
      },
      required: ["macro"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.macro)) throw new ToolError('"macro" ist ungültig.');
      const workspace = await resolveWorkspace(config, session, args.workspace);
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
        macroId: args.macro,
        ...(ticketId ? { ticketId } : {}),
      });
      const preview = isRecord(data.preview) ? data.preview : {};
      return textResult({ text: preview.responseText ?? null });
    },
  },
  {
    name: "create_knowledge_draft",
    description:
      "Erstellt aus einem Ticket einen Entwurf für einen Wissensartikel. Der Entwurf geht in die Prüfung und wird nicht direkt veröffentlicht. body in Markdown; ohne Angabe wird die Ticketbeschreibung verwendet.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Wissensentwurf erstellen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        ticket: TICKET_PROPERTY,
        title: { type: "string", minLength: 3, maxLength: 240 },
        body: { type: "string", maxLength: 50000 },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = args.title === undefined ? null : str(args.title, 3, 240);
      if (args.title !== undefined && !title) {
        throw new ToolError('"title" muss 3 bis 240 Zeichen lang sein.');
      }
      const body = args.body === undefined ? null : str(args.body, 1, 50000);
      if (args.body !== undefined && !body) {
        throw new ToolError('"body" muss 1 bis 50000 Zeichen lang sein.');
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
    name: "list_event_bookings",
    description:
      "Zeigt die Räume und die Raumbuchungen (Veranstaltungen, Sitzungen) der letzten zwei Tage und der nächsten rund 13 Monate mit Status und Aufgaben. Optional gefiltert nach Raum oder Zeitraum.",
    annotations: { readOnlyHint: true, title: "Raumbuchungen" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        room: { type: "string", description: "Raumname oder ID." },
        from: { type: "string", description: "Ab Datum/Zeit (ISO 8601)." },
        to: { type: "string", description: "Bis Datum/Zeit (ISO 8601)." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const from = args.from === undefined ? null : isoDate(args.from);
      const to = args.to === undefined ? null : isoDate(args.to);
      if (
        (args.from !== undefined && !from) ||
        (args.to !== undefined && !to)
      ) {
        throw new ToolError('"from" oder "to" ist kein gültiges Datum.');
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await eventWorkspace(config, session, workspace);
      const rooms = data.rooms;
      const room = args.room === undefined ? null : findRoom(rooms, args.room);
      const roomName = new Map(rooms.map((entry) => [entry.id, entry.name]));
      const matching = data.requests.filter(
        (entry) =>
          (!room || entry.spaceId === room.id) &&
          (!from || String(entry.endsAt) >= from) &&
          (!to || String(entry.startsAt) <= to),
      );
      const bookings = matching.slice(0, clampLimit(args.limit, 30, 100));
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
            ? "Weitere Buchungen vorhanden: Zeitraum oder Raum eingrenzen oder limit erhöhen."
            : undefined,
      });
    },
  },
  {
    name: "book_event_space",
    description: `Bucht einen Raum, einmalig oder als Serie (recurrence weekly mit count 2-52 Terminen, monthly mit count 2-12; gleiche Uhrzeit, Zürcher Zeit). Prüft vorher auf Überschneidungen; bei einer Überschneidung wird nicht gebucht, ausser die Person bestätigt sie ausdrücklich (confirmConflicts=true). equipment: ${EVENT_EQUIPMENT.join(", ")}.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Raum buchen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        room: { type: "string", description: "Raumname oder ID." },
        title: { type: "string", minLength: 3, maxLength: 240 },
        startsAt: { type: "string", description: "Beginn (ISO 8601)." },
        endsAt: { type: "string", description: "Ende (ISO 8601)." },
        organizer: { type: "string", maxLength: 160 },
        participants: { type: "integer", minimum: 1, maximum: 10000 },
        recurrence: {
          type: "string",
          enum: ["none", "weekly", "monthly"],
          description: "Standard: none (einmalig).",
        },
        count: {
          type: "integer",
          minimum: 2,
          maximum: 52,
          description:
            "Anzahl Termine der Serie inklusive des ersten (nur mit recurrence).",
        },
        equipment: {
          type: "array",
          items: { type: "string", enum: EVENT_EQUIPMENT },
        },
        confirmConflicts: {
          type: "boolean",
          description:
            "Nur true, wenn die Person eine gemeldete Überschneidung ausdrücklich akzeptiert hat.",
        },
      },
      required: ["room", "title", "startsAt", "endsAt"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const title = str(args.title, 3, 240);
      if (!title)
        throw new ToolError('"title" muss 3 bis 240 Zeichen lang sein.');
      const startsAt = isoDate(args.startsAt);
      const endsAt = isoDate(args.endsAt);
      if (!startsAt || !endsAt) {
        throw new ToolError(
          '"startsAt" oder "endsAt" ist kein gültiges Datum.',
        );
      }
      const organizer =
        args.organizer === undefined ? null : str(args.organizer, 2, 160);
      if (args.organizer !== undefined && !organizer) {
        throw new ToolError('"organizer" muss 2 bis 160 Zeichen lang sein.');
      }
      if (
        args.participants !== undefined &&
        (typeof args.participants !== "number" ||
          !Number.isInteger(args.participants) ||
          args.participants < 1)
      ) {
        throw new ToolError(
          '"participants" muss eine positive ganze Zahl sein.',
        );
      }
      const equipment = Array.isArray(args.equipment) ? args.equipment : [];
      if (
        args.equipment !== undefined &&
        (!Array.isArray(args.equipment) ||
          !equipment.every((key) => EVENT_EQUIPMENT.includes(String(key))))
      ) {
        throw new ToolError(
          `Ungültige Ausstattung. Erlaubt: ${EVENT_EQUIPMENT.join(", ")}.`,
        );
      }
      const recurrence =
        args.recurrence === "weekly" || args.recurrence === "monthly"
          ? args.recurrence
          : "none";
      if (args.recurrence !== undefined && args.recurrence !== recurrence) {
        throw new ToolError(
          '"recurrence" muss none, weekly oder monthly sein.',
        );
      }
      const maxCount = recurrence === "monthly" ? 12 : 52;
      const count = args.count;
      if (
        recurrence !== "none" &&
        (typeof count !== "number" ||
          !Number.isInteger(count) ||
          count < 2 ||
          count > maxCount)
      ) {
        throw new ToolError(
          `"count" muss für eine ${recurrence === "monthly" ? "monatliche" : "wöchentliche"} Serie eine ganze Zahl von 2 bis ${maxCount} sein.`,
        );
      }
      if (recurrence === "none" && count !== undefined) {
        throw new ToolError('"count" gilt nur zusammen mit recurrence.');
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
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const overview = await callFunction(config, session, "event-spaces", {
        type: "listWorkspace",
        tenantId: workspace.id,
        offset: 0,
      });
      const room = findRoom(records(overview.rooms), args.room);
      const input = {
        tenantId: workspace.id,
        spaceId: room.id,
        title,
        organizer,
        expectedParticipants:
          typeof args.participants === "number" ? args.participants : null,
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
      if (hasConflicts && args.confirmConflicts !== true) {
        return textResult({
          booked: false,
          conflicts: {
            room: conflicts.roomConflictCount ?? 0,
            equipment: conflicts.equipmentConflictCount ?? 0,
          },
          hint: "Es gibt Überschneidungen. Frage die Person, ob trotzdem gebucht werden soll (confirmConflicts=true), oder wähle einen anderen Raum oder Zeitpunkt.",
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
    name: "update_event_booking",
    description:
      "Ändert den Status einer Raumbuchung (id aus list_event_bookings): planned, in_preparation, ready, conducted, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Raumbuchung aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        booking: { type: "string", description: "ID der Raumbuchung." },
        status: { type: "string", enum: EVENT_REQUEST_STATUSES },
      },
      required: ["booking", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.booking)) throw new ToolError('"booking" ist ungültig.');
      if (!EVENT_REQUEST_STATUSES.includes(String(args.status))) {
        throw new ToolError(
          `Ungültiger Status. Erlaubt: ${EVENT_REQUEST_STATUSES.join(", ")}.`,
        );
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      await callFunction(config, session, "event-spaces", {
        type: "updateRequestStatus",
        tenantId: workspace.id,
        requestId: args.booking,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },
  {
    name: "update_event_task",
    description:
      "Setzt den Status einer Aufgabe zu einer Raumbuchung (id aus list_event_bookings): open, in_progress, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Raumaufgabe aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        task: { type: "string", description: "ID der Aufgabe." },
        status: { type: "string", enum: ["open", "in_progress", "completed"] },
      },
      required: ["task", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.task)) throw new ToolError('"task" ist ungültig.');
      if (!["open", "in_progress", "completed"].includes(String(args.status))) {
        throw new ToolError(
          '"status" muss open, in_progress oder completed sein.',
        );
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      await callFunction(config, session, "event-spaces", {
        type: "updateTaskStatus",
        tenantId: workspace.id,
        taskId: args.task,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },

  // ------------------------------------------------ Eintritte (Onboarding)
  {
    name: "list_onboardings",
    description:
      "Zeigt die Eintritte neuer Mitarbeitender mit Startdatum, Verantwortlichen und offenen Aufgaben, dazu die verfügbaren Vorlagen und Personen.",
    annotations: { readOnlyHint: true, title: "Eintritte" },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        query: {
          type: "string",
          description: "Filter nach Name oder Einheit.",
        },
        openTasksOnly: {
          type: "boolean",
          description: "Nur nicht erledigte Aufgaben anzeigen.",
        },
      },
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "onboarding", {
        type: "listWorkspace",
        tenantId: workspace.id,
      });
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const entries = records(data.entries).filter((entry) =>
        matches(query, entry.employeeName, entry.organisationUnit),
      );
      return textResult({
        entries: entries.slice(0, 50).map((entry) => ({
          id: entry.id,
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
                args.openTasksOnly !== true || task.status !== "completed",
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
    name: "create_onboarding",
    description:
      "Erfasst einen Eintritt (neue mitarbeitende Person). Vorlage, Führungsperson und ICT-Verantwortung als Name oder ID aus list_onboardings. Frage vorher nach, ob der Eintritt erfasst werden soll.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: "Eintritt erfassen",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        employeeName: { type: "string", minLength: 2, maxLength: 160 },
        startsOn: { type: "string", description: "Startdatum JJJJ-MM-TT." },
        unit: {
          type: "string",
          minLength: 2,
          maxLength: 160,
          description: "Organisationseinheit.",
        },
        location: { type: "string", minLength: 2, maxLength: 160 },
        manager: { type: "string", description: "Führungsperson." },
        ictResponsible: {
          type: "string",
          description: "ICT-Verantwortung. Standard: du selbst.",
        },
        template: {
          type: "string",
          description: "Vorlage. Standard: die erste.",
        },
      },
      required: ["employeeName", "startsOn", "unit", "location", "manager"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      const employeeName = str(args.employeeName, 2, 160);
      const unit = str(args.unit, 2, 160);
      const location = str(args.location, 2, 160);
      if (!employeeName || !unit || !location) {
        throw new ToolError(
          '"employeeName", "unit" und "location" müssen 2 bis 160 Zeichen lang sein.',
        );
      }
      const startsOn = typeof args.startsOn === "string" ? args.startsOn : "";
      if (isoDate(`${startsOn}T00:00:00Z`)?.slice(0, 10) !== startsOn) {
        throw new ToolError('"startsOn" muss ein Datum JJJJ-MM-TT sein.');
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      const data = await callFunction(config, session, "onboarding", {
        type: "listWorkspace",
        tenantId: workspace.id,
      });
      const people = records(data.people);
      const templates = records(data.templates);
      const manager = findByName(people, args.manager, "displayName", "Person");
      const ict =
        args.ictResponsible === undefined
          ? { id: session.userId }
          : findByName(people, args.ictResponsible, "displayName", "Person");
      const template =
        args.template === undefined
          ? templates[0]
          : findByName(templates, args.template, "name", "Vorlage");
      if (!template) {
        throw new ToolError("Es ist keine Vorlage für Eintritte vorhanden.");
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
    name: "update_onboarding_task",
    description:
      "Setzt den Status einer Eintrittsaufgabe (id aus list_onboardings): open, in_progress, blocked, completed.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      title: "Eintrittsaufgabe aktualisieren",
    },
    inputSchema: {
      type: "object",
      properties: {
        workspace: WORKSPACE_PROPERTY,
        task: { type: "string", description: "ID der Aufgabe." },
        status: {
          type: "string",
          enum: ["open", "in_progress", "blocked", "completed"],
        },
      },
      required: ["task", "status"],
      additionalProperties: false,
    },
    run: async (config, session, args) => {
      if (!isUuid(args.task)) throw new ToolError('"task" ist ungültig.');
      if (
        !["open", "in_progress", "blocked", "completed"].includes(
          String(args.status),
        )
      ) {
        throw new ToolError(
          '"status" muss open, in_progress, blocked oder completed sein.',
        );
      }
      const workspace = await resolveWorkspace(config, session, args.workspace);
      await callFunction(config, session, "onboarding", {
        type: "updateTaskStatus",
        tenantId: workspace.id,
        taskId: args.task,
        status: args.status,
      });
      return textResult({ updated: true, status: args.status });
    },
  },
];

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
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "Greift als angemeldete Person auf nextDesk zu. Lesen ist frei. Schreibaktionen (Ticket erfassen, Notiz, Status, Priorität, Zuweisen, Zeit, Checkliste, Antworten, Freigaben, Serviceaufgaben, Wiedervorlagen, Übergaben, Verknüpfungen, Eskalationen, Raumbuchungen, Eintritte, Wissensentwürfe) nur nach Rückfrage bei der Person; Antworten, Lösen, Schliessen, Freigabeentscheide, Eskalationen, externe Wissensartikel und Raumbuchungen trotz Überschneidung verlangen ausdrückliche Bestätigung (confirm=true).",
    });
  }
  if (method === "ping") return isNotification ? null : rpcResult(id, {});
  if (method.startsWith("notifications/")) return null;
  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        annotations,
      })),
    });
  }
  if (method === "tools/call") {
    const params = isRecord(message.params) ? message.params : {};
    const tool = TOOLS.find((entry) => entry.name === params.name);
    if (!tool) return rpcError(id, -32602, "Unbekanntes Werkzeug.");
    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
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
