import { withSupabase } from "@supabase/server";

type RiskLevel = "low" | "medium" | "high";
type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "create";
      tenantId: string;
      ticketId: string;
      summary: string;
      nextSteps: string | null;
      riskLevel: RiskLevel;
    }
  | {
      type: "acknowledge";
      tenantId: string;
      ticketId: string;
      handoverId: string;
    }
  | {
      type: "resolve";
      tenantId: string;
      ticketId: string;
      handoverId: string;
    };

type Ticket = {
  id: string;
  tenant_id: string;
  department_id: string;
};

type HandoverRow = {
  id: string;
  ticket_id: string;
  summary: string;
  next_steps: string | null;
  risk_level: RiskLevel;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 8 * 1024;
const HANDOVER_SELECT =
  "id, ticket_id, summary, next_steps, risk_level, acknowledged_at, resolved_at, created_at";

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const header of [...headers.keys()]) {
    if (header.toLowerCase().startsWith("access-control-")) {
      headers.delete(header);
    }
  }
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", crypto.randomUUID());
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function secureError(
  request: Request,
  code: string,
  message: string,
  status: number,
): Response {
  return json(request, { error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function canonicalUuid(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string | null {
  if (typeof value !== "string" || value.includes("\u0000")) return null;
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < minimumLength || length > maximumLength) return null;
  return normalized;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  const tenantId = canonicalUuid(value.tenantId);
  const ticketId = canonicalUuid(value.ticketId);
  if (!tenantId || !ticketId) return null;

  if (
    value.type === "list" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"])
  ) {
    return { type: "list", tenantId, ticketId };
  }

  if (
    value.type === "create" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "summary",
      "nextSteps",
      "riskLevel",
    ])
  ) {
    const summary = parseText(value.summary, 3, 2_000);
    const nextSteps =
      value.nextSteps === undefined
        ? null
        : parseText(value.nextSteps, 0, 3_000);
    const validNextSteps = value.nextSteps === undefined || nextSteps !== null;
    if (!summary || !validNextSteps || !isRiskLevel(value.riskLevel)) {
      return null;
    }

    return {
      type: "create",
      tenantId,
      ticketId,
      summary,
      nextSteps: nextSteps || null,
      riskLevel: value.riskLevel,
    };
  }

  if (
    (value.type === "acknowledge" || value.type === "resolve") &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "handoverId"])
  ) {
    const handoverId = canonicalUuid(value.handoverId);
    if (!handoverId) return null;
    return { type: value.type, tenantId, ticketId, handoverId };
  }

  return null;
}

