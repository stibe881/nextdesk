import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  getMobileUserId,
  invokeNextDesk,
  loadCurrentTenant,
  nextDesk,
} from "@/lib/nextdesk-client";
import {
  NextDeskRequestError,
  nextDeskErrorMessage,
} from "@/lib/nextdesk-error-messages";

export const PUSH_CATEGORIES = [
  "assigned",
  "requester_reply",
  "support_reply",
  "mention",
  "resolved",
  "approval",
  "escalation",
  "sla",
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];
export type PushEnvironment = "development" | "production";
export type PushContentLevel = "minimal" | "subject";

export type PushPreferences = {
  enabledCategories: PushCategory[];
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  timezone: string;
};

export type PushDevice = {
  id: string;
  deviceName: string | null;
  appVersion: string | null;
  appBuild: string | null;
  enabled: boolean;
  disabledReason: string | null;
  lastRegisteredAt: string | null;
  lastSentAt: string | null;
};

export type PushNotificationStatus = {
  featureEnabled: boolean;
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  applicableCategories: PushCategory[];
  preferences: PushPreferences;
  devices: PushDevice[];
};

export type PushTenantSettings = {
  featureEnabled: boolean;
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  registeredDevices: number;
};

export type PushTestResult = {
  deviceId: string;
  status: "sent" | "failed" | "disabled";
  code?: string;
};

type PushAction =
  | { type: "getStatus"; tenantId: string }
  | {
      type: "registerDevice";
      tenantId: string;
      token: string;
      environment: PushEnvironment;
      appVersion?: string;
      appBuild?: string;
      deviceName?: string;
    }
  | {
      type: "unregisterDevice";
      tenantId: string;
      token?: string;
      deviceId?: string;
    }
  | {
      type: "updatePreferences";
      tenantId: string;
      enabledCategories: PushCategory[];
      quietHoursEnabled: boolean;
      quietStart: number;
      quietEnd: number;
      timezone: string;
    }
  | { type: "sendTest"; tenantId: string }
  | { type: "getTenantSettings"; tenantId: string }
  | {
      type: "updateTenantSettings";
      tenantId: string;
      contentLevel: PushContentLevel;
    };

type RegistrationContext = {
  tenantId: string;
  userId: string;
};

export type PushPermissionState =
  | "granted"
  | "denied"
  | "undetermined"
  | "unsupported";

const REGISTRATION_KEY_PREFIX = "nextdesk:push:registered:v1";
const APNS_TOKEN_PATTERN = /^[a-f0-9]{64,200}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataFromEnvelope<T>(value: unknown): T {
  if (isRecord(value) && isRecord(value.error)) {
    const code = typeof value.error.code === "string" ? value.error.code : null;
    throw new NextDeskRequestError(nextDeskErrorMessage(code), code);
  }
  if (!isRecord(value) || !("data" in value)) {
    throw new Error(
      "Die Antwort für Push-Benachrichtigungen ist unvollständig.",
    );
  }
  return value.data as T;
}

async function invokePushNotifications<T>(action: PushAction): Promise<T> {
  const response = await invokeNextDesk<unknown>("push-notifications", action);
  return dataFromEnvelope<T>(response);
}

function assertIos(): void {
  if (Platform.OS !== "ios") {
    throw new Error(
      "Push-Benachrichtigungen stehen nur in der nextDesk iPhone-App zur Verfügung.",
    );
  }
}

function registrationKey({ tenantId, userId }: RegistrationContext): string {
  return `${REGISTRATION_KEY_PREFIX}:${userId}:${tenantId}`;
}

function genericDeviceModel(): string {
  const model = Constants.platform?.ios?.model?.trim();
  // Constants.platform.ios.model is a generic model designation (for example
  // "iPhone 15"), unlike Constants.deviceName which can be user-assigned.
  return (model || "iPhone").slice(0, 80);
}

function appMetadata(): {
  appVersion?: string;
  appBuild?: string;
  deviceName: string;
} {
  const appVersion =
    Constants.nativeAppVersion?.trim() ?? Constants.expoConfig?.version?.trim();
  const appBuild =
    Constants.nativeBuildVersion?.trim() ??
    Constants.expoConfig?.ios?.buildNumber?.trim();
  return {
    ...(appVersion ? { appVersion } : {}),
    ...(appBuild ? { appBuild } : {}),
    deviceName: genericDeviceModel(),
  };
}

function pushEnvironment(): PushEnvironment {
  return __DEV__ ? "development" : "production";
}

function tokenFromDevicePushToken(
  token: Notifications.DevicePushToken,
): string {
  if (
    token.type !== "ios" ||
    typeof token.data !== "string" ||
    !APNS_TOKEN_PATTERN.test(token.data)
  ) {
    throw new Error(
      "Der Apple-Gerätetoken ist ungültig. Bitte versuche es nochmals.",
    );
  }
  return token.data;
}

async function currentApnsToken(): Promise<string> {
  assertIos();
  return tokenFromDevicePushToken(
    await Notifications.getDevicePushTokenAsync(),
  );
}

async function setRegisteredOnThisDevice(
  context: RegistrationContext,
  registered: boolean,
): Promise<void> {
  const key = registrationKey(context);
  if (registered) {
    await AsyncStorage.setItem(key, "1");
  } else {
    await AsyncStorage.removeItem(key);
  }
}

