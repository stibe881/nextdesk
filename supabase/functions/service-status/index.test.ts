Deno.test(
  "Service status protects publication and keeps the public contract minimal",
  async () => {
    const [internalSource, publicSource, config, migration] = await Promise.all(
      [
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
      ],
    );

    for (const required of [
      "await requireActiveMembership(context.supabase, action.tenantId)",
      "await requireAssetFeature(context.supabaseAdmin, action.tenantId)",
      'await requirePermission(context.supabase, action.tenantId, "asset.manage")',
      '"tenant.settings.manage"',
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

    for (const required of [
      '.eq("public_enabled", true)',
      '.eq("status_public", true)',
      '.eq("active", true)',
      'select("id, name, status, updated_at")',
      'select("service_id, status, changed_at")',
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

    const publicProjection = publicSource.slice(
      publicSource.indexOf("const publicServices: PublicService[]"),
      publicSource.indexOf(
        "return {",
        publicSource.indexOf("const publicServices: PublicService[]"),
      ),
    );
    for (const forbidden of ["description", "changed_by", "tenant_id"]) {
      if (publicProjection.includes(forbidden)) {
        throw new Error(`The public service projection exposes ${forbidden}`);
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
      if (!migration.includes(required)) {
        throw new Error(
          `The status migration lost its required hardening: ${required}`,
        );
      }
    }
  },
);
