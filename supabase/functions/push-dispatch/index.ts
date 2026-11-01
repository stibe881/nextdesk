import { withSupabase } from "@supabase/server";
import {
  buildApnsPayload,
  isApnsConfigured,
  sendApns,
} from "../_shared/apns.ts";

type Environment = "production" | "development";
type Device = { id: string; token: string; environment: Environment };
type ClaimRow = {
  outbox_id: string;
  tenant_id: string;
  user_id: string;
  notification_id: string | null;
  source_type: "ticket" | "contract";
  ticket_id: string | null;
  contract_id: string | null;
  kind: string;
  ticket_number: string | null;
  subject: string | null;
  delivery_mode: "immediate" | "summary";
  devices: unknown;
};
type Delivery = { status: number; reason?: string };

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function devices(value: unknown): Device[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, Device>();
  for (const item of value) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof item.id === "string" &&
      typeof item.token === "string" &&
      (item.environment === "production" || item.environment === "development")
    ) {
      found.set(item.id, {
        id: item.id,
        token: item.token,
        environment: item.environment,
      });
    }
  }
  return [...found.values()];
}

function category(
  kind: string,
):
  | "assigned"
  | "requester_reply"
  | "support_reply"
  | "mention"
  | "resolved"
  | "approval"
  | "escalation"
  | "sla"
  | "follow_up"
  | "contract_deadline"
  | "inventory_low_stock"
  | "shop"
  | null {
  if (kind === "ticket.assigned") return "assigned";
  if (kind === "ticket.requester_reply") return "requester_reply";
  if (kind === "ticket.support_reply") return "support_reply";
  if (kind === "ticket.mention") return "mention";
  if (kind === "ticket.resolved") return "resolved";
  if (kind === "ticket.approval.requested") return "approval";
  if (
    kind === "ticket.department_question.asked" ||
    kind === "ticket.department_question.answered"
  )
    return "approval";
  if (kind === "ticket.escalation_opened") return "escalation";
  if (kind === "ticket.follow_up_due") return "follow_up";
  if (kind === "contract.deadline") return "contract_deadline";
  if (kind === "inventory.low_stock") return "inventory_low_stock";
  if (kind.startsWith("shop.order.")) return "shop";
  return kind.startsWith("ticket.sla.") ? "sla" : null;
}

function payloadKind(
  kind: string,
  fallback: NonNullable<ReturnType<typeof category>>,
):
  | NonNullable<ReturnType<typeof category>>
  | "department_question_asked"
  | "department_question_answered" {
  if (kind === "ticket.department_question.asked")
    return "department_question_asked";
  if (kind === "ticket.department_question.answered")
    return "department_question_answered";
  return fallback;
}

function invalidDevice(result: Delivery): boolean {
  return (
    result.status === 410 ||
    (result.status === 400 &&
      ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(
        result.reason ?? "",
      ))
  );
}

function transient(result: Delivery): boolean {
  return result.status === 0 || result.status === 429 || result.status >= 500;
}

function deliveryCode(result: Delivery): string {
  return (result.reason ?? String(result.status || "network_error")).slice(
    0,
    200,
  );
}

async function updateDeviceForDelivery(
  admin: any,
  device: Device,
  result: Delivery,
): Promise<void> {
  if (result.status === 200) {
    await admin
      .from("push_devices")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("id", device.id)
      .eq("enabled", true);
  } else if (invalidDevice(result)) {
    await admin
      .from("push_devices")
      .update({ enabled: false, disabled_reason: "apns_unregistered" })
      .eq("id", device.id);
  }
}

async function retryOrFail(
  admin: any,
  outboxId: string,
  code: string,
): Promise<void> {
  const { data, error } = await admin
    .from("push_outbox")
    .select("attempts")
    .eq("id", outboxId)
    .eq("status", "sending")
    .maybeSingle();
  if (error || !data) return;
  await admin
    .from("push_outbox")
    .update({
      status: data.attempts >= 3 ? "failed" : "pending",
      last_error: code,
      claimed_at: null,
    })
    .eq("id", outboxId)
    .eq("status", "sending");
}

