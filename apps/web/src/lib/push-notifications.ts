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
    description:
      "Erinnerungen zu Wiedervorlagen und aus zeitgesteuerten Regeln",
    label: "Wiedervorlagen",
  },
  infrastructure: {
    description:
      "Wenn Garantie, Support, End of Life oder Wartung eines Geräts fällig werden",
    label: "Infrastruktur",
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
  security_report: {
    description: "Wenn eine verdächtige E-Mail als Phishing gemeldet wird",
    label: "Phishing-Meldungen",
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
  /** ISO weekdays 1 (Monday) to 7 (Sunday) on which pushes arrive. */
  deliveryDays: number[];
  /** Categories also sent by e-mail through the tenant's Exchange mailbox. */
  emailCategories: PushCategory[];
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
  /** E-mail notifications possible (e-mail module and active mailbox). */
  emailAvailable: boolean;
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
      categoryModes: Record<string, "immediate" | "off">;
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

export const ALL_DELIVERY_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function parseDeliveryDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...ALL_DELIVERY_DAYS];
  const days = [
    ...new Set(
      value.filter(
        (day): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 1 &&
          day <= 7,
      ),
    ),
  ].sort((left, right) => left - right);
  return days.length > 0 ? days : [...ALL_DELIVERY_DAYS];
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
    deliveryDays: parseDeliveryDays(value.deliveryDays),
    emailCategories: Array.isArray(value.emailCategories)
      ? knownCategories(
          value.emailCategories.filter(
            (category): category is string => typeof category === "string",
          ),
        )
      : [],
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
    emailAvailable: value.emailAvailable === true,
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
    // Explicit modes so categories outside the stored list (infrastructure)
    // can be switched off as well.
    categoryModes: Object.fromEntries(
      (Object.keys(pushCategoryMeta) as PushCategory[]).map((category) => [
        category,
        preferences.enabledCategories.includes(category) ? "immediate" : "off",
      ]),
    ),
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

/**
 * Personal notification window. It is stored as the existing quiet hours:
 * "deliver from 06 to 17" means "quiet from 17 to 06". The delivery queue
 * holds messages during quiet hours and sends them once the window opens.
 */
export type DeliveryWindow =
  | { mode: "always" }
  | { mode: "window"; startHour: number; endHour: number; days: number[] };

export const DEFAULT_DELIVERY_WINDOW = {
  startHour: 6,
  endHour: 17,
  days: [1, 2, 3, 4, 5],
} as const;

export function deliveryWindowFromPreferences(
  preferences: Pick<
    PushPreferences,
    "quietHoursEnabled" | "quietStart" | "quietEnd" | "deliveryDays"
  >,
): DeliveryWindow {
  const allDays = preferences.deliveryDays.length === ALL_DELIVERY_DAYS.length;
  const timeLimited =
    preferences.quietHoursEnabled &&
    preferences.quietStart !== preferences.quietEnd;
  if (!timeLimited && allDays) return { mode: "always" };
  return {
    mode: "window",
    startHour: timeLimited ? preferences.quietEnd : 0,
    // A window ending at midnight is shown as 24:00.
    endHour:
      !timeLimited || preferences.quietStart === 0
        ? 24
        : preferences.quietStart,
    days: [...preferences.deliveryDays],
  };
}

export function preferencesWithDeliveryWindow<T extends PushPreferences>(
  preferences: T,
  window: DeliveryWindow,
): T {
  if (window.mode === "always") {
    return {
      ...preferences,
      quietHoursEnabled: false,
      deliveryDays: [...ALL_DELIVERY_DAYS],
    };
  }
  const days =
    window.days.length > 0
      ? [...new Set(window.days)].sort((left, right) => left - right)
      : [...ALL_DELIVERY_DAYS];
  const start = window.startHour % 24;
  const end = window.endHour % 24;
  // 00:00–24:00 means "all day" on the chosen days.
  if (start === end) {
    return { ...preferences, quietHoursEnabled: false, deliveryDays: days };
  }
  return {
    ...preferences,
    quietHoursEnabled: true,
    quietStart: end,
    quietEnd: start,
    deliveryDays: days,
  };
}
