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
const SERVER_INFO = { name: "nextdesk", version: "1.1.0" } as const;
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
      const records = (value: unknown) =>
        Array.isArray(value) ? value.filter(isRecord) : [];
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
        priority: { type: "string", enum: PRIORITY_KEYS },
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
        "Greift als angemeldete Person auf nextDesk zu. Lesen ist frei. Schreibaktionen (Ticket erfassen, Notiz, Status, Priorität, Zuweisen, Zeit, Checkliste, Antworten, Freigaben, Serviceaufgaben) nur nach Rückfrage bei der Person; Antworten, Lösen, Schliessen und Freigabeentscheide verlangen ausdrückliche Bestätigung (confirm=true).",
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
