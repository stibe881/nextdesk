// Graph access token for the tenant's customer Entra tenant (Intune
// connection), used by license reclamation.

import {
  type FetchLike,
  type IntuneGraphCredentials,
  readIntuneGraphCredentials,
} from "./intune-managed-devices-graph.ts";
import {
  IntuneActionError,
  requestIntuneActionAccessToken,
} from "./intune-device-actions-graph.ts";
import {
  SoftwareDeployError,
  type SoftwareDeployErrorCode,
} from "./intune-software-graph.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

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
export async function entraGraphAccessToken(
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
