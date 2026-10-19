import { withSupabase } from "@supabase/server";
import {
  delegatedExchangeCallbackUrl,
  delegatedExchangeClientId,
  delegatedExchangeScopes,
  delegatedGraphRequest,
  isDelegatedExchangeMailConfigured,
  pkceChallenge,
  randomUrlSafe,
  sha256Hex,
  type DelegatedConnection,
} from "../_shared/exchange-delegated-oauth.ts";
import { ExchangeMailError } from "../_shared/exchange-graph.ts";
import { removeSubscriptionsForChannel } from "../_shared/exchange-mail-processing.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "integrations.email";
const OAUTH_STATE_TTL_MS = 10 * 60_000;

type Row = Record<string, unknown>;
type Admin = any;
type Channel = Row & {
  id: string;
  tenant_id: string;
  connection_id: string | null;
  access_mode: "delegated" | "legacy_rbac";
  entra_tenant_id: string;
  mailbox_address: string;
  mailbox_object_id: string | null;
  default_department_id: string | null;
  send_acknowledgement: boolean;
  send_agent_replies: boolean;
  send_resolution: boolean;
  configuration_version: number;
  status: "draft" | "verified" | "active" | "paused" | "error";
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
  | { action: "startMicrosoftConnect"; tenantId: string }
  | {
      action: "saveMailbox";
      tenantId: string;
      channelId: string | null;
      connectionId: string;
      mailboxAddress: string;
      mailboxObjectId: string | null;
      defaultDepartmentId: string | null;
      sendAcknowledgement: boolean;
      sendAgentReplies: boolean;
      sendResolution: boolean;
    }
  | { action: "verifyConnection"; tenantId: string; channelId: string }
  | { action: "activate"; tenantId: string; channelId: string }
  | { action: "pause"; tenantId: string; channelId: string }
  | { action: "sendTestMail"; tenantId: string; channelId: string };

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

function tenantAction(value: Row): { tenantId: string; action: string } | null {
  return typeof value.action === "string" && isUuid(value.tenantId)
    ? { action: value.action, tenantId: value.tenantId.toLowerCase() }
    : null;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  const base = tenantAction(value);
  if (!base) return null;
  if (
    ["getStatus", "startMicrosoftConnect"].includes(base.action) &&
    onlyKeys(value, ["action", "tenantId"])
  ) {
    return base as Action;
  }
  if (
    ["verifyConnection", "activate", "pause", "sendTestMail"].includes(
      base.action,
    ) &&
    onlyKeys(value, ["action", "tenantId", "channelId"]) &&
    isUuid(value.channelId)
  ) {
    return { ...base, channelId: value.channelId.toLowerCase() } as Action;
  }
  if (
    base.action !== "saveMailbox" ||
    !onlyKeys(value, [
      "action",
      "tenantId",
      "channelId",
      "connectionId",
      "mailboxAddress",
      "mailboxObjectId",
      "defaultDepartmentId",
      "sendAcknowledgement",
      "sendAgentReplies",
      "sendResolution",
    ]) ||
    !(value.channelId === null || isUuid(value.channelId)) ||
    !isUuid(value.connectionId) ||
    !mailbox(value.mailboxAddress) ||
    typeof value.sendAcknowledgement !== "boolean" ||
    typeof value.sendAgentReplies !== "boolean" ||
    typeof value.sendResolution !== "boolean"
  ) {
    return null;
  }
  const mailboxObjectId = nullableUuid(value.mailboxObjectId);
  const defaultDepartmentId = nullableUuid(value.defaultDepartmentId);
  if (mailboxObjectId === undefined || defaultDepartmentId === undefined)
    return null;
  return {
    action: "saveMailbox",
    tenantId: base.tenantId,
    channelId: value.channelId ? value.channelId.toLowerCase() : null,
    connectionId: value.connectionId.toLowerCase(),
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
      "Die zentrale Microsoft-365-Verbindung von nextDesk ist noch nicht vollständig eingerichtet.",
    feature_disabled:
      "Der E-Mail-Kanal ist für diesen Mandanten nicht aktiviert.",
    forbidden: "Sie dürfen diese Mandanteneinstellung nicht verwalten.",
    tenant_access_denied: "Sie haben keinen Zugriff auf diesen Mandanten.",
    invalid_settings:
      "Die Einstellungen für dieses Support-Postfach sind ungültig.",
    exchange_verification_required:
      "Bitte prüfen Sie dieses Support-Postfach erfolgreich, bevor Sie es aktivieren.",
    exchange_configuration_changed:
      "Die Postfachkonfiguration wurde zwischenzeitlich geändert. Laden Sie die Einstellungen neu und prüfen Sie erneut.",
    mailbox_in_use:
      "Dieses Support-Postfach ist bereits mit einem anderen Mandanten verbunden.",
    exchange_mailbox_not_found: "Das Support-Postfach wurde nicht gefunden.",
    exchange_access_denied:
      "Microsoft 365 verweigert den Zugriff auf dieses Postfach. Geben Sie dem verbundenen Konto in Exchange Admin Center mindestens Vollzugriff und Senden als für dieses Postfach.",
    exchange_reauthorization_required:
      "Die Microsoft-365-Verbindung muss erneut angemeldet werden.",
    legacy_migration_required:
      "Dieser bisherige E-Mail-Kanal muss zuerst über Microsoft 365 migriert werden.",
    exchange_throttled:
      "Microsoft Graph drosselt die Anfrage. Bitte versuchen Sie es später erneut.",
    exchange_unavailable:
      "Microsoft 365 ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
    connection_not_found:
      "Die gewählte Microsoft-365-Verbindung ist nicht verfügbar.",
    not_authenticated: "Sie sind nicht angemeldet.",
    invalid_request: "Die Anfrage ist ungültig.",
    operation_failed: "Die E-Mail-Kanal-Aktion konnte nicht ausgeführt werden.",
  };
  return (
    messages[code] ?? "Die E-Mail-Kanal-Aktion konnte nicht ausgeführt werden."
  );
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
  if (allowed.error || allowed.data !== true)
    throw new HttpError(403, "forbidden");
}

async function requireFeature(admin: Admin, tenantId: string): Promise<void> {
  const states = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!states || states[FEATURE] !== true)
    throw new HttpError(403, "feature_disabled");
}

