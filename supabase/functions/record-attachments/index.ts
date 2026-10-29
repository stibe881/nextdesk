import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStatesCached } from "../_shared/tenant-features.ts";

const ORIGIN = "https://app.nextdesk.ch";
const BUCKET = "record-attachments";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PER_RECORD = 30;
const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
const CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
type EntityType = "contract" | "license";
type Row = Record<string, unknown>;
type Admin = SupabaseContext["supabaseAdmin"];
type Action =
  | { type: "list"; tenantId: string; entityType: EntityType; entityId: string }
  | {
    type: "createUpload";
    tenantId: string;
    entityType: EntityType;
    entityId: string;
    filename: string;
    contentType: string;
    byteSize: number;
  }
  | {
    type: "completeUpload";
    tenantId: string;
    entityType: EntityType;
    entityId: string;
    storageObjectPath: string;
    filename: string;
    contentType: string;
    byteSize: number;
  }
  | { type: "createDownloadUrl"; tenantId: string; attachmentId: string }
  | { type: "delete"; tenantId: string; attachmentId: string };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const hasOnly = (value: Row, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
function cleanFilename(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  const name = value.trim().replace(/[\\/]/g, "_");
  return name.length >= 1 && name.length <= 240 ? name : null;
}
function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  const entityType = value.entityType;
  const entityOk = (entityType === "contract" || entityType === "license") &&
    isUuid(value.entityId);
  if (value.type === "list" && entityOk) {
    return hasOnly(value, ["type", "tenantId", "entityType", "entityId"])
      ? {
        type: "list",
        tenantId,
        entityType: entityType as EntityType,
        entityId: (value.entityId as string).toLowerCase(),
      }
      : null;
  }
  if (value.type === "createUpload" && entityOk) {
    const filename = cleanFilename(value.filename);
    if (
      !filename || typeof value.contentType !== "string" ||
      !CONTENT_TYPES.has(value.contentType.toLowerCase()) ||
      !Number.isSafeInteger(value.byteSize) ||
      (value.byteSize as number) < 1 || (value.byteSize as number) > MAX_BYTES ||
      !hasOnly(value, [
        "type",
        "tenantId",
        "entityType",
        "entityId",
        "filename",
        "contentType",
        "byteSize",
      ])
    ) return null;
    return {
      type: "createUpload",
      tenantId,
      entityType: entityType as EntityType,
      entityId: (value.entityId as string).toLowerCase(),
      filename,
      contentType: value.contentType.toLowerCase(),
      byteSize: value.byteSize as number,
    };
  }
  if (value.type === "completeUpload" && entityOk) {
    const filename = cleanFilename(value.filename);
    if (
      !filename || typeof value.storageObjectPath !== "string" ||
      typeof value.contentType !== "string" ||
      !CONTENT_TYPES.has(value.contentType.toLowerCase()) ||
      !Number.isSafeInteger(value.byteSize) ||
      (value.byteSize as number) < 1 || (value.byteSize as number) > MAX_BYTES ||
      !hasOnly(value, [
        "type",
        "tenantId",
        "entityType",
        "entityId",
        "storageObjectPath",
        "filename",
        "contentType",
        "byteSize",
      ])
    ) return null;
    return {
      type: "completeUpload",
      tenantId,
      entityType: entityType as EntityType,
      entityId: (value.entityId as string).toLowerCase(),
      storageObjectPath: value.storageObjectPath,
      filename,
      contentType: value.contentType.toLowerCase(),
      byteSize: value.byteSize as number,
    };
  }
  if (
    (value.type === "createDownloadUrl" || value.type === "delete") &&
    isUuid(value.attachmentId) &&
    hasOnly(value, ["type", "tenantId", "attachmentId"])
  ) {
    return {
      type: value.type,
      tenantId,
      attachmentId: value.attachmentId.toLowerCase(),
    };
  }
  return null;
}
function headers(request: Request): Headers {
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ORIGIN) {
    result.set("Access-Control-Allow-Origin", ORIGIN);
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    result.set("Access-Control-Max-Age", "7200");
  }
  return result;
}
const reply = (request: Request, body: Row, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(request) });

