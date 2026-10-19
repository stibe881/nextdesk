import { withSupabase } from "@supabase/server";
import {
  createSubscriptionForChannel,
  enqueueGraphInbound,
  maintenance,
  processDueInbound,
} from "../_shared/exchange-mail-processing.ts";
import {
  graphDeleteSubscription,
  graphRenewSubscription,
} from "../_shared/exchange-graph.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_VALIDATION_TOKEN_LENGTH = 4096;

type Row = Record<string, unknown>;
type Channel = {
  id: string;
  tenant_id: string;
  entra_tenant_id: string;
  mailbox_address: string;
  mailbox_object_id: string | null;
  default_department_id: string | null;
  send_acknowledgement: boolean;
  send_agent_replies: boolean;
  send_resolution: boolean;
  configuration_version: number;
  status: string;
  activated_at: string | null;
  poll_watermark: string | null;
};

function record(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(status: number, body?: Row): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: body
      ? { "Content-Type": "application/json; charset=utf-8" }
      : undefined,
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function timingSafeHashEqual(
  expectedHex: string,
  supplied: string,
): Promise<boolean> {
  const [expected, actual] = await Promise.all([
    sha256(expectedHex),
    sha256(hex(await sha256(supplied))),
  ]);
  let different = 0;
  for (let index = 0; index < expected.length; index += 1)
    different |= expected[index] ^ actual[index];
  return different === 0;
}

function randomHex(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function matchChannelTarget(query: any, channel: Channel): any {
  const matched = query
    .eq("id", channel.id)
    .eq("tenant_id", channel.tenant_id)
    .eq("configuration_version", channel.configuration_version)
    .eq("entra_tenant_id", channel.entra_tenant_id)
    .eq("mailbox_address", channel.mailbox_address);
  return channel.mailbox_object_id
    ? matched.eq("mailbox_object_id", channel.mailbox_object_id)
    : matched.is("mailbox_object_id", null);
}

async function channelIsActive(admin: any, channel: Channel): Promise<boolean> {
  const result = await matchChannelTarget(
    admin.from("exchange_mail_channels").select("id").eq("status", "active"),
    channel,
  ).maybeSingle();
  return !result.error && Boolean(result.data);
}

async function auditInvalid(
  admin: any,
  tenantId: string | null,
): Promise<void> {
  if (!tenantId) return;
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: null,
    action: "exchange_mail.webhook_rejected",
    entity_type: "exchange_mail_subscription",
    entity_id: null,
    severity: "security",
    metadata: { reason: "invalid_notification" },
  });
}

async function subscriptionForNotification(
  admin: any,
  item: Row,
): Promise<{
  subscription: any;
  channel: Channel;
} | null> {
  const subscriptionId =
    typeof item.subscriptionId === "string" ? item.subscriptionId : null;
  if (!subscriptionId || subscriptionId.length > 512) return null;
  const result = await admin
    .from("exchange_mail_subscriptions")
    .select("*, exchange_mail_channels!inner(*)")
    .eq("graph_subscription_id", subscriptionId)
    .eq("status", "active")
    .maybeSingle();
  if (
    result.error ||
    !result.data ||
    !record(result.data.exchange_mail_channels)
  )
    return null;
  const channel = result.data.exchange_mail_channels as Channel;
  if (
    result.data.configuration_version !== channel.configuration_version ||
    result.data.source_entra_tenant_id !== channel.entra_tenant_id
  )
    return null;
  return {
    subscription: result.data,
    channel,
  };
}

async function handleChangeNotification(
  admin: any,
  item: Row,
): Promise<string | null> {
  const resolved = await subscriptionForNotification(admin, item);
  if (!resolved) return null;
  const { subscription, channel } = resolved;
  if (channel.status !== "active") return null;
  const validClientState =
    typeof item.clientState === "string" &&
    (await timingSafeHashEqual(
      subscription.client_state_hash,
      item.clientState,
    ));
  const validTenant =
    typeof item.tenantId === "string" &&
    item.tenantId.toLowerCase() === channel.entra_tenant_id.toLowerCase();
  if (!validClientState || !validTenant) {
    await auditInvalid(admin, channel.tenant_id);
    return null;
  }
  if (!(await channelIsActive(admin, channel))) return null;
  await admin
    .from("exchange_mail_subscriptions")
    .update({ last_notification_at: new Date().toISOString() })
    .eq("id", subscription.id);
  if (item.changeType !== "created" || !record(item.resourceData)) return null;
  const messageId =
    typeof item.resourceData.id === "string" ? item.resourceData.id : null;
  if (!messageId || messageId.length > 1024) return null;
  await enqueueGraphInbound(admin, channel, messageId);
  return channel.id;
}

