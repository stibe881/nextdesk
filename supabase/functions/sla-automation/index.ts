import { withSupabase } from "@supabase/server";
import { filterSlaAutomationCandidates } from "../_shared/sla-automation-feature-gate.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Deployment requirements:
 * - Configure this function with `verify_jwt = false`.
 * - Set a high-entropy `SLA_AUTOMATION_SECRET` Edge Function secret.
 * - Run it from a trusted scheduler only, using the
 *   `X-NextDesk-Automation-Secret` request header. The secret must never be
 *   stored in browser code, a URL, source control, or scheduler logs.
 * - The scheduler may safely retry. Migration 0028 makes each breach event
 *   unique per ticket and breach kind.
 */

const encoder = new TextEncoder();
const MAX_BATCH_SIZE = 100;

type Invocation = { dryRun: boolean; limit: number };

type Ticket = {
  id: string;
  tenant_id: string;
  department_id: string;
  ticket_number: string;
  response_due_at: string | null;
  resolution_due_at: string | null;
  first_responded_at: string | null;
  assigned_agent_id: string | null;
  escalation_level: number;
};

type BreachKind = "response" | "resolution";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInvocation(value: unknown): Invocation | null {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) => key === "dryRun" || key === "limit")
  ) {
    return null;
  }
  if (value.dryRun !== undefined && typeof value.dryRun !== "boolean") {
    return null;
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== "number" ||
      !Number.isInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > MAX_BATCH_SIZE)
  ) {
    return null;
  }
  return {
    dryRun: value.dryRun === true,
    limit: typeof value.limit === "number" ? value.limit : MAX_BATCH_SIZE,
  };
}

function json(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): Response {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

async function timingSafeSecretEqual(
  expected: string,
  supplied: string,
): Promise<boolean> {
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}

function eventType(
  kind: BreachKind,
): "response_breached" | "resolution_breached" {
  return kind === "response" ? "response_breached" : "resolution_breached";
}

/**
 * The database function excludes earlier breaches in the query itself. Loading
 * the first due rows and filtering event records afterwards can permanently
 * starve later tickets when a historical backlog is larger than one batch.
 */
async function listPendingBreachTickets(
  admin: any,
  kind: BreachKind,
  limit: number,
): Promise<{ data: Ticket[]; error: boolean }> {
  const { data, error } = await admin.rpc("list_pending_sla_breaches", {
    p_kind: kind,
    p_limit: limit,
  });
  return { data: (data ?? []) as Ticket[], error: Boolean(error) };
}

async function recordBreach(
  admin: any,
  ticket: Ticket,
  kind: BreachKind,
  requestId: string,
): Promise<"recorded" | "already_recorded" | "failed"> {
  const { data, error } = await admin.rpc("apply_sla_breach", {
    p_ticket_id: ticket.id,
    p_event_type: eventType(kind),
    p_request_id: requestId,
  });
  if (error) return "failed";
  return data === true ? "recorded" : "already_recorded";
}

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    const requestId = crypto.randomUUID();
    const expectedSecret = Deno.env.get("SLA_AUTOMATION_SECRET");
    if (!expectedSecret) {
      return json(
        { error: { code: "sla_automation_unavailable" } },
        503,
        requestId,
      );
    }
    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "X-Request-Id": requestId },
      });
    }
    const suppliedSecret =
      request.headers.get("X-NextDesk-Automation-Secret") ?? "";
    if (!(await timingSafeSecretEqual(expectedSecret, suppliedSecret))) {
      return json(
        { error: { code: "sla_automation_unauthorized" } },
        401,
        requestId,
      );
    }

    const invocation = parseInvocation(await request.json().catch(() => null));
    if (!invocation) {
      return json({ error: { code: "invalid_request" } }, 422, requestId);
    }

    const [responseTickets, resolutionTickets] = await Promise.all([
      listPendingBreachTickets(
        context.supabaseAdmin,
        "response",
        invocation.limit,
      ),
      listPendingBreachTickets(
        context.supabaseAdmin,
        "resolution",
        invocation.limit,
      ),
    ]);
    if (responseTickets.error || resolutionTickets.error) {
      return json(
        { error: { code: "sla_automation_query_failed" } },
        500,
        requestId,
      );
    }

    const candidates = [
      ...responseTickets.data.map((ticket) => ({
        ticket,
        kind: "response" as const,
      })),
      ...resolutionTickets.data.map((ticket) => ({
        ticket,
        kind: "resolution" as const,
      })),
    ];
    const featureFiltered = await filterSlaAutomationCandidates(
      candidates,
      async (tenantId) => {
        const states = await resolveTenantFeatureStates(
          context.supabaseAdmin,
          tenantId,
          ["automation.sla"],
        );
        return states?.["automation.sla"] === true;
      },
    );
    const pending = featureFiltered.candidates;
    if (invocation.dryRun) {
      return json(
        {
          data: {
            dryRun: true,
            responseBreaches: pending.filter((item) => item.kind === "response")
              .length,
            resolutionBreaches: pending.filter(
              (item) => item.kind === "resolution",
            ).length,
            skippedInactiveTenants: featureFiltered.skippedInactiveTenants,
          },
        },
        200,
        requestId,
      );
    }

    const result = {
      responseBreaches: 0,
      resolutionBreaches: 0,
      alreadyRecorded: 0,
      failed: 0,
    };
    for (const item of pending) {
      const outcome = await recordBreach(
        context.supabaseAdmin,
        item.ticket,
        item.kind,
        requestId,
      );
      if (outcome === "recorded") {
        if (item.kind === "response") result.responseBreaches += 1;
        else result.resolutionBreaches += 1;
      } else if (outcome === "already_recorded") {
        result.alreadyRecorded += 1;
      } else {
        result.failed += 1;
      }
    }

    console.info(
      JSON.stringify({
        event: "sla_automation.run",
        requestId,
        skippedInactiveTenants: featureFiltered.skippedInactiveTenants,
        ...result,
      }),
    );
    return json(
      {
        data: {
          ...result,
          skippedInactiveTenants: featureFiltered.skippedInactiveTenants,
        },
      },
      result.failed > 0 ? 207 : 200,
      requestId,
    );
  },
);

export default { fetch: handler };
