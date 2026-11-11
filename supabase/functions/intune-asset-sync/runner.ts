import { type SupabaseContext } from "@supabase/server";
import {
  type IntuneManagedDevice,
  IntuneGraphError,
  readIntuneGraphCredentials,
  readIntuneManagedDevices,
  requestIntuneGraphAccessToken,
  withoutNetwork,
} from "../_shared/intune-managed-devices-graph.ts";

// Gemeinsamer Ablauf des Intune-Asset-Abgleichs für den manuellen Start
// (intune-asset-sync) und den täglichen Abgleich (intune-scheduled-sync).

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type AdminClient = SupabaseContext["supabaseAdmin"];

export type SyncAction = {
  tenantId: string;
  mode: "dry_run" | "synchronize";
  clientRequestId: string;
  retryOfRunId: string | null;
};

export type SyncOptions = {
  includeNetwork?: boolean;
  onNetworkDevices?: (devices: IntuneManagedDevice[]) => void;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function databaseFailure(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new HttpError(
        403,
        "asset_integration_manage_required",
        "Die Berechtigung fehlt.",
      );
    case "22023":
    case "22P02":
    case "23514":
      throw new HttpError(422, "invalid_request", "Die Anfrage ist ungültig.");
    case "P0001":
      throw new HttpError(
        409,
        "intune_manual_sync_not_ready",
        "Der manuelle Intune-Abgleich ist noch nicht bereit.",
      );
    case "P0002":
      throw new HttpError(
        409,
        "intune_manual_sync_invalidated",
        "Der manuelle Intune-Abgleich ist nicht mehr gültig.",
      );
    default:
      throw new HttpError(
        503,
        "intune_manual_sync_service_unavailable",
        "Der manuelle Intune-Abgleich ist derzeit nicht verfügbar.",
      );
  }
}

function asRow(value: unknown, code: string): Row {
  if (!isRecord(value)) {
    throw new HttpError(
      503,
      code,
      "Die sichere Serverantwort ist unvollständig.",
    );
  }
  return value;
}

async function failRun(
  admin: AdminClient,
  tenantId: string,
  runId: string,
  resultCode:
    | "provider_not_configured"
    | "provider_unavailable"
    | "provider_rate_limited"
    | "provider_payload_invalid"
    | "run_invalidated"
    | "run_expired",
): Promise<void> {
  const failed = await admin.rpc("fail_asset_intune_manual_sync_run", {
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_result_code: resultCode,
  });
  if (failed.error) {
    throw new HttpError(
      503,
      "intune_manual_sync_cleanup_failed",
      "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
    );
  }
}

async function renewFence(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  runId: string,
  configurationGeneration: number,
  manualSyncGeneration: number,
): Promise<void> {
  const renewed = await admin.rpc("renew_asset_intune_manual_sync_fence", {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_configuration_generation: configurationGeneration,
    p_manual_sync_generation: manualSyncGeneration,
  });
  if (renewed.error) databaseFailure(renewed.error);
}

const ASSET_DEPARTMENT_BATCH_SIZE = 100;