async function getChannel(
  admin: Admin,
  tenantId: string,
  channelId: string,
): Promise<Channel> {
  const result = await admin
    .from("exchange_mail_channels")
    .select("*")
    .eq("id", channelId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (result.error) throw new HttpError(500, "operation_failed");
  if (!result.data) throw new HttpError(422, "invalid_settings");
  return result.data as Channel;
}

async function getDelegatedConnection(
  admin: Admin,
  tenantId: string,
  connectionId: string,
): Promise<DelegatedConnection> {
  const result = await admin
    .from("exchange_mail_connections")
    .select(
      "id, tenant_id, entra_tenant_id, connector_object_id, connector_principal, status",
    )
    .eq("id", connectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (result.error) throw new HttpError(500, "operation_failed");
  if (!result.data) throw new HttpError(422, "connection_not_found");
  return result.data as DelegatedConnection;
}

function matchChannelTarget(query: any, channel: Channel): any {
  const matched = query
    .eq("id", channel.id)
    .eq("tenant_id", channel.tenant_id)
    .eq("configuration_version", channel.configuration_version)
    .eq("mailbox_address", channel.mailbox_address);
  return channel.mailbox_object_id
    ? matched.eq("mailbox_object_id", channel.mailbox_object_id)
    : matched.is("mailbox_object_id", null);
}

function graphMailboxIdentifier(channel: Channel): string {
  return encodeURIComponent(
    channel.mailbox_object_id ?? channel.mailbox_address,
  );
}

function channelPayload(channel: Channel) {
  return {
    id: channel.id,
    connectionId: channel.connection_id,
    accessMode: channel.access_mode,
    entraTenantId: channel.entra_tenant_id,
    mailboxAddress: channel.mailbox_address,
    mailboxObjectId: channel.mailbox_object_id,
    defaultDepartmentId: channel.default_department_id,
    sendAcknowledgement: channel.send_acknowledgement,
    sendAgentReplies: channel.send_agent_replies,
    sendResolution: channel.send_resolution,
    status: channel.status,
    lastVerifiedAt: channel.last_verified_at,
    lastErrorCode: channel.last_error_code,
    lastErrorMessage: channel.last_error_message,
    lastInboundAt: channel.last_inbound_at,
    lastOutboundAt: channel.last_outbound_at,
    activatedAt: channel.activated_at,
  };
}

async function getStatus(
  request: Request,
  admin: Admin,
  tenantId: string,
): Promise<Response> {
  const [feature, connections, channels, departments, stats] =
    await Promise.all([
      resolveTenantFeatureStates(admin, tenantId, [FEATURE]),
      admin
        .from("exchange_mail_connections")
        .select(
          "id, entra_tenant_id, connector_principal, status, last_connected_at, last_error_code, last_error_message, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at"),
      admin
        .from("exchange_mail_channels")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at"),
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
    ]);
  if (
    !feature ||
    connections.error ||
    channels.error ||
    departments.error ||
    stats.error
  )
    throw new HttpError(500, "operation_failed");
  const rows = stats.data ?? [];
  return reply(request, {
    data: {
      platformConfigured: isDelegatedExchangeMailConfigured(),
      featureEnabled: feature[FEATURE] === true,
      callbackUrl: delegatedExchangeCallbackUrl(),
      connections: (connections.data ?? []).map((connection: any) => ({
        id: connection.id,
        entraTenantId: connection.entra_tenant_id,
        connectorPrincipal: connection.connector_principal,
        status: connection.status,
        lastConnectedAt: connection.last_connected_at,
        lastErrorCode: connection.last_error_code,
        lastErrorMessage: connection.last_error_message,
      })),
      channels: (channels.data ?? []).map((item: any) =>
        channelPayload(item as Channel),
      ),
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

async function startMicrosoftConnect(
  request: Request,
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const clientId = delegatedExchangeClientId();
  if (!isDelegatedExchangeMailConfigured() || !clientId)
    throw new HttpError(503, "exchange_platform_not_configured");
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);
  const verifier = randomUrlSafe(64);
  const stored = await admin.rpc("exchange_mail_create_oauth_state", {
    p_state_hash: await sha256Hex(state),
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_code_verifier: verifier,
    p_nonce_hash: await sha256Hex(nonce),
    p_expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (stored.error) throw new HttpError(500, "operation_failed");
  const authorizationUrl = new URL(
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: delegatedExchangeCallbackUrl(),
    response_mode: "query",
    scope: delegatedExchangeScopes().join(" "),
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "exchange_mail.connection.started",
    entity_type: "exchange_mail_connection",
    entity_id: null,
    severity: "security",
    metadata: { access_mode: "delegated" },
  });
  return reply(request, {
    data: { authorizationUrl: authorizationUrl.toString() },
  });
}

async function saveMailbox(
  request: Request,
  admin: Admin,
  action: Extract<Action, { action: "saveMailbox" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const connection = await getDelegatedConnection(
    admin,
    action.tenantId,
    action.connectionId,
  );
  if (connection.status !== "connected")
    throw new HttpError(422, "exchange_reauthorization_required");
  if (action.defaultDepartmentId) {
    const department = await admin
      .from("departments")
      .select("id")
      .eq("id", action.defaultDepartmentId)
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .maybeSingle();
    if (department.error || !department.data)
      throw new HttpError(422, "invalid_settings");
  }
  const existing = action.channelId
    ? await getChannel(admin, action.tenantId, action.channelId)
    : null;
  const changedTarget = Boolean(
    existing &&
    (existing.connection_id !== action.connectionId ||
      existing.mailbox_address !== action.mailboxAddress ||
      existing.mailbox_object_id !== action.mailboxObjectId),
  );
  const payload = {
    tenant_id: action.tenantId,
    connection_id: action.connectionId,
    access_mode: "delegated",
    entra_tenant_id: connection.entra_tenant_id,
    // A delegated connector may access a shared mailbox without permission to
    // read its Entra directory profile. Keep the validated address here and
    // verify the actual mailbox/read/send access explicitly on the next step.
    mailbox_address: action.mailboxAddress,
    mailbox_object_id: action.mailboxObjectId,
    default_department_id: action.defaultDepartmentId,
    send_acknowledgement: action.sendAcknowledgement,
    send_agent_replies: action.sendAgentReplies,
    send_resolution: action.sendResolution,
    ...(existing
      ? {
          updated_by: actorId,
          configuration_version: existing.configuration_version + 1,
          ...(changedTarget
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
        }
      : {
          created_by: actorId,
          updated_by: actorId,
          configuration_version: 1,
          status: "draft",
        }),
  };
  const stored = existing
    ? await admin
        .from("exchange_mail_channels")
        .update(payload)
        .eq("id", existing.id)
        .eq("tenant_id", action.tenantId)
        .eq("configuration_version", existing.configuration_version)
        .select("*")
        .maybeSingle()
    : await admin
        .from("exchange_mail_channels")
        .insert(payload)
        .select("*")
        .maybeSingle();
  if (stored.error) {
    if (stored.error.code === "23505")
      throw new HttpError(409, "mailbox_in_use");
    throw new HttpError(422, "invalid_settings");
  }
  if (!stored.data) throw new HttpError(409, "exchange_configuration_changed");
  if (existing) {
    if (changedTarget)
      await removeSubscriptionsForChannel(admin, existing).catch(
        () => undefined,
      );
    await admin
      .from("mail_messages")
      .update({
        processing_status: "ignored",
        ignore_reason: "channel_reconfigured",
      })
      .eq("channel_id", existing.id)
      .eq("direction", "outbound")
      .eq("exchange_configuration_version", existing.configuration_version)
      .in("processing_status", ["pending", "failed"]);
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: existing
      ? "exchange_mail.channel.updated"
      : "exchange_mail.channel.created",
    entity_type: "exchange_mail_channel",
    entity_id: stored.data.id,
    severity: "security",
    metadata: { access_mode: "delegated" },
  });
  return reply(request, {
    data: { channel: channelPayload(stored.data as Channel) },
  });
}

type VerificationStage = "mailbox" | "read" | "send";

async function verifyConnection(
  request: Request,
  admin: Admin,
  tenantId: string,
  channelId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const channel = await getChannel(admin, tenantId, channelId);
  if (channel.access_mode !== "delegated" || !channel.connection_id)
    throw new HttpError(422, "legacy_migration_required");
  if (channel.status === "active")
    throw new HttpError(409, "exchange_verification_required");
  const connection = await getDelegatedConnection(
    admin,
    tenantId,
    channel.connection_id,
  );
  const checks: Array<{
    key: "mailbox" | "read" | "send";
    ok: boolean;
    message: string;
  }> = [];
  let stage: VerificationStage = "mailbox";
  try {
    const mailboxId = graphMailboxIdentifier(channel);
    await delegatedGraphRequest(
      admin,
      connection,
      `/users/${mailboxId}/mailFolders/inbox?$select=id,totalItemCount`,
    );
    checks.push({
      key: "mailbox",
      ok: true,
      message: "Postfach wurde gefunden.",
    });
    stage = "read";
    await delegatedGraphRequest(
      admin,
      connection,
      `/users/${mailboxId}/mailFolders/inbox/messages?$top=1&$select=id`,
    );
    checks.push({
      key: "read",
      ok: true,
      message: "Leseberechtigung wurde geprüft.",
    });
    stage = "send";
    await delegatedGraphRequest(
      admin,
      connection,
      `/users/${mailboxId}/sendMail`,
      {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject: "nextDesk: Microsoft-365-Berechtigungsprüfung",
            body: {
              contentType: "Text",
              content:
                "Diese E-Mail bestätigt, dass nextDesk aus dem gewählten Support-Postfach senden darf.",
            },
            toRecipients: [
              { emailAddress: { address: connection.connector_principal } },
            ],
          },
          saveToSentItems: false,
        }),
      },
    );
    checks.push({
      key: "send",
      ok: true,
      message:
        "Senden als wurde geprüft; die Bestätigungs-E-Mail ging an das verbundene Microsoft-365-Konto.",
    });
  } catch (error) {
    const code =
      error instanceof ExchangeMailError ? error.code : "exchange_unavailable";
    const updated = await matchChannelTarget(
      admin
        .from("exchange_mail_channels")
        .update({
          status: "error",
          last_error_code: code,
          last_error_message: `${message(code)} Prüfphase: ${stage === "mailbox" ? "Postfach finden" : stage === "read" ? "Eingang lesen" : "Senden als"}.`,
        })
        .eq("status", channel.status),
      channel,
    )
      .select("id")
      .maybeSingle();
    if (updated.error) throw new HttpError(500, "operation_failed");
    if (!updated.data)
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
      .eq("status", channel.status),
    channel,
  )
    .select("*")
    .maybeSingle();
  if (verified.error) throw new HttpError(500, "operation_failed");
  if (!verified.data)
    throw new HttpError(409, "exchange_configuration_changed");
  return reply(request, {
    data: { checks, channel: channelPayload(verified.data as Channel) },
  });
}

async function activate(
  request: Request,
  admin: Admin,
  tenantId: string,
  channelId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const channel = await getChannel(admin, tenantId, channelId);
  if (channel.access_mode !== "delegated" || !channel.connection_id)
    throw new HttpError(422, "legacy_migration_required");
  if (channel.status !== "verified")
    throw new HttpError(409, "exchange_verification_required");
  const connection = await getDelegatedConnection(
    admin,
    tenantId,
    channel.connection_id,
  );
  if (connection.status !== "connected")
    throw new HttpError(422, "exchange_reauthorization_required");
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
    channel,
  )
    .select("*")
    .maybeSingle();
  if (activated.error) throw new HttpError(500, "operation_failed");
  if (!activated.data)
    throw new HttpError(409, "exchange_verification_required");
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "exchange_mail.channel.activated",
    entity_type: "exchange_mail_channel",
    entity_id: channel.id,
    severity: "security",
    metadata: { access_mode: "delegated", inbound: "polling" },
  });
  return reply(request, {
    data: { channel: channelPayload(activated.data as Channel) },
  });
}

async function pause(
  request: Request,
  admin: Admin,
  tenantId: string,
  channelId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const channel = await getChannel(admin, tenantId, channelId);
  const paused = await matchChannelTarget(
    admin
      .from("exchange_mail_channels")
      .update({
        status: "paused",
        configuration_version: channel.configuration_version + 1,
        updated_by: actorId,
      })
      .eq("status", channel.status),
    channel,
  )
    .select("*")
    .maybeSingle();
  if (paused.error) throw new HttpError(500, "operation_failed");
  if (!paused.data) throw new HttpError(409, "exchange_configuration_changed");
  await removeSubscriptionsForChannel(admin, paused.data as Channel).catch(
    () => undefined,
  );
  await admin
    .from("mail_messages")
    .update({
      processing_status: "ignored",
      ignore_reason: "channel_reconfigured",
    })
    .eq("channel_id", channel.id)
    .in("processing_status", ["pending", "failed"]);
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "exchange_mail.channel.paused",
    entity_type: "exchange_mail_channel",
    entity_id: channel.id,
    severity: "security",
    metadata: { access_mode: channel.access_mode },
  });
  return reply(request, {
    data: { channel: channelPayload(paused.data as Channel) },
  });
}

