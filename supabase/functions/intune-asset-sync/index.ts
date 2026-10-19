import { withSupabase, type SupabaseContext } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type Admin = SupabaseContext["supabaseAdmin"];
type Invocation = { tenantId: string | null; dryRun: boolean };
type ManagedDevice = {
  id: string;
  deviceName?: string | null;
  managedDeviceName?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  operatingSystem?: string | null;
  osVersion?: string | null;
  userDisplayName?: string | null;
  userPrincipalName?: string | null;
  complianceState?: string | null;
  isEncrypted?: boolean | null;
  lastSyncDateTime?: string | null;
  lastLoggedOnDateTime?: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_SELECT = [
  "id",
  "deviceName",
  "managedDeviceName",
  "serialNumber",
  "manufacturer",
  "model",
  "operatingSystem",
  "osVersion",
  "userDisplayName",
  "userPrincipalName",
  "complianceState",
  "isEncrypted",
  "lastSyncDateTime",
  "lastLoggedOnDateTime",
].join(",");

function json(body: unknown, status = 200, requestId = crypto.randomUUID()) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

function parseInvocation(value: unknown): Invocation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => key === "tenantId" || key === "dryRun"))
    return null;
  if (
    raw.tenantId !== undefined &&
    raw.tenantId !== null &&
    (typeof raw.tenantId !== "string" || !UUID.test(raw.tenantId))
  )
    return null;
  if (raw.dryRun !== undefined && typeof raw.dryRun !== "boolean") return null;
  return {
    tenantId:
      typeof raw.tenantId === "string" ? raw.tenantId.toLowerCase() : null,
    dryRun: raw.dryRun === true,
  };
}

async function timingSafeEqual(
  expected: string,
  supplied: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const suppliedBytes = encoder.encode(supplied);
  if (expectedBytes.length !== suppliedBytes.length) return false;
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", expectedBytes),
    crypto.subtle.digest("SHA-256", suppliedBytes),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let result = 0;
  for (let index = 0; index < a.length; index += 1)
    result |= a[index] ^ b[index];
  return result === 0;
}

function nullableText(value: unknown, maximum = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed &&
    !trimmed.includes("\u0000") &&
    Array.from(trimmed).length <= maximum
    ? trimmed
    : null;
}

function validDevice(value: unknown): value is ManagedDevice {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    UUID.test((value as { id: string }).id)
  );
}