async function completeForDeliveries(
  admin: any,
  row: ClaimRow,
  results: Delivery[],
): Promise<void> {
  if (results.some((result) => result.status === 200)) {
    await admin
      .from("push_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", row.outbox_id)
      .eq("status", "sending");
    return;
  }
  const transientResult = results.find(transient);
  if (transientResult) {
    await retryOrFail(admin, row.outbox_id, deliveryCode(transientResult));
    return;
  }
  const terminalResult = results[0];
  await admin
    .from("push_outbox")
    .update({
      status: "failed",
      last_error: terminalResult
        ? deliveryCode(terminalResult)
        : "no_active_devices",
    })
    .eq("id", row.outbox_id)
    .eq("status", "sending");
}

async function skip(
  admin: any,
  outboxId: string,
  reason: "apns_not_configured",
): Promise<void> {
  await admin
    .from("push_outbox")
    .update({ status: "skipped", last_error: reason })
    .eq("id", outboxId)
    .eq("status", "sending");
}

export async function ticketNotificationRecipientAuthorized(
  admin: any,
  row: ClaimRow,
): Promise<boolean> {
  if (row.source_type !== "ticket") return true;
  if (!row.ticket_id) {
    if (row.kind.startsWith("shop.order.")) {
      // Shop notifications go only to active members of the workspace.
      const { data: membership } = await admin
        .from("tenant_memberships")
        .select("user_id")
        .eq("tenant_id", row.tenant_id)
        .eq("user_id", row.user_id)
        .eq("status", "active")
        .maybeSingle();
      return Boolean(membership);
    }
    if (row.kind !== "inventory.low_stock") return false;
    const { data, error } = await admin.rpc(
      "inventory_low_stock_delivery_authorized",
      {
        p_tenant_id: row.tenant_id,
        p_user_id: row.user_id,
      },
    );
    return !error && data === true;
  }
  const { data, error } = await admin.rpc(
    "ticket_notification_recipient_authorized",
    {
      p_tenant_id: row.tenant_id,
      p_ticket_id: row.ticket_id,
      p_user_id: row.user_id,
    },
  );
  return !error && data === true;
}

async function skipUnauthorizedRecipient(
  admin: any,
  row: ClaimRow,
): Promise<void> {
  await admin
    .from("push_outbox")
    .update({
      status: "skipped",
      last_error: "recipient_not_authorized",
      claimed_at: null,
    })
    .eq("id", row.outbox_id)
    .eq("status", "sending");
}

async function deliverSingle(admin: any, row: ClaimRow): Promise<void> {
  if (!(await ticketNotificationRecipientAuthorized(admin, row))) {
    await skipUnauthorizedRecipient(admin, row);
    return;
  }
  const preferenceCategory = category(row.kind);
  if (!preferenceCategory) {
    await admin
      .from("push_outbox")
      .update({ status: "skipped", last_error: "unsupported_kind" })
      .eq("id", row.outbox_id)
      .eq("status", "sending");
    return;
  }
  const currentDevices = devices(row.devices);
  if (currentDevices.length === 0) {
    await completeForDeliveries(admin, row, []);
    return;
  }
  let shop: { shopEvent: string; orderId?: string; orderNumber?: string } | {} =
    {};
  if (preferenceCategory === "shop" && row.notification_id) {
    const { data: notification } = await admin
      .from("ticket_notifications")
      .select("payload")
      .eq("id", row.notification_id)
      .maybeSingle();
    const payload = notification?.payload ?? {};
    shop = {
      shopEvent: row.kind.slice("shop.order.".length),
      ...(typeof payload.orderId === "string"
        ? { orderId: payload.orderId }
        : {}),
      ...(typeof payload.orderNumber === "string"
        ? { orderNumber: payload.orderNumber }
        : {}),
    };
  }
  const payload = buildApnsPayload({
    ...shop,
    kind: payloadKind(row.kind, preferenceCategory),
    tenantId: row.tenant_id,
    notificationId: row.notification_id ?? row.outbox_id,
    ...(row.ticket_id ? { ticketId: row.ticket_id } : {}),
    ...(row.contract_id ? { contractId: row.contract_id } : {}),
    ...(row.ticket_number ? { ticketNumber: row.ticket_number } : {}),
    subject: row.subject,
  });
  const results = await Promise.all(
    currentDevices.map(async (device) => {
      const result = await sendApns(
        device.token,
        device.environment,
        payload,
        row.notification_id ?? row.outbox_id,
      );
      await updateDeviceForDelivery(admin, device, result);
      return result;
    }),
  );
  await completeForDeliveries(admin, row, results);
}

