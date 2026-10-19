import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,100}$/;
const DEPARTMENT_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const BRANDING_KEYS = new Set([
  "portalName",
  "logoUrl",
  "primaryColor",
  "secondaryColor",
  "accentColor",
]);
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_BASE64_LENGTH = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 8;
const SSO_KEYS = new Set([
  "type",
  "tenantId",
  "provider",
  "enabled",
  "issuerUrl",
  "discoveryUrl",
  "clientId",
  "allowedEmailDomains",
  "enforceSso",
]);

type BrandingInput = {
  portalName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
};

type SsoInput = {
  provider: "oidc" | "saml" | "azure_ad";
  enabled: boolean;
  issuerUrl?: string | null;
  discoveryUrl?: string | null;
  clientId?: string | null;
  allowedEmailDomains?: string[];
  enforceSso: boolean;
};

type Action =
  | { type: "getSettings"; tenantId: string }
  | { type: "updateBranding"; tenantId: string; branding: BrandingInput }
  | {
      type: "uploadBrandingLogo";
      tenantId: string;
      fileName: string;
      contentType: "image/png" | "image/jpeg" | "image/webp";
      base64: string;
    }
  | ({ type: "updateSsoConfiguration"; tenantId: string } & SsoInput)
  | {
      type: "toggleFeature";
      tenantId: string;
      featureKey: string;
      enabled: boolean;
    }
  | {
      type: "setFeaturePilot";
      tenantId: string;
      featureKey: string;
      pilotEndDate: string | null;
    }
  | { type: "listUsers"; tenantId: string }
  | { type: "listRoles"; tenantId: string }
  | { type: "listDepartments"; tenantId: string }
  | { type: "saveDepartment"; tenantId: string; id?: string; name: string }
  | { type: "archiveDepartment"; tenantId: string; id: string };

type SsoConfiguration = {
  provider: "oidc" | "saml" | "azure_ad";
  enabled: boolean;
  issuer_url: string | null;
  discovery_url: string | null;
  client_id: string | null;
  allowed_email_domains: string[];
  enforce_sso: boolean;
  updated_at?: string;
};

type SafeRole = {
  id: string;
  name: string;
  scope: string;
  active: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function textInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : null;
}

function isHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function hasSufficientWhiteTextContrast(value: string): boolean {
  if (!COLOR_PATTERN.test(value)) return false;
  const linearChannel = (offset: number) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const red = linearChannel(1);
  const green = linearChannel(3);
  const blue = linearChannel(5);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05) >= 4.5;
}

function parseOptionalUrl(
  value: Record<string, unknown>,
  key: string,
): string | null | undefined | false {
  if (!hasOwn(value, key)) return undefined;
  if (value[key] === null) return null;
  if (typeof value[key] !== "string") return false;
  const normalized = value[key].trim();
  return isHttpsUrl(normalized) ? normalized : false;
}

function parseOptionalText(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
): string | null | undefined | false {
  if (!hasOwn(value, key)) return undefined;
  if (value[key] === null) return null;
  return textInRange(value[key], 1, maximum) ?? false;
}

function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  return domain.length <= 253 && DOMAIN_PATTERN.test(domain) ? domain : null;
}

function parseBranding(value: unknown): BrandingInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, BRANDING_KEYS)) return null;

  const branding: BrandingInput = {};
  if (hasOwn(value, "portalName")) {
    if (value.portalName === null) {
      branding.portalName = null;
    } else {
      const portalName = textInRange(value.portalName, 2, 160);
      if (!portalName) return null;
      branding.portalName = portalName;
    }
  }
  if (hasOwn(value, "logoUrl")) {
    if (value.logoUrl === null) branding.logoUrl = null;
    else if (
      typeof value.logoUrl === "string" &&
      isHttpsUrl(value.logoUrl.trim())
    ) {
      branding.logoUrl = value.logoUrl.trim();
    } else return null;
  }

  for (const [inputKey, outputKey] of [
    ["primaryColor", "primaryColor"],
    ["secondaryColor", "secondaryColor"],
    ["accentColor", "accentColor"],
  ] as const) {
    if (!hasOwn(value, inputKey)) continue;
    if (
      typeof value[inputKey] !== "string" ||
      !COLOR_PATTERN.test(value[inputKey])
    ) {
      return null;
    }
    if (
      inputKey !== "accentColor" &&
      !hasSufficientWhiteTextContrast(value[inputKey] as string)
    ) {
      return null;
    }
    branding[outputKey] = value[inputKey].toUpperCase();
  }

  return Object.keys(branding).length > 0 ? branding : null;
}