function publicHandover(row: HandoverRow) {
  // Deliberately omit author_id, acknowledged_by, and resolved_by. The API
  // exposes state and handover content, never personal user data.
  return {
    id: row.id,
    ticketId: row.ticket_id,
    summary: row.summary,
    nextSteps: row.next_steps,
    riskLevel: row.risk_level,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

async function findReadableTicket(
  userClient: any,
  tenantId: string,
  ticketId: string,
): Promise<{ ticket: Ticket | null; failed: boolean }> {
  // This caller-scoped query is the ticket-read authorization boundary. In
  // particular, it preserves requester, affected-user, customer, assignee,
  // and department-based ticket RLS without using the service role.
  const { data, error } = await userClient
    .from("tickets")
    .select("id, tenant_id, department_id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { ticket: null, failed: true };
  if (!data) return { ticket: null, failed: false };
  return { ticket: data as Ticket, failed: false };
}

async function canUpdateTicket(
  userClient: any,
  ticket: Ticket,
): Promise<boolean | null> {
  const { data, error } = await userClient.rpc("has_ticket_permission", {
    p_tenant_id: ticket.tenant_id,
    p_department_id: ticket.department_id,
    p_permission_code: "ticket.update",
  });
  if (error) return null;
  return data === true;
}

async function handoverExists(
  userClient: any,
  tenantId: string,
  ticketId: string,
  handoverId: string,
): Promise<{ exists: boolean; failed: boolean }> {
  const { data, error } = await userClient
    .from("ticket_handover_notes")
    .select("id")
    .eq("id", handoverId)
    .eq("tenant_id", tenantId)
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) return { exists: false, failed: true };
  return { exists: Boolean(data), failed: false };
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST") {
      return secureError(
        request,
        "method_not_allowed",
        "Nur POST-Anfragen sind zulässig.",
        405,
      );
    }

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > MAX_REQUEST_BYTES)
    ) {
      return secureError(
        request,
        "payload_too_large",
        "Die Anfrage ist zu gross.",
        413,
      );
    }

    const action = parseAction(await request.json().catch(() => null));
    const actorId = canonicalUuid(context.userClaims?.id);
    if (!action || !actorId) {
      return secureError(
        request,
        "invalid_request",
        "Die Anfrage enthält ungültige Daten.",
        422,
      );
    }

    const ticketAccess = await findReadableTicket(
      context.supabase,
      action.tenantId,
      action.ticketId,
    );
    if (ticketAccess.failed) {
      return secureError(
        request,
        "ticket_access_check_failed",
        "Der Zugriff auf das Ticket konnte nicht geprüft werden.",
        500,
      );
    }
    if (!ticketAccess.ticket) {
      // Keep unreadable and absent tickets indistinguishable.
      return secureError(
        request,
        "ticket_not_found_or_access_denied",
        "Das Ticket wurde nicht gefunden oder darf nicht eingesehen werden.",
        404,
      );
    }
    const ticket = ticketAccess.ticket;

    if (action.type === "list") {
      const { data, error } = await context.supabase
        .from("ticket_handover_notes")
        .select(HANDOVER_SELECT)
        .eq("tenant_id", ticket.tenant_id)
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false });
      if (error) {
        return secureError(
          request,
          "handover_list_failed",
          "Die Übergabenotizen konnten nicht geladen werden.",
          500,
        );
      }
      return json(request, {
        data: {
          handovers: ((data as HandoverRow[] | null) ?? []).map(publicHandover),
        },
      });
    }

    const permitted = await canUpdateTicket(context.supabase, ticket);
    if (permitted === null) {
      return secureError(
        request,
        "ticket_permission_check_failed",
        "Die Änderungsberechtigung für das Ticket konnte nicht geprüft werden.",
        500,
      );
    }
    if (!permitted) {
      return secureError(
        request,
        "ticket_update_denied",
        "Für Änderungen an diesem Ticket fehlt die Berechtigung.",
        403,
      );
    }

    if (action.type === "create") {
      // author_id is explicit because the migration's trigger requires that it
      // equals auth.uid(); the caller-scoped client makes both values identical.
      const { data, error } = await context.supabase
        .from("ticket_handover_notes")
        .insert({
          tenant_id: ticket.tenant_id,
          ticket_id: ticket.id,
          author_id: actorId,
          summary: action.summary,
          next_steps: action.nextSteps,
          risk_level: action.riskLevel,
        })
        .select(HANDOVER_SELECT)
        .single();
      if (error || !data) {
        return secureError(
          request,
          "handover_create_failed",
          "Die Übergabenotiz konnte nicht erstellt werden.",
          422,
        );
      }
      return json(
        request,
        { data: { handover: publicHandover(data as HandoverRow) } },
        201,
      );
    }

    const stateColumn =
      action.type === "acknowledge" ? "acknowledged_at" : "resolved_at";
    const update =
      action.type === "acknowledge"
        ? {
            acknowledged_at: new Date().toISOString(),
            acknowledged_by: actorId,
          }
        : { resolved_at: new Date().toISOString(), resolved_by: actorId };

    // Only the current actor may be attributed to state transitions. The
    // conditional update also keeps acknowledgement and resolution immutable
    // once recorded, avoiding accidental reassignment by a later operator.
    const { data, error } = await context.supabase
      .from("ticket_handover_notes")
      .update(update)
      .eq("id", action.handoverId)
      .eq("tenant_id", ticket.tenant_id)
      .eq("ticket_id", ticket.id)
      .is(stateColumn, null)
      .select(HANDOVER_SELECT)
      .maybeSingle();
    if (error) {
      return secureError(
        request,
        action.type === "acknowledge"
          ? "handover_acknowledge_failed"
          : "handover_resolve_failed",
        action.type === "acknowledge"
          ? "Die Übergabenotiz konnte nicht bestätigt werden."
          : "Die Übergabenotiz konnte nicht gelöst werden.",
        422,
      );
    }
    if (data) {
      return json(request, {
        data: { handover: publicHandover(data as HandoverRow) },
      });
    }

    const existing = await handoverExists(
      context.supabase,
      ticket.tenant_id,
      ticket.id,
      action.handoverId,
    );
    if (existing.failed) {
      return secureError(
        request,
        "handover_lookup_failed",
        "Der Status der Übergabenotiz konnte nicht geprüft werden.",
        500,
      );
    }
    if (!existing.exists) {
      return secureError(
        request,
        "handover_not_found",
        "Die Übergabenotiz wurde nicht gefunden.",
        404,
      );
    }
    return secureError(
      request,
      action.type === "acknowledge"
        ? "handover_already_acknowledged"
        : "handover_already_resolved",
      action.type === "acknowledge"
        ? "Die Übergabenotiz wurde bereits bestätigt."
        : "Die Übergabenotiz wurde bereits gelöst.",
      409,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return secureError(
        request,
        "origin_not_allowed",
        "Diese Herkunft ist nicht zugelassen.",
        403,
      );
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    return withCors(request, await handler(request));
  },
};
