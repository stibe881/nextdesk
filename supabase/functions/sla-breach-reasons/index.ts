import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  detectBreaches,
  isSlaBreachReasonCode,
  SLA_BREACH_NOTE_MAX,
  SLA_BREACH_REASON_LABELS,
  type SlaBreachKind,
  type SlaBreachReasonCode,
} from "../_shared/sla-breach-causes.ts";

/**
 * Causes of SLA breaches per ticket. Agents who may work tickets in the
 * tenant and can see the ticket (caller-scoped RLS read) list the breached
 * targets and record one reason each. Data is written with the service role
 * after that check; the table itself is closed to browsers.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;

type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
    type: "record";
    tenantId: string;
    ticketId: string;
    kinds: SlaBreachKind[] | null;
    reasonCode: SlaBreachReasonCode;
    note: string | null;
  };

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId)) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();
  const ticketId = value.ticketId.toLowerCase();
  if (value.type === "list") return { type: "list", tenantId, ticketId };
  if (value.type !== "record" || !isSlaBreachReasonCode(value.reasonCode)) {
    return null;
  }
  let kinds: SlaBreachKind[] | null = null;
  if (value.kinds !== undefined && value.kinds !== null) {
    if (
      !Array.isArray(value.kinds) || value.kinds.length === 0 ||
      !value.kinds.every((kind) => kind === "response" || kind === "resolution")
    ) {
      return null;
    }
    kinds = [...new Set(value.kinds as SlaBreachKind[])];
  }
  if (
    !(value.note === undefined || value.note === null ||
      typeof value.note === "string")
  ) {
    return null;
  }
  const note = typeof value.note === "string"
    ? value.note.replace(/\s+/g, " ").trim()
    : "";
  if ([...note].length > SLA_BREACH_NOTE_MAX || note.includes("\u0000")) {
    return null;
  }
  if (value.reasonCode === "other" && !note) return null;
  return {
    type: "record",
    tenantId,
    ticketId,
    kinds,
    reasonCode: value.reasonCode,
    note: note || null,
  };
}

function errorResponse(request: Request, status: number, code: string, message?: string) {
  return json(request, { error: message ? { code, message } : { code } }, status);
}

async function loadBreaches(admin: Client, ticket: Row) {
  const [events, reasons] = await Promise.all([
    admin
      .from("ticket_sla_events")
      .select("event_type")
      .eq("ticket_id", ticket.id)
      .in("event_type", ["response_breached", "resolution_breached"]),
    admin
      .from("ticket_sla_breach_reasons")
      .select("breach_kind, reason_code, note, recorded_by, recorded_at")
      .eq("tenant_id", ticket.tenant_id)
      .eq("ticket_id", ticket.id),
  ]);
  if (events.error || reasons.error) return null;
  const breaches = detectBreaches(
    {
      responseDueAt: (ticket.response_due_at as string | null) ?? null,
      firstRespondedAt: (ticket.first_responded_at as string | null) ?? null,
      resolutionDueAt: (ticket.resolution_due_at as string | null) ?? null,
      resolvedAt: (ticket.resolved_at as string | null) ?? null,
      closedAt: (ticket.closed_at as string | null) ?? null,
      slaPausedAt: (ticket.sla_paused_at as string | null) ?? null,
    },
    ((events.data ?? []) as Row[]).map((row) => String(row.event_type)),
  );
  const reasonRows = (reasons.data ?? []) as Row[];
  const recorderIds = [
    ...new Set(reasonRows.map((row) => row.recorded_by).filter(isUuid)),
  ];
  const names = new Map<string, string>();
  if (recorderIds.length) {
    const profiles = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", recorderIds);
    for (const row of (profiles.data ?? []) as Row[]) {
      if (typeof row.display_name === "string" && row.display_name.trim()) {
        names.set(row.id as string, row.display_name.trim());
      }
    }
  }
  const byKind = new Map(reasonRows.map((row) => [row.breach_kind, row]));
  return breaches.map((breach) => {
    const reason = byKind.get(breach.kind);
    return {
      kind: breach.kind,
      dueAt: breach.dueAt,
      reason: reason
        ? {
          code: reason.reason_code,
          label: SLA_BREACH_REASON_LABELS[reason.reason_code as SlaBreachReasonCode] ??
            String(reason.reason_code),
          note: reason.note ?? null,
          recordedAt: reason.recorded_at,
          recordedByName: names.get(reason.recorded_by as string) ?? null,
        }
        : null,
    };
  });
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST") {
      return errorResponse(request, 405, "method_not_allowed");
    }
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) return errorResponse(request, 401, "unauthorized");
    const text = await request.text().catch(() => null);
    if (text === null || new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
      return errorResponse(request, 413, "payload_too_large");
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const action = parseAction(body);
    if (!action) {
      return errorResponse(request, 422, "invalid_request", "Die Anfrage ist ungültig.");
    }
    const admin = context.supabaseAdmin;

    // Caller-scoped read: ticket RLS decides visibility.
    const [ticketResult, staffCheck] = await Promise.all([
      context.supabase
        .from("tickets")
        .select(
          "id, tenant_id, ticket_number, department_id, response_due_at, first_responded_at, resolution_due_at, resolved_at, closed_at, sla_paused_at",
        )
        .eq("tenant_id", action.tenantId)
        .eq("id", action.ticketId)
        .maybeSingle(),
      context.supabase.rpc("can_work_tickets_in_tenant", {
        p_tenant_id: action.tenantId,
      }),
    ]);
    if (ticketResult.error) return errorResponse(request, 503, "ticket_lookup_failed");
    const ticket = ticketResult.data as Row | null;
    if (!ticket) return errorResponse(request, 403, "ticket_access_denied");
    const canRecord = !staffCheck.error && staffCheck.data === true;
    if (!canRecord) {
      // Requesters never see internal SLA causes.
      if (action.type === "list") {
        return json(request, { data: { breaches: [], canRecord: false } });
      }
      return errorResponse(
        request,
        403,
        "sla_reason_not_allowed",
        "Nur Agent:innen können Ursachen erfassen.",
      );
    }

    const breaches = await loadBreaches(admin, ticket);
    if (!breaches) return errorResponse(request, 503, "database_failure");
    if (action.type === "list") {
      return json(request, { data: { breaches, canRecord } });
    }

    const breachedKinds = new Set(breaches.map((breach) => breach.kind));
    const targetKinds = action.kinds ??
      breaches.filter((breach) => !breach.reason).map((breach) => breach.kind);
    if (
      targetKinds.length === 0 ||
      targetKinds.some((kind) => !breachedKinds.has(kind))
    ) {
      return errorResponse(
        request,
        422,
        "sla_not_breached",
        "Für dieses Ticket gibt es keine passende SLA-Verletzung.",
      );
    }
    const now = new Date().toISOString();
    const { error } = await admin.from("ticket_sla_breach_reasons").upsert(
      targetKinds.map((kind) => ({
        ticket_id: ticket.id,
        tenant_id: ticket.tenant_id,
        breach_kind: kind,
        reason_code: action.reasonCode,
        note: action.note,
        recorded_by: actorId,
        recorded_at: now,
        updated_at: now,
      })),
      { onConflict: "ticket_id,breach_kind" },
    );
    if (error) return errorResponse(request, 503, "database_failure");
    await admin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: "ticket.sla.breach_reason_recorded",
      payload: { kinds: targetKinds, reasonCode: action.reasonCode },
    });
    await admin.from("audit_logs").insert({
      tenant_id: ticket.tenant_id,
      actor_id: actorId,
      action: "ticket.sla.breach_reason_recorded",
      entity_type: "ticket",
      entity_id: ticket.id,
      severity: "info",
      metadata: {
        kinds: targetKinds,
        reasonCode: action.reasonCode,
        hasNote: action.note !== null,
        departmentId: ticket.department_id,
      },
    });
    const updated = await loadBreaches(admin, ticket);
    return json(request, { data: { breaches: updated ?? [], canRecord } });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
