// «Phishing melden» (web): contract of the phishing-reports edge function and
// client-side checks of the uploaded file. Pure, no I/O.

export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REPORT_PASTE_CHARACTERS = 1_000_000;
export const REPORT_FILE_ACCEPT =
  ".eml,.msg,.txt,message/rfc822,application/vnd.ms-outlook";

export type PhishingConfig = { enabled: boolean; reportAddress: string | null };

export type PhishingSubmitResult = {
  ticketId: string;
  ticketNumber: string;
  duplicate: boolean;
  message: string;
};

export type PhishingPriority = "low" | "normal" | "high" | "urgent";

export type PhishingSettings = {
  enabled: boolean;
  reportAddress: string | null;
  departmentId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  priorityKey: PhishingPriority;
  notifyTeamId: string | null;
};

export type PhishingSettingsOptions = {
  departments: { id: string; name: string }[];
  categories: { id: string; name: string; departmentId: string | null }[];
  subcategories: { id: string; name: string; categoryId: string }[];
  teams: { id: string; name: string; departmentId: string | null }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

/** Returns a German error text, or null when the file can be sent. */
export function validateReportFile(name: string, size: number): string | null {
  if (!/\.(eml|msg|txt)$/i.test(name)) {
    return "Bitte laden Sie die E-Mail als .eml- oder .msg-Datei hoch.";
  }
  if (size <= 0) return "Die Datei ist leer.";
  if (size > MAX_REPORT_FILE_BYTES) {
    return "Die Datei ist zu gross (höchstens 5 MB).";
  }
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function parsePhishingConfig(value: unknown): PhishingConfig {
  const data = isRecord(value) && isRecord(value.data) ? value.data : {};
  return {
    enabled: data.enabled === true,
    reportAddress: text(data.reportAddress, 320),
  };
}

export function parsePhishingSubmit(
  value: unknown,
): PhishingSubmitResult | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const ticketId = text(data.ticketId, 64);
  const ticketNumber = text(data.ticketNumber, 64);
  const message = text(data.message, 1000);
  if (!ticketId || !ticketNumber || !message) return null;
  return {
    ticketId,
    ticketNumber,
    duplicate: data.duplicate === true,
    message,
  };
}

function priority(value: unknown): PhishingPriority {
  return value === "low" || value === "normal" || value === "urgent"
    ? value
    : "high";
}

export function parsePhishingSettings(
  value: unknown,
): { settings: PhishingSettings; options: PhishingSettingsOptions } | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const { settings, options } = value.data;
  if (!isRecord(settings) || !isRecord(options)) return null;
  const list = (entries: unknown) =>
    (Array.isArray(entries) ? entries : []).filter(isRecord);
  return {
    settings: {
      enabled: settings.enabled === true,
      reportAddress: text(settings.reportAddress, 320),
      departmentId: text(settings.departmentId, 64),
      categoryId: text(settings.categoryId, 64),
      subcategoryId: text(settings.subcategoryId, 64),
      priorityKey: priority(settings.priorityKey),
      notifyTeamId: text(settings.notifyTeamId, 64),
    },
    options: {
      departments: list(options.departments).flatMap((row) => {
        const id = text(row.id, 64);
        const name = text(row.name, 200);
        return id && name ? [{ id, name }] : [];
      }),
      categories: list(options.categories).flatMap((row) => {
        const id = text(row.id, 64);
        const name = text(row.name, 200);
        return id && name
          ? [{ id, name, departmentId: text(row.departmentId, 64) }]
          : [];
      }),
      subcategories: list(options.subcategories).flatMap((row) => {
        const id = text(row.id, 64);
        const name = text(row.name, 200);
        const categoryId = text(row.categoryId, 64);
        return id && name && categoryId ? [{ id, name, categoryId }] : [];
      }),
      teams: list(options.teams).flatMap((row) => {
        const id = text(row.id, 64);
        const name = text(row.name, 200);
        return id && name
          ? [{ id, name, departmentId: text(row.departmentId, 64) }]
          : [];
      }),
    },
  };
}

const EMAIL = /^[^@\s]+@[a-z0-9.-]+\.[a-z0-9-]{2,}$/;

/** Client-side check before saving the settings (server checks again). */
export function settingsError(settings: PhishingSettings): string | null {
  const address = settings.reportAddress?.trim().toLowerCase() ?? "";
  if (address && !EMAIL.test(address)) {
    return "Die Meldeadresse ist keine gültige E-Mail-Adresse.";
  }
  if (settings.enabled && !settings.departmentId) {
    return "Bitte wählen Sie eine Zielabteilung.";
  }
  return null;
}