async function authorize(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<void> {
  const featurePromise = resolveTenantFeatureStatesCached(admin, tenantId, [
    "contracts.management",
  ]);
  featurePromise.catch(() => undefined);
  const { data, error } = await admin.rpc(
    "has_contracts_management_permission",
    { p_tenant_id: tenantId, p_user_id: actorId },
  );
  if (error) {
    throw new HttpError(
      503,
      "attachments_authorization_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (data !== true) {
    throw new HttpError(
      403,
      "attachments_manage_required",
      "Die Berechtigung für Verträge und Lizenzen fehlt.",
    );
  }
  const feature = await featurePromise;
  if (!feature) {
    throw new HttpError(
      503,
      "attachments_unavailable",
      "Die Anhänge sind derzeit nicht verfügbar.",
    );
  }
  if (!feature["contracts.management"]) {
    throw new HttpError(
      403,
      "attachments_feature_disabled",
      "Die Verwaltung ist für diesen Mandanten nicht aktiviert.",
    );
  }
}

const parentColumn = (type: EntityType) =>
  type === "contract" ? "contract_id" : "license_id";

async function assertParent(
  admin: Admin,
  tenantId: string,
  entityType: EntityType,
  entityId: string,
  requireWritable: boolean,
): Promise<void> {
  const { data, error } = await admin
    .from(entityType === "contract" ? "contracts" : "licenses")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) {
    throw new HttpError(503, "attachments_unavailable", "Die Anhänge sind derzeit nicht verfügbar.");
  }
  if (!data) {
    throw new HttpError(404, "record_not_found", "Der Eintrag wurde nicht gefunden.");
  }
  if (requireWritable && (data as Row).status === "archived") {
    throw new HttpError(
      422,
      "record_archived",
      "Archivierten Einträgen können keine Anhänge hinzugefügt werden.",
    );
  }
}

/**
 * The private bucket is normally created by the migration. If it is missing
 * (for example when the migration ran without the storage schema), it is
 * created here once and the upload link is requested again.
 */
async function createUploadUrl(admin: Admin, storageObjectPath: string) {
  let result = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storageObjectPath, { upsert: false });
  if (result.error && /bucket/i.test(result.error.message ?? "")) {
    const created = await admin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: [...CONTENT_TYPES],
    });
    if (!created.error || /already exists/i.test(created.error.message ?? "")) {
      result = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storageObjectPath, { upsert: false });
    }
  }
  return result;
}

const toAttachment = (row: Row) => ({
  id: row.id,
  filename: row.original_filename,
  contentType: row.content_type,
  byteSize: row.byte_size,
  createdAt: row.created_at,
});
const SELECT =
  "id, tenant_id, contract_id, license_id, storage_object_path, original_filename, content_type, byte_size, created_at";

