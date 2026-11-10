import { withSupabase } from "@supabase/server";
import { renderTemplatePreview } from "../_shared/email-template-preview.ts";
import { normalizeCustomerTicketEmailBranding } from "../_shared/customer-ticket-email-template.ts";
import {
  EMAIL_TEMPLATES,
  emailTemplateDefinition,
  sanitizeTemplateFields,
} from "../_shared/email-templates.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";

type Row = Record<string, unknown>;
type Admin = any;
type Action =
  | { action: "list"; tenantId: string }
  | {
      action: "save";
      tenantId: string;
      templateKey: string;
      enabled: boolean;
      fields: Record<string, string>;
    }
  | { action: "reset"; tenantId: string; templateKey: string }
  | {
      action: "preview";
      tenantId: string;
      templateKey: string;
      fields: Record<string, string>;
    };

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

function onlyKeys(value: Row, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.action === "list" && onlyKeys(value, ["action", "tenantId"]))
    return { action: "list", tenantId };
  if (
    value.action === "reset" &&
    onlyKeys(value, ["action", "tenantId", "templateKey"]) &&
    typeof value.templateKey === "string" &&
    emailTemplateDefinition(value.templateKey)
  )
    return { action: "reset", tenantId, templateKey: value.templateKey };
  if (
    value.action === "preview" &&
    onlyKeys(value, ["action", "tenantId", "templateKey", "fields"]) &&
    typeof value.templateKey === "string"
  ) {
    const fields = sanitizeTemplateFields(value.templateKey, value.fields);
    return fields
      ? { action: "preview", tenantId, templateKey: value.templateKey, fields }
      : null;
  }
  if (
    value.action === "save" &&
    onlyKeys(value, [
      "action",
      "tenantId",
      "templateKey",
      "enabled",
      "fields",
    ]) &&
    typeof value.templateKey === "string" &&
    typeof value.enabled === "boolean"
  ) {
    const fields = sanitizeTemplateFields(value.templateKey, value.fields);
    if (!fields) return null;
    return {
      action: "save",
      tenantId,
      templateKey: value.templateKey,
      enabled: value.enabled,
      fields,
    };
  }
  return null;
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

const MESSAGES: Record<string, string> = {
  not_authenticated: "Bitte melden Sie sich erneut an.",
  tenant_access_denied: "Sie haben keinen Zugriff auf diesen Mandanten.",
  forbidden: "Dafür fehlt Ihnen die Berechtigung.",
  invalid_request: "Die Anfrage ist ungültig.",
  operation_failed: "Die E-Mail-Vorlagen konnten nicht verarbeitet werden.",
};

function failure(request: Request, error: unknown): Response {
  const safe =
    error instanceof HttpError ? error : new HttpError(500, "operation_failed");
  return reply(
    request,
    {
      error: {
        code: safe.code,
        message: MESSAGES[safe.code] ?? MESSAGES.operation_failed,
      },
    },
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

async function list(request: Request, admin: Admin, tenantId: string) {
  const stored = await admin
    .from("tenant_email_templates")
    .select("template_key, enabled, fields, updated_at")
    .eq("tenant_id", tenantId);
  if (stored.error) throw new HttpError(500, "operation_failed");
  const byKey = new Map<string, Row>(
    (stored.data ?? []).map((row: Row) => [String(row.template_key), row]),
  );
  return reply(request, {
    data: {
      templates: EMAIL_TEMPLATES.map((template) => {
        const row = byKey.get(template.key);
        return {
          ...template,
          enabled: row ? row.enabled !== false : true,
          values: isRecord(row?.fields) ? row.fields : {},
          updatedAt: row ? (row.updated_at ?? null) : null,
        };
      }),
    },
  });
}

async function preview(
  request: Request,
  admin: Admin,
  action: Extract<Action, { action: "preview" }>,
) {
  const [branding, settings, tenant, frame] = await Promise.all([
    admin
      .from("tenant_branding")
      .select("logo_path, primary_color, secondary_color, accent_color")
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
    admin
      .from("tenant_settings")
      .select("portal_name")
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name")
      .eq("id", action.tenantId)
      .maybeSingle(),
    admin
      .from("tenant_email_templates")
      .select("fields")
      .eq("tenant_id", action.tenantId)
      .eq("template_key", "security_notice")
      .maybeSingle(),
  ]);
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const portalName =
    str(settings.data?.portal_name) ?? str(tenant.data?.name) ?? "nextDesk";
  const frameFields: Record<string, string> = {};
  if (isRecord(frame.data?.fields)) {
    for (const [name, value] of Object.entries(frame.data.fields)) {
      if (typeof value === "string") frameFields[name] = value;
    }
  }
  const result = renderTemplatePreview({
    key: action.templateKey,
    fields: action.fields,
    frameFields,
    portalName,
    branding: normalizeCustomerTicketEmailBranding({
      accentColor: str(branding.data?.accent_color),
      displayName: portalName,
      logoUrl: str(branding.data?.logo_path),
      primaryColor: str(branding.data?.primary_color),
      secondaryColor: str(branding.data?.secondary_color),
    }),
  });
  if (!result) throw new HttpError(400, "invalid_request");
  return reply(request, { data: result });
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) throw new HttpError(401, "not_authenticated");
    const action = parseAction(await request.json().catch(() => null));
    if (!action) throw new HttpError(400, "invalid_request");
    const admin = context.supabaseAdmin;
    await requireTenantAdmin(admin, action.tenantId, actorId);
    if (action.action === "preview")
      return await preview(request, admin, action);
    if (action.action === "save") {
      const result = await admin.from("tenant_email_templates").upsert(
        {
          tenant_id: action.tenantId,
          template_key: action.templateKey,
          enabled: action.enabled,
          fields: action.fields,
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,template_key" },
      );
      if (result.error) throw new HttpError(500, "operation_failed");
    } else if (action.action === "reset") {
      const result = await admin
        .from("tenant_email_templates")
        .delete()
        .eq("tenant_id", action.tenantId)
        .eq("template_key", action.templateKey);
      if (result.error) throw new HttpError(500, "operation_failed");
    }
    return await list(request, admin, action.tenantId);
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
