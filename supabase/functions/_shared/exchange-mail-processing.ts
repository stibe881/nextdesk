import { ExchangeMailError } from "./exchange-graph.ts";
import {
  delegatedGraphRequest,
  type DelegatedConnection,
} from "./exchange-delegated-oauth.ts";
import { resolveTenantFeatureStates } from "./tenant-features.ts";

const SERVICE_EMAIL = "exchange-mail-service@app.nextdesk.ch";
const SERVICE_NAME = "nextDesk E-Mail-Dienst";
const MAX_BODY = 48_000;
const MAX_INBOUND_ATTACHMENTS = 10;
const MAX_INBOUND_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_INBOUND_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_OUTBOUND_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const BUCKET = "ticket-attachments";
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const TICKET_NUMBER_PATTERN =
  /(?:^|[^a-z0-9_-])([a-z0-9_-]{2,8}-\d{4}-\d{6})(?=$|[^a-z0-9_-])/gi;

type Admin = any;
type Row = Record<string, unknown>;
type Channel = {
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
  status: string;
  activated_at: string | null;
  poll_watermark: string | null;
};
type Message = {
  id: string;
  tenant_id: string;
  channel_id: string;
  exchange_configuration_version: number | null;
  direction: "inbound" | "outbound";
  kind: string | null;
  graph_message_id: string | null;
  ticket_id: string | null;
  comment_id: string | null;
  department_question_id: string | null;
  recipient_user_id: string | null;
  to_addresses: string[];
  attempt_count: number;
};

async function delegatedConnectionForChannel(
  admin: Admin,
  channel: Channel,
): Promise<DelegatedConnection> {
  if (channel.access_mode !== "delegated" || !channel.connection_id)
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  const result = await admin
    .from("exchange_mail_connections")
    .select(
      "id, tenant_id, entra_tenant_id, connector_object_id, connector_principal, status",
    )
    .eq("id", channel.connection_id)
    .eq("tenant_id", channel.tenant_id)
    .maybeSingle();
  if (result.error || !result.data)
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  return result.data as DelegatedConnection;
}

async function graphRequestForChannel<T = Row>(
  admin: Admin,
  channel: Channel,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  return await delegatedGraphRequest<T>(
    admin,
    await delegatedConnectionForChannel(admin, channel),
    path,
    init,
  );
}

