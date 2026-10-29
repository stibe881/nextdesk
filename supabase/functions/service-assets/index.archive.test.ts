import { parseAction } from "./index.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";

Deno.test(
  "Service-Archivzugriff verlangt die serverseitige Verwaltungsgrenze und Restore bleibt eine exklusive Aktion",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    const rlsMigration = await Deno.readTextFile(
      new URL(
        "../../migrations/0142_service_archive_visibility_and_restore.sql",
        import.meta.url,
      ),
    );

    for (const required of [
      '"includeArchivedServices"',
      "includeArchivedServices: value.includeArchivedServices === true",
      "action.includeArchivedServices && assetManage.data",
      "canManageServices: assetManage.data",
      'operation === "restore"',
      "? { active: false, status_public: false }",
      "? { active: true }",
    ]) {
      if (!source.includes(required)) {
        throw new Error(`Missing archive security boundary: ${required}`);
      }
    }
    const serviceFields = source.slice(
      source.indexOf("const SERVICE_FIELDS"),
      source.indexOf("const ASSET_FIELDS"),
    );
    if (/active:\s*\{\s*column:\s*"active"/.test(serviceFields)) {
      throw new Error(
        "Normal service updates must not accept an active field.",
      );
    }
    for (const required of [
      "drop policy if exists services_select_member",
      "public.is_active_tenant_member(tenant_id)",
      "public.is_asset_management_client_enabled(tenant_id)",
      "or public.has_tenant_permission(tenant_id, 'asset.manage')",
    ]) {
      if (!rlsMigration.includes(required)) {
        throw new Error(`Missing archived-service RLS boundary: ${required}`);
      }
    }
  },
);

Deno.test("Service-Restore akzeptiert nur die exklusive Id-Operation", () => {
  const restored = parseAction({
    type: "manageService",
    tenantId: TENANT_ID,
    operation: "restore",
    serviceId: SERVICE_ID,
  });
  if (
    restored?.type !== "manageService" ||
    restored.operation !== "restore" ||
    restored.id !== SERVICE_ID ||
    Object.keys(restored.values).length !== 0
  ) {
    throw new Error("A minimal service restore must be accepted unchanged.");
  }

  const updateWithActive = parseAction({
    type: "manageService",
    tenantId: TENANT_ID,
    operation: "update",
    serviceId: SERVICE_ID,
    active: true,
  });
  if (updateWithActive !== null) {
    throw new Error("A normal service update must not reactivate a service.");
  }

  const restoreWithFields = parseAction({
    type: "manageService",
    tenantId: TENANT_ID,
    operation: "restore",
    serviceId: SERVICE_ID,
    active: true,
  });
  if (restoreWithFields !== null) {
    throw new Error("A service restore must not accept writable fields.");
  }
});
