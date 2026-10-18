import { withSupabase } from "@supabase/server";
import {
  dispatchOutboundMessage,
  maintenance,
  processInboundMessage,
} from "../_shared/exchange-mail-processing.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type Row = Record<string, unknown>;
type Action =
  | { action: "processInbound"; ids?: string[] }
  | { action: "dispatchOutbound"; ids: string[] }
  | { action: "maintenance" };

function response(body: Row, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    return null;
  const values = value.map((item) =>
    isUuid(item) ? item.toLowerCase() : null,
  );
  return values.every((item): item is string => item !== null) &&
    new Set(values).size === values.length
    ? values
    : null;
}

function action(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.action !== "string") return null;
  if (value.action === "maintenance" && Object.keys(value).length === 1)
    return { action: "maintenance" };
  if (
    value.action === "processInbound" &&
    Object.keys(value).every((key) => key === "action" || key === "ids")
  ) {
    if (value.ids === undefined) return { action: "processInbound" };
    const parsed = ids(value.ids);
    return parsed ? { action: "processInbound", ids: parsed } : null;
  }
  if (value.action === "dispatchOutbound" && Object.keys(value).length === 2) {
    const parsed = ids(value.ids);
    return parsed ? { action: "dispatchOutbound", ids: parsed } : null;
  }
  return null;
}

async function featureEnabled(admin: any, tenantId: string): Promise<boolean> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [
    "integrations.email",
  ]);
  return flags?.["integrations.email"] === true;
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const secret = request.headers.get("x-nextdesk-dispatch-secret") ?? "";
    const verification = await context.supabaseAdmin.rpc(
      "exchange_mail_verify_dispatch_secret",
      { p_secret: secret },
    );
    if (verification.error || verification.data !== true)
      return response({ error: { code: "unauthorized" } }, 401);
    const requested = action(await request.json().catch(() => null));
    if (!requested)
      return response({ error: { code: "invalid_request" } }, 400);
    if (requested.action === "maintenance") {
      await maintenance(context.supabaseAdmin);
      return response({ data: { action: "maintenance" } }, 202);
    }
    let query = context.supabaseAdmin
      .from("mail_messages")
      .select(
        "id, tenant_id, channel_id, direction, kind, graph_message_id, ticket_id, comment_id, to_addresses, attempt_count",
      )
      .in("processing_status", ["pending", "failed"])
      .lte("next_attempt_at", new Date().toISOString())
      .lt("attempt_count", 6)
      .order("created_at")
      .limit(50);
    if (requested.ids?.length) query = query.in("id", requested.ids);
    query = query.eq(
      "direction",
      requested.action === "processInbound" ? "inbound" : "outbound",
    );
    const pending = await query;
    if (pending.error)
      return response({ error: { code: "claim_failed" } }, 500);
    let processed = 0;
    for (const item of pending.data ?? []) {
      if (!(await featureEnabled(context.supabaseAdmin, item.tenant_id))) {
        await context.supabaseAdmin
          .from("mail_messages")
          .update({
            processing_status: "ignored",
            ignore_reason: "feature_disabled",
          })
          .eq("id", item.id);
        continue;
      }
      if (requested.action === "processInbound")
        await processInboundMessage(context.supabaseAdmin, item);
      else await dispatchOutboundMessage(context.supabaseAdmin, item);
      processed += 1;
    }
    return response({ data: { action: requested.action, processed } }, 202);
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handler(request);
    } catch {
      return response({ error: { code: "worker_failed" } }, 500);
    }
  },
};
