import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import {
  hasTicketCommentImageSignature,
  TICKET_COMMENT_IMAGE_CONTENT_TYPES,
} from "../_shared/ticket-comment-image.ts";

type AttachmentVisibility = "internal" | "external";

type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "createUpload";
      tenantId: string;
      ticketId: string;
      filename: string;
      contentType: string;
      byteSize: number;
      visibility?: AttachmentVisibility;
    }
  | {
      type: "completeUpload";
      tenantId: string;
      ticketId: string;
      storageObjectPath: string;
      originalFilename: string;
      contentType: string;
      byteSize: number;
      visibility?: AttachmentVisibility;
    }
  | {
      type: "createDownloadUrl";
      tenantId: string;
      ticketId: string;
      attachmentId: string;
    }
  | {
      type: "createInlineImageUrls";
      tenantId: string;
      ticketId: string;
      attachmentIds: string[];
    }
  | {
      type: "delete";
      tenantId: string;
      ticketId: string;
      attachmentId: string;
    };

type Ticket = {
  id: string;
  tenant_id: string;
  department_id: string;
  requester_id: string | null;
};

type Attachment = {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  visibility: AttachmentVisibility;
  storage_bucket: string;
  storage_object_path: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  uploaded_by: string;
  created_at: string;
};

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const BUCKET = "ticket-attachments";
const MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_FILENAME_LENGTH = 255;
const MAX_INLINE_IMAGE_URLS = 16;
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
const ATTACHMENT_SELECT =
  "id, ticket_id, comment_id, visibility, storage_bucket, storage_object_path, original_filename, content_type, byte_size, uploaded_by, created_at";

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const header of [...headers.keys()]) {
    if (header.toLowerCase().startsWith("access-control-"))
      headers.delete(header);
  }
  const allowedHeaders = corsHeaders(request);
  allowedHeaders.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", crypto.randomUUID());
  return new Response(JSON.stringify(body), { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function canonicalUuid(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function parseFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const filename = value.trim();
  if (
    filename.length < 1 ||
    filename.length > MAX_FILENAME_LENGTH ||
    filename === "." ||
    filename === ".." ||
    /[\u0000-\u001f\u007f/\\]/.test(filename)
  )
    return null;
  return filename;
}

function parseContentType(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const contentType = value.toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : null;
}

function parseAttachmentVisibility(
  value: unknown,
): AttachmentVisibility | null {
  return value === "internal" || value === "external" ? value : null;
}

function parseByteSize(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_BYTES
    ? value
    : null;
}

function parseAttachmentIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_INLINE_IMAGE_URLS
  ) {
    return null;
  }
  const attachmentIds = value.map(canonicalUuid);
  return attachmentIds.every((attachmentId): attachmentId is string =>
    Boolean(attachmentId),
  ) && new Set(attachmentIds).size === attachmentIds.length
    ? attachmentIds
    : null;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const tenantId = canonicalUuid(value.tenantId);
  const ticketId = canonicalUuid(value.ticketId);
  if (!tenantId || !ticketId) return null;

  if (
    value.type === "list" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"])
  )
    return { type: value.type, tenantId, ticketId };

  if (
    value.type === "createUpload" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "filename",
      "contentType",
      "byteSize",
      "visibility",
    ])
  ) {
    const filename = parseFilename(value.filename);
    const contentType = parseContentType(value.contentType);
    const byteSize = parseByteSize(value.byteSize);
    const visibility =
      value.visibility === undefined
        ? undefined
        : parseAttachmentVisibility(value.visibility);
    if (
      !filename ||
      !contentType ||
      byteSize === null ||
      (value.visibility !== undefined && !visibility)
    )
      return null;
    return {
      type: value.type,
      tenantId,
      ticketId,
      filename,
      contentType,
      byteSize,
      ...(visibility ? { visibility } : {}),
    };
  }

  if (
    value.type === "completeUpload" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "storageObjectPath",
      "originalFilename",
      "contentType",
      "byteSize",
      "visibility",
    ])
  ) {
    const originalFilename = parseFilename(value.originalFilename);
    const contentType = parseContentType(value.contentType);
    const byteSize = parseByteSize(value.byteSize);
    const visibility =
      value.visibility === undefined
        ? undefined
        : parseAttachmentVisibility(value.visibility);
    if (
      typeof value.storageObjectPath !== "string" ||
      !originalFilename ||
      !contentType ||
      byteSize === null ||
      (value.visibility !== undefined && !visibility)
    )
      return null;
    return {
      type: value.type,
      tenantId,
      ticketId,
      storageObjectPath: value.storageObjectPath,
      originalFilename,
      contentType,
      byteSize,
      ...(visibility ? { visibility } : {}),
    };
  }

  if (
    (value.type === "createDownloadUrl" || value.type === "delete") &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "attachmentId"])
  ) {
    const attachmentId = canonicalUuid(value.attachmentId);
    if (!attachmentId) return null;
    return { type: value.type, tenantId, ticketId, attachmentId };
  }

  if (
    value.type === "createInlineImageUrls" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "attachmentIds"])
  ) {
    const attachmentIds = parseAttachmentIds(value.attachmentIds);
    return attachmentIds
      ? { type: value.type, tenantId, ticketId, attachmentIds }
      : null;
  }

  return null;
}