function graphMailboxIdentifier(
  mailboxObjectId: string | null,
  mailboxAddress: string,
): string {
  return encodeURIComponent(mailboxObjectId ?? mailboxAddress);
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

async function activeChannel(
  admin: Admin,
  expected: Channel,
): Promise<Channel | null> {
  const result = await matchChannelTarget(
    admin.from("exchange_mail_channels").select("*").eq("status", "active"),
    expected,
  ).maybeSingle();
  if (result.error) throw new Error("channel_load_failed");
  return result.data as Channel | null;
}

function record(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function array(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function cleanText(value: unknown, fallback = "E-Mail ohne Text"): string {
  if (typeof value !== "string") return fallback;
  const text = value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, MAX_BODY);
  return text || fallback;
}

function emailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
    ? address
    : null;
}

function emailFromPerson(value: unknown): string | null {
  if (!record(value) || !record(value.emailAddress)) return null;
  return emailAddress(value.emailAddress.address);
}

function displayNameFromAddress(address: string): string {
  const local = address.slice(0, address.indexOf("@"));
  const label = local
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return label || "E-Mail-Kontakt";
}

function subject(value: unknown): string {
  const cleaned = cleanText(value, "E-Mail-Anfrage").replace(/\s+/g, " ");
  return cleaned.length >= 3 ? cleaned.slice(0, 240) : "E-Mail-Anfrage";
}

function ticketNumbers(value: string): string[] {
  const matches = new Set<string>();
  for (const match of value.matchAll(TICKET_NUMBER_PATTERN)) {
    if (match[1]) matches.add(match[1].toUpperCase());
  }
  return [...matches];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function htmlTemplate(input: {
  text: string;
  ticketNumber: string;
  subject: string;
  portalName: string;
  attachmentNotice: boolean;
}): string {
  const attachment = input.attachmentNotice
    ? "<p>Einige Anhänge sind zu gross für den E-Mail-Versand. Bitte verwenden Sie das Portal.</p>"
    : "";
  return `<div style="font-family:Arial,sans-serif;line-height:1.5">${escapeHtml(input.text).replace(/\n/g, "<br>")}${attachment}<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="color:#666;font-size:12px">${escapeHtml(input.ticketNumber)} · ${escapeHtml(input.subject)} · ${escapeHtml(input.portalName)}</p><p style="color:#666;font-size:12px">Antworten Sie direkt auf diese E-Mail. Bitte lassen Sie die Ticketnummer im Betreff stehen.</p></div>`;
}

function retryDelaySeconds(attempt: number, retryAfter?: number): number {
  const exponential = Math.min(6 * 60 * 60, 60 * 2 ** Math.max(0, attempt));
  return Math.max(exponential, retryAfter ?? 0);
}

function errorCode(error: unknown): string {
  return error instanceof ExchangeMailError
    ? error.code
    : "exchange_unavailable";
}

function isPermanent(error: unknown): boolean {
  return (
    error instanceof ExchangeMailError &&
    [
      "exchange_app_not_consented",
      "exchange_mailbox_not_found",
      "exchange_access_denied",
      "exchange_platform_not_configured",
    ].includes(error.code)
  );
}

async function updateMessage(
  admin: Admin,
  id: string,
  values: Row,
): Promise<void> {
  await admin.from("mail_messages").update(values).eq("id", id);
}

// Atomically claims a due queue entry so parallel webhook, trigger and
// maintenance runs never process the same message twice.
async function claimMessage(admin: Admin, id: string): Promise<boolean> {
  const result = await admin
    .from("mail_messages")
    .update({ processing_status: "processing" })
    .eq("id", id)
    .in("processing_status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("attempt_count", 6)
    .select("id");
  return (
    !result.error && Array.isArray(result.data) && result.data.length === 1
  );
}

// Entries left in "processing" by an interrupted run become retryable again;
// each recovery counts as an attempt so a crashing message cannot loop forever.
async function recoverStaleProcessing(admin: Admin): Promise<void> {
  const stale = await admin
    .from("mail_messages")
    .select("id, attempt_count")
    .eq("processing_status", "processing")
    .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(50);
  for (const item of (stale.data ?? []) as Array<{
    id: string;
    attempt_count: number | null;
  }>) {
    const attempts = Number(item.attempt_count ?? 0) + 1;
    await admin
      .from("mail_messages")
      .update({
        processing_status: "failed",
        attempt_count: attempts,
        last_error_code: "processing_timeout",
        next_attempt_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("processing_status", "processing");
  }
}

/** Processes due inbound entries of one channel (used after authentic webhook notifications). */
export async function processDueInbound(
  admin: Admin,
  channelId: string,
): Promise<void> {
  const due = await admin
    .from("mail_messages")
    .select(
      "id, tenant_id, channel_id, exchange_configuration_version, direction, kind, graph_message_id, ticket_id, comment_id, to_addresses, attempt_count",
    )
    .eq("channel_id", channelId)
    .eq("direction", "inbound")
    .in("processing_status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("attempt_count", 6)
    .order("created_at")
    .limit(20);
  for (const item of (due.data ?? []) as Message[]) {
    await processInboundMessage(admin, item).catch(() => undefined);
  }
}

async function retryOrFail(
  admin: Admin,
  message: Message,
  error: unknown,
): Promise<void> {
  const nextAttempt = Number(message.attempt_count ?? 0) + 1;
  const code = errorCode(error);
  const retryAfter =
    error instanceof ExchangeMailError ? error.retryAfterSeconds : undefined;
  const terminal = isPermanent(error) || nextAttempt >= 6;
  await admin
    .from("mail_messages")
    .update({
      processing_status: "failed",
      attempt_count: nextAttempt,
      next_attempt_at: terminal
        ? new Date(253402300799000).toISOString()
        : new Date(
            Date.now() + retryDelaySeconds(nextAttempt, retryAfter) * 1000,
          ).toISOString(),
      last_error_code: code,
    })
    .eq("id", message.id)
    .eq("processing_status", "processing");
}

async function markProcessed(
  admin: Admin,
  message: Message,
  values: Row = {},
): Promise<void> {
  await updateMessage(admin, message.id, {
    processing_status: "processed",
    last_error_code: null,
    occurred_at: new Date().toISOString(),
    ...values,
  });
}

async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Row = {},
): Promise<void> {
  // Metadata deliberately contains no email body, token, recipient, subject or address.
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity: "info",
    metadata,
  });
}

async function exchangeMailFeatureEnabled(
  admin: Admin,
  tenantId: string,
): Promise<boolean> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [
    "integrations.email",
  ]);
  return flags?.["integrations.email"] === true;
}

export async function ensureExchangeMailServiceIdentity(
  admin: Admin,
): Promise<string> {
  const existing = await admin
    .schema("mail_private")
    .from("service_identity")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  if (existing.error) throw new Error("service_identity_lookup_failed");
  let userId = asString(existing.data?.user_id);

  if (!userId) {
    const created = await (admin.auth.admin as any).createUser({
      email: SERVICE_EMAIL,
      email_confirm: true,
      password: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
      ban_duration: "876000h",
      app_metadata: { nextdesk_service_identity: "exchange_mail" },
      user_metadata: { display_name: SERVICE_NAME },
    });
    userId = asString(created?.data?.user?.id);
    if (!userId) {
      const users = await (admin.auth.admin as any).listUsers({
        page: 1,
        perPage: 1000,
      });
      const found = Array.isArray(users?.data?.users)
        ? users.data.users.find(
            (user: any) =>
              typeof user?.email === "string" &&
              user.email.toLowerCase() === SERVICE_EMAIL,
          )
        : null;
      userId = asString(found?.id);
    }
    if (!userId) throw new Error("service_identity_create_failed");
    const saved = await admin
      .schema("mail_private")
      .from("service_identity")
      .upsert(
        { singleton: true, user_id: userId },
        { onConflict: "singleton" },
      );
    if (saved.error) throw new Error("service_identity_store_failed");
  }

  const profile = await admin
    .from("user_profiles")
    .upsert({ id: userId, display_name: SERVICE_NAME }, { onConflict: "id" });
  if (profile.error) throw new Error("service_identity_profile_failed");
  const membership = await admin
    .from("tenant_memberships")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (membership.error || membership.data)
    throw new Error("service_identity_membership_invalid");
  return userId;
}

async function requesterContact(
  admin: Admin,
  tenantId: string,
  address: string,
): Promise<{ id: string; email: string }> {
  const upsert = await admin
    .from("ticket_requesters")
    .upsert(
      {
        tenant_id: tenantId,
        email: address,
        display_name: displayNameFromAddress(address),
        source: "email",
      },
      { onConflict: "tenant_id,email" },
    )
    .select("id, email")
    .single();
  if (
    upsert.error ||
    !asString(upsert.data?.id) ||
    !emailAddress(upsert.data?.email)
  )
    throw new Error("requester_contact_upsert_failed");
  return { id: upsert.data.id, email: upsert.data.email };
}

async function findInboundTicket(
  admin: Admin,
  channel: Channel,
  graph: Row,
): Promise<{ id: string; ticket_number: string } | null> {
  const headers = array(graph.internetMessageHeaders);
  const references = headers
    .filter((header) => {
      const name = asString(header.name)?.toLowerCase();
      return name === "in-reply-to" || name === "references";
    })
    .flatMap(
      (header) => asString(header.value)?.match(/<[^<>\r\n]{1,512}>/g) ?? [],
    )
    .slice(0, 20);
  if (references.length) {
    const result = await admin
      .from("mail_messages")
      .select("ticket_id, tickets!inner(id, ticket_number)")
      .eq("tenant_id", channel.tenant_id)
      .eq("channel_id", channel.id)
      .in("internet_message_id", references)
      .not("ticket_id", "is", null)
      .limit(2);
    const candidate = result.data?.[0]?.tickets;
    if (!result.error && result.data?.length === 1 && record(candidate)) {
      const id = asString(candidate.id);
      const number = asString(candidate.ticket_number);
      if (id && number) return { id, ticket_number: number };
    }
  }

  const numbers = ticketNumbers(subject(graph.subject));
  if (numbers.length === 1) {
    const byNumber = await admin
      .from("tickets")
      .select("id, ticket_number")
      .eq("tenant_id", channel.tenant_id)
      .eq("exchange_mail_channel_id", channel.id)
      .eq("ticket_number", numbers[0])
      .maybeSingle();
    if (!byNumber.error && asString(byNumber.data?.id)) return byNumber.data;
  }

  const conversationId = asString(graph.conversationId);
  if (conversationId) {
    const byConversation = await admin
      .from("mail_messages")
      .select("ticket_id, tickets!inner(id, ticket_number)")
      .eq("tenant_id", channel.tenant_id)
      .eq("channel_id", channel.id)
      .eq("conversation_id", conversationId)
      .not("ticket_id", "is", null)
      .limit(2);
    const candidate = byConversation.data?.[0]?.tickets;
    if (
      !byConversation.error &&
      byConversation.data?.length === 1 &&
      record(candidate)
    ) {
      const id = asString(candidate.id);
      const number = asString(candidate.ticket_number);
      if (id && number) return { id, ticket_number: number };
    }
  }
  return null;
}

async function senderMayReply(
  admin: Admin,
  tenantId: string,
  channelId: string,
  ticketId: string,
  sender: string,
): Promise<boolean> {
  const ticket = await admin
    .from("tickets")
    .select("requester_contact_id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (ticket.error || !ticket.data) return false;
  if (asString(ticket.data.requester_contact_id)) {
    const contact = await admin
      .from("ticket_requesters")
      .select("email")
      .eq("id", ticket.data.requester_contact_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (emailAddress(contact.data?.email) === sender) return true;
  }
  const participating = await admin
    .from("mail_messages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("ticket_id", ticketId)
    .or(`from_address.eq.${sender},to_addresses.cs.{${sender}}`)
    .limit(1)
    .maybeSingle();
  if (!participating.error && participating.data) return true;
  const configuration = await admin
    .from("tenant_sso_configurations")
    .select("allowed_email_domains")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const domain = sender.slice(sender.lastIndexOf("@") + 1);
  return (
    !configuration.error &&
    Array.isArray(configuration.data?.allowed_email_domains) &&
    configuration.data.allowed_email_domains.some(
      (item: unknown) =>
        typeof item === "string" && item.trim().toLowerCase() === domain,
    )
  );
}

function ignoredReason(
  channel: Channel,
  graph: Row,
  sender: string | null,
): string | null {
  if (graph.isDraft === true) return "draft";
  if (!sender) return "sender_missing";
  if (sender === channel.mailbox_address) return "mailbox_self";
  if (sender === "mailer-daemon" || sender.startsWith("mailer-daemon@"))
    return "mailer_daemon";
  if (sender === "postmaster" || sender.startsWith("postmaster@"))
    return "postmaster";
  const headers = new Map(
    array(graph.internetMessageHeaders)
      .map((item) => [asString(item.name)?.toLowerCase(), asString(item.value)])
      .filter((item): item is [string, string] => Boolean(item[0] && item[1])),
  );
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_submitted";
  if (headers.has("x-autoreply") || headers.has("x-autorespond"))
    return "auto_reply";
  const precedence = headers.get("precedence")?.toLowerCase();
  if (precedence && ["bulk", "junk", "list", "auto_reply"].includes(precedence))
    return "bulk_or_list";
  if (
    channel.activated_at &&
    typeof graph.receivedDateTime === "string" &&
    Date.parse(graph.receivedDateTime) < Date.parse(channel.activated_at)
  )
    return "before_activation";
  return null;
}

async function isOtherChannelMailbox(
  admin: Admin,
  sender: string,
): Promise<boolean> {
  const result = await admin
    .from("exchange_mail_channels")
    .select("id")
    .eq("mailbox_address", sender)
    .limit(1)
    .maybeSingle();
  return !result.error && Boolean(result.data);
}

async function createInboundAttachments(
  admin: Admin,
  channel: Channel,
  graphMessageId: string,
  ticketId: string,
  commentId: string | null,
  serviceIdentityId: string,
): Promise<void> {
  const mailbox = graphMailboxIdentifier(
    channel.mailbox_object_id,
    channel.mailbox_address,
  );
  const response = await graphRequestForChannel<Row>(
    admin,
    channel,
    `/users/${mailbox}/messages/${encodeURIComponent(graphMessageId)}/attachments?$top=${MAX_INBOUND_ATTACHMENTS}`,
  );
  const entries = array(response.data.value).slice(0, MAX_INBOUND_ATTACHMENTS);
  let total = 0;
  for (const entry of entries) {
    if (entry["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    const contentType = asString(entry.contentType)?.toLowerCase();
    const filename = asString(entry.name);
    const contentBytes = asString(entry.contentBytes);
    const size = typeof entry.size === "number" ? entry.size : 0;
    if (
      !contentType ||
      !filename ||
      !contentBytes ||
      !ALLOWED_CONTENT_TYPES.has(contentType) ||
      size < 1 ||
      size > MAX_INBOUND_ATTACHMENT_BYTES ||
      total + size > MAX_INBOUND_TOTAL_BYTES ||
      filename.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/.test(filename)
    )
      continue;
    const raw = Uint8Array.from(atob(contentBytes), (character) =>
      character.charCodeAt(0),
    );
    if (raw.byteLength !== size) continue;
    total += size;
    const path = `${channel.tenant_id}/${ticketId}/${crypto.randomUUID()}`;
    const uploaded = await admin.storage
      .from(BUCKET)
      .upload(path, raw, { contentType, upsert: false });
    if (uploaded.error) continue;
    await admin.from("ticket_attachments").insert({
      ticket_id: ticketId,
      comment_id: commentId,
      uploaded_by: serviceIdentityId,
      storage_bucket: BUCKET,
      storage_object_path: path,
      original_filename: filename,
      content_type: contentType,
      byte_size: size,
    });
  }
}

async function createNewTicket(
  admin: Admin,
  channel: Channel,
  graph: Row,
  sender: string,
  serviceIdentityId: string,
): Promise<{ id: string; ticket_number: string; contactId: string }> {
  if (!(await activeChannel(admin, channel)))
    throw new Error("channel_reconfigured");
  const contact = await requesterContact(admin, channel.tenant_id, sender);
  const department = channel.default_department_id
    ? await admin
        .from("departments")
        .select("id, key")
        .eq("id", channel.default_department_id)
        .eq("tenant_id", channel.tenant_id)
        .eq("active", true)
        .maybeSingle()
    : await admin
        .from("departments")
        .select("id, key")
        .eq("tenant_id", channel.tenant_id)
        .eq("active", true)
        .order("key")
        .limit(1)
        .maybeSingle();
  const status = await admin
    .from("ticket_statuses")
    .select("id")
    .eq("tenant_id", channel.tenant_id)
    .eq("key", "new")
    .maybeSingle();
  const priority = await admin
    .from("ticket_priorities")
    .select("id")
    .eq("tenant_id", channel.tenant_id)
    .eq("key", "normal")
    .maybeSingle();
  if (
    department.error ||
    status.error ||
    priority.error ||
    !department.data ||
    !status.data ||
    !priority.data
  )
    throw new Error("ticket_defaults_unavailable");
  const number = await admin.rpc("reserve_ticket_number", {
    p_tenant_id: channel.tenant_id,
    p_department_id: department.data.id,
    p_prefix: String(department.data.key).slice(0, 8),
  });
  if (number.error || !asString(number.data))
    throw new Error("ticket_number_failed");
  if (!(await activeChannel(admin, channel)))
    throw new Error("channel_reconfigured");
  const created = await admin
    .from("tickets")
    .insert({
      tenant_id: channel.tenant_id,
      department_id: department.data.id,
      ticket_number: number.data,
      subject: subject(graph.subject),
      description: `Eingegangene E-Mail von ${displayNameFromAddress(sender)}\n\n${cleanText(
        record(graph.uniqueBody) ? graph.uniqueBody.content : null,
      )}`,
      status_id: status.data.id,
      priority_id: priority.data.id,
      requester_id: serviceIdentityId,
      requester_contact_id: contact.id,
      source: "email",
    })
    .select("id, ticket_number")
    .single();
  if (created.error || !asString(created.data?.id))
    throw new Error("ticket_create_failed");
  await admin.from("ticket_events").insert({
    ticket_id: created.data.id,
    actor_id: serviceIdentityId,
    event_type: "ticket.created",
    payload: { source: "exchange_online" },
  });
  return {
    id: created.data.id,
    ticket_number: created.data.ticket_number,
    contactId: contact.id,
  };
}

async function enqueueAcknowledgement(
  admin: Admin,
  channel: Channel,
  ticket: { id: string; ticket_number: string; contactId: string },
): Promise<void> {
  if (!channel.send_acknowledgement) return;
  const contact = await admin
    .from("ticket_requesters")
    .select("email")
    .eq("id", ticket.contactId)
    .eq("tenant_id", channel.tenant_id)
    .maybeSingle();
  const recipient = emailAddress(contact.data?.email);
  if (!recipient) return;
  await admin.from("mail_messages").insert({
    tenant_id: channel.tenant_id,
    channel_id: channel.id,
    exchange_configuration_version: channel.configuration_version,
    direction: "outbound",
    kind: "acknowledgement",
    ticket_id: ticket.id,
    from_address: channel.mailbox_address,
    to_addresses: [recipient],
    subject: `Bestätigung ${ticket.ticket_number}`,
  });
}

export async function processInboundMessage(
  admin: Admin,
  rawMessage: Message,
): Promise<void> {
  const message = rawMessage as Message;
  if (
    !Number.isSafeInteger(message.exchange_configuration_version) ||
    !message.exchange_configuration_version ||
    message.exchange_configuration_version < 1
  ) {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "channel_reconfigured",
    });
    return;
  }
  const channelResult = await admin
    .from("exchange_mail_channels")
    .select("*")
    .eq("id", message.channel_id)
    .eq("tenant_id", message.tenant_id)
    .eq("configuration_version", message.exchange_configuration_version)
    .maybeSingle();
  const channel = channelResult.data as Channel | null;
  if (channelResult.error || !channel || channel.status !== "active") {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "channel_inactive",
    });
    return;
  }
  if (channel.access_mode !== "delegated") {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "legacy_migration_required",
    });
    return;
  }
  if (!(await exchangeMailFeatureEnabled(admin, channel.tenant_id))) {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "feature_disabled",
    });
    return;
  }
  if (!message.graph_message_id) {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "graph_message_missing",
    });
    return;
  }
  try {
    if (!(await claimMessage(admin, message.id))) return;
    const mailbox = graphMailboxIdentifier(
      channel.mailbox_object_id,
      channel.mailbox_address,
    );
    const graphResponse = await graphRequestForChannel<Row>(
      admin,
      channel,
      `/users/${mailbox}/messages/${encodeURIComponent(message.graph_message_id)}?$select=id,internetMessageId,conversationId,subject,from,sender,replyTo,toRecipients,ccRecipients,receivedDateTime,uniqueBody,body,hasAttachments,isDraft,internetMessageHeaders`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    const graph = graphResponse.data;
    if (!(await activeChannel(admin, channel))) {
      await updateMessage(admin, message.id, {
        processing_status: "ignored",
        ignore_reason: "channel_reconfigured",
      });
      return;
    }
    const sender = emailFromPerson(graph.from) ?? emailFromPerson(graph.sender);
    let reason = ignoredReason(channel, graph, sender);
    if (!reason && sender && (await isOtherChannelMailbox(admin, sender)))
      reason = "nextdesk_channel_mailbox";
    if (reason) {
      await updateMessage(admin, message.id, {
        processing_status: "ignored",
        ignore_reason: reason,
        internet_message_id: asString(graph.internetMessageId),
        conversation_id: asString(graph.conversationId),
        from_address: sender,
        occurred_at: asString(graph.receivedDateTime),
      });
      return;
    }
    if (!sender) {
      await updateMessage(admin, message.id, {
        processing_status: "ignored",
        ignore_reason: "sender_missing",
      });
      return;
    }
    const recentCount = await admin
      .from("mail_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", channel.tenant_id)
      .eq("direction", "inbound")
      .eq("kind", "new_ticket")
      .eq("from_address", sender)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if (!recentCount.error && (recentCount.count ?? 0) >= 20) {
      await updateMessage(admin, message.id, {
        processing_status: "ignored",
        ignore_reason: "sender_rate_limit",
      });
      return;
    }
    const linkedTicket = await findInboundTicket(admin, channel, graph);
    const replyAuthorized =
      Boolean(linkedTicket) &&
      (await senderMayReply(
        admin,
        channel.tenant_id,
        channel.id,
        linkedTicket!.id,
        sender,
      ));
    const contact = await requesterContact(admin, channel.tenant_id, sender);
    const serviceIdentityId = await ensureExchangeMailServiceIdentity(admin);
    const body = cleanText(
      record(graph.uniqueBody)
        ? graph.uniqueBody.content
        : record(graph.body)
          ? graph.body.content
          : null,
    );
    const committed = await admin.rpc("exchange_mail_commit_inbound", {
      p_tenant_id: channel.tenant_id,
      p_channel_id: channel.id,
      p_configuration_version: message.exchange_configuration_version,
      p_message_id: message.id,
      p_candidate_ticket_id: linkedTicket?.id ?? null,
      p_reply_authorized: replyAuthorized,
      p_requester_contact_id: contact.id,
      p_sender: sender,
      p_subject: subject(graph.subject),
      p_body: replyAuthorized
        ? body
        : `Eingegangene E-Mail von ${displayNameFromAddress(sender)}\n\n${body}`,
      p_internet_message_id: asString(graph.internetMessageId),
      p_conversation_id: asString(graph.conversationId),
      p_to_addresses: array(graph.toRecipients)
        .map(emailFromPerson)
        .filter((value): value is string => value !== null),
      p_cc_addresses: array(graph.ccRecipients)
        .map(emailFromPerson)
        .filter((value): value is string => value !== null),
    });
    const result = Array.isArray(committed.data) ? committed.data[0] : null;
    const ticketId = asString(result?.ticket_id);
    const ticketNumber = asString(result?.ticket_number);
    const commentId = asString(result?.comment_id);
    const kind = asString(result?.kind);
    if (committed.error || !result) throw new Error("inbound_commit_failed");
    if (result.outcome === "ignored" || result.outcome === "already_processed")
      return;
    if (
      result.outcome !== "processed" ||
      !ticketId ||
      !ticketNumber ||
      (kind !== "new_ticket" && kind !== "reply")
    )
      throw new Error("inbound_commit_invalid");
    if (graph.hasAttachments === true) {
      await createInboundAttachments(
        admin,
        channel,
        message.graph_message_id,
        ticketId,
        commentId,
        serviceIdentityId,
      ).catch(() => undefined);
    }
    await audit(
      admin,
      channel.tenant_id,
      serviceIdentityId,
      "exchange_mail.inbound.processed",
      "mail_message",
      message.id,
      {
        kind,
        hasAttachments: graph.hasAttachments === true,
      },
    );
  } catch (error) {
    await retryOrFail(admin, message, error);
  }
}

