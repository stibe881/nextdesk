import { withSupabase } from "@supabase/server";
import { processEventSpaceEmailTicketIntake } from "../_shared/event-space-email-ticket-intake.ts";

/**
 * Deployment requirements (kept here because this task must not change config.toml):
 *
 * - Set `[functions.email-ingress] verify_jwt = false`. Authentication for this
 *   provider-to-provider endpoint is the dedicated secret check below, not a user JWT.
 * - REQUIRED EXTERNAL SECRET: `EMAIL_INGRESS_SECRET`. Configure a high-entropy value
 *   as a Supabase Edge Function secret and configure the same value at the mail provider.
 *   Never put it in source control, a URL, or logs.
 * - REQUIRED RUNTIME SECRETS: the standard Supabase server credentials consumed by
 *   `@supabase/server` to construct `context.supabaseAdmin` (for example
 *   `SUPABASE_URL` and `SUPABASE_SECRET_KEY`) must be available only to the Edge Runtime.
 * - REQUIRED NON-SECRET CONFIGURATION: `EMAIL_INGRESS_SERVICE_USER_ID` must identify a
 *   dedicated global service account. It must have a user profile and no tenant membership.
 *   This function deliberately never maps a sender address to a user account.
 */

const MAX_REQUEST_BYTES = 262_144;
const MAX_EMAIL_TEXT_LENGTH = 48_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MESSAGE_ID_PATTERN = /^<[^<>\r\n]{1,512}>$/;
const TICKET_NUMBER_PATTERN =
  /(?:^|[^a-z0-9_-])([a-z0-9_-]{2,8}-\d{4}-\d{6})(?=$|[^a-z0-9_-])/gi;
const encoder = new TextEncoder();

type EmailIngressPayload = {
  tenantSlug: string;
  from: string;
  fromDomain: string;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
};

type TicketLink = {
  id: string;
  ticket_number: string;
};

type TicketLookup = {
  ticket: TicketLink | null;
  ambiguous: boolean;
  failed: boolean;
};

type AuditInput = {
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string;
  severity: "info" | "security";
  metadata: Record<string, unknown>;
};

function json(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

function normalizeMessageId(value: unknown): string | null | false {
  if (value === undefined) return null;
  if (typeof value !== "string") return false;
  const messageId = value.trim();
  return MESSAGE_ID_PATTERN.test(messageId) ? messageId : false;
}

function parseSender(
  value: unknown,
): { address: string; domain: string } | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (address.length < 3 || address.length > 320 || /[\r\n]/.test(address))
    return null;

  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1 || address.indexOf("@") !== at)
    return null;
  const localPart = address.slice(0, at);
  const domain = normalizeDomain(address.slice(at + 1));
  if (!localPart || /[\s@]/.test(localPart) || !domain) return null;

  return { address: `${localPart}@${domain}`, domain };
}

function parsePayload(value: unknown): EmailIngressPayload | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "tenantSlug",
      "from",
      "subject",
      "text",
      "messageId",
      "inReplyTo",
    ]) ||
    typeof value.tenantSlug !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.text !== "string"
  ) {
    return null;
  }

  const tenantSlug = value.tenantSlug.trim().toLowerCase();
  const subject = value.subject.trim();
  const text = value.text.trim();
  const sender = parseSender(value.from);
  const messageId = normalizeMessageId(value.messageId);
  const inReplyTo = normalizeMessageId(value.inReplyTo);

  if (
    !TENANT_SLUG_PATTERN.test(tenantSlug) ||
    !sender ||
    subject.length < 3 ||
    subject.length > 240 ||
    text.length < 1 ||
    text.length > MAX_EMAIL_TEXT_LENGTH ||
    messageId === false ||
    inReplyTo === false
  ) {
    return null;
  }

  return {
    tenantSlug,
    from: sender.address,
    fromDomain: sender.domain,
    subject,
    text,
    messageId,
    inReplyTo,
  };
}

/**
 * Hash both values before the fixed-size byte comparison. This avoids an early
 * length or character mismatch exit while retaining an explicit timing-safe compare.
 */
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

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * A sender address is contact data, not a display name. Derive a bounded,
 * plain-text label from its local part instead of ever copying the address into
 * a value that could later be rendered to an operator.
 */