async function deliverSummary(admin: any, rows: ClaimRow[]): Promise<void> {
  const authorization = await Promise.all(
    rows.map(async (row) => ({
      row,
      authorized: await ticketNotificationRecipientAuthorized(admin, row),
    })),
  );
  const authorizedRows = authorization
    .filter((entry) => entry.authorized)
    .map((entry) => entry.row);
  await Promise.all(
    authorization
      .filter((entry) => !entry.authorized)
      .map(({ row }) => skipUnauthorizedRecipient(admin, row)),
  );
  if (authorizedRows.length === 0) return;

  const uniqueDevices = new Map<string, Device>();
  for (const row of authorizedRows) {
    for (const device of devices(row.devices))
      uniqueDevices.set(device.id, device);
  }
  const anchor = authorizedRows[0];
  const payload = buildApnsPayload({
    kind: "summary",
    tenantId: anchor.tenant_id,
    notificationId: anchor.notification_id ?? anchor.outbox_id,
    summaryCount: authorizedRows.length,
  });
  const results = await Promise.all(
    [...uniqueDevices.values()].map(async (device) => {
      const result = await sendApns(
        device.token,
        device.environment,
        payload,
        anchor.notification_id ?? anchor.outbox_id,
      );
      await updateDeviceForDelivery(admin, device, result);
      return result;
    }),
  );
  for (const row of authorizedRows)
    await completeForDeliveries(admin, row, results);
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const secret = request.headers.get("x-nextdesk-push-secret") ?? "";
    const { data: verified, error } = await context.supabaseAdmin.rpc(
      "push_verify_dispatch_secret",
      { p_secret: secret },
    );
    if (error || verified !== true) {
      return response({ error: { code: "unauthorized" } }, 401);
    }

    const [ticketAuthorizationSweep, questionAuthorizationSweep] =
      await Promise.all([
        context.supabaseAdmin.rpc("push_skip_unauthorized_ticket_outbox"),
        context.supabaseAdmin.rpc(
          "push_skip_unauthorized_department_question_outbox",
        ),
      ]);
    // Fail closed: a queue cannot be claimed if current ticket access cannot
    // be rechecked. The second sweep retains question lifecycle checks.
    if (ticketAuthorizationSweep.error || questionAuthorizationSweep.error) {
      return response({ error: { code: "authorization_check_failed" } }, 500);
    }

    const { data, error: claimError } = await context.supabaseAdmin.rpc(
      "push_claim_outbox_v2",
      { p_limit: 50 },
    );
    if (claimError) return response({ error: { code: "claim_failed" } }, 500);
    const claimed = (data ?? []) as ClaimRow[];
    if (claimed.length === 0) return response({ data: { claimed: 0 } });

    if (!isApnsConfigured()) {
      for (const row of claimed)
        await skip(context.supabaseAdmin, row.outbox_id, "apns_not_configured");
      return response({
        data: { claimed: claimed.length, skipped: claimed.length },
      });
    }

    const summaryGroups = new Map<string, ClaimRow[]>();
    for (const row of claimed) {
      if (row.delivery_mode === "summary") {
        const key = `${row.tenant_id}:${row.user_id}`;
        summaryGroups.set(key, [...(summaryGroups.get(key) ?? []), row]);
      } else {
        await deliverSingle(context.supabaseAdmin, row);
      }
    }
    for (const rows of summaryGroups.values()) {
      await deliverSummary(context.supabaseAdmin, rows);
    }
    return response({ data: { claimed: claimed.length } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handler(request);
    } catch {
      return response({ error: { code: "dispatch_failed" } }, 500);
    }
  },
};
