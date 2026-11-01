import { functionErrorMessage } from "./function-error";
import { supabase } from "./supabase";

export type PushContentLevel = "minimal" | "subject";

export const pushCategoryMeta = {
  approval: {
    description: "Informationen zu angeforderten Freigaben",
    label: "Freigaben",
  },
  assigned: {
    description: "Wenn Ihnen ein Ticket zugewiesen wird",
    label: "Zuweisungen",
  },
  escalation: {
    description: "Hinweise zu eskalierten Tickets",
    label: "Eskalationen",
  },
  follow_up: {
    description: "Erinnerung zum gesetzten Termin",
    label: "Wiedervorlagen",
  },
  inventory_low_stock: {
    description:
      "Wenn die Gesamtverfügbarkeit eines Artikels den Mindestbestand erreicht",
    label: "Lagerunterbestand",
  },
  mention: {
    description: "Wenn Sie in einem Ticket erwähnt werden",
    label: "Erwähnungen",
  },
  requester_reply: {
    description: "Antworten von anfragenden Personen",
    label: "Antworten von anfragenden Personen",
  },
  resolved: {
    description: "Wenn ein Ticket als gelöst markiert wird",
    label: "Ticketlösungen",
  },
  shop: {
    description: "Freigaben, Bereitstellung und Status Ihrer Bestellungen",
    label: "Shop",
  },
  sla: {
    description: "Hinweise zu betroffenen SLA-Fristen",
    label: "SLA-Hinweise",
  },
  support_reply: {
    description: "Antworten des Supports zu Ihren Tickets",
    label: "Support-Antworten",
  },
} as const;

export type PushCategory = keyof typeof pushCategoryMeta;

export type PushPreferences = {
  enabledCategories: PushCategory[];
  quietEnd: number;
  quietHoursEnabled: boolean;
  quietStart: number;
  timezone: string;
};

export type WorkHours = {
  required: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  localDate: string;
  withinWindow: boolean;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  declinedAt: string | null;
  active: boolean;
  promptDue: boolean;
};

export type PushWorkHoursSettings = {
  checkInRequired: boolean;
  workStartHour: number;
  workEndHour: number;
};

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
  applicableCategories: PushCategory[];
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  devices: PushDevice[];
  featureEnabled: boolean;
  preferences: PushPreferences;
  workHours: WorkHours;
};

export type PushTenantSettings = {
  apnsConfigured: boolean;
  contentLevel: PushContentLevel;
  featureEnabled: boolean;
  registeredDevices: number;
  workHours: PushWorkHoursSettings;
};

export type PushTenantSettingsUpdate = Pick<
  PushTenantSettings,
  "contentLevel" | "workHours"
>;

export type PushTenantSettingsInput = {
  contentLevel: PushContentLevel;
  checkInRequired?: boolean;
  workStartHour?: number;
  workEndHour?: number;
};

type FunctionEnvelope<T> = { data: T };

type PushNotificationsRequest =
  | { tenantId: string; type: "getStatus" }
  | { deviceId: string; tenantId: string; type: "unregisterDevice" }
  | { tenantId: string; type: "getTenantSettings" }
  | {
      contentLevel: PushContentLevel;
      checkInRequired?: boolean;
      tenantId: string;
      type: "updateTenantSettings";
      workEndHour?: number;
      workStartHour?: number;
    }
  | {
      enabledCategories: PushCategory[];
      quietEnd: number;
      quietHoursEnabled: boolean;
      quietStart: number;
      tenantId: string;
      timezone: string;
      type: "updatePreferences";
    }
  | { tenantId: string; type: "checkIn" }
  | { tenantId: string; type: "checkOut" }
  | { tenantId: string; type: "declineCheckIn" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContentLevel(value: unknown): value is PushContentLevel {
  return value === "minimal" || value === "subject";
}

function isPushCategory(value: unknown): value is PushCategory {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(pushCategoryMeta, value)
  );
}