async function sendTestMail(
  request: Request,
  admin: Admin,
  tenantId: string,
  channelId: string,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, tenantId);
  const channel = await getChannel(admin, tenantId, channelId);
  if (channel.status !== "active") throw new HttpError(422, "invalid_settings");
  const user = await (admin.auth.admin as any).getUserById(actorId);
  const recipient = mailbox(user?.data?.user?.email);
  if (!recipient) throw new HttpError(422, "invalid_settings");
  const queued = await admin.from("mail_messages").insert({
    tenant_id: tenantId,
    channel_id: channel.id,
    exchange_configuration_version: channel.configuration_version,
    direction: "outbound",
    kind: "test",
    from_address: channel.mailbox_address,
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
    if (action.action === "startMicrosoftConnect")
      return await startMicrosoftConnect(
        request,
        context.supabaseAdmin,
        action.tenantId,
        actorId,
      );
    if (action.action === "saveMailbox")
      return await saveMailbox(request, context.supabaseAdmin, action, actorId);
    if (action.action === "verifyConnection")
      return await verifyConnection(
        request,
        context.supabaseAdmin,
        action.tenantId,
        action.channelId,
      );
    if (action.action === "activate")
      return await activate(
        request,
        context.supabaseAdmin,
        action.tenantId,
        action.channelId,
        actorId,
      );
    if (action.action === "pause")
      return await pause(
        request,
        context.supabaseAdmin,
        action.tenantId,
        action.channelId,
        actorId,
      );
    return await sendTestMail(
      request,
      context.supabaseAdmin,
      action.tenantId,
      action.channelId,
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
