import { withSupabase } from "@supabase/server";
import {
  ExchangeMailError,
  exchangeMailClientId,
  getExchangeAccessToken,
  graphMailboxIdentifier,
  graphRequest,
  isExchangeMailPlatformConfigured,
} from "../_shared/exchange-graph.ts";
import {
  createSubscriptionForChannel,
  removeSubscriptionsForChannel,
} from "../_shared/exchange-mail-processing.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "integrations.email";
const WEBHOOK_URL =
  "https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-webhook";

type Row = Record<string, unknown>;
type Admin = any;
type Channel = Row & {
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
  last_verified_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  activated_at: string | null;
  poll_watermark: string | null;
};
type Action =
  | { action: "getStatus"; tenantId: string }
  | {
      action: "saveSettings";
      tenantId: string;
      entraTenantId: string;
      mailboxAddress: string;
      mailboxObjectId: string | null;
      defaultDepartmentId: string | null;
      sendAcknowledgement: boolean;
      sendAgentReplies: boolean;
      sendResolution: boolean;
    }
  | { action: "verifyConnection"; tenantId: string }
  | { action: "activate"; tenantId: string }
  | { action: "pause"; tenantId: string }
  | { action: "sendTestMail"; tenantId: string };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
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

function mailbox(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
    ? address
    : null;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null
    ? null
    : isUuid(value)
      ? value.toLowerCase()
      : undefined;
}

function onlyKeys(value: Row, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    typeof value.action !== "string" ||
    !isUuid(value.tenantId)
  )
    return null;
  const tenantId = value.tenantId.toLowerCase();
  if (
    [
      "getStatus",
      "verifyConnection",
      "activate",
      "pause",
      "sendTestMail",
    ].includes(value.action) &&
    onlyKeys(value, ["action", "tenantId"])
  )
    return { action: value.action as Action["action"], tenantId } as Action;
  if (
    value.action !== "saveSettings" ||
    !onlyKeys(value, [
      "action",
      "tenantId",
      "entraTenantId",
      "mailboxAddress",
      "mailboxObjectId",
      "defaultDepartmentId",
      "sendAcknowledgement",
      "sendAgentReplies",
      "sendResolution",
    ]) ||
    !isUuid(value.entraTenantId) ||
    !mailbox(value.mailboxAddress) ||
    typeof value.sendAcknowledgement !== "boolean" ||
    typeof value.sendAgentReplies !== "boolean" ||
    typeof value.sendResolution !== "boolean"
  )
    return null;
  const mailboxObjectId = nullableUuid(value.mailboxObjectId);
  const defaultDepartmentId = nullableUuid(value.defaultDepartmentId);
  if (mailboxObjectId === undefined || defaultDepartmentId === undefined)
    return null;
  return {
    action: "saveSettings",
    tenantId,
    entraTenantId: value.entraTenantId.toLowerCase(),
    mailboxAddress: mailbox(value.mailboxAddress) as string,
    mailboxObjectId,
    defaultDepartmentId,
    sendAcknowledgement: value.sendAcknowledgement,
    sendAgentReplies: value.sendAgentReplies,
    sendResolution: value.sendResolution,
  };
}

function message(code: string): string {
  const messages: Record<string, string> = {
    exchange_platform_not_configured:
      "Die Exchange-Online-Plattform ist noch nicht konfiguriert.",
    feature_disabled:
      "Der E-Mail-Kanal ist für diesen Mandanten nicht aktiviert.",
    forbidden: "Sie dürfen diese Mandanteneinstellung nicht verwalten.",
    tenant_access_denied: "Sie haben keinen Zugriff auf diesen Mandanten.",
    invalid_settings: "Die Einstellungen für den E-Mail-Kanal sind ungültig.",
    exchange_verification_required:
      "Bitte prüfen Sie die Verbindung erfolgreich, bevor Sie den E-Mail-Kanal aktivieren.",
    exchange_overbroad_permissions:
      "Die nextDesk-App besitzt zu weitreichende Microsoft-Graph-Mailberechtigungen. Entfernen Sie Mail.*-Berechtigungen und prüfen Sie die Verbindung erneut.",
    exchange_configuration_changed:
      "Die E-Mail-Konfiguration wurde zwischenzeitlich geändert. Laden Sie die Einstellungen neu und prüfen Sie die Verbindung erneut.",
    mailbox_in_use:
      "Dieses Postfach wird bereits von einem anderen Mandanten verwendet.",
    exchange_app_not_consented:
      "Die nextDesk-App ist im Microsoft-Mandanten nicht freigegeben.",
    exchange_mailbox_not_found: "Das Support-Postfach wurde nicht gefunden.",
    exchange_access_denied:
      "Exchange Online verweigert den Zugriff. Prüfen Sie die RBAC-Zuweisung; Änderungen können 30 Minuten bis 2 Stunden benötigen.",
    exchange_throttled:
      "Microsoft Graph drosselt die Anfrage. Bitte versuchen Sie es später erneut.",
    exchange_unavailable:
      "Exchange Online ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
    not_authenticated: "Sie sind nicht angemeldet.",
    invalid_request: "Die Anfrage ist ungültig.",
    operation_failed: "Die E-Mail-Kanal-Aktion konnte nicht ausgeführt werden.",
  };
  return (
    messages[code] ?? "Die E-Mail-Kanal-Aktion konnte nicht ausgeführt werden."
  );
}

