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
const SERVER_INFO = { name: "nextdesk", version: "1.0.0" } as const;
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
    throw new ToolError(
      response.status === 403
        ? `Keine Berechtigung für diese Aktion (${code}).`
        : `Die Aktion war nicht möglich (${code}).`,
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
  if (isUuid(value)) return value;
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
                | Json
                | undefined
            )?.label ?? null)
          : null;
      const requester = isRecord(data.requesterContact)
        ? data.requesterContact
        : null;
      const comments = Array.isArray(data.comments)
        ? data.comments.filter(isRecord)
        : [];
      return textResult({
        number: ticket.ticket_number,
        subject: ticket.subject,
        description: clip(ticket.description, 4000),
        status: label(data.statuses, ticket.status_id),
        priority: label(data.priorities, ticket.priority_id),
        requester: requester?.displayName ?? null,
        createdAt: ticket.created_at,
        resolvedAt: ticket.resolved_at ?? null,
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
      "Erfasst ein neues Ticket für dich selbst. Frage vorher nach, ob das Ticket wirklich erfasst werden soll.",
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
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        department: {
          type: "string",
          description: "Abteilung (Name). Standard: die erste.",
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
      if (!requester || typeof requester.id !== "string") {
        throw new ToolError(
          "Für dein Konto ist keine anfragende Person hinterlegt.",
        );
      }
      const priority =
        typeof args.priority === "string" ? args.priority : "normal";
      const created = await callFunction(config, session, "ticket-actions", {
        type: "createTicket",
        tenantId: workspace.id,
        departmentId: department.id,
        priorityKey: priority,
        requesterContactId: requester.id,
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
        "Greift als angemeldete Person auf nextDesk zu. Lesen ist frei, Ticket erfassen und Notizen schreiben nur nach Rückfrage bei der Person.",
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
