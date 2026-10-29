Deno.test(
  "Service status protects publication, atomic maintenance administration and public contracts",
  async () => {
    const [
      internalSource,
      publicSource,
      config,
      statusMigration,
      maintenanceMigration,
      atomicMaintenanceMigration,
    ] = await Promise.all([
      Deno.readTextFile(new URL("./index.ts", import.meta.url)),
      Deno.readTextFile(
        new URL("../service-status-public/index.ts", import.meta.url),
      ),
      Deno.readTextFile(new URL("../../config.toml", import.meta.url)),
      Deno.readTextFile(
        new URL(
          "../../migrations/0106_service_status_page.sql",
          import.meta.url,
        ),
      ),
      Deno.readTextFile(
        new URL(
          "../../migrations/0113_service_status_maintenance.sql",
          import.meta.url,
        ),
      ),
      Deno.readTextFile(
        new URL(
          "../../migrations/0114_atomic_service_status_maintenance.sql",
          import.meta.url,
        ),
      ),
    ]);

    for (const required of [
      "await requireActiveMembership(context.supabase, action.tenantId)",
      "await requireAssetFeature(context.supabase, action.tenantId)",
      'await requirePermission(context.supabase, action.tenantId, "asset.manage")',
      'type: "manageMaintenance"',
      'operation: "create" | "update"',
      'if (value.operation === "update") allowedKeys.push("maintenanceId")',
      "function parseIsoTimestamp",
      "function parseServiceIds",
      "MAX_MAINTENANCES = 500",
      "MAX_MAINTENANCE_SERVICES = 100",
      "async function readMaintenances",
      "async function manageMaintenance",
      'admin.rpc("save_service_status_maintenance"',
      'result.error.code === "P0002"',
      'result.error.code === "42501"',
      '"maintenance_validation_failed"',
      'type: "rotateStatusPageId"',
      "await rotatePage(context.supabaseAdmin, actorId, action.tenantId)",
      '"service_status_page.updated"',
      '"service_status_page.rotated"',
      "status, status_public",
    ]) {
      if (!internalSource.includes(required)) {
        throw new Error(
          `The internal status contract lost its fence: ${required}`,
        );
      }
    }

    const handlerSource = internalSource.slice(
      internalSource.indexOf("const handler = withSupabase"),
    );
    const authorizationEnd = handlerSource.indexOf(
      'await requirePermission(context.supabase, action.tenantId, "asset.manage")',
    );
    const maintenanceRpc = handlerSource.indexOf("await manageMaintenance(");
    if (
      authorizationEnd < 0 ||
      maintenanceRpc < 0 ||
      authorizationEnd > maintenanceRpc
    ) {
      throw new Error(
        "Maintenance RPC calls must remain after membership, feature and asset permission checks.",
      );
    }

    const maintenanceMutation = internalSource.slice(
      internalSource.indexOf("async function manageMaintenance"),
      internalSource.indexOf("const handler = withSupabase"),
    );
    for (const forbidden of [
      '.from("service_status_maintenances")',
      '.from("service_status_maintenance_services")',
      "await writeAudit(",
      "await requirePermission(",
    ]) {
      if (maintenanceMutation.includes(forbidden)) {
        throw new Error(
          `Maintenance mutations must use only the atomic RPC, not ${forbidden}.`,
        );
      }
    }

    for (const required of [
      "create or replace function public.save_service_status_maintenance(",
      "security definer",
      "set search_path = pg_catalog, public, pg_temp",
      "p_maintenance_id uuid",
      "for update",
      "for share",
      "maintenance.tenant_id = p_tenant_id",
      "service.tenant_id = p_tenant_id",
      "public.user_has_tenant_permission(",
      "v_maintenance.public_enabled",
      "delete from public.service_status_maintenance_services",
      "insert into public.service_status_maintenance_services",
      "insert into public.audit_logs",
      "'source', 'service_status'",
      "'state', p_state",
      "'publicEnabled', p_public_enabled",
      "'serviceCount', v_requested_service_count",
      "revoke all on function public.save_service_status_maintenance(",
      ") from public, anon, authenticated;",
      ") to service_role;",
    ]) {
      if (!atomicMaintenanceMigration.includes(required)) {
        throw new Error(
          `The atomic maintenance RPC lost its required fence: ${required}`,
        );
      }
    }
    const maintenanceAudit = atomicMaintenanceMigration.slice(
      atomicMaintenanceMigration.indexOf("insert into public.audit_logs"),
      atomicMaintenanceMigration.indexOf("return v_maintenance.id;"),
    );
    for (const forbidden of [
      "p_title",
      "p_description",
      "before_data",
      "after_data",
    ]) {
      if (maintenanceAudit.includes(forbidden)) {
        throw new Error(
          `Maintenance audit data must not contain ${forbidden}.`,
        );
      }
    }

    for (const required of [
      '.eq("public_enabled", true)',
      '.in("state", [...PUBLIC_MAINTENANCE_STATES])',
      '.gte("ends_at", now)',
      '.eq("status_public", true)',
      '.eq("active", true)',
      'select("id, name, status, updated_at")',
      'select("service_id, status, changed_at")',
      'select("id, title, description, starts_at, ends_at, state")',
      'select("maintenance_id, service_id")',
      "function hasActivePublicMaintenance",
      "function isCurrentPublicMaintenance",
      "activeServiceIds",
      "displayStatus",
      'height="32"',
      "MAX_PUBLIC_MAINTENANCES = 100",
      "MAX_MAINTENANCE_SERVICES = 100",
      "Cross-Origin-Resource-Policy",
      '"Cache-Control": "no-store, max-age=0"',
      'headers.set("Access-Control-Allow-Origin", "*")',
      "const isBadgeRequest",
      'searchParams.get("format") === "badge"',
      "service_status_history_baselines",
      'format !== "page" && format !== "badge"',
      "function unavailableBadge",
    ]) {
      if (!publicSource.includes(required)) {
        throw new Error(
          `The public status contract lost its privacy fence: ${required}`,
        );
      }
    }
    if (publicSource.includes('fill="#174260"')) {
      throw new Error("The public status badge must not render a blue outer background.");
    }

    const publicServiceProjection = publicSource.slice(
      publicSource.indexOf("const publicServices: PublicService[]"),
      publicSource.indexOf(
        "return {",
        publicSource.indexOf("const publicServices: PublicService[]"),
      ),
    );
    for (const forbidden of ["description", "changed_by", "tenant_id"]) {
      if (publicServiceProjection.includes(forbidden)) {
        throw new Error(`The public service projection exposes ${forbidden}`);
      }
    }

    const publicMaintenanceType = publicSource.slice(
      publicSource.indexOf("type PublicMaintenance ="),
      publicSource.indexOf("type PublicStatusPayload"),
    );
    for (const forbidden of [
      "id:",
      "tenantId",
      "tenant_id",
      "createdAt",
      "updatedAt",
      "audit",
    ]) {
      if (publicMaintenanceType.includes(forbidden)) {
        throw new Error(
          `The public maintenance contract exposes ${forbidden}.`,
        );
      }
    }
    for (const required of [
      "title: string;",
      "description: string | null;",
      "startsAt: string;",
      "endsAt: string;",
      "state: PublicMaintenanceState;",
      "serviceNames: string[];",
    ]) {
      if (!publicMaintenanceType.includes(required)) {
        throw new Error(`The public maintenance contract lost ${required}.`);
      }
    }

    if (!config.includes("[functions.service-status]\nverify_jwt = true")) {
      throw new Error(
        "The internal service status function must require a user JWT.",
      );
    }
    if (
      !config.includes("[functions.service-status-public]\nverify_jwt = false")
    ) {
      throw new Error(
        "The public service status endpoint must be explicitly configured.",
      );
    }

    for (const required of [
      "create table if not exists public.service_status_events",
      "create table if not exists public.service_status_pages",
      "alter table public.service_status_events force row level security",
      "alter table public.service_status_pages force row level security",
      "create trigger services_status_history",
      "create or replace function public.service_status_history_baselines",
      "grant execute on function public.service_status_history_baselines(uuid, uuid[], timestamptz)",
      "revoke all on table public.service_status_events, public.service_status_pages",
    ]) {
      if (!statusMigration.includes(required)) {
        throw new Error(
          `The status migration lost its required hardening: ${required}`,
        );
      }
    }

    for (const required of [
      "create table if not exists public.service_status_maintenances",
      "create table if not exists public.service_status_maintenance_services",
      "state in ('scheduled', 'active', 'completed', 'cancelled')",
      "public_enabled boolean not null default false",
      "constraint service_status_maintenances_time_valid check (ends_at > starts_at)",
      "foreign key (maintenance_id, tenant_id)",
      "references public.service_status_maintenances (id, tenant_id)",
      "foreign key (service_id, tenant_id)",
      "references public.services (id, tenant_id)",
      "service_status_maintenances_tenant_window_idx",
      "service_status_maintenances_public_window_idx",
      "alter table public.service_status_maintenances force row level security",
      "alter table public.service_status_maintenance_services force row level security",
      "revoke all on table public.service_status_maintenances,",
      "to service_role",
      "create trigger service_status_maintenances_updated_at",
    ]) {
      if (!maintenanceMigration.includes(required)) {
        throw new Error(
          `The maintenance migration lost its required hardening: ${required}`,
        );
      }
    }
    if (maintenanceMigration.includes("create policy")) {
      throw new Error(
        "Maintenance tables must not grant direct browser policies.",
      );
    }
  },
);