function isTicketStoragePath(
  storageObjectPath: string,
  tenantId: string,
  ticketId: string,
): boolean {
  const prefix = `${tenantId}/${ticketId}/`;
  if (!storageObjectPath.startsWith(prefix)) return false;
  const objectId = storageObjectPath.slice(prefix.length);
  return objectId === objectId.toLowerCase() && isUuid(objectId);
}

async function resolveReadableTicket(
  admin: any,
  userClient: any,
  tenantId: string,
  ticketId: string,
): Promise<{
  ticket: Ticket | null;
  failure: "not_found" | "denied" | "error" | null;
}> {
  const { data: ticket, error: ticketError } = await admin
    .from("tickets")
    .select("id, tenant_id, department_id, requester_id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (ticketError) return { ticket: null, failure: "error" };
  if (!ticket) return { ticket: null, failure: "not_found" };

  // This deliberately uses the caller-scoped client. It keeps requester,
  // affected-user, customer, assigned-agent, and department access governed by
  // the existing ticket RLS policy rather than the service role.
  const { data: visibleTicket, error: visibilityError } = await userClient
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (visibilityError) return { ticket: null, failure: "error" };
  if (!visibleTicket) return { ticket: null, failure: "denied" };

  return { ticket: ticket as Ticket, failure: null };
}

async function canUpdateTicket(
  userClient: any,
  ticket: Ticket,
): Promise<boolean | null> {
  const { data, error } = await userClient.rpc("has_ticket_permission", {
    p_tenant_id: ticket.tenant_id,
    p_department_id: ticket.department_id,
    p_permission_code: "ticket.update",
  });
  if (error) return null;
  return data === true;
}

async function canReadInternalTicketAttachment(
  userClient: any,
  ticketId: string,
): Promise<boolean | null> {
  const { data, error } = await userClient.rpc("can_read_internal_note", {
    p_ticket_id: ticketId,
  });
  if (error) return null;
  return data === true;
}

async function canWriteInternalTicketAttachment(
  userClient: any,
  ticket: Ticket,
): Promise<boolean | null> {
  const { data, error } = await userClient.rpc("has_ticket_permission", {
    p_department_id: ticket.department_id,
    p_permission_code: "ticket.internal_notes.write",
    p_tenant_id: ticket.tenant_id,
  });
  if (error) return null;
  return data === true;
}

async function canWriteExternalTicketAttachment(
  userClient: any,
  actorId: string,
  ticket: Ticket,
): Promise<boolean | null> {
  const directCommentPermission = await userClient.rpc(
    "has_ticket_permission",
    {
      p_department_id: ticket.department_id,
      p_permission_code: "ticket.comment.external",
      p_tenant_id: ticket.tenant_id,
    },
  );
  if (directCommentPermission.error) return null;
  if (directCommentPermission.data === true) return true;
  if (ticket.requester_id !== actorId) return false;

  const [canReadOwnTicket, canCommentOnOwnTicket] = await Promise.all([
    userClient.rpc("has_tenant_permission", {
      p_permission_code: "ticket.read.own",
      p_tenant_id: ticket.tenant_id,
    }),
    userClient.rpc("has_tenant_permission", {
      p_permission_code: "ticket.comment.external.own",
      p_tenant_id: ticket.tenant_id,
    }),
  ]);
  if (canReadOwnTicket.error || canCommentOnOwnTicket.error) return null;
  return canReadOwnTicket.data === true && canCommentOnOwnTicket.data === true;
}

async function canWriteCommentAttachment(
  userClient: any,
  actorId: string,
  ticket: Ticket,
  visibility: AttachmentVisibility,
): Promise<boolean | null> {
  return visibility === "internal"
    ? canWriteInternalTicketAttachment(userClient, ticket)
    : canWriteExternalTicketAttachment(userClient, actorId, ticket);
}

async function getStoredObject(
  admin: any,
  tenantId: string,
  ticketId: string,
  storageObjectPath: string,
): Promise<{ object: Record<string, unknown> | null; error: boolean }> {
  if (!isTicketStoragePath(storageObjectPath, tenantId, ticketId))
    return { object: null, error: false };
  const prefix = `${tenantId}/${ticketId}`;
  const objectName = storageObjectPath.slice(prefix.length + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, {
    limit: 10,
    offset: 0,
    search: objectName,
  });
  if (error) return { object: null, error: true };
  const object = (data ?? []).find((entry: any) => entry?.name === objectName);
  return { object: isRecord(object) ? object : null, error: false };
}

function objectMetadataMatches(
  object: Record<string, unknown>,
  contentType: string,
  byteSize: number,
): boolean {
  const metadata = isRecord(object.metadata) ? object.metadata : null;
  if (!metadata) return false;
  const storedSize = metadata.size;
  const actualSize =
    typeof storedSize === "number"
      ? storedSize
      : typeof storedSize === "string" && /^\d+$/.test(storedSize)
        ? Number(storedSize)
        : NaN;
  const actualContentType = metadata.mimetype;
  return (
    Number.isSafeInteger(actualSize) &&
    actualSize === byteSize &&
    typeof actualContentType === "string" &&
    actualContentType.toLowerCase() === contentType
  );
}

async function hasValidCommentImageSignature(
  admin: any,
  storageObjectPath: string,
  contentType: string,
  byteSize: number,
): Promise<boolean | null> {
  if (!TICKET_COMMENT_IMAGE_CONTENT_TYPES.has(contentType)) return false;
  const { data, error } = await admin.storage
    .from(BUCKET)
    .download(storageObjectPath);
  if (error || !data) return null;
  if (data.size !== byteSize) return false;
  const bytes = new Uint8Array(await data.slice(0, 16).arrayBuffer());
  return hasTicketCommentImageSignature(contentType, bytes);
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  attachmentId: string,
  ticketId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
) {
  return await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "ticket_attachment",
    entity_id: attachmentId,
    severity: "info",
    before_data: beforeData,
    after_data: afterData,
    metadata: { ticketId },
  });
}