function parseSso(value: Record<string, unknown>): SsoInput | null {
  if (!hasOnlyKeys(value, SSO_KEYS)) return null;
  if (
    !["oidc", "saml", "azure_ad"].includes(String(value.provider)) ||
    typeof value.enabled !== "boolean" ||
    typeof value.enforceSso !== "boolean"
  )
    return null;

  const issuerUrl = parseOptionalUrl(value, "issuerUrl");
  const discoveryUrl = parseOptionalUrl(value, "discoveryUrl");
  const clientId = parseOptionalText(value, "clientId", 512);
  if (issuerUrl === false || discoveryUrl === false || clientId === false)
    return null;

  let allowedEmailDomains: string[] | undefined;
  if (hasOwn(value, "allowedEmailDomains")) {
    if (
      !Array.isArray(value.allowedEmailDomains) ||
      value.allowedEmailDomains.length > 50
    ) {
      return null;
    }
    const domains: string[] = [];
    for (const candidate of value.allowedEmailDomains) {
      if (typeof candidate !== "string") return null;
      const domain = normalizeDomain(candidate);
      if (!domain) return null;
      domains.push(domain);
    }
    allowedEmailDomains = [...new Set(domains)];
  }

  return {
    provider: value.provider as SsoInput["provider"],
    enabled: value.enabled,
    issuerUrl,
    discoveryUrl,
    clientId,
    allowedEmailDomains,
    enforceSso: value.enforceSso,
  };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (
    ["getSettings", "listUsers", "listRoles", "listDepartments"].includes(
      value.type,
    ) &&
    hasOnlyKeys(value, new Set(["type", "tenantId"])) &&
    isUuid(value.tenantId)
  ) {
    return {
      type: value.type as
        "getSettings" | "listUsers" | "listRoles" | "listDepartments",
      tenantId: value.tenantId,
    };
  }

  if (
    value.type === "uploadBrandingLogo" &&
    hasOnlyKeys(
      value,
      new Set(["type", "tenantId", "fileName", "contentType", "base64"]),
    ) &&
    isUuid(value.tenantId) &&
    typeof value.fileName === "string" &&
    textInRange(value.fileName, 1, 120) &&
    typeof value.contentType === "string" &&
    LOGO_CONTENT_TYPES.has(value.contentType) &&
    typeof value.base64 === "string" &&
    value.base64.length > 0 &&
    value.base64.length <= MAX_LOGO_BASE64_LENGTH &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)
  ) {
    return {
      type: "uploadBrandingLogo",
      tenantId: value.tenantId,
      fileName: value.fileName.trim(),
      contentType: value.contentType as
        "image/png" | "image/jpeg" | "image/webp",
      base64: value.base64,
    };
  }

  if (
    value.type === "updateBranding" &&
    hasOnlyKeys(value, new Set(["type", "tenantId", "branding"])) &&
    isUuid(value.tenantId)
  ) {
    const branding = parseBranding(value.branding);
    return branding
      ? { type: "updateBranding", tenantId: value.tenantId, branding }
      : null;
  }

  if (value.type === "updateSsoConfiguration" && isUuid(value.tenantId)) {
    const sso = parseSso(value);
    return sso
      ? { type: "updateSsoConfiguration", tenantId: value.tenantId, ...sso }
      : null;
  }

  if (
    value.type === "toggleFeature" &&
    hasOnlyKeys(
      value,
      new Set(["type", "tenantId", "featureKey", "enabled"]),
    ) &&
    isUuid(value.tenantId) &&
    typeof value.featureKey === "string" &&
    FEATURE_KEY_PATTERN.test(value.featureKey) &&
    typeof value.enabled === "boolean"
  ) {
    return {
      type: "toggleFeature",
      tenantId: value.tenantId,
      featureKey: value.featureKey,
      enabled: value.enabled,
    };
  }

  if (
    value.type === "setFeaturePilot" &&
    hasOnlyKeys(
      value,
      new Set(["type", "tenantId", "featureKey", "pilotEndDate"]),
    ) &&
    isUuid(value.tenantId) &&
    typeof value.featureKey === "string" &&
    FEATURE_KEY_PATTERN.test(value.featureKey) &&
    (value.pilotEndDate === null ||
      (typeof value.pilotEndDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.pilotEndDate) &&
        Number.isFinite(Date.parse(`${value.pilotEndDate}T23:59:59Z`))))
  ) {
    return {
      type: "setFeaturePilot",
      tenantId: value.tenantId,
      featureKey: value.featureKey,
      pilotEndDate: value.pilotEndDate,
    };
  }

  if (
    value.type === "saveDepartment" &&
    hasOnlyKeys(value, new Set(["type", "tenantId", "id", "name"])) &&
    isUuid(value.tenantId) &&
    textInRange(value.name, 2, 120) &&
    (!hasOwn(value, "id") || isUuid(value.id))
  ) {
    return {
      type: "saveDepartment",
      tenantId: value.tenantId,
      ...(hasOwn(value, "id") ? { id: value.id as string } : {}),
      name: (value.name as string).trim(),
    };
  }

  if (
    value.type === "archiveDepartment" &&
    hasOnlyKeys(value, new Set(["type", "tenantId", "id"])) &&
    isUuid(value.tenantId) &&
    isUuid(value.id)
  ) {
    return {
      type: "archiveDepartment",
      tenantId: value.tenantId,
      id: value.id,
    };
  }

  return null;
}

function corsHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function noContent(request: Request): Response {
  if (request.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json(request, { error: { code: "origin_not_allowed" } }, 403);
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function parseJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function requireTenantAdministrator(
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<"allowed" | "forbidden" | "error"> {
  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) return "error";
  if (!membership) return "forbidden";

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (roleError) return "error";
  if (!role?.id) return "forbidden";

  const now = new Date().toISOString();
  const { data: assignment, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (assignmentError) return "error";
  return assignment ? "allowed" : "forbidden";
}

async function authorize(
  admin: any,
  request: Request,
  actorId: string,
  tenantId: string,
): Promise<Response | null> {
  const result = await requireTenantAdministrator(admin, actorId, tenantId);
  if (result === "allowed") return null;
  if (result === "error") {
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  return json(request, { error: { code: "tenant_admin_required" } }, 403);
}

function toSafeRole(role: Record<string, unknown>): SafeRole | null {
  return typeof role.id === "string" &&
    typeof role.name === "string" &&
    typeof role.scope === "string" &&
    typeof role.active === "boolean"
    ? { id: role.id, name: role.name, scope: role.scope, active: role.active }
    : null;
}

async function listSafeRoles(
  admin: any,
  tenantId: string,
): Promise<{
  roles: SafeRole[] | null;
  error: boolean;
}> {
  const { data, error } = await admin
    .from("roles")
    .select("id, name, scope, active")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true })
    .limit(200);
  if (error) return { roles: null, error: true };
  const roles = ((data ?? []) as Record<string, unknown>[])
    .map(toSafeRole)
    .filter((role): role is SafeRole => role !== null);
  return { roles, error: false };
}

function safeSsoConfiguration(configuration: SsoConfiguration) {
  return {
    provider: configuration.provider,
    enabled: configuration.enabled,
    issuer_url: configuration.issuer_url,
    discovery_url: configuration.discovery_url,
    client_id: configuration.client_id,
    allowed_email_domains: configuration.allowed_email_domains,
    enforce_sso: configuration.enforce_sso,
    updated_at: configuration.updated_at,
  };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: tenantId,
    severity: "security",
    metadata,
  });
  return !error;
}

