import { functionErrorMessage } from "./function-error";
import { supabase } from "./supabase";

export type PushContentLevel = "minimal" | "subject";

export type PushDevice = {
  appBuild: string | null;
  appVersion: string | null;
  deviceName: string | null;
  disabledReason: string | null;
  enabled: boolean;
  id: string;
  lastRegisteredAt: string | null;
  lastSentAt: string | null;
};

export type PushStatus = {
  applicableCategories: string[];
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  devices: PushDevice[];
  featureEnabled: boolean;
  preferences: {
    enabledCategories: string[];
    quietEnd: number;
    quietHoursEnabled: boolean;
    quietStart: number;
    timezone: string;
  };
};

export type PushTenantSettings = {
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  featureEnabled: boolean;
  registeredDevices: number;
};

type FunctionEnvelope<T> = { data: T };

type PushNotificationsRequest =
  | { tenantId: string; type: "getStatus" }
  | { deviceId: string; tenantId: string; type: "unregisterDevice" }
  | { tenantId: string; type: "getTenantSettings" }
  | {
      contentLevel: PushContentLevel;
      tenantId: string;
      type: "updateTenantSettings";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Invokes the push-notifications Edge Function and keeps backend failures out
 * of tenant-facing screens. The function may not be deployed yet, so every
 * caller receives a concise German fallback rather than an uncaught error.
 */
export async function pushNotificationsRequest<T>(
  body: PushNotificationsRequest,
): Promise<T> {
  if (!supabase) {
    throw new Error("Push-Benachrichtigungen sind derzeit nicht verfügbar.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "push-notifications",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Push-Benachrichtigungen sind derzeit nicht verfügbar. Bitte versuche es später erneut.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Push-Benachrichtigungen haben keine verwertbaren Daten geliefert.",
    );
  }

  return data.data as T;
}
