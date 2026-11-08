// Software articles: Intune link of a catalog item and the deployment of
// approved orders (see migration 0231 and _shared/intune-software-graph.ts).

import {
  type FetchLike,
  type IntuneGraphCredentials,
  readIntuneGraphCredentials,
} from "../_shared/intune-managed-devices-graph.ts";
import {
  IntuneActionError,
  requestIntuneActionAccessToken,
} from "../_shared/intune-device-actions-graph.ts";
import {
  deploySoftware,
  isGuid,
  type SoftwareAssignmentMode,
  SoftwareDeployError,
  type SoftwareDeployErrorCode,
  softwareDeployErrorMessage,
} from "../_shared/intune-software-graph.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type SoftwareLink = {
  appId: string;
  appName: string | null;
  mode: SoftwareAssignmentMode;
  groupId: string;
  ensureAppAssignment: boolean;
};

/**
 * Parses the `software` field of a catalog item. undefined: not sent (keep);
 * null: no software; false: invalid.
 */
export function parseSoftwareLink(
  value: unknown,
): SoftwareLink | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Row;
  const mode =
    input.mode === "device_group"
      ? "device_group"
      : input.mode === "user_group" || input.mode === undefined
        ? "user_group"
        : null;
  const appName =
    typeof input.appName === "string" && input.appName.trim()
      ? input.appName.trim().slice(0, 240)
      : null;
  if (
    !isGuid(input.appId) ||
    !isGuid(input.groupId) ||
    !mode ||
    (input.ensureAppAssignment !== undefined &&
      typeof input.ensureAppAssignment !== "boolean")
  ) {
    return false;
  }
  return {
    appId: input.appId.toLowerCase(),
    appName,
    mode,
    groupId: input.groupId.toLowerCase(),
    ensureAppAssignment: input.ensureAppAssignment === true,
  };
}

/** Database columns for a software link (null clears it). */
export function softwareColumns(link: SoftwareLink | null): Row {
  return {
    intune_app_id: link?.appId ?? null,
    intune_app_name: link?.appName ?? null,
    intune_assignment_mode: link?.mode ?? null,
    intune_target_group_id: link?.groupId ?? null,
    intune_ensure_app_assignment: link?.ensureAppAssignment ?? false,
  };
}

/** Software link of a catalog row (agents only). */
export function softwareFromRow(row: Row): SoftwareLink | null {
  if (!isGuid(row.intune_app_id) || !isGuid(row.intune_target_group_id)) {
    return null;
  }
  return {
    appId: row.intune_app_id,
    appName:
      typeof row.intune_app_name === "string" ? row.intune_app_name : null,
    mode:
      row.intune_assignment_mode === "device_group"
        ? "device_group"
        : "user_group",
    groupId: row.intune_target_group_id,
    ensureAppAssignment: row.intune_ensure_app_assignment === true,
  };
}

function tokenErrorCode(error: unknown): SoftwareDeployErrorCode {
  if (error instanceof IntuneActionError) {
    if (error.code === "consent_missing") return "consent_missing";
    if (error.code === "provider_not_configured") {
      return "provider_not_configured";
    }
    if (error.code === "rate_limited") return "rate_limited";
  }
  return "provider_unavailable";
}

/** Access token for the tenant's Entra tenant (Intune connection). */
export async function softwareAccessToken(
  admin: Admin,
  tenantId: string,
  options: {
    fetchImpl?: FetchLike;
    credentials?: IntuneGraphCredentials | null;
  } = {},
): Promise<string> {
  const credentials =
    options.credentials === undefined
      ? readIntuneGraphCredentials()
      : options.credentials;
  if (!credentials) throw new SoftwareDeployError("provider_not_configured");
  const { data: entraTenant, error } = await admin.rpc(
    "intune_device_action_entra_tenant",
    { p_tenant_id: tenantId },
  );
  if (error || typeof entraTenant !== "string") {
    throw new SoftwareDeployError("provider_not_configured");
  }
  try {
    return await requestIntuneActionAccessToken(
      entraTenant,
      credentials,
      options.fetchImpl ?? fetch,
    );
  } catch (tokenError) {
    throw new SoftwareDeployError(tokenErrorCode(tokenError));
  }
}

export type DeploymentOutcome = {
  deploymentId: string;
  status: "assigned" | "failed";
  errorCode: SoftwareDeployErrorCode | null;
};

/**
 * Claims the pending deployments of an order, assigns them through Graph
 * and records each result (order event, notification). Never throws.
 */
export async function runSoftwareDeployments(
  admin: Admin,
  tenantId: string,
  orderId: string,
  options: {
    fetchImpl?: FetchLike;
    credentials?: IntuneGraphCredentials | null;
  } = {},
): Promise<DeploymentOutcome[]> {
  const { data, error } = await admin.rpc("shop_software_deployments_claim", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
  });
  if (error) {
    console.error("Software deployments could not be claimed", error.code);
    return [];
  }
  const claimed = (Array.isArray(data) ? data : []) as Row[];
  if (claimed.length === 0) return [];

  let token: string | null = null;
  let tokenError: SoftwareDeployErrorCode | null = null;
  try {
    token = await softwareAccessToken(admin, tenantId, options);
  } catch (failure) {
    tokenError =
      failure instanceof SoftwareDeployError
        ? failure.code
        : "provider_unavailable";
  }

  const outcomes: DeploymentOutcome[] = [];
  for (const row of claimed) {
    const deploymentId = String(row.deployment_id);
    const userObjectId = isGuid(row.entra_object_id)
      ? row.entra_object_id
      : null;
    let success = false;
    let membersAdded = 0;
    let code: SoftwareDeployErrorCode | null = null;
    try {
      if (tokenError || !token) {
        throw new SoftwareDeployError(tokenError ?? "provider_unavailable");
      }
      const result = await deploySoftware(
        {
          appId: String(row.intune_app_id),
          mode:
            row.assignment_mode === "device_group"
              ? "device_group"
              : "user_group",
          groupId: String(row.target_group_id),
          ensureAppAssignment: row.ensure_app_assignment === true,
          userObjectId,
        },
        token,
        options.fetchImpl ?? fetch,
      );
      success = true;
      membersAdded = result.membersAdded;
    } catch (failure) {
      code =
        failure instanceof SoftwareDeployError
          ? failure.code
          : "provider_unavailable";
    }
    const { error: recordError } = await admin.rpc(
      "shop_software_deployment_record",
      {
        p_tenant_id: tenantId,
        p_deployment_id: deploymentId,
        p_success: success,
        p_entra_object_id: userObjectId,
        p_members_added: membersAdded,
        p_error_code: code,
        p_error_message: code ? softwareDeployErrorMessage(code) : null,
      },
    );
    if (recordError) {
      console.error("Software deployment result not saved", recordError.code);
    }
    outcomes.push({
      deploymentId,
      status: success ? "assigned" : "failed",
      errorCode: code,
    });
  }
  return outcomes;
}

/**
 * Runs the deployments after the response when the Edge runtime supports
 * background work, otherwise waits for them.
 */
export async function scheduleSoftwareDeployments(
  admin: Admin,
  tenantId: string,
  orderId: string,
): Promise<void> {
  const work = runSoftwareDeployments(admin, tenantId, orderId).catch(() => []);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
    return;
  }
  await work;
}