function requesterDisplayName(address: string): string {
  const localPart = address.slice(0, address.lastIndexOf("@"));
  const label = localPart
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return label || "E-Mail-Kontakt";
}

function emailAuditMetadata(
  senderFingerprint: string,
  requesterContactId?: string,
): Record<string, string> {
  return requesterContactId
    ? { senderFingerprint, requesterContactId }
    : { senderFingerprint };
}

function extractTicketNumbers(subject: string): string[] {
  const matches = new Set<string>();
  for (const match of subject.matchAll(TICKET_NUMBER_PATTERN)) {
    if (match[1]) matches.add(match[1].toUpperCase());
  }
  return [...matches];
}

function inboundBody(payload: EmailIngressPayload): string {
  return `Eingegangene E-Mail von ${payload.from}\n\n${payload.text}`;
}

function inboundNewTicketBody(payload: EmailIngressPayload): string {
  return `Eingegangene E-Mail von ${requesterDisplayName(payload.from)}\n\n${payload.text}`;
}

function emailEventPayload(
  payload: EmailIngressPayload,
  senderFingerprint: string,
): Record<string, unknown> {
  return {
    source: "email",
    messageId: payload.messageId,
    inReplyTo: payload.inReplyTo,
    senderDomain: payload.fromDomain,
    senderFingerprint,
    bodyLength: payload.text.length,
  };
}

async function findTicketByNumber(
  admin: any,
  tenantId: string,
  ticketNumber: string,
): Promise<TicketLookup> {
  const { data, error } = await admin
    .from("tickets")
    .select("id, ticket_number")
    .eq("tenant_id", tenantId)
    .eq("ticket_number", ticketNumber)
    .maybeSingle();
  return { ticket: data ?? null, ambiguous: false, failed: Boolean(error) };
}

/**
 * Message IDs are stored only in our own `email.received` events. This avoids
 * trusting a provider's opaque In-Reply-To value unless it refers to an email
 * previously accepted for the same tenant.
 */
async function findTicketByMessageId(
  admin: any,
  tenantId: string,
  messageId: string,
): Promise<TicketLookup> {
  const { data: events, error: eventsError } = await admin
    .from("ticket_events")
    .select("ticket_id")
    .eq("event_type", "email.received")
    .contains("payload", { messageId })
    .limit(3);
  if (eventsError) return { ticket: null, ambiguous: false, failed: true };

  const ticketIds = [
    ...new Set(
      (events ?? [])
        .map((event: { ticket_id?: unknown }) => event.ticket_id)
        .filter(
          (ticketId: unknown): ticketId is string =>
            typeof ticketId === "string",
        ),
    ),
  ];
  if (ticketIds.length === 0)
    return { ticket: null, ambiguous: false, failed: false };

  const { data: tickets, error: ticketsError } = await admin
    .from("tickets")
    .select("id, ticket_number")
    .eq("tenant_id", tenantId)
    .in("id", ticketIds)
    .limit(2);
  if (ticketsError) return { ticket: null, ambiguous: false, failed: true };
  if ((tickets ?? []).length > 1)
    return { ticket: null, ambiguous: true, failed: false };

  return {
    ticket: (tickets?.[0] as TicketLink | undefined) ?? null,
    ambiguous: false,
    failed: false,
  };
}

async function insertAudit(admin: any, input: AuditInput): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    request_id: input.requestId,
    severity: input.severity,
    metadata: input.metadata,
  });
  return !error;
}