async function handleLifecycleNotification(
  admin: any,
  item: Row,
): Promise<void> {
  const resolved = await subscriptionForNotification(admin, item);
  if (!resolved) return;
  const { subscription, channel } = resolved;
  if (channel.status !== "active") return;
  const validClientState =
    typeof item.clientState === "string" &&
    (await timingSafeHashEqual(
      subscription.client_state_hash,
      item.clientState,
    ));
  const validTenant =
    typeof item.tenantId === "string" &&
    item.tenantId.toLowerCase() === channel.entra_tenant_id.toLowerCase();
  if (!validClientState || !validTenant) {
    await auditInvalid(admin, channel.tenant_id);
    return;
  }
  if (!(await channelIsActive(admin, channel))) return;
  const lifecycleEvent = item.lifecycleEvent;
  if (lifecycleEvent === "reauthorizationRequired") {
    const renewed = await graphRenewSubscription(
      channel.entra_tenant_id,
      subscription.graph_subscription_id,
      new Date(Date.now() + 4200 * 60_000).toISOString(),
    );
    if (!(await channelIsActive(admin, channel))) {
      await graphDeleteSubscription(
        channel.entra_tenant_id,
        subscription.graph_subscription_id,
      ).catch(() => undefined);
      await admin
        .from("exchange_mail_subscriptions")
        .update({ status: "removal_pending" })
        .eq("id", subscription.id)
        .eq("status", "active");
      return;
    }
    await admin
      .from("exchange_mail_subscriptions")
      .update({
        expires_at: renewed.expirationDateTime,
        last_renewed_at: new Date().toISOString(),
      })
      .eq("id", subscription.id)
      .eq("status", "active");
    return;
  }
  if (lifecycleEvent === "subscriptionRemoved") {
    await admin
      .from("exchange_mail_subscriptions")
      .update({ status: "removed" })
      .eq("id", subscription.id);
    const clientState = randomHex();
    await createSubscriptionForChannel(admin, channel, {
      webhookUrl:
        "https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-webhook",
      lifecycleUrl:
        "https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-webhook?lifecycle=1",
      clientState,
      clientStateHash: hex(await sha256(clientState)),
    });
  }
  if (lifecycleEvent === "subscriptionRemoved" || lifecycleEvent === "missed")
    await maintenance(admin);
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const url = new URL(request.url);
    const validationToken = url.searchParams.get("validationToken");
    if (validationToken !== null) {
      if (validationToken.length > MAX_VALIDATION_TOKEN_LENGTH)
        return new Response(null, { status: 400 });
      return new Response(validationToken, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
      return response(413, { error: { code: "payload_too_large" } });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES)
      return response(413, { error: { code: "payload_too_large" } });
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return response(400, { error: { code: "invalid_payload" } });
    }
    const notifications =
      record(payload) && Array.isArray(payload.value)
        ? payload.value.filter(record).slice(0, 100)
        : [];
    const lifecycle = url.searchParams.get("lifecycle") === "1";
    // Only authentic notifications (valid subscription, clientState and
    // tenant) lead to Graph calls, and only for the channels they concern.
    const work = lifecycle
      ? Promise.all(
          notifications.map((item) =>
            handleLifecycleNotification(context.supabaseAdmin, item).catch(
              () => undefined,
            ),
          ),
        ).then(() => undefined)
      : Promise.all(
          notifications.map((item) =>
            handleChangeNotification(context.supabaseAdmin, item).catch(
              () => null,
            ),
          ),
        ).then(async (channelIds) => {
          const accepted = [
            ...new Set(channelIds.filter((id): id is string => Boolean(id))),
          ];
          for (const channelId of accepted)
            await processDueInbound(context.supabaseAdmin, channelId).catch(
              () => undefined,
            );
        });
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime && typeof edgeRuntime.waitUntil === "function")
      edgeRuntime.waitUntil(work);
    else await work;
    return response(202, { data: { accepted: true } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handler(request);
    } catch {
      return response(500, { error: { code: "webhook_failed" } });
    }
  },
};