async function handleGetSettings(
  admin: any,
  request: Request,
  tenantId: string,
): Promise<Response> {
  const [
    settingsResult,
    brandingResult,
    ssoResult,
    featuresResult,
    rolesResult,
  ] = await Promise.all([
    admin
      .from("tenant_settings")
      .select(
        "portal_name, support_email, ticket_access_enabled, allow_external_ticket_access, updated_at",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("tenant_branding")
      .select(
        "logo_path, primary_color, secondary_color, accent_color, updated_at",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("tenant_sso_configurations")
      .select(
        "provider, enabled, issuer_url, discovery_url, client_id, allowed_email_domains, enforce_sso, updated_at",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("tenant_feature_flags")
      .select(
        "feature_key, enabled, pilot_ends_at, updated_at, feature_catalog(key, name, description, category, default_enabled)",
      )
      .eq("tenant_id", tenantId)
      .order("feature_key", { ascending: true })
      .limit(200),
    listSafeRoles(admin, tenantId),
  ]);

  if (
    settingsResult.error ||
    brandingResult.error ||
    ssoResult.error ||
    featuresResult.error ||
    rolesResult.error
  ) {
    return json(request, { error: { code: "settings_read_failed" } }, 500);
  }

  const sso = ssoResult.data as SsoConfiguration | null;
  return json(request, {
    data: {
      tenant_settings: settingsResult.data ?? null,
      tenant_branding: brandingResult.data
        ? {
            ...brandingResult.data,
            logo_url: brandingResult.data.logo_path,
          }
        : null,
      // Deliberately omits client_secret_reference and all secret material.
      tenant_sso_configurations: sso ? [safeSsoConfiguration(sso)] : [],
      tenant_feature_flags: featuresResult.data ?? [],
      roles: rolesResult.roles ?? [],
    },
  });
}

function decodeBase64(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > MAX_LOGO_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function handleUploadBrandingLogo(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "uploadBrandingLogo" }>,
  actorId: string,
): Promise<Response> {
  const bytes = decodeBase64(action.base64);
  if (!bytes) {
    return json(request, { error: { code: "invalid_logo_file" } }, 422);
  }

  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[action.contentType];
  const path = `tenant/${action.tenantId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage
    .from("tenant-branding")
    .upload(path, bytes, {
      contentType: action.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (uploadError) {
    return json(request, { error: { code: "logo_upload_failed" } }, 422);
  }

  const { data: publicUrl } = admin.storage
    .from("tenant-branding")
    .getPublicUrl(path);
  if (!publicUrl?.publicUrl || !isHttpsUrl(publicUrl.publicUrl)) {
    await admin.storage.from("tenant-branding").remove([path]);
    return json(
      request,
      { error: { code: "logo_url_generation_failed" } },
      500,
    );
  }

  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.branding.logo_uploaded",
      "tenant_branding",
      { content_type: action.contentType, byte_size: bytes.length },
    ))
  ) {
    await admin.storage.from("tenant-branding").remove([path]);
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }

  return json(request, { data: { logoUrl: publicUrl.publicUrl } });
}

function toDepartmentKey(name: string): string | null {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return DEPARTMENT_KEY_PATTERN.test(normalized) ? normalized : null;
}

function safeDepartment(value: Record<string, unknown>) {
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    kind: value.kind,
    active: value.active,
    created_at: value.created_at,
  };
}

async function handleListDepartments(
  admin: any,
  request: Request,
  tenantId: string,
): Promise<Response> {
  const { data, error } = await admin
    .from("departments")
    .select("id, key, name, kind, active, created_at")
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("name", { ascending: true })
    .limit(200);
  if (error)
    return json(request, { error: { code: "department_list_failed" } }, 500);
  return json(request, { data: { departments: data ?? [] } });
}

async function handleSaveDepartment(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "saveDepartment" }>,
  actorId: string,
): Promise<Response> {
  if (action.id) {
    const { data, error } = await admin
      .from("departments")
      .update({ name: action.name })
      .eq("id", action.id)
      .eq("tenant_id", action.tenantId)
      .select("id, key, name, kind, active, created_at")
      .maybeSingle();
    if (error || !data) {
      return json(
        request,
        { error: { code: "department_update_failed" } },
        422,
      );
    }
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "tenant.department.updated",
        "department",
        { department_id: action.id },
      ))
    ) {
      return json(request, { error: { code: "audit_log_write_failed" } }, 500);
    }
    return json(request, { data: { department: safeDepartment(data) } });
  }

  const baseKey = toDepartmentKey(action.name);
  if (!baseKey) {
    return json(request, { error: { code: "department_key_invalid" } }, 422);
  }
  const { data: existing, error: existingError } = await admin
    .from("departments")
    .select("key")
    .eq("tenant_id", action.tenantId)
    .limit(200);
  if (existingError) {
    return json(request, { error: { code: "department_lookup_failed" } }, 500);
  }
  const used = new Set((existing ?? []).map((row: { key: string }) => row.key));
  let key = baseKey;
  for (let suffix = 2; used.has(key) && suffix < 1000; suffix += 1) {
    const suffixValue = `-${suffix}`;
    key = `${baseKey.slice(0, 63 - suffixValue.length)}${suffixValue}`;
  }
  if (used.has(key)) {
    return json(request, { error: { code: "department_key_conflict" } }, 409);
  }

  const { data, error } = await admin
    .from("departments")
    .insert({
      tenant_id: action.tenantId,
      key,
      name: action.name,
      kind: "custom",
      active: true,
    })
    .select("id, key, name, kind, active, created_at")
    .single();
  if (error || !data) {
    return json(request, { error: { code: "department_create_failed" } }, 422);
  }
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.department.created",
      "department",
      { department_id: data.id },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { department: safeDepartment(data) } });
}

async function handleArchiveDepartment(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "archiveDepartment" }>,
  actorId: string,
): Promise<Response> {
  const { data, error } = await admin
    .from("departments")
    .update({ active: false })
    .eq("id", action.id)
    .eq("tenant_id", action.tenantId)
    .select("id, key, name, kind, active, created_at")
    .maybeSingle();
  if (error || !data) {
    return json(request, { error: { code: "department_archive_failed" } }, 422);
  }
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.department.archived",
      "department",
      { department_id: action.id },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { department: safeDepartment(data) } });
}

async function handleUpdateBranding(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "updateBranding" }>,
  actorId: string,
): Promise<Response> {
  const brandingUpdate: Record<string, unknown> = {
    tenant_id: action.tenantId,
  };
  if (action.branding.logoUrl !== undefined) {
    brandingUpdate.logo_path = action.branding.logoUrl;
  }
  if (action.branding.primaryColor !== undefined) {
    brandingUpdate.primary_color = action.branding.primaryColor;
  }
  if (action.branding.secondaryColor !== undefined) {
    brandingUpdate.secondary_color = action.branding.secondaryColor;
  }
  if (action.branding.accentColor !== undefined) {
    brandingUpdate.accent_color = action.branding.accentColor;
  }

  const writes: Promise<{ error: unknown }>[] = [];
  if (Object.keys(brandingUpdate).length > 1) {
    writes.push(
      admin
        .from("tenant_branding")
        .upsert(brandingUpdate, { onConflict: "tenant_id" }),
    );
  }
  if (action.branding.portalName !== undefined) {
    writes.push(
      admin.from("tenant_settings").upsert(
        {
          tenant_id: action.tenantId,
          portal_name: action.branding.portalName,
        },
        { onConflict: "tenant_id" },
      ),
    );
  }

  const results = await Promise.all(writes);
  if (results.some((result) => result.error)) {
    return json(request, { error: { code: "branding_update_failed" } }, 422);
  }

  const changedFields = Object.keys(action.branding);
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.branding.updated",
      "tenant_branding",
      { changed_fields: changedFields },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { updated: true } });
}

async function handleUpdateSsoConfiguration(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "updateSsoConfiguration" }>,
  actorId: string,
): Promise<Response> {
  const { data: existingData, error: existingError } = await admin
    .from("tenant_sso_configurations")
    .select(
      "provider, enabled, issuer_url, discovery_url, client_id, allowed_email_domains, enforce_sso",
    )
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (existingError) {
    return json(
      request,
      { error: { code: "sso_configuration_read_failed" } },
      500,
    );
  }

  const existing = existingData as SsoConfiguration | null;
  const issuerUrl =
    action.issuerUrl === undefined
      ? (existing?.issuer_url ?? null)
      : action.issuerUrl;
  const discoveryUrl =
    action.discoveryUrl === undefined
      ? (existing?.discovery_url ?? null)
      : action.discoveryUrl;
  // Azure customer SSO always uses the centrally managed, multitenant
  // nextDesk application in Supabase. A per-tenant client ID would suggest a
  // second provider configuration that Supabase cannot safely select at login.
  const clientId =
    action.provider === "azure_ad"
      ? null
      : action.clientId === undefined
        ? (existing?.client_id ?? null)
        : action.clientId;
  const allowedEmailDomains =
    action.allowedEmailDomains === undefined
      ? (existing?.allowed_email_domains ?? [])
      : action.allowedEmailDomains;

  if (action.enforceSso && !action.enabled) {
    return json(
      request,
      { error: { code: "sso_enforcement_requires_enabled_sso" } },
      422,
    );
  }
  if (action.enabled && action.provider !== "azure_ad") {
    return json(
      request,
      { error: { code: "sso_provider_not_supported" } },
      422,
    );
  }
  if (action.enabled && (!issuerUrl || !discoveryUrl)) {
    return json(
      request,
      { error: { code: "sso_issuer_and_discovery_required" } },
      422,
    );
  }
  if (action.enabled && allowedEmailDomains.length === 0) {
    return json(request, { error: { code: "sso_email_domain_required" } }, 422);
  }

  const configuration = {
    tenant_id: action.tenantId,
    provider: action.provider,
    enabled: action.enabled,
    issuer_url: issuerUrl,
    discovery_url: discoveryUrl,
    client_id: clientId,
    allowed_email_domains: allowedEmailDomains,
    enforce_sso: action.enforceSso,
    // Secrets are neither accepted nor returned. This function keeps the reference unset.
    client_secret_reference: null,
    updated_by: actorId,
  };
  const { error } = await admin
    .from("tenant_sso_configurations")
    .upsert(configuration, { onConflict: "tenant_id" });
  if (error) {
    return json(
      request,
      { error: { code: "sso_configuration_update_failed" } },
      422,
    );
  }

  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.sso_configuration.updated",
      "tenant_sso_configuration",
      {
        provider: action.provider,
        enabled: action.enabled,
        enforce_sso: action.enforceSso,
        allowed_email_domain_count: allowedEmailDomains.length,
      },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }

  return json(request, {
    data: {
      updated: true,
      configuration: safeSsoConfiguration({
        provider: action.provider,
        enabled: action.enabled,
        issuer_url: issuerUrl,
        discovery_url: discoveryUrl,
        client_id: clientId,
        allowed_email_domains: allowedEmailDomains,
        enforce_sso: action.enforceSso,
      }),
    },
  });
}

async function handleToggleFeature(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "toggleFeature" }>,
  actorId: string,
): Promise<Response> {
  const { data: feature, error: featureError } = await admin
    .from("feature_catalog")
    .select("key")
    .eq("key", action.featureKey)
    .maybeSingle();
  if (featureError) {
    return json(request, { error: { code: "feature_lookup_failed" } }, 500);
  }
  if (!feature) {
    return json(request, { error: { code: "feature_not_found" } }, 422);
  }

  const { error } = await admin.from("tenant_feature_flags").upsert(
    {
      tenant_id: action.tenantId,
      feature_key: action.featureKey,
      enabled: action.enabled,
      pilot_ends_at: null,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,feature_key" },
  );
  if (error) {
    return json(request, { error: { code: "feature_update_failed" } }, 422);
  }

  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.feature.toggled",
      "tenant_feature_flag",
      { feature_key: action.featureKey, enabled: action.enabled },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { updated: true } });
}

async function handleSetFeaturePilot(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "setFeaturePilot" }>,
  actorId: string,
): Promise<Response> {
  const { data: feature, error: featureError } = await admin
    .from("feature_catalog")
    .select("key")
    .eq("key", action.featureKey)
    .maybeSingle();
  if (featureError)
    return json(request, { error: { code: "feature_lookup_failed" } }, 500);
  if (!feature)
    return json(request, { error: { code: "feature_not_found" } }, 422);

  const { data: existing, error: existingError } = await admin
    .from("tenant_feature_flags")
    .select("enabled")
    .eq("tenant_id", action.tenantId)
    .eq("feature_key", action.featureKey)
    .maybeSingle();
  if (existingError)
    return json(request, { error: { code: "feature_read_failed" } }, 500);

  const pilotEndsAt = action.pilotEndDate
    ? `${action.pilotEndDate}T23:59:59Z`
    : null;
  const { error } = await admin.from("tenant_feature_flags").upsert(
    {
      tenant_id: action.tenantId,
      feature_key: action.featureKey,
      // Creating a pilot deliberately enables only the named module. Clearing a
      // pilot preserves the current manual switch position.
      enabled: pilotEndsAt !== null ? true : existing?.enabled === true,
      pilot_ends_at: pilotEndsAt,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,feature_key" },
  );
  if (error)
    return json(request, { error: { code: "feature_pilot_save_failed" } }, 422);

  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "tenant.feature.pilot_updated",
      "tenant_feature_flag",
      { feature_key: action.featureKey, pilot_ends_at: pilotEndsAt },
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { updated: true, pilotEndsAt } });
}

async function handleListUsers(
  admin: any,
  request: Request,
  tenantId: string,
): Promise<Response> {
  const { data: memberships, error: membershipsError } = await admin
    .from("tenant_memberships")
    .select("user_id, status, joined_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (membershipsError) {
    return json(request, { error: { code: "user_list_failed" } }, 500);
  }

  const rows = (memberships ?? []) as Array<{
    user_id: string;
    status: string;
    joined_at: string | null;
  }>;
  const profilesResult =
    rows.length === 0
      ? { data: [], error: null }
      : await admin
          .from("user_profiles")
          .select("id, display_name")
          .in(
            "id",
            rows.map((row) => row.user_id),
          );
  if (profilesResult.error) {
    return json(request, { error: { code: "user_list_failed" } }, 500);
  }
  const displayNames = new Map(
    (
      (profilesResult.data ?? []) as Array<{
        id: string;
        display_name: string | null;
      }>
    ).map((profile) => [profile.id, profile.display_name]),
  );

  const users = await Promise.all(
    rows.map(async (membership) => {
      const { data, error } = await admin.auth.admin.getUserById(
        membership.user_id,
      );
      const user = error ? null : data.user;
      return {
        id: membership.user_id,
        email: user?.email ?? null,
        display_name: displayNames.get(membership.user_id) ?? null,
        status: membership.status,
        joined_at: membership.joined_at,
      };
    }),
  );

  return json(request, { data: { users, truncated: rows.length === 200 } });
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const body = await parseJsonObject(request);
  const action = body ? parseAction(body) : null;
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const denied = await authorize(
    context.supabaseAdmin,
    request,
    actorId,
    action.tenantId,
  );
  if (denied) return denied;

  if (action.type === "getSettings") {
    return handleGetSettings(context.supabaseAdmin, request, action.tenantId);
  }
  if (action.type === "uploadBrandingLogo") {
    return handleUploadBrandingLogo(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }
  if (action.type === "updateBranding") {
    return handleUpdateBranding(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }
  if (action.type === "updateSsoConfiguration") {
    return handleUpdateSsoConfiguration(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }
  if (action.type === "toggleFeature") {
    return handleToggleFeature(context.supabaseAdmin, request, action, actorId);
  }
  if (action.type === "setFeaturePilot") {
    return handleSetFeaturePilot(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }
  if (action.type === "listUsers") {
    return handleListUsers(context.supabaseAdmin, request, action.tenantId);
  }
  if (action.type === "listDepartments") {
    return handleListDepartments(
      context.supabaseAdmin,
      request,
      action.tenantId,
    );
  }
  if (action.type === "saveDepartment") {
    return handleSaveDepartment(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }
  if (action.type === "archiveDepartment") {
    return handleArchiveDepartment(
      context.supabaseAdmin,
      request,
      action,
      actorId,
    );
  }

  const roles = await listSafeRoles(context.supabaseAdmin, action.tenantId);
  if (roles.error) {
    return json(request, { error: { code: "role_list_failed" } }, 500);
  }
  return json(request, { data: { roles: roles.roles ?? [] } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS" ? noContent(request) : handler(request);
  },
};