async function outboundAttachments(
  admin: Admin,
  ticketId: string,
  commentId: string | null,
): Promise<{ attachments: Row[]; omitted: boolean }> {
  if (!commentId) return { attachments: [], omitted: false };
  const rows = await admin
    .from("ticket_attachments")
    .select(
      "storage_bucket, storage_object_path, original_filename, content_type, byte_size",
    )
    .eq("ticket_id", ticketId)
    .eq("comment_id", commentId)
    .eq("malware_status", "clean")
    .order("created_at")
    .limit(10);
  if (rows.error) return { attachments: [], omitted: true };
  let total = 0;
  const attachments: Row[] = [];
  let omitted = false;
  for (const row of rows.data ?? []) {
    const size = Number(row.byte_size);
    if (
      row.storage_bucket !== BUCKET ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      total + size > MAX_OUTBOUND_ATTACHMENT_BYTES ||
      !ALLOWED_CONTENT_TYPES.has(String(row.content_type).toLowerCase())
    ) {
      omitted = true;
      continue;
    }
    const file = await admin.storage
      .from(BUCKET)
      .download(row.storage_object_path);
    if (file.error || !file.data) {
      omitted = true;
      continue;
    }
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.byteLength !== size) {
      omitted = true;
      continue;
    }
    total += size;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: String(row.original_filename),
      contentType: String(row.content_type),
      contentBytes: btoa(binary),
    });
  }
  return { attachments, omitted };
}