function attachmentAuditData(attachment: Attachment): Record<string, unknown> {
  return {
    ticketId: attachment.ticket_id,
    commentId: attachment.comment_id,
    visibility: attachment.visibility,
    originalFilename: attachment.original_filename,
    contentType: attachment.content_type,
    byteSize: Number(attachment.byte_size),
  };
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST")
      return json(request, { error: { code: "method_not_allowed" } }, 405);

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > MAX_REQUEST_BYTES)
    )
      return json(request, { error: { code: "payload_too_large" } }, 413);

    const action = parseAction(await request.json().catch(() => null));
    const actorId = canonicalUuid(context.userClaims?.id);
    if (!action || !actorId)
      return json(request, { error: { code: "invalid_request" } }, 422);

    const admin = context.supabaseAdmin;
    const access = await resolveReadableTicket(
      admin,
      context.supabase,
      action.tenantId,
      action.ticketId,
    );
    if (access.failure === "error")
      return json(
        request,
        { error: { code: "ticket_access_check_failed" } },
        500,
      );
    if (access.failure === "not_found")
      return json(request, { error: { code: "ticket_not_found" } }, 404);
    if (access.failure === "denied" || !access.ticket)
      return json(
        request,
        { error: { code: "ticket_not_found_or_access_denied" } },
        404,
      );
    const ticket = access.ticket;
    const featureStates = await resolveTenantFeatureStates(
      admin,
      ticket.tenant_id,
      ["ticketing.detail"],
    );
    if (!featureStates)
      return json(
        request,
        { error: { code: "tenant_feature_lookup_failed" } },
        503,
      );
    if (featureStates["ticketing.detail"] !== true)
      return json(request, { error: { code: "ticket_feature_disabled" } }, 403);

    if (action.type === "list") {
      const canReadInternal = await canReadInternalTicketAttachment(
        context.supabase,
        ticket.id,
      );
      if (canReadInternal === null)
        return json(
          request,
          { error: { code: "internal_attachment_access_check_failed" } },
          500,
        );
      let attachmentQuery = admin
        .from("ticket_attachments")
        .select(
          "id, ticket_id, comment_id, visibility, original_filename, content_type, byte_size, malware_status, uploaded_by, created_at",
        )
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false });
      if (!canReadInternal) {
        attachmentQuery = attachmentQuery.eq("visibility", "external");
      }
      const { data: attachments, error } = await attachmentQuery;
      if (error)
        return json(
          request,
          { error: { code: "attachment_list_failed" } },
          500,
        );
      return json(request, { data: { attachments: attachments ?? [] } });
    }

    if (action.type === "createInlineImageUrls") {
      const canReadInternal = await canReadInternalTicketAttachment(
        context.supabase,
        ticket.id,
      );
      if (canReadInternal === null)
        return json(
          request,
          { error: { code: "internal_attachment_access_check_failed" } },
          500,
        );
      let attachmentQuery = admin
        .from("ticket_attachments")
        .select(
          "id, ticket_id, comment_id, visibility, storage_bucket, storage_object_path, original_filename, content_type, byte_size, uploaded_by, created_at, inline_content_id",
        )
        .eq("ticket_id", ticket.id)
        .in("id", action.attachmentIds)
        .eq("malware_status", "clean")
        .not("inline_content_id", "is", null);
      if (!canReadInternal) {
        attachmentQuery = attachmentQuery.eq("visibility", "external");
      }
      const { data: attachments, error: attachmentError } =
        await attachmentQuery;
      if (attachmentError)
        return json(
          request,
          { error: { code: "inline_attachment_lookup_failed" } },
          500,
        );

      const inlineImages: Array<{
        attachmentId: string;
        originalFilename: string;
        signedUrl: string;
      }> = [];
      for (const attachment of attachments ?? []) {
        const typedAttachment = attachment as Attachment & {
          inline_content_id?: string | null;
        };
        if (
          typedAttachment.inline_content_id === null ||
          typedAttachment.inline_content_id === undefined ||
          !["image/png", "image/jpeg", "image/webp"].includes(
            typedAttachment.content_type,
          ) ||
          typedAttachment.storage_bucket !== BUCKET ||
          !isTicketStoragePath(
            typedAttachment.storage_object_path,
            ticket.tenant_id,
            ticket.id,
          )
        ) {
          continue;
        }
        const { data: signed, error: signedError } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(
            typedAttachment.storage_object_path,
            DOWNLOAD_URL_TTL_SECONDS,
          );
        if (signedError || !signed?.signedUrl) continue;
        inlineImages.push({
          attachmentId: typedAttachment.id,
          originalFilename: typedAttachment.original_filename,
          signedUrl: signed.signedUrl,
        });
      }
      return json(request, {
        data: { expiresIn: DOWNLOAD_URL_TTL_SECONDS, inlineImages },
      });
    }

    if (action.type === "createDownloadUrl") {
      const canReadInternal = await canReadInternalTicketAttachment(
        context.supabase,
        ticket.id,
      );
      if (canReadInternal === null)
        return json(
          request,
          { error: { code: "internal_attachment_access_check_failed" } },
          500,
        );
      const { data: attachment, error: attachmentError } = await admin
        .from("ticket_attachments")
        .select(ATTACHMENT_SELECT)
        .eq("id", action.attachmentId)
        .eq("ticket_id", ticket.id)
        .maybeSingle();
      if (attachmentError)
        return json(
          request,
          { error: { code: "attachment_lookup_failed" } },
          500,
        );
      if (!attachment)
        return json(request, { error: { code: "attachment_not_found" } }, 404);
      const typedAttachment = attachment as Attachment;
      if (typedAttachment.visibility === "internal" && !canReadInternal)
        return json(request, { error: { code: "attachment_not_found" } }, 404);
      if (
        typedAttachment.storage_bucket !== BUCKET ||
        !isTicketStoragePath(
          typedAttachment.storage_object_path,
          ticket.tenant_id,
          ticket.id,
        )
      )
        return json(
          request,
          { error: { code: "attachment_storage_metadata_invalid" } },
          422,
        );
      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(
          typedAttachment.storage_object_path,
          DOWNLOAD_URL_TTL_SECONDS,
        );
      if (signedError || !signed?.signedUrl)
        return json(
          request,
          { error: { code: "download_url_create_failed" } },
          500,
        );
      return json(request, {
        data: {
          attachmentId: typedAttachment.id,
          signedUrl: signed.signedUrl,
          expiresIn: DOWNLOAD_URL_TTL_SECONDS,
        },
      });
    }

    if (action.type === "createUpload") {
      const canCreateUpload =
        action.visibility === undefined
          ? await canUpdateTicket(context.supabase, ticket)
          : await canWriteCommentAttachment(
              context.supabase,
              actorId,
              ticket,
              action.visibility,
            );
      if (canCreateUpload === null)
        return json(
          request,
          { error: { code: "attachment_permission_check_failed" } },
          500,
        );
      if (!canCreateUpload)
        return json(
          request,
          {
            error: {
              code:
                action.visibility === undefined
                  ? "ticket_update_denied"
                  : "comment_attachment_write_denied",
            },
          },
          403,
        );
      const storageObjectPath = `${ticket.tenant_id}/${ticket.id}/${crypto.randomUUID()}`;
      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storageObjectPath, { upsert: false });
      if (signedError || !signed?.signedUrl || !signed.token)
        return json(
          request,
          { error: { code: "upload_url_create_failed" } },
          500,
        );
      return json(request, {
        data: {
          storageObjectPath,
          signedUrl: signed.signedUrl,
          uploadToken: signed.token,
          contentType: action.contentType,
          byteSize: action.byteSize,
          expiresIn: UPLOAD_URL_TTL_SECONDS,
        },
      });
    }

    if (action.type === "completeUpload") {
      const visibility = action.visibility ?? "external";
      const canCompleteUpload =
        action.visibility === undefined
          ? await canUpdateTicket(context.supabase, ticket)
          : await canWriteCommentAttachment(
              context.supabase,
              actorId,
              ticket,
              action.visibility,
            );
      if (canCompleteUpload === null)
        return json(
          request,
          { error: { code: "attachment_permission_check_failed" } },
          500,
        );
      if (!canCompleteUpload)
        return json(
          request,
          {
            error: {
              code:
                action.visibility === undefined
                  ? "ticket_update_denied"
                  : "comment_attachment_write_denied",
            },
          },
          403,
        );
      if (
        !isTicketStoragePath(
          action.storageObjectPath,
          ticket.tenant_id,
          ticket.id,
        )
      )
        return json(
          request,
          { error: { code: "invalid_storage_object_path" } },
          422,
        );

      const storedObject = await getStoredObject(
        admin,
        ticket.tenant_id,
        ticket.id,
        action.storageObjectPath,
      );
      if (storedObject.error)
        return json(
          request,
          { error: { code: "storage_object_check_failed" } },
          500,
        );
      if (!storedObject.object)
        return json(
          request,
          { error: { code: "storage_object_not_found" } },
          422,
        );
      if (
        !objectMetadataMatches(
          storedObject.object,
          action.contentType,
          action.byteSize,
        )
      )
        return json(
          request,
          { error: { code: "storage_object_metadata_mismatch" } },
          422,
        );
      if (action.visibility !== undefined) {
        const validCommentImage = await hasValidCommentImageSignature(
          admin,
          action.storageObjectPath,
          action.contentType,
          action.byteSize,
        );
        if (validCommentImage === null)
          return json(
            request,
            { error: { code: "comment_image_inspection_failed" } },
            500,
          );
        if (!validCommentImage)
          return json(
            request,
            { error: { code: "invalid_comment_image_content" } },
            422,
          );
      }

      const { data: attachment, error: insertError } = await admin
        .from("ticket_attachments")
        .insert({
          ticket_id: ticket.id,
          uploaded_by: actorId,
          visibility,
          storage_bucket: BUCKET,
          storage_object_path: action.storageObjectPath,
          original_filename: action.originalFilename,
          content_type: action.contentType,
          byte_size: action.byteSize,
        })
        .select(ATTACHMENT_SELECT)
        .single();
      if (insertError || !attachment)
        return json(
          request,
          { error: { code: "attachment_create_failed" } },
          422,
        );

      const typedAttachment = attachment as Attachment;
      const { error: auditError } = await writeAudit(
        admin,
        ticket.tenant_id,
        actorId,
        "ticket.attachment.created",
        typedAttachment.id,
        ticket.id,
        null,
        attachmentAuditData(typedAttachment),
      );
      if (auditError)
        return json(
          request,
          { error: { code: "attachment_audit_failed" } },
          500,
        );
      return json(
        request,
        {
          data: {
            attachment: {
              id: typedAttachment.id,
              ticketId: typedAttachment.ticket_id,
              commentId: typedAttachment.comment_id,
              originalFilename: typedAttachment.original_filename,
              contentType: typedAttachment.content_type,
              byteSize: Number(typedAttachment.byte_size),
              uploadedBy: typedAttachment.uploaded_by,
              visibility: typedAttachment.visibility,
              createdAt: typedAttachment.created_at,
            },
          },
        },
        201,
      );
    }

    // The only remaining action is delete; parseAction has already made this
    // exhaustive, but keeping the guard prevents accidental future fallthrough.
    if (action.type !== "delete")
      return json(request, { error: { code: "invalid_request" } }, 422);

    const canUpdate = await canUpdateTicket(context.supabase, ticket);
    if (canUpdate === null)
      return json(
        request,
        { error: { code: "ticket_permission_check_failed" } },
        500,
      );
    if (!canUpdate)
      return json(request, { error: { code: "ticket_update_denied" } }, 403);

    const { data: attachment, error: attachmentError } = await admin
      .from("ticket_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("id", action.attachmentId)
      .eq("ticket_id", ticket.id)
      .maybeSingle();
    if (attachmentError)
      return json(
        request,
        { error: { code: "attachment_lookup_failed" } },
        500,
      );
    if (!attachment)
      return json(request, { error: { code: "attachment_not_found" } }, 404);
    const typedAttachment = attachment as Attachment;
    if (
      typedAttachment.storage_bucket !== BUCKET ||
      !isTicketStoragePath(
        typedAttachment.storage_object_path,
        ticket.tenant_id,
        ticket.id,
      )
    )
      return json(
        request,
        { error: { code: "attachment_storage_metadata_invalid" } },
        422,
      );

    const { error: deleteError } = await admin
      .from("ticket_attachments")
      .delete()
      .eq("id", typedAttachment.id)
      .eq("ticket_id", ticket.id);
    if (deleteError)
      return json(
        request,
        { error: { code: "attachment_delete_failed" } },
        500,
      );

    const { error: storageDeleteError } = await admin.storage
      .from(BUCKET)
      .remove([typedAttachment.storage_object_path]);
    const { error: auditError } = await writeAudit(
      admin,
      ticket.tenant_id,
      actorId,
      "ticket.attachment.deleted",
      typedAttachment.id,
      ticket.id,
      attachmentAuditData(typedAttachment),
      null,
    );
    if (auditError)
      return json(request, { error: { code: "attachment_audit_failed" } }, 500);
    if (storageDeleteError)
      return json(
        request,
        { error: { code: "attachment_storage_delete_failed" } },
        500,
      );
    return json(request, { data: { deletedAttachmentId: typedAttachment.id } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN)
      return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    return withCors(request, await handler(request));
  },
};