async function graphToken(directoryTenantId: string): Promise<string> {
  const clientId = Deno.env.get("INTUNE_GRAPH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("INTUNE_GRAPH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("intune_credentials_missing");
  const response = await fetch(
    `https://login.microsoftonline.com/${directoryTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  if (!response.ok) throw new Error("intune_token_request_failed");
  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
  } | null;
  if (
    !payload ||
    typeof payload.access_token !== "string" ||
    !payload.access_token
  )
    throw new Error("intune_token_invalid");
  return payload.access_token;
}

async function readDevices(token: string): Promise<ManagedDevice[]> {
  const devices: ManagedDevice[] = [];
  let next: string | null =
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${encodeURIComponent(GRAPH_SELECT)}&$top=100`;
  for (let page = 0; next && page < 100; page += 1) {
    const url = new URL(next);
    if (url.origin !== "https://graph.microsoft.com")
      throw new Error("intune_pagination_invalid");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("intune_graph_request_failed");
    const payload = (await response.json().catch(() => null)) as {
      value?: unknown;
      "@odata.nextLink"?: unknown;
    } | null;
    if (!payload || !Array.isArray(payload.value))
      throw new Error("intune_graph_response_invalid");
    for (const item of payload.value) if (validDevice(item)) devices.push(item);
    next =
      typeof payload["@odata.nextLink"] === "string"
        ? payload["@odata.nextLink"]
        : null;
  }
  if (next) throw new Error("intune_page_limit_reached");
  return devices;
}

async function writeDevice(
  admin: Admin,
  tenantId: string,
  device: ManagedDevice,
): Promise<"created" | "updated"> {
  const { data: existing, error: existingError } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("intune_device_id", device.id)
    .maybeSingle();
  if (existingError) throw existingError;
  const name =
    nullableText(device.deviceName, 300) ??
    nullableText(device.managedDeviceName, 300) ??
    `Intune-Gerät ${device.id.slice(0, 8)}`;
  const payload = {
    tenant_id: tenantId,
    name,
    kind: "managed-device",
    status: nullableText(device.complianceState, 120) ?? "unknown",
    active: true,
    intune_device_id: device.id,
    serial_number: nullableText(device.serialNumber, 160),
    manufacturer: nullableText(device.manufacturer, 160),
    model: nullableText(device.model, 160),
    operating_system: nullableText(device.operatingSystem, 160),
    intune_compliance_state: nullableText(device.complianceState, 120),
    intune_encrypted:
      typeof device.isEncrypted === "boolean" ? device.isEncrypted : null,
    intune_last_sync_at: nullableText(device.lastSyncDateTime),
    intune_last_seen_at: nullableText(device.lastLoggedOnDateTime),
    metadata: { source: "intune", external_device_id: device.id },
  };
  const assetRequest = existing
    ? admin
        .from("assets")
        .update(payload)
        .eq("tenant_id", tenantId)
        .eq("id", existing.id)
        .select("id")
        .single()
    : admin.from("assets").insert(payload).select("id").single();
  const { data: asset, error: assetError } = await assetRequest;
  if (assetError || !asset)
    throw assetError ?? new Error("asset_upsert_failed");
  const { error: snapshotError } = await admin
    .from("asset_intune_devices")
    .upsert(
      {
        tenant_id: tenantId,
        asset_id: asset.id,
        external_device_id: device.id,
        device_name: nullableText(device.deviceName, 300),
        managed_device_name: nullableText(device.managedDeviceName, 300),
        serial_number: nullableText(device.serialNumber, 160),
        manufacturer: nullableText(device.manufacturer, 160),
        model: nullableText(device.model, 160),
        operating_system: nullableText(device.operatingSystem, 160),
        os_version: nullableText(device.osVersion, 160),
        user_display_name: nullableText(device.userDisplayName, 300),
        user_principal_name: nullableText(device.userPrincipalName, 320),
        compliance_state: nullableText(device.complianceState, 120),
        is_encrypted:
          typeof device.isEncrypted === "boolean" ? device.isEncrypted : null,
        last_sync_at: nullableText(device.lastSyncDateTime),
        last_seen_at: nullableText(device.lastLoggedOnDateTime),
        snapshot: device,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,external_device_id" },
    );
  if (snapshotError) throw snapshotError;
  return existing ? "updated" : "created";
}

async function syncTenant(
  admin: Admin,
  tenantId: string,
  directoryTenantId: string,
  dryRun: boolean,
) {
  const { data: run, error: runError } = await admin
    .from("asset_intune_sync_runs")
    .insert({
      tenant_id: tenantId,
      mode: dryRun ? "dry_run" : "synchronize",
      status: "running",
    })
    .select("id")
    .single();
  if (runError || !run) throw runError ?? new Error("sync_run_create_failed");
  const startedAt = new Date().toISOString();
  await admin
    .from("asset_intune_connections")
    .update({
      last_attempt_at: startedAt,
      last_status: "running",
      last_error_code: null,
    })
    .eq("tenant_id", tenantId);
  try {
    const devices = await readDevices(await graphToken(directoryTenantId));
    let created = 0;
    let updated = 0;
    if (!dryRun) {
      for (const device of devices) {
        const outcome = await writeDevice(admin, tenantId, device);
        if (outcome === "created") created += 1;
        else updated += 1;
      }
    }
    const finishedAt = new Date().toISOString();
    await admin
      .from("asset_intune_sync_runs")
      .update({
        status: "succeeded",
        finished_at: finishedAt,
        devices_seen: devices.length,
        assets_created: created,
        assets_updated: updated,
      })
      .eq("id", run.id);
    await admin
      .from("asset_intune_connections")
      .update({
        last_status: "succeeded",
        last_success_at: finishedAt,
        last_error_code: null,
      })
      .eq("tenant_id", tenantId);
    return {
      tenantId,
      devicesSeen: devices.length,
      assetsCreated: created,
      assetsUpdated: updated,
    };
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "intune_sync_failed";
    const finishedAt = new Date().toISOString();
    await admin
      .from("asset_intune_sync_runs")
      .update({ status: "failed", finished_at: finishedAt, error_code: code })
      .eq("id", run.id);
    await admin
      .from("asset_intune_connections")
      .update({ last_status: "failed", last_error_code: code })
      .eq("tenant_id", tenantId);
    throw error;
  }
}

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    const requestId = crypto.randomUUID();
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "X-Request-Id": requestId },
      });
    const expected = Deno.env.get("INTUNE_ASSET_SYNC_SECRET");
    if (!expected)
      return json(
        { error: { code: "intune_sync_unavailable" } },
        503,
        requestId,
      );
    if (
      !(await timingSafeEqual(
        expected,
        request.headers.get("X-NextDesk-Intune-Sync-Secret") ?? "",
      ))
    ) {
      return json(
        { error: { code: "intune_sync_unauthorized" } },
        401,
        requestId,
      );
    }
    const invocation = parseInvocation(await request.json().catch(() => null));
    if (!invocation)
      return json({ error: { code: "invalid_request" } }, 422, requestId);
    const query = context.supabaseAdmin
      .from("asset_intune_connections")
      .select("tenant_id, directory_tenant_id")
      .eq("enabled", true)
      .eq("sync_enabled", true);
    const { data: connections, error } = invocation.tenantId
      ? await query.eq("tenant_id", invocation.tenantId)
      : await query;
    if (error)
      return json(
        { error: { code: "intune_connection_read_failed" } },
        500,
        requestId,
      );
    const enabledConnections = [];
    let skippedInactive = 0;
    for (const connection of connections ?? []) {
      const states = await resolveTenantFeatureStates(
        context.supabaseAdmin,
        connection.tenant_id,
        ["assets.management"],
      );
      if (states === null)
        return json(
          { error: { code: "tenant_feature_lookup_failed" } },
          503,
          requestId,
        );
      if (states["assets.management"] !== true) {
        skippedInactive += 1;
        continue;
      }
      enabledConnections.push(connection);
    }

    const results = [];
    for (const connection of enabledConnections) {
      if (!connection.directory_tenant_id) continue;
      results.push(
        await syncTenant(
          context.supabaseAdmin,
          connection.tenant_id,
          connection.directory_tenant_id,
          invocation.dryRun,
        ),
      );
    }
    console.info(
      JSON.stringify({
        event: "intune_asset_sync.run",
        requestId,
        tenants: results.length,
        dryRun: invocation.dryRun,
      }),
    );
    return json(
      {
        data: {
          dryRun: invocation.dryRun,
          tenants: results,
          skippedInactive,
        },
      },
      200,
      requestId,
    );
  },
);

export default { fetch: handler };