type VerificationStage = "token" | "inbox-folder" | "inbox-messages";

function verificationFailureMessage(
  code: string,
  stage: VerificationStage,
  error: unknown,
): string {
  const stageLabel: Record<VerificationStage, string> = {
    token: "Tokenabruf",
    "inbox-folder": "Zugriff auf den Eingangordner",
    "inbox-messages": "Lesen einer Nachricht im Eingangordner",
  };
  const graphCode =
    error instanceof ExchangeMailError ? error.graphErrorCode : undefined;
  const reference =
    error instanceof ExchangeMailError ? error.graphRequestId : undefined;
  return [
    message(code),
    `Prüfphase: ${stageLabel[stage]}.`,
    graphCode ? `Microsoft-Code: ${graphCode}.` : null,
    reference ? `Microsoft-Referenz: ${reference}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function headers(request: Request): Headers {
  const origin = request.headers.get("origin");
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin === ALLOWED_ORIGIN) {
    result.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return result;
}

function reply(request: Request, body: Row, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function failure(request: Request, error: unknown): Response {
  const safe =
    error instanceof HttpError
      ? error
      : error instanceof ExchangeMailError
        ? new HttpError(error.status, error.code)
        : new HttpError(500, "operation_failed");
  return reply(
    request,
    { error: { code: safe.code, message: message(safe.code) } },
    safe.status,
  );
}

async function requireTenantAdmin(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const membership = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error) throw new HttpError(500, "operation_failed");
  if (!membership.data) throw new HttpError(403, "tenant_access_denied");
  const allowed = await admin.rpc("user_has_tenant_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  if (allowed.error) {
    // Older local schemas use only the caller-scoped helper; direct role check
    // remains equivalent to push-notifications' Tenant administrator policy.
    const role = await admin
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", "Tenant administrator")
      .eq("scope", "tenant")
      .eq("active", true)
      .maybeSingle();
    const assignment = role.data?.id
      ? await admin
          .from("user_role_assignments")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("user_id", actorId)
          .eq("role_id", role.data.id)
          .lte("starts_at", new Date().toISOString())
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .maybeSingle()
      : { data: null };
    if (!assignment.data) throw new HttpError(403, "forbidden");
  } else if (allowed.data !== true) throw new HttpError(403, "forbidden");
}

async function requireFeature(admin: Admin, tenantId: string): Promise<void> {
  const states = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!states || states[FEATURE] !== true)
    throw new HttpError(403, "feature_disabled");
}

async function channel(
  admin: Admin,
  tenantId: string,
): Promise<Channel | null> {
  const result = await admin
    .from("exchange_mail_channels")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (result.error) throw new HttpError(500, "operation_failed");
  return result.data as Channel | null;
}

function matchChannelTarget(query: any, value: Channel): any {
  const matched = query
    .eq("id", value.id)
    .eq("tenant_id", value.tenant_id)
    .eq("configuration_version", value.configuration_version)
    .eq("entra_tenant_id", value.entra_tenant_id)
    .eq("mailbox_address", value.mailbox_address);
  return value.mailbox_object_id
    ? matched.eq("mailbox_object_id", value.mailbox_object_id)
    : matched.is("mailbox_object_id", null);
}

function suggestedEntraTenantId(issuer: unknown): string | null {
  if (typeof issuer !== "string") return null;
  const found = issuer.match(
    /login\.microsoftonline\.com\/([0-9a-f-]{36})(?:\/|$)/iu,
  );
  return found?.[1]?.toLowerCase() ?? null;
}

async function getStatus(
  request: Request,
  admin: Admin,
  tenantId: string,
): Promise<Response> {
  const [feature, foundChannel, departments, stats, sso, directory] =
    await Promise.all([
      resolveTenantFeatureStates(admin, tenantId, [FEATURE]),
      channel(admin, tenantId),
      admin
        .from("departments")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      admin
        .from("mail_messages")
        .select("direction, processing_status")
        .eq("tenant_id", tenantId)
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        ),
      admin
        .from("tenant_sso_configurations")
        .select("issuer_url")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("tenant_entra_directory_sync_configurations")
        .select("entra_tenant_id")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .maybeSingle(),
    ]);
  if (
    !feature ||
    departments.error ||
    stats.error ||
    sso.error ||
    directory.error
  )
    throw new HttpError(500, "operation_failed");
  let overBroadPermissions = false;
  if (foundChannel && isExchangeMailPlatformConfigured()) {
    try {
      overBroadPermissions = (
        await getExchangeAccessToken(foundChannel.entra_tenant_id)
      ).overBroadPermissions;
    } catch {
      // Status remains readable even while the Microsoft side is unavailable.
    }
  }
  const subscription = foundChannel
    ? await admin
        .from("exchange_mail_subscriptions")
        .select("expires_at")
        .eq("channel_id", foundChannel.id)
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (subscription.error) throw new HttpError(500, "operation_failed");
  const rows = stats.data ?? [];
  return reply(request, {
    data: {
      platformConfigured: isExchangeMailPlatformConfigured(),
      appId: exchangeMailClientId(),
      webhookUrl: WEBHOOK_URL,
      featureEnabled: feature[FEATURE] === true,
      suggestedEntraTenantId:
        (typeof directory.data?.entra_tenant_id === "string"
          ? directory.data.entra_tenant_id
          : null) ?? suggestedEntraTenantId(sso.data?.issuer_url),
      channel: foundChannel
        ? {
            entraTenantId: foundChannel.entra_tenant_id,
            mailboxAddress: foundChannel.mailbox_address,
            mailboxObjectId: foundChannel.mailbox_object_id,
            defaultDepartmentId: foundChannel.default_department_id,
            sendAcknowledgement: foundChannel.send_acknowledgement,
            sendAgentReplies: foundChannel.send_agent_replies,
            sendResolution: foundChannel.send_resolution,
            status: foundChannel.status,
            lastVerifiedAt: foundChannel.last_verified_at,
            lastErrorCode: foundChannel.last_error_code,
            lastErrorMessage: foundChannel.last_error_message,
            lastInboundAt: foundChannel.last_inbound_at,
            lastOutboundAt: foundChannel.last_outbound_at,
            activatedAt: foundChannel.activated_at,
            subscriptionExpiresAt: subscription.data?.expires_at ?? null,
            overBroadPermissions,
          }
        : null,
      departments: departments.data ?? [],
      stats: {
        inbound24h: rows.filter((row: any) => row.direction === "inbound")
          .length,
        outbound24h: rows.filter((row: any) => row.direction === "outbound")
          .length,
        failed24h: rows.filter((row: any) => row.processing_status === "failed")
          .length,
      },
    },
  });
}

async function saveSettings(
  request: Request,
  admin: Admin,
  action: Extract<Action, { action: "saveSettings" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const existing = await channel(admin, action.tenantId);
  if (action.defaultDepartmentId) {
    const department = await admin
      .from("departments")
      .select("id")
      .eq("id", action.defaultDepartmentId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle();
    if (department.error || !department.data)
      throw new HttpError(422, "invalid_settings");
  }
  const changedMailbox = Boolean(
    existing &&
    (existing.entra_tenant_id !== action.entraTenantId ||
      existing.mailbox_address !== action.mailboxAddress ||
      existing.mailbox_object_id !== action.mailboxObjectId),
  );
  const nextChannel = {
    tenant_id: action.tenantId,
    entra_tenant_id: action.entraTenantId,
    mailbox_address: action.mailboxAddress,
    mailbox_object_id: action.mailboxObjectId,
    default_department_id: action.defaultDepartmentId,
    send_acknowledgement: action.sendAcknowledgement,
    send_agent_replies: action.sendAgentReplies,
    send_resolution: action.sendResolution,
    ...(changedMailbox
      ? {
          status: "draft",
          last_verified_at: null,
          activated_at: null,
          activated_by: null,
          poll_watermark: null,
          last_error_code: null,
          last_error_message: null,
        }
      : {}),
    ...(existing
      ? {
          updated_by: actorId,
          configuration_version: existing.configuration_version + 1,
        }
      : {
          created_by: actorId,
          updated_by: actorId,
          configuration_version: 1,
        }),
  };
  const stored = existing
    ? await admin
        .from("exchange_mail_channels")
        .update(nextChannel)
        .eq("id", existing.id)
        .eq("tenant_id", existing.tenant_id)
        .eq("configuration_version", existing.configuration_version)
        .select("*")
        .maybeSingle()
    : await admin
        .from("exchange_mail_channels")
        .insert(nextChannel)
        .select("*")
        .maybeSingle();
  if (stored.error) {
    if (stored.error.code === "23505")
      throw new HttpError(409, "mailbox_in_use");
    throw new HttpError(422, "invalid_settings");
  }
  if (!stored.data) throw new HttpError(409, "exchange_configuration_changed");
  if (existing && changedMailbox) {
    await removeSubscriptionsForChannel(admin, existing);
    await admin
      .from("mail_messages")
      .update({
        processing_status: "ignored",
        ignore_reason: "channel_reconfigured",
      })
      .eq("channel_id", existing.id)
      .eq("direction", "outbound")
      .in("processing_status", ["pending", "failed"]);
  }
  return reply(request, { data: { channel: stored.data } });
}

async function verifyConnection(
  request: Request,
  admin: Admin,
  tenantId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  if (!isExchangeMailPlatformConfigured())
    throw new HttpError(503, "exchange_platform_not_configured");
  const found = await channel(admin, tenantId);
  if (!found) throw new HttpError(422, "invalid_settings");
  if (found.status === "active")
    throw new HttpError(409, "exchange_verification_required");
  const checks: Array<{
    key: "token" | "mailbox" | "read";
    ok: boolean;
    message: string;
  }> = [];
  let overBroadPermissions = false;
  let verificationStage: VerificationStage = "token";
  try {
    const token = await getExchangeAccessToken(found.entra_tenant_id);
    overBroadPermissions = token.overBroadPermissions;
    if (overBroadPermissions)
      throw new HttpError(422, "exchange_overbroad_permissions");
    checks.push({
      key: "token",
      ok: true,
      message: "Token wurde erfolgreich abgerufen.",
    });
    const mailbox = graphMailboxIdentifier(
      found.mailbox_object_id,
      found.mailbox_address,
    );
    verificationStage = "inbox-folder";
    await graphRequest(
      found.entra_tenant_id,
      `/users/${mailbox}/mailFolders/inbox?$select=id,totalItemCount`,
    );
    checks.push({
      key: "mailbox",
      ok: true,
      message: "Postfach wurde gefunden.",
    });
    verificationStage = "inbox-messages";
    await graphRequest(
      found.entra_tenant_id,
      `/users/${mailbox}/mailFolders/inbox/messages?$top=1&$select=id`,
    );
    checks.push({
      key: "read",
      ok: true,
      message: "Leseberechtigung wurde geprüft.",
    });
  } catch (error) {
    const code =
      error instanceof ExchangeMailError || error instanceof HttpError
        ? error.code
        : "exchange_unavailable";
    const recordedFailure = await matchChannelTarget(
      admin
        .from("exchange_mail_channels")
        .update({
          status: "error",
          last_error_code: code,
          last_error_message: verificationFailureMessage(
            code,
            verificationStage,
            error,
          ),
        })
        .eq("status", found.status),
      found,
    )
      .select("id")
      .maybeSingle();
    if (recordedFailure.error) throw new HttpError(500, "operation_failed");
    if (!recordedFailure.data)
      throw new HttpError(409, "exchange_configuration_changed");
    throw error;
  }
  const verified = await matchChannelTarget(
    admin
      .from("exchange_mail_channels")
      .update({
        status: "verified",
        last_verified_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("status", found.status),
    found,
  )
    .select("id")
    .maybeSingle();
  if (verified.error) throw new HttpError(500, "operation_failed");
  if (!verified.data)
    throw new HttpError(409, "exchange_verification_required");
  return reply(request, {
    data: { checks, overBroadPermissions },
  });
}

function randomHex(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function activate(
  request: Request,
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  if (!isExchangeMailPlatformConfigured())
    throw new HttpError(503, "exchange_platform_not_configured");
  const found = await channel(admin, tenantId);
  if (!found) throw new HttpError(422, "invalid_settings");
  if (found.status !== "verified")
    throw new HttpError(409, "exchange_verification_required");
  const token = await getExchangeAccessToken(found.entra_tenant_id);
  if (token.overBroadPermissions)
    throw new HttpError(422, "exchange_overbroad_permissions");
  const now = new Date().toISOString();
  const activated = await matchChannelTarget(
    admin
      .from("exchange_mail_channels")
      .update({
        status: "active",
        poll_watermark: now,
        activated_at: now,
        activated_by: actorId,
        last_error_code: null,
        last_error_message: null,
      })
      .eq("status", "verified"),
    found,
  )
    .select("*")
    .maybeSingle();
  if (activated.error) throw new HttpError(500, "operation_failed");
  if (!activated.data)
    throw new HttpError(409, "exchange_verification_required");
  const clientState = randomHex();
  try {
    const subscriptionExpiresAt = await createSubscriptionForChannel(
      admin,
      activated.data as Channel,
      {
        webhookUrl: WEBHOOK_URL,
        lifecycleUrl: `${WEBHOOK_URL}?lifecycle=1`,
        clientState,
        clientStateHash: await sha256(clientState),
      },
    );
    if (!subscriptionExpiresAt)
      throw new HttpError(409, "exchange_verification_required");
    return reply(request, {
      data: { status: "active", subscriptionExpiresAt },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code =
      error instanceof ExchangeMailError ? error.code : "exchange_unavailable";
    await matchChannelTarget(
      admin
        .from("exchange_mail_channels")
        .update({ last_error_code: code, last_error_message: message(code) })
        .eq("status", "active"),
      activated.data as Channel,
    );
    // Polling remains active, exactly as required when a Graph subscription fails.
    return reply(request, {
      data: { status: "active", subscriptionExpiresAt: null },
    });
  }
}

async function pause(
  request: Request,
  admin: Admin,
  tenantId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const found = await channel(admin, tenantId);
  if (!found) throw new HttpError(422, "invalid_settings");
  const paused = await matchChannelTarget(
    admin
      .from("exchange_mail_channels")
      .update({
        status: "paused",
        configuration_version: found.configuration_version + 1,
      })
      .eq("status", found.status),
    found,
  )
    .select("*")
    .maybeSingle();
  if (paused.error) throw new HttpError(500, "operation_failed");
  if (!paused.data) throw new HttpError(409, "exchange_configuration_changed");
  await removeSubscriptionsForChannel(admin, paused.data as Channel);
  return reply(request, { data: { status: "paused" } });
}

async function sendTestMail(
  request: Request,
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  if (!isExchangeMailPlatformConfigured())
    throw new HttpError(503, "exchange_platform_not_configured");
  const found = await channel(admin, tenantId);
  if (!found || found.status !== "active")
    throw new HttpError(422, "invalid_settings");
  const user = await (admin.auth.admin as any).getUserById(actorId);
  const recipient = mailbox(user?.data?.user?.email);
  if (!recipient) throw new HttpError(422, "invalid_settings");
  const queued = await admin.from("mail_messages").insert({
    tenant_id: tenantId,
    channel_id: found.id,
    exchange_configuration_version: found.configuration_version,
    direction: "outbound",
    kind: "test",
    from_address: found.mailbox_address,
    to_addresses: [recipient],
    subject: "nextDesk E-Mail-Kanal Test",
  });
  if (queued.error) throw new HttpError(500, "operation_failed");
  return reply(request, { data: { queued: true } }, 202);
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) throw new HttpError(401, "not_authenticated");
    const action = parseAction(await request.json().catch(() => null));
    if (!action) throw new HttpError(400, "invalid_request");
    await requireTenantAdmin(context.supabaseAdmin, action.tenantId, actorId);
    if (action.action === "getStatus")
      return await getStatus(request, context.supabaseAdmin, action.tenantId);
    if (action.action === "saveSettings")
      return await saveSettings(
        request,
        context.supabaseAdmin,
        action,
        actorId,
      );
    if (action.action === "verifyConnection")
      return await verifyConnection(
        request,
        context.supabaseAdmin,
        action.tenantId,
      );
    if (action.action === "activate")
      return await activate(
        request,
        context.supabaseAdmin,
        action.tenantId,
        actorId,
      );
    if (action.action === "pause")
      return await pause(request, context.supabaseAdmin, action.tenantId);
    return await sendTestMail(
      request,
      context.supabaseAdmin,
      action.tenantId,
      actorId,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN)
      return failure(request, new HttpError(403, "forbidden"));
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN)
        return failure(request, new HttpError(403, "forbidden"));
      return new Response(null, { status: 204, headers: headers(request) });
    }
    if (request.method !== "POST")
      return failure(request, new HttpError(405, "invalid_request"));
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return failure(request, new HttpError(415, "invalid_request"));
    try {
      const response = await handler(request);
      if (response.headers.has("x-supabase-server-error"))
        return failure(request, new HttpError(401, "not_authenticated"));
      return new Response(response.body, {
        status: response.status,
        headers: headers(request),
      });
    } catch (error) {
      return failure(request, error);
    }
  },
};