export async function dispatchOutboundMessage(
  admin: Admin,
  rawMessage: Message,
): Promise<void> {
  const message = rawMessage as Message;
  if (
    !Number.isSafeInteger(message.exchange_configuration_version) ||
    !message.exchange_configuration_version ||
    message.exchange_configuration_version < 1
  ) {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "channel_reconfigured",
    });
    return;
  }
  const channelResult = await admin
    .from("exchange_mail_channels")
    .select("*")
    .eq("id", message.channel_id)
    .eq("tenant_id", message.tenant_id)
    .eq("configuration_version", message.exchange_configuration_version)
    .maybeSingle();
  const channel = channelResult.data as Channel | null;
  if (channelResult.error || !channel || channel.status !== "active") {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "channel_reconfigured",
      last_error_code: "channel_inactive",
    });
    return;
  }
  if (channel.access_mode !== "delegated") {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "legacy_migration_required",
      last_error_code: "legacy_migration_required",
    });
    return;
  }
  if (!(await exchangeMailFeatureEnabled(admin, channel.tenant_id))) {
    await updateMessage(admin, message.id, {
      processing_status: "ignored",
      ignore_reason: "feature_disabled",
    });
    return;
  }
  try {
    if (!(await claimMessage(admin, message.id))) return;
    let ticket: any = null;
    let bodyText = "";
    let recipient = emailAddress(message.to_addresses?.[0]);
    let portalName = "nextDesk Portal";
    const internalDepartmentNotice =
      message.kind === "department_question" ||
      message.kind === "department_answer";
    if (internalDepartmentNotice) {
      if (!message.department_question_id || !message.recipient_user_id) {
        await updateMessage(admin, message.id, {
          processing_status: "ignored",
          ignore_reason: "recipient_not_authorized",
        });
        return;
      }
      const authorization = await admin.rpc(
        "department_question_delivery_authorized",
        {
          p_delivery_kind: message.kind,
          p_question_id: message.department_question_id,
          p_recipient_user_id: message.recipient_user_id,
          p_tenant_id: message.tenant_id,
        },
      );
      // Fehler werden absichtlich fail-closed behandelt: Ohne aktuelle
      // Berechtigungsbestätigung darf eine Warteschlangenmail keine Ticketdaten
      // preisgeben und wird auch nicht erneut versucht.
      if (authorization.error || authorization.data !== true) {
        await updateMessage(admin, message.id, {
          processing_status: "ignored",
          ignore_reason: "recipient_not_authorized",
        });
        return;
      }
      const user = await admin.auth.admin.getUserById(
        message.recipient_user_id,
      );
      recipient = emailAddress(user.data.user?.email);
      if (!recipient) {
        await updateMessage(admin, message.id, {
          processing_status: "ignored",
          ignore_reason: "recipient_email_unavailable",
        });
        return;
      }
    }
    if (message.ticket_id) {
      const ticketResult = await admin
        .from("tickets")
        .select("id, ticket_number, subject, requester_contact_id")
        .eq("id", message.ticket_id)
        .eq("tenant_id", message.tenant_id)
        .maybeSingle();
      ticket = ticketResult.data;
      if (ticketResult.error || !ticket) throw new Error("ticket_unavailable");
      const contact = await admin
        .from("ticket_requesters")
        .select("email")
        .eq("id", ticket.requester_contact_id)
        .eq("tenant_id", message.tenant_id)
        .maybeSingle();
      recipient = recipient ?? emailAddress(contact.data?.email);
      const settings = await admin
        .from("tenant_settings")
        .select("portal_name")
        .eq("tenant_id", message.tenant_id)
        .maybeSingle();
      portalName = asString(settings.data?.portal_name) ?? portalName;
      if (message.comment_id) {
        const comment = await admin
          .from("ticket_comments")
          .select("body")
          .eq("id", message.comment_id)
          .eq("ticket_id", ticket.id)
          .maybeSingle();
        bodyText = cleanText(comment.data?.body);
      }
      if (internalDepartmentNotice) {
        const question = await admin
          .from("ticket_department_questions")
          .select("question, answer")
          .eq("tenant_id", message.tenant_id)
          .eq("id", message.department_question_id)
          .eq("ticket_id", ticket.id)
          .maybeSingle();
        if (question.error || !question.data)
          throw new Error("department_question_unavailable");
        bodyText =
          message.kind === "department_question"
            ? `Eine Abteilungsrückfrage benötigt Ihre Antwort:\n\n${cleanText(question.data.question)}`
            : `Die Abteilungsleitung hat auf Ihre Rückfrage geantwortet:\n\n${cleanText(question.data.answer)}`;
      }
    }
    if (!recipient) throw new Error("recipient_unavailable");
    if (message.kind === "acknowledgement")
      bodyText =
        "Ihre Anfrage ist bei uns eingegangen und wurde als Ticket erfasst.";
    if (message.kind === "resolution")
      bodyText = "Ihr Ticket wurde als gelöst markiert.";
    if (message.kind === "test")
      bodyText = "Dies ist eine Testmail des nextDesk E-Mail-Kanals.";
    const ticketNumber = asString(ticket?.ticket_number) ?? "nextDesk-Test";
    const ticketSubject = asString(ticket?.subject) ?? "E-Mail-Kanal Test";
    const attachments =
      ticket && !internalDepartmentNotice
        ? await outboundAttachments(admin, ticket.id, message.comment_id)
        : { attachments: [], omitted: false };
    const html = htmlTemplate({
      text: bodyText,
      ticketNumber,
      subject: ticketSubject,
      portalName,
      attachmentNotice: attachments.omitted,
    });
    const graphMessage: Row = {
      subject:
        message.kind === "agent_reply"
          ? `AW: [${ticketNumber}] ${ticketSubject}`
          : `[${ticketNumber}] ${ticketSubject}`,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: recipient } }],
      internetMessageHeaders: [
        { name: "X-nextDesk-Ticket", value: ticketNumber },
        { name: "X-Auto-Response-Suppress", value: "All" },
      ],
      ...(attachments.attachments.length
        ? { attachments: attachments.attachments }
        : {}),
    };
    if (!(await activeChannel(admin, channel))) {
      await updateMessage(admin, message.id, {
        processing_status: "ignored",
        ignore_reason: "channel_reconfigured",
      });
      return;
    }
    const mailbox = graphMailboxIdentifier(
      channel.mailbox_object_id,
      channel.mailbox_address,
    );
    const previous = ticket
      ? await admin
          .from("mail_messages")
          .select("graph_message_id")
          .eq("tenant_id", message.tenant_id)
          .eq("channel_id", channel.id)
          .eq("ticket_id", ticket.id)
          .eq("direction", "inbound")
          .eq("processing_status", "processed")
          .not("graph_message_id", "is", null)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (
      message.kind === "agent_reply" &&
      asString(previous.data?.graph_message_id)
    ) {
      await graphRequestForChannel(
        admin,
        channel,
        `/users/${mailbox}/messages/${encodeURIComponent(previous.data.graph_message_id)}/reply`,
        { method: "POST", body: JSON.stringify({ message: graphMessage }) },
      );
    } else {
      await graphRequestForChannel(
        admin,
        channel,
        `/users/${mailbox}/sendMail`,
        {
          method: "POST",
          body: JSON.stringify({
            message: graphMessage,
            saveToSentItems: true,
          }),
        },
      );
    }
    await markProcessed(admin, message);
    await admin
      .from("exchange_mail_channels")
      .update({ last_outbound_at: new Date().toISOString() })
      .eq("id", channel.id);
    await audit(
      admin,
      channel.tenant_id,
      null,
      "exchange_mail.outbound.sent",
      "mail_message",
      message.id,
      {
        kind: message.kind,
        hasAttachments: attachments.attachments.length > 0,
        attachmentsOmitted: attachments.omitted,
      },
    );
  } catch (error) {
    await retryOrFail(admin, message, error);
  }
}