// Assets created by a synchronize run (in the database function, without a
// department) go to the tenant's ICT department. Only links created during
// this run and only assets still without a department are touched, so
// existing linked assets keep their department. Best effort: the run has
// already succeeded, and assets without a department stay visible to everyone
// with the module.
async function assignNewAssetsToIctDepartment(
  admin: AdminClient,
  tenantId: string,
  completedRun: Row,
): Promise<void> {
  if (
    typeof completedRun.assets_created !== "number" ||
    completedRun.assets_created <= 0 ||
    typeof completedRun.started_at !== "string"
  ) {
    return;
  }
  try {
    const { data: department } = await admin
      .from("departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "ict")
      .limit(1)
      .maybeSingle();
    if (!isUuid(department?.id)) return;
    const { data: links } = await admin
      .from("asset_intune_asset_links")
      .select("asset_id")
      .eq("tenant_id", tenantId)
      .gte("created_at", completedRun.started_at);
    const assetIds = ((links ?? []) as Row[]).flatMap((link) =>
      isUuid(link.asset_id) ? [link.asset_id] : [],
    );
    for (
      let index = 0;
      index < assetIds.length;
      index += ASSET_DEPARTMENT_BATCH_SIZE
    ) {
      await admin
        .from("assets")
        .update({ department_id: department.id })
        .eq("tenant_id", tenantId)
        .is("department_id", null)
        .in("id", assetIds.slice(index, index + ASSET_DEPARTMENT_BATCH_SIZE));
    }
  } catch {
    // The synchronized assets remain without a department.
  }
}

/**
 * Führt einen Intune-Asset-Abgleich aus (manuell oder nach Zeitplan). Mit
 * includeNetwork liest derselbe Graph-Abruf auch die MAC-Adressen für die
 * IP-Adressverwaltung; sie gehen an onNetworkDevices, nie ins Asset-Staging.
 */
export async function runIntuneAssetSync(
  admin: AdminClient,
  actorId: string,
  action: SyncAction,
  options: SyncOptions = {},
): Promise<{ run: Row; reused: boolean }> {
  const claimResult = await admin.rpc("claim_asset_intune_manual_sync_run", {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_mode: action.mode,
    p_retry_of_run_id: action.retryOfRunId,
  });
  if (claimResult.error) databaseFailure(claimResult.error);
  const claim = asRow(
    Array.isArray(claimResult.data) ? claimResult.data[0] : null,
    "intune_manual_sync_service_unavailable",
  );
  if (typeof claim.outcome !== "string" || typeof claim.id !== "string") {
    throw new HttpError(
      503,
      "intune_manual_sync_service_unavailable",
      "Der manuelle Intune-Abgleich konnte nicht sicher gestartet werden.",
    );
  }
  if (claim.outcome === "existing") {
    return { run: claim, reused: true };
  }
  if (claim.outcome === "in_progress") {
    throw new HttpError(
      409,
      "intune_manual_sync_in_progress",
      "Für diesen Mandanten läuft bereits ein manueller Intune-Abgleich.",
    );
  }
  if (claim.outcome === "blocked") {
    throw new HttpError(
      409,
      "intune_manual_sync_not_ready",
      "Der manuelle Intune-Abgleich ist für diese Konfiguration noch nicht bereit.",
    );
  }
  if (
    claim.outcome !== "claimed" ||
    !isUuid(claim.entra_tenant_id) ||
    typeof claim.configuration_generation !== "number" ||
    typeof claim.manual_sync_generation !== "number"
  ) {
    throw new HttpError(
      503,
      "intune_manual_sync_service_unavailable",
      "Der manuelle Intune-Abgleich konnte nicht sicher gestartet werden.",
    );
  }

  const runId = claim.id;
  const entraTenantId = claim.entra_tenant_id;
  const configurationGeneration = claim.configuration_generation;
  const manualSyncGeneration = claim.manual_sync_generation;
  const credentials = readIntuneGraphCredentials();
  if (!credentials) {
    try {
      await failRun(admin, action.tenantId, runId, "provider_not_configured");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "intune_manual_sync_cleanup_failed",
        "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
      );
    }
    throw new HttpError(
      503,
      "intune_provider_not_configured",
      "Die serverseitige Intune-Anbindung ist noch nicht vollständig eingerichtet.",
    );
  }

  try {
    await renewFence(
      admin,
      actorId,
      action.tenantId,
      runId,
      configurationGeneration,
      manualSyncGeneration,
    );
    const accessToken = await requestIntuneGraphAccessToken(
      entraTenantId,
      credentials,
    );
    const contact = await admin.rpc(
      "mark_asset_intune_manual_sync_provider_contact",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_run_id: runId,
        p_configuration_generation: configurationGeneration,
        p_manual_sync_generation: manualSyncGeneration,
      },
    );
    if (contact.error) databaseFailure(contact.error);
    await readIntuneManagedDevices(
      accessToken,
      async (pageDevices) => {
        if (pageDevices.length === 0) return;
        if (options.includeNetwork) options.onNetworkDevices?.(pageDevices);
        const devices = pageDevices.map(withoutNetwork);
        const staged = await admin.rpc(
          "stage_asset_intune_manual_sync_devices",
          {
            p_actor_id: actorId,
            p_tenant_id: action.tenantId,
            p_run_id: runId,
            p_configuration_generation: configurationGeneration,
            p_manual_sync_generation: manualSyncGeneration,
            p_devices: devices,
          },
        );
        if (staged.error) databaseFailure(staged.error);
      },
      fetch,
      async () => {
        await renewFence(
          admin,
          actorId,
          action.tenantId,
          runId,
          configurationGeneration,
          manualSyncGeneration,
        );
      },
      { includeNetwork: options.includeNetwork === true },
    );
    const completed = await admin.rpc("complete_asset_intune_manual_sync_run", {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_run_id: runId,
      p_configuration_generation: configurationGeneration,
      p_manual_sync_generation: manualSyncGeneration,
    });
    if (completed.error) databaseFailure(completed.error);
    const completedRun = asRow(
      Array.isArray(completed.data) ? completed.data[0] : null,
      "intune_manual_sync_service_unavailable",
    );
    if (action.mode === "synchronize") {
      await assignNewAssetsToIctDepartment(
        admin,
        action.tenantId,
        completedRun,
      );
    }
    return { run: completedRun, reused: false };
  } catch (error) {
    const resultCode =
      error instanceof IntuneGraphError
        ? error.code
        : error instanceof HttpError &&
            error.code === "intune_manual_sync_invalidated"
          ? "run_invalidated"
          : "provider_unavailable";
    try {
      await failRun(admin, action.tenantId, runId, resultCode);
    } catch (cleanupError) {
      if (cleanupError instanceof HttpError) throw cleanupError;
      throw new HttpError(
        503,
        "intune_manual_sync_cleanup_failed",
        "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
      );
    }
    if (error instanceof HttpError) throw error;
    if (error instanceof IntuneGraphError) {
      const code =
        error.code === "provider_rate_limited"
          ? "intune_provider_rate_limited"
          : error.code === "provider_payload_invalid"
            ? "intune_provider_response_invalid"
            : "intune_provider_unavailable";
      throw new HttpError(
        error.code === "provider_rate_limited" ? 429 : 503,
        code,
        "Microsoft Intune konnte nicht sicher verarbeitet werden.",
      );
    }
    throw new HttpError(
      503,
      "intune_provider_unavailable",
      "Microsoft Intune ist derzeit nicht verfügbar.",
    );
  }
}