async function insertEmailReceivedEvent(
  admin: any,
  ticketId: string,
  serviceIdentityId: string,
  payload: EmailIngressPayload,
  senderFingerprint: string,
): Promise<boolean> {
  const { error } = await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: "email.received",
    payload: emailEventPayload(payload, senderFingerprint),
  });
  return !error;
}

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    const requestId = crypto.randomUUID();
    const expectedSecret = Deno.env.get("EMAIL_INGRESS_SECRET");

    // Do not start the endpoint in a fail-open state when its external secret is absent.
    if (!expectedSecret)
      return json(
        { error: { code: "email_ingress_unavailable" } },
        503,
        requestId,
      );

    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "X-Request-Id": requestId },
      });
    }

    const suppliedSecret = request.headers.get("X-NextDesk-Email-Secret") ?? "";
    if (!(await timingSafeSecretEqual(expectedSecret, suppliedSecret))) {
      return json(
        { error: { code: "email_ingress_unauthorized" } },
        401,
        requestId,
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json({ error: { code: "payload_too_large" } }, 413, requestId);
    }

    const payload = parsePayload(await request.json().catch(() => null));
    if (!payload)
      return json({ error: { code: "invalid_payload" } }, 422, requestId);

    const { data: tenant, error: tenantError } = await context.supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", payload.tenantSlug)
      .eq("status", "active")
      .maybeSingle();
    if (tenantError)
      return json({ error: { code: "tenant_lookup_failed" } }, 500, requestId);
    if (!tenant)
      return json({ error: { code: "tenant_not_found" } }, 404, requestId);

    const serviceIdentityId = Deno.env.get("EMAIL_INGRESS_SERVICE_USER_ID");
    if (!isUuid(serviceIdentityId)) {
      return json(
        { error: { code: "service_identity_unavailable" } },
        422,
        requestId,
      );
    }

    const [
      { data: emailDomainPolicy, error: emailDomainPolicyError },
      { data: emailFeature, error: emailFeatureError },
      { data: tenantSettings, error: tenantSettingsError },
      { data: serviceProfile, error: serviceProfileError },
      { data: serviceMembership, error: serviceMembershipError },
    ] = await Promise.all([
      // This is the only existing explicit allowed-email-domain allowlist.
      // Do not infer authorization from tenant slug, support email, or tenant_domains.
      context.supabaseAdmin
        .from("tenant_sso_configurations")
        .select("allowed_email_domains")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      context.supabaseAdmin
        .from("tenant_feature_flags")
        .select("enabled")
        .eq("tenant_id", tenant.id)
        .eq("feature_key", "integrations.email")
        .maybeSingle(),
      context.supabaseAdmin
        .from("tenant_settings")
        .select("ticket_access_enabled")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      context.supabaseAdmin
        .from("user_profiles")
        .select("id")
        .eq("id", serviceIdentityId)
        .maybeSingle(),
      // A global system identity must never double as a tenant user/requester.
      context.supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("user_id", serviceIdentityId)
        .limit(1)
        .maybeSingle(),
    ]);

    if (
      emailDomainPolicyError ||
      emailFeatureError ||
      tenantSettingsError ||
      serviceProfileError ||
      serviceMembershipError
    ) {
      return json(
        { error: { code: "email_ingress_configuration_lookup_failed" } },
        500,
        requestId,
      );
    }

    if (!serviceProfile || serviceMembership) {
      return json(
        { error: { code: "service_identity_unavailable" } },
        422,
        requestId,
      );
    }

    if (
      tenantSettings?.ticket_access_enabled !== true ||
      emailFeature?.enabled !== true
    ) {
      return json(
        { error: { code: "email_ingress_disabled" } },
        403,
        requestId,
      );
    }

    const senderFingerprint = await sha256Hex(payload.from);
    const allowedDomains = Array.isArray(
      emailDomainPolicy?.allowed_email_domains,
    )
      ? emailDomainPolicy.allowed_email_domains
          .map((domain: unknown) =>
            typeof domain === "string" ? normalizeDomain(domain) : null,
          )
          .filter((domain: string | null): domain is string => domain !== null)
      : [];
    if (!allowedDomains.includes(payload.fromDomain)) {
      await insertAudit(context.supabaseAdmin, {
        tenantId: tenant.id,
        actorId: null,
        action: "email_ingress.rejected",
        entityType: "email_ingress",
        entityId: null,
        requestId,
        severity: "security",
        // A security audit must never contain a raw sender address.
        metadata: emailAuditMetadata(senderFingerprint),
      });
      return json(
        { error: { code: "sender_domain_not_allowed" } },
        403,
        requestId,
      );
    }

    // Idempotently acknowledge provider retries only after tenant/domain checks.
    if (payload.messageId) {
      const duplicateLookup = await findTicketByMessageId(
        context.supabaseAdmin,
        tenant.id,
        payload.messageId,
      );
      if (duplicateLookup.failed)
        return json(
          { error: { code: "email_deduplication_failed" } },
          500,
          requestId,
        );
      if (duplicateLookup.ambiguous)
        return json(
          { error: { code: "email_message_id_ambiguous" } },
          422,
          requestId,
        );
      if (duplicateLookup.ticket) {
        return json(
          { data: { accepted: true, duplicate: true } },
          200,
          requestId,
        );
      }
    }

    const ticketNumbers = extractTicketNumbers(payload.subject);
    if (ticketNumbers.length > 1) {
      return json(
        { error: { code: "ambiguous_ticket_reference" } },
        422,
        requestId,
      );
    }

    const byNumber = ticketNumbers[0]
      ? await findTicketByNumber(
          context.supabaseAdmin,
          tenant.id,
          ticketNumbers[0],
        )
      : null;
    const byReplyReference = payload.inReplyTo
      ? await findTicketByMessageId(
          context.supabaseAdmin,
          tenant.id,
          payload.inReplyTo,
        )
      : null;
    if (byNumber?.failed || byReplyReference?.failed) {
      return json({ error: { code: "ticket_lookup_failed" } }, 500, requestId);
    }
    if (byReplyReference?.ambiguous) {
      return json(
        { error: { code: "ambiguous_reply_reference" } },
        422,
        requestId,
      );
    }
    if (
      (ticketNumbers[0] && !byNumber?.ticket) ||
      (payload.inReplyTo && !byReplyReference?.ticket)
    ) {
      // A claimed reply must never silently become a new ticket when threading fails.
      return json(
        { error: { code: "reply_ticket_not_found" } },
        422,
        requestId,
      );
    }
    if (
      byNumber?.ticket &&
      byReplyReference?.ticket &&
      byNumber.ticket.id !== byReplyReference.ticket.id
    ) {
      return json(
        { error: { code: "conflicting_reply_references" } },
        422,
        requestId,
      );
    }

    const linkedTicket = byNumber?.ticket ?? byReplyReference?.ticket;
    const eventMetadata = emailEventPayload(payload, senderFingerprint);

    if (linkedTicket) {
      const { data: comment, error: commentError } = await context.supabaseAdmin
        .from("ticket_comments")
        .insert({
          ticket_id: linkedTicket.id,
          author_id: serviceIdentityId,
          visibility: "external",
          body: inboundBody(payload),
        })
        .select("id")
        .single();
      if (commentError || !comment) {
        return json(
          { error: { code: "email_comment_create_failed" } },
          422,
          requestId,
        );
      }

      const { error: commentEventError } = await context.supabaseAdmin
        .from("ticket_events")
        .insert({
          ticket_id: linkedTicket.id,
          actor_id: serviceIdentityId,
          event_type: "comment.external_added",
          payload: { ...eventMetadata, commentId: comment.id },
        });
      const receivedEventCreated = await insertEmailReceivedEvent(
        context.supabaseAdmin,
        linkedTicket.id,
        serviceIdentityId,
        payload,
        senderFingerprint,
      );
      const auditWritten = await insertAudit(context.supabaseAdmin, {
        tenantId: tenant.id,
        actorId: serviceIdentityId,
        action: "ticket.email_ingress.comment_added",
        entityType: "ticket_comment",
        entityId: comment.id,
        requestId,
        severity: "info",
        metadata: { ...eventMetadata, ticketId: linkedTicket.id },
      });
      if (commentEventError || !receivedEventCreated || !auditWritten) {
        return json(
          { error: { code: "email_ingress_audit_failed" } },
          500,
          requestId,
        );
      }

      return json(
        { data: { accepted: true, action: "comment_added" } },
        201,
        requestId,
      );
    }

    const [
      { data: departments, error: departmentsError },
      { data: status, error: statusError },
      { data: priority, error: priorityError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("departments")
        .select("id, key")
        .eq("tenant_id", tenant.id)
        .eq("active", true)
        .order("key")
        .limit(2),
      context.supabaseAdmin
        .from("ticket_statuses")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("key", "new")
        .maybeSingle(),
      context.supabaseAdmin
        .from("ticket_priorities")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("key", "normal")
        .maybeSingle(),
    ]);
    if (departmentsError || statusError || priorityError) {
      return json(
        { error: { code: "ticket_reference_lookup_failed" } },
        500,
        requestId,
      );
    }

    /**
     * The current schema has no `default_department_id`. One active department
     * is the only unambiguous default. For multi-department tenants, fail closed
     * until a later migration adds an explicit email-ingress default department.
     */
    if ((departments ?? []).length !== 1 || !status || !priority) {
      return json(
        { error: { code: "email_ticket_defaults_unavailable" } },
        422,
        requestId,
      );
    }
    const department = departments[0] as { id: string; key: string };

    const { data: requesterContact, error: requesterContactError } =
      await context.supabaseAdmin
        .from("ticket_requesters")
        .upsert(
          {
            tenant_id: tenant.id,
            email: payload.from,
            display_name: requesterDisplayName(payload.from),
            source: "email",
          },
          { onConflict: "tenant_id,email" },
        )
        .select("id")
        .single();
    if (
      requesterContactError ||
      !requesterContact ||
      !isUuid(requesterContact.id)
    ) {
      return json(
        { error: { code: "email_requester_upsert_failed" } },
        500,
        requestId,
      );
    }

    const { data: ticketNumber, error: ticketNumberError } =
      await context.supabaseAdmin.rpc("reserve_ticket_number", {
        p_tenant_id: tenant.id,
        p_department_id: department.id,
        p_prefix: department.key.slice(0, 8),
      });
    if (ticketNumberError || typeof ticketNumber !== "string") {
      return json({ error: { code: "ticket_number_failed" } }, 500, requestId);
    }

    const { data: ticket, error: ticketError } = await context.supabaseAdmin
      .from("tickets")
      .insert({
        tenant_id: tenant.id,
        department_id: department.id,
        ticket_number: ticketNumber,
        subject: payload.subject,
        description: inboundNewTicketBody(payload),
        status_id: status.id,
        priority_id: priority.id,
        requester_id: serviceIdentityId,
        requester_contact_id: requesterContact.id,
        source: "email",
      })
      .select("id, ticket_number")
      .single();
    if (ticketError || !ticket) {
      return json(
        { error: { code: "email_ticket_create_failed" } },
        422,
        requestId,
      );
    }

    const { error: ticketCreatedEventError } = await context.supabaseAdmin
      .from("ticket_events")
      .insert({
        ticket_id: ticket.id,
        actor_id: serviceIdentityId,
        event_type: "ticket.created",
        payload: eventMetadata,
      });
    const receivedEventCreated = await insertEmailReceivedEvent(
      context.supabaseAdmin,
      ticket.id,
      serviceIdentityId,
      payload,
      senderFingerprint,
    );
    const auditWritten = await insertAudit(context.supabaseAdmin, {
      tenantId: tenant.id,
      actorId: serviceIdentityId,
      action: "ticket.email_ingress.created",
      entityType: "ticket",
      entityId: ticket.id,
      requestId,
      severity: "info",
      metadata: {
        ...emailAuditMetadata(senderFingerprint, requesterContact.id),
        ticketNumber: ticket.ticket_number,
      },
    });
    if (ticketCreatedEventError || !receivedEventCreated || !auditWritten) {
      return json(
        { error: { code: "email_ingress_audit_failed" } },
        500,
        requestId,
      );
    }

    await processEventSpaceEmailTicketIntake(context.supabaseAdmin, {
      tenantId: tenant.id,
      ticketId: ticket.id,
      subject: payload.subject,
      description: payload.text,
    });

    return json(
      {
        data: {
          accepted: true,
          action: "ticket_created",
          ticketNumber: ticket.ticket_number,
        },
      },
      201,
      requestId,
    );
  },
);

export default { fetch: handler };