function isHour(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function responseError(): Error {
  return new Error(
    "Push-Benachrichtigungen haben unvollständige oder ungültige Daten geliefert.",
  );
}

function knownCategories(value: unknown[]): PushCategory[] {
  return [...new Set(value.filter(isPushCategory))];
}

function parsePreferences(value: unknown): PushPreferences {
  if (!isRecord(value)) throw responseError();

  const {
    enabledCategories,
    quietEnd,
    quietHoursEnabled,
    quietStart,
    timezone,
  } = value;
  if (
    !Array.isArray(enabledCategories) ||
    enabledCategories.some((category) => typeof category !== "string") ||
    !isHour(quietEnd, 0, 23) ||
    typeof quietHoursEnabled !== "boolean" ||
    !isHour(quietStart, 0, 23) ||
    typeof timezone !== "string" ||
    !timezone.trim()
  ) {
    throw responseError();
  }

  return {
    // New server categories can arrive before this client understands them.
    // Omit those values instead of rendering an unlabelled preference row.
    enabledCategories: knownCategories(enabledCategories),
    quietEnd,
    quietHoursEnabled,
    quietStart,
    timezone,
  };
}

function parseWorkHours(value: unknown): WorkHours {
  if (!isRecord(value)) throw responseError();

  const {
    required,
    startHour,
    endHour,
    timezone,
    localDate,
    withinWindow,
    checkedIn,
    checkedInAt,
    checkedOutAt,
    declinedAt,
    active,
    promptDue,
  } = value;
  if (
    typeof required !== "boolean" ||
    !isHour(startHour, 0, 23) ||
    !isHour(endHour, 1, 24) ||
    endHour <= startHour ||
    typeof timezone !== "string" ||
    !timezone.trim() ||
    typeof localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
    typeof withinWindow !== "boolean" ||
    typeof checkedIn !== "boolean" ||
    !isNullableString(checkedInAt) ||
    !isNullableString(checkedOutAt) ||
    !isNullableString(declinedAt) ||
    typeof active !== "boolean" ||
    typeof promptDue !== "boolean"
  ) {
    throw responseError();
  }

  return {
    required,
    startHour,
    endHour,
    timezone,
    localDate,
    withinWindow,
    checkedIn,
    checkedInAt,
    checkedOutAt,
    declinedAt,
    active,
    promptDue,
  };
}

function parseDevice(value: unknown): PushDevice {
  if (!isRecord(value)) throw responseError();

  const {
    appBuild,
    appVersion,
    deviceName,
    disabledReason,
    enabled,
    id,
    lastRegisteredAt,
    lastSentAt,
  } = value;
  if (
    !isNullableString(appBuild) ||
    !isNullableString(appVersion) ||
    !isNullableString(deviceName) ||
    !isNullableString(disabledReason) ||
    typeof enabled !== "boolean" ||
    typeof id !== "string" ||
    !id ||
    !isNullableString(lastRegisteredAt) ||
    !isNullableString(lastSentAt)
  ) {
    throw responseError();
  }

  return {
    appBuild,
    appVersion,
    deviceName,
    disabledReason,
    enabled,
    id,
    lastRegisteredAt,
    lastSentAt,
  };
}

function parseStatus(value: unknown): PushStatus {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    throw responseError();
  }

  const {
    applicableCategories,
    apnsConfigured,
    contentLevel,
    devices,
    featureEnabled,
    preferences,
    workHours,
  } = value;
  if (
    !Array.isArray(applicableCategories) ||
    applicableCategories.some((category) => typeof category !== "string") ||
    typeof apnsConfigured !== "boolean" ||
    !isContentLevel(contentLevel) ||
    !Array.isArray(devices) ||
    typeof featureEnabled !== "boolean" ||
    !isRecord(preferences)
  ) {
    throw responseError();
  }

  return {
    applicableCategories: knownCategories(applicableCategories),
    apnsConfigured,
    contentLevel,
    devices: devices.map(parseDevice),
    featureEnabled,
    preferences: parsePreferences(preferences),
    workHours: parseWorkHours(workHours),
  };
}

function parseWorkHoursSettings(value: unknown): PushWorkHoursSettings {
  if (!isRecord(value)) throw responseError();

  const { checkInRequired, workStartHour, workEndHour } = value;
  if (
    typeof checkInRequired !== "boolean" ||
    !isHour(workStartHour, 0, 23) ||
    !isHour(workEndHour, 1, 24) ||
    workEndHour <= workStartHour
  ) {
    throw responseError();
  }

  return { checkInRequired, workStartHour, workEndHour };
}

function parseTenantSettings(value: unknown): PushTenantSettings {
  if (!isRecord(value)) throw responseError();

  const {
    apnsConfigured,
    contentLevel,
    featureEnabled,
    registeredDevices,
    workHours,
  } = value;
  if (
    typeof apnsConfigured !== "boolean" ||
    !isContentLevel(contentLevel) ||
    typeof featureEnabled !== "boolean" ||
    !isNonNegativeInteger(registeredDevices)
  ) {
    throw responseError();
  }

  return {
    apnsConfigured,
    contentLevel,
    featureEnabled,
    registeredDevices,
    workHours: parseWorkHoursSettings(workHours),
  };
}

function parseTenantSettingsUpdate(value: unknown): PushTenantSettingsUpdate {
  if (!isRecord(value) || !isContentLevel(value.contentLevel)) {
    throw responseError();
  }

  return {
    contentLevel: value.contentLevel,
    workHours: parseWorkHoursSettings(value.workHours),
  };
}

function parseWorkHoursAction(value: unknown): WorkHours {
  if (!isRecord(value)) throw responseError();
  return parseWorkHours(value.workHours);
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

export async function getStatus(tenantId: string): Promise<PushStatus> {
  return parseStatus(
    await pushNotificationsRequest<unknown>({ tenantId, type: "getStatus" }),
  );
}

export async function getTenantSettings(
  tenantId: string,
): Promise<PushTenantSettings> {
  return parseTenantSettings(
    await pushNotificationsRequest<unknown>({
      tenantId,
      type: "getTenantSettings",
    }),
  );
}

export async function updateTenantSettings(
  tenantId: string,
  settings: PushTenantSettingsInput,
): Promise<PushTenantSettingsUpdate> {
  return parseTenantSettingsUpdate(
    await pushNotificationsRequest<unknown>({
      tenantId,
      type: "updateTenantSettings",
      ...settings,
    }),
  );
}

export async function updatePreferences(
  tenantId: string,
  preferences: PushPreferences,
): Promise<PushPreferences> {
  const result = await pushNotificationsRequest<unknown>({
    tenantId,
    type: "updatePreferences",
    ...preferences,
  });
  if (!isRecord(result)) throw responseError();
  return parsePreferences(result.preferences);
}

export async function checkIn(tenantId: string): Promise<WorkHours> {
  return parseWorkHoursAction(
    await pushNotificationsRequest<unknown>({ tenantId, type: "checkIn" }),
  );
}

export async function checkOut(tenantId: string): Promise<WorkHours> {
  return parseWorkHoursAction(
    await pushNotificationsRequest<unknown>({ tenantId, type: "checkOut" }),
  );
}

export async function declineCheckIn(tenantId: string): Promise<WorkHours> {
  return parseWorkHoursAction(
    await pushNotificationsRequest<unknown>({
      tenantId,
      type: "declineCheckIn",
    }),
  );
}
