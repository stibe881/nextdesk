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
  notification_id: string;
  ticket_id: string;
  kind: string;
  ticket_number: string;
  subject: string | null;
  devices: unknown;
  quiet_hours: boolean;
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
  reason: "apns_not_configured" | "quiet_hours",
): Promise<void> {
  await admin
    .from("push_outbox")
    .update({ status: "skipped", last_error: reason })
    .eq("id", outboxId)
    .eq("status", "sending");
}

async function deliverSingle(admin: any, row: ClaimRow): Promise<void> {
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
  const payload = buildApnsPayload({
    kind: payloadKind(row.kind, preferenceCategory),
    tenantId: row.tenant_id,
    notificationId: row.notification_id,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    subject: row.subject,
  });
  const results = await Promise.all(
    currentDevices.map(async (device) => {
      const result = await sendApns(
        device.token,
        device.environment,
        payload,
        row.notification_id,
      );
      await updateDeviceForDelivery(admin, device, result);
      return result;
    }),
  );
  await completeForDeliveries(admin, row, results);
}

async function deliverSummary(admin: any, rows: ClaimRow[]): Promise<void> {
  const uniqueDevices = new Map<string, Device>();
  for (const row of rows) {
    for (const device of devices(row.devices))
      uniqueDevices.set(device.id, device);
  }
  const anchor = rows[0];
  const payload = buildApnsPayload({
    kind: "summary",
    tenantId: anchor.tenant_id,
    notificationId: anchor.notification_id,
    summaryCount: rows.length,
  });
  const results = await Promise.all(
    [...uniqueDevices.values()].map(async (device) => {
      const result = await sendApns(
        device.token,
        device.environment,
        payload,
        anchor.notification_id,
      );
      await updateDeviceForDelivery(admin, device, result);
      return result;
    }),
  );
  for (const row of rows) await completeForDeliveries(admin, row, results);
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

    const { error: authorizationSweepError } = await context.supabaseAdmin.rpc(
      "push_skip_unauthorized_department_question_outbox",
    );
    // Fail closed: when the re-authorization check cannot run, no sensitive
    // department-question notification is claimed for APNs delivery.
    if (authorizationSweepError) {
      return response({ error: { code: "authorization_check_failed" } }, 500);
    }

    const { data, error: claimError } = await context.supabaseAdmin.rpc(
      "push_claim_outbox",
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

    const groups = new Map<string, ClaimRow[]>();
    for (const row of claimed) {
      if (row.quiet_hours) {
        await skip(context.supabaseAdmin, row.outbox_id, "quiet_hours");
        continue;
      }
      const key = `${row.tenant_id}:${row.user_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const rows of groups.values()) {
      if (rows.length > 3) await deliverSummary(context.supabaseAdmin, rows);
      else {
        for (const row of rows) await deliverSingle(context.supabaseAdmin, row);
      }
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