export async function enqueueGraphInbound(
  admin: Admin,
  channel: Pick<Channel, "id" | "tenant_id" | "configuration_version">,
  graphMessageId: string,
): Promise<void> {
  if (!graphMessageId || graphMessageId.length > 1024) return;
  await admin.rpc("exchange_mail_enqueue_inbound", {
    p_tenant_id: channel.tenant_id,
    p_channel_id: channel.id,
    p_configuration_version: channel.configuration_version,
    p_graph_message_id: graphMessageId,
  });
}

export async function maintenance(admin: Admin): Promise<void> {
  await recoverStaleProcessing(admin).catch(() => undefined);
  await admin
    .from("exchange_mail_subscriptions")
    .update({ status: "removed" })
    .eq("status", "removal_pending");
  const channelsResult = await admin
    .from("exchange_mail_channels")
    .select("*")
    .eq("status", "active")
    .eq("access_mode", "delegated")
    .limit(100);
  const channels = (channelsResult.data ?? []) as Channel[];
  for (const channel of channels) {
    if (!(await exchangeMailFeatureEnabled(admin, channel.tenant_id))) continue;
    if (!(await activeChannel(admin, channel))) continue;
    try {
      if (!(await activeChannel(admin, channel))) continue;
      const mailbox = graphMailboxIdentifier(
        channel.mailbox_object_id,
        channel.mailbox_address,
      );
      const since = new Date(
        Math.max(
          0,
          Date.parse(
            channel.poll_watermark ??
              channel.activated_at ??
              new Date().toISOString(),
          ) -
            10 * 60_000,
        ),
      ).toISOString();
      const path = `/users/${mailbox}/mailFolders/inbox/messages?$select=id,receivedDateTime&$orderby=receivedDateTime asc&$filter=receivedDateTime ge ${encodeURIComponent(since)}&$top=50`;
      const response = await graphRequestForChannel<Row>(admin, channel, path);
      let watermark = channel.poll_watermark;
      for (const entry of array(response.data.value)) {
        const graphMessageId = asString(entry.id);
        if (graphMessageId && (await activeChannel(admin, channel)))
          await enqueueGraphInbound(admin, channel, graphMessageId);
        const received = asString(entry.receivedDateTime);
        if (
          received &&
          (!watermark || Date.parse(received) > Date.parse(watermark))
        )
          watermark = received;
      }
      if (watermark)
        await matchChannelTarget(
          admin
            .from("exchange_mail_channels")
            .update({
              poll_watermark: watermark,
              last_error_code: null,
              last_error_message: null,
            })
            .eq("status", "active"),
          channel,
        );
    } catch (error) {
      await matchChannelTarget(
        admin
          .from("exchange_mail_channels")
          .update({
            last_error_code: errorCode(error),
            last_error_message:
              "Postfachabfrage oder Abo-Erneuerung fehlgeschlagen.",
          })
          .eq("status", "active"),
        channel,
      );
    }
  }
  const due = await admin
    .from("mail_messages")
    .select(
      "id, tenant_id, channel_id, exchange_configuration_version, direction, kind, graph_message_id, ticket_id, comment_id, department_question_id, recipient_user_id, to_addresses, attempt_count",
    )
    .in("processing_status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("attempt_count", 6)
    .order("created_at")
    .limit(50);
  for (const message of (due.data ?? []) as Message[]) {
    if (message.direction === "inbound")
      await processInboundMessage(admin, message);
    else await dispatchOutboundMessage(admin, message);
  }
}

export async function removeSubscriptionsForChannel(
  admin: Admin,
  channel: Channel,
): Promise<void> {
  const removed = await admin
    .from("exchange_mail_subscriptions")
    .update({ status: "removed" })
    .eq("channel_id", channel.id)
    .eq("tenant_id", channel.tenant_id)
    .in("status", ["active", "removal_pending"]);
  if (removed.error) throw new Error("subscription_cleanup_failed");
}