/** Contains only a local yes/no flag; APNs tokens are never persisted here. */
export async function isPushRegisteredOnThisDevice(
  context: RegistrationContext,
): Promise<boolean> {
  return (await AsyncStorage.getItem(registrationKey(context))) === "1";
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (Platform.OS !== "ios") return "unsupported";
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return "granted";
  return permission.canAskAgain ? "undetermined" : "denied";
}

/** This is the only function that may request the iOS notification permission. */
async function requestPushPermissionFromPerson(): Promise<void> {
  assertIos();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted
    ? current
    : await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: false },
      });
  if (!permission.granted) {
    throw new Error(
      "Mitteilungen sind in iOS deaktiviert. Öffne die iPhone-Einstellungen, um Push-Benachrichtigungen zu erlauben.",
    );
  }
}

export async function getPushNotificationStatus(
  tenantId: string,
): Promise<PushNotificationStatus> {
  return invokePushNotifications<PushNotificationStatus>({
    type: "getStatus",
    tenantId,
  });
}

export async function registerPushDevice(input: {
  tenantId: string;
  token: string;
}): Promise<{ device: PushDevice }> {
  return invokePushNotifications<{ device: PushDevice }>({
    type: "registerDevice",
    tenantId: input.tenantId,
    token: input.token,
    environment: pushEnvironment(),
    ...appMetadata(),
  });
}

export async function unregisterPushDevice(input: {
  tenantId: string;
  token?: string;
  deviceId?: string;
}): Promise<{ removed: boolean }> {
  if (!input.token && !input.deviceId) {
    throw new Error("Für die Abmeldung fehlt die Gerätekennung.");
  }
  return invokePushNotifications<{ removed: boolean }>({
    type: "unregisterDevice",
    tenantId: input.tenantId,
    ...(input.token ? { token: input.token } : {}),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
  });
}

export async function updatePushPreferences(input: {
  tenantId: string;
  preferences: PushPreferences;
}): Promise<{ preferences: PushPreferences }> {
  const { preferences } = input;
  return invokePushNotifications<{ preferences: PushPreferences }>({
    type: "updatePreferences",
    tenantId: input.tenantId,
    enabledCategories: preferences.enabledCategories,
    quietHoursEnabled: preferences.quietHoursEnabled,
    quietStart: preferences.quietStart,
    quietEnd: preferences.quietEnd,
    timezone: preferences.timezone,
  });
}

export async function sendPushTest(
  tenantId: string,
): Promise<{ results: PushTestResult[] }> {
  return invokePushNotifications<{ results: PushTestResult[] }>({
    type: "sendTest",
    tenantId,
  });
}

export async function getPushTenantSettings(
  tenantId: string,
): Promise<PushTenantSettings> {
  return invokePushNotifications<PushTenantSettings>({
    type: "getTenantSettings",
    tenantId,
  });
}

export async function updatePushTenantSettings(input: {
  tenantId: string;
  contentLevel: PushContentLevel;
}): Promise<{ contentLevel: PushContentLevel }> {
  return invokePushNotifications<{ contentLevel: PushContentLevel }>({
    type: "updateTenantSettings",
    tenantId: input.tenantId,
    contentLevel: input.contentLevel,
  });
}

export async function registerPushDeviceToken(
  context: RegistrationContext,
  devicePushToken: Notifications.DevicePushToken,
): Promise<void> {
  const token = tokenFromDevicePushToken(devicePushToken);
  await registerPushDevice({ tenantId: context.tenantId, token });
  await setRegisteredOnThisDevice(context, true);
}

/** Registers only after an explicit person-initiated enable action. */
export async function enablePushNotifications(
  context: RegistrationContext,
): Promise<void> {
  await requestPushPermissionFromPerson();
  await registerPushDeviceToken(
    context,
    await Notifications.getDevicePushTokenAsync(),
  );
}

export async function disablePushNotifications(
  context: RegistrationContext,
): Promise<void> {
  const token = await currentApnsToken();
  await unregisterPushDevice({ tenantId: context.tenantId, token });
  await setRegisteredOnThisDevice(context, false);
}

/**
 * Uses an existing iOS permission only; it never opens the permission dialog.
 * This is used after APNs rolls a token while the app is running.
 */
export async function reregisterPushTokenIfEnabled(
  context: RegistrationContext,
  devicePushToken: Notifications.DevicePushToken,
): Promise<void> {
  if (!(await isPushRegisteredOnThisDevice(context))) return;
  if ((await getPushPermissionState()) !== "granted") return;
  await registerPushDeviceToken(context, devicePushToken);
}

/**
 * Best-effort logout cleanup. A three-second ceiling means a stalled network or
 * APNs token lookup can never delay account sign-out. Unregistering is allowed
 * by the contract even after a tenant feature has been disabled.
 */
export async function unregisterPushDeviceBeforeSignOut(): Promise<void> {
  const client = nextDesk;
  if (Platform.OS !== "ios" || !client) return;

  const cleanup = async () => {
    const [{ data }, tenant, userId] = await Promise.all([
      client.auth.getSession(),
      loadCurrentTenant(),
      getMobileUserId(),
    ]);
    if (!data.session?.user.id) return;

    const context = { tenantId: tenant.id, userId };
    try {
      await unregisterPushDevice({
        tenantId: tenant.id,
        token: await currentApnsToken(),
      });
    } finally {
      await setRegisteredOnThisDevice(context, false).catch(() => undefined);
    }
  };

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    void cleanup()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        resolve();
      });
  });
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich";
  } catch {
    return "Europe/Zurich";
  }
}