async function handler(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  const actorId = context.userClaims?.id;
  const action = parseAction(await request.json().catch(() => null));
  if (!isUuid(actorId) || !action) {
    throw new HttpError(400, "invalid_request", "Die Anfrage ist ungültig.");
  }
  const admin = context.supabaseAdmin;
  await authorize(admin, actorId, action.tenantId);

  if (action.type === "list") {
    await assertParent(admin, action.tenantId, action.entityType, action.entityId, false);
    const { data, error } = await admin
      .from("record_attachments")
      .select(SELECT)
      .eq("tenant_id", action.tenantId)
      .eq(parentColumn(action.entityType), action.entityId)
      .order("created_at", { ascending: false })
      .limit(MAX_PER_RECORD);
    if (error) {
      throw new HttpError(503, "attachments_unavailable", "Anhänge konnten nicht geladen werden.");
    }
    return reply(request, {
      data: { attachments: (data ?? []).map((row) => toAttachment(row as Row)) },
    });
  }

  if (action.type === "createUpload") {
    await assertParent(admin, action.tenantId, action.entityType, action.entityId, true);
    const { count, error: countError } = await admin
      .from("record_attachments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId)
      .eq(parentColumn(action.entityType), action.entityId);
    if (countError) {
      throw new HttpError(503, "attachments_unavailable", "Anhänge konnten nicht geprüft werden.");
    }
    if ((count ?? 0) >= MAX_PER_RECORD) {
      throw new HttpError(
        422,
        "attachment_limit_reached",
        `Pro Eintrag sind höchstens ${MAX_PER_RECORD} Anhänge möglich.`,
      );
    }
    const storageObjectPath =
      `${action.tenantId}/${action.entityType}/${action.entityId}/${crypto.randomUUID()}`;
    const { data, error } = await createUploadUrl(admin, storageObjectPath);
    if (error || !data?.signedUrl) {
      console.error("record-attachments: createSignedUploadUrl failed", error?.message);
      throw new HttpError(500, "upload_url_create_failed", "Der Upload konnte nicht vorbereitet werden.");
    }
    return reply(request, {
      data: {
        storageObjectPath,
        signedUrl: data.signedUrl,
        contentType: action.contentType,
        byteSize: action.byteSize,
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      },
    });
  }

  if (action.type === "completeUpload") {
    await assertParent(admin, action.tenantId, action.entityType, action.entityId, true);
    const prefix = `${action.tenantId}/${action.entityType}/${action.entityId}`;
    if (
      !action.storageObjectPath.startsWith(`${prefix}/`) ||
      !UUID.test(action.storageObjectPath.slice(prefix.length + 1))
    ) {
      throw new HttpError(422, "invalid_storage_object_path", "Der Speicherpfad ist ungültig.");
    }
    const objectName = action.storageObjectPath.slice(prefix.length + 1);
    const { data: listed, error: listError } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: 10, offset: 0, search: objectName });
    if (listError) {
      throw new HttpError(503, "attachments_unavailable", "Der Upload konnte nicht geprüft werden.");
    }
    const object = (listed ?? []).find((entry: any) => entry?.name === objectName);
    const metadata = isRecord(object) && isRecord((object as Row).metadata)
      ? ((object as Row).metadata as Row)
      : null;
    const size = Number(metadata?.size);
    if (
      !metadata || size !== action.byteSize ||
      String(metadata.mimetype ?? "").toLowerCase() !== action.contentType
    ) {
      throw new HttpError(422, "upload_not_found", "Die hochgeladene Datei wurde nicht gefunden oder stimmt nicht überein.");
    }
    const { data, error } = await admin
      .from("record_attachments")
      .insert({
        tenant_id: action.tenantId,
        [parentColumn(action.entityType)]: action.entityId,
        storage_object_path: action.storageObjectPath,
        original_filename: action.filename,
        content_type: action.contentType,
        byte_size: action.byteSize,
        uploaded_by: actorId,
      })
      .select(SELECT)
      .single();
    if (error || !data) {
      throw new HttpError(503, "attachment_save_failed", "Der Anhang konnte nicht gespeichert werden.");
    }
    return reply(request, { data: { attachment: toAttachment(data as Row) } }, 201);
  }

  const { data: attachment, error: attachmentError } = await admin
    .from("record_attachments")
    .select(SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("id", action.attachmentId)
    .maybeSingle();
  if (attachmentError) {
    throw new HttpError(503, "attachments_unavailable", "Der Anhang konnte nicht geladen werden.");
  }
  if (!attachment) {
    throw new HttpError(404, "attachment_not_found", "Der Anhang wurde nicht gefunden.");
  }
  const path = String((attachment as Row).storage_object_path);

  if (action.type === "createDownloadUrl") {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, {
        download: String((attachment as Row).original_filename),
      });
    if (error || !data?.signedUrl) {
      throw new HttpError(503, "download_url_failed", "Der Download konnte nicht vorbereitet werden.");
    }
    return reply(request, { data: { url: data.signedUrl } });
  }

  const parentId = (attachment as Row).contract_id ?? (attachment as Row).license_id;
  const parentType: EntityType = (attachment as Row).contract_id
    ? "contract"
    : "license";
  await assertParent(admin, action.tenantId, parentType, String(parentId), true);
  const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
  if (removeError) {
    throw new HttpError(503, "attachment_delete_failed", "Der Anhang konnte nicht gelöscht werden.");
  }
  const { error: deleteError } = await admin
    .from("record_attachments")
    .delete()
    .eq("tenant_id", action.tenantId)
    .eq("id", action.attachmentId);
  if (deleteError) {
    throw new HttpError(503, "attachment_delete_failed", "Der Anhang konnte nicht gelöscht werden.");
  }
  return reply(request, { data: { deleted: true } });
}

const secured = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  handler,
);
export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return reply(request, { error: { code: "origin_not_allowed" } }, 403);
    }
    if (request.method === "OPTIONS") {
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: headers(request) })
        : reply(request, { error: { code: "origin_not_allowed" } }, 403);
    }
    if (
      request.method !== "POST" ||
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
    ) {
      return reply(request, { error: { code: "invalid_request" } }, 400);
    }
    try {
      return await secured(request);
    } catch (error) {
      return reply(
        request,
        {
          error: {
            code: error instanceof HttpError
              ? error.code
              : "attachments_unavailable",
            message: error instanceof HttpError
              ? error.message
              : "Die Anhänge sind derzeit nicht verfügbar.",
          },
        },
        error instanceof HttpError ? error.status : 503,
      );
    }
  },
};
