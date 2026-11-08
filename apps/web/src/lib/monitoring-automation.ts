// Parsing and presentation for certificate/domain expiry and backup
// monitoring (functions expiry-monitoring and backup-monitoring).

export type ExpiryStatus =
  "pending" | "valid" | "expiring" | "expired" | "error";
export type BackupResult = "success" | "warning" | "failed";
export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export type Option = { id: string; name: string };
export type PriorityOption = { key: string; label: string };
export type AssetOption = { id: string; name: string; hostname: string | null };

export type ExpirySettings = {
  configured: boolean;
  enabled: boolean;
  departmentId: string | null;
  priorityKey: string | null;
  reminderPriorityKey: string | null;
  warnDays: number;
  reminderDays: number;
  autoResolve: boolean;
  lastRunAt: string | null;
};

export type ExpiryTarget = {
  id: string;
  kind: "certificate" | "domain";
  host: string;
  port: number | null;
  label: string | null;
  departmentId: string | null;
  assetId: string | null;
  assetName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  warnDays: number | null;
  active: boolean;
  status: ExpiryStatus;
  expiresAt: string | null;
  issuer: string | null;
  san: string[];
  registrar: string | null;
  checkMethod: "tls" | "ct" | "rdap" | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  ticketNumber: string | null;
};

export type BackupSettings = {
  configured: boolean;
  enabled: boolean;
  departmentId: string | null;
  priorityKey: string | null;
  warningAction: "ignore" | "ticket";
  autoResolve: boolean;
  defaultIntervalHours: number;
  defaultGraceHours: number;
  senderPatterns: string[];
  subjectPatterns: string[];
  hasToken: boolean;
  tokenRotatedAt: string | null;
  lastReceivedAt: string | null;
};

export type BackupJob = {
  id: string;
  name: string;
  lastSource: "email" | "webhook" | null;
  expectedIntervalHours: number | null;
  graceHours: number | null;
  departmentId: string | null;
  assetId: string | null;
  serviceId: string | null;
  active: boolean;
  lastResult: BackupResult | null;
  lastReportAt: string | null;
  lastSuccessAt: string | null;
  lastMessage: string | null;
  reportCount: number;
  missingAlertedAt: string | null;
  ticketNumber: string | null;
  ticketReason: "failed" | "warning" | "missing" | null;
};

export type BackupReport = {
  id: string;
  result: BackupResult;
  source: "email" | "webhook";
  subject: string | null;
  summary: string | null;
  objectCount: number | null;
  action: string | null;
  reportedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort ist unvollständig.");
  }
  return value.data;
}

export function parseOptions(payload: Record<string, unknown>): {
  departments: Option[];
  priorities: PriorityOption[];
  assets: AssetOption[];
  services: Option[];
} {
  const list = <T>(
    value: unknown,
    map: (entry: Record<string, unknown>) => T | null,
  ): T[] =>
    Array.isArray(value)
      ? value.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const mapped = map(entry);
          return mapped ? [mapped] : [];
        })
      : [];
  const named = (entry: Record<string, unknown>) =>
    typeof entry.id === "string" && typeof entry.name === "string"
      ? { id: entry.id, name: entry.name }
      : null;
  return {
    departments: list(payload.departments, named),
    services: list(payload.services, named),
    priorities: list(payload.priorities, (entry) =>
      typeof entry.key === "string" && typeof entry.label === "string"
        ? { key: entry.key, label: entry.label }
        : null,
    ),
    assets: list(payload.assets, (entry) => {
      const base = named(entry);
      return base ? { ...base, hostname: text(entry.hostname) } : null;
    }),
  };
}

export function parseExpirySettings(value: unknown): ExpirySettings | null {
  if (!isRecord(value)) return null;
  const warnDays = integer(value.warnDays);
  const reminderDays = integer(value.reminderDays);
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.autoResolve !== "boolean" ||
    warnDays === null ||
    reminderDays === null
  ) {
    return null;
  }
  return {
    configured: value.configured === true,
    enabled: value.enabled,
    departmentId: text(value.departmentId),
    priorityKey: text(value.priorityKey),
    reminderPriorityKey: text(value.reminderPriorityKey),
    warnDays,
    reminderDays,
    autoResolve: value.autoResolve,
    lastRunAt: text(value.lastRunAt),
  };
}

const EXPIRY_STATUSES: ExpiryStatus[] = [
  "pending",
  "valid",
  "expiring",
  "expired",
  "error",
];

export function parseExpiryTargets(value: unknown): ExpiryTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.host !== "string" ||
      (entry.kind !== "certificate" && entry.kind !== "domain")
    ) {
      return [];
    }
    const status = EXPIRY_STATUSES.includes(entry.status as ExpiryStatus)
      ? (entry.status as ExpiryStatus)
      : "pending";
    const method =
      entry.checkMethod === "tls" ||
      entry.checkMethod === "ct" ||
      entry.checkMethod === "rdap"
        ? entry.checkMethod
        : null;
    return [
      {
        id: entry.id,
        kind: entry.kind,
        host: entry.host,
        port: integer(entry.port),
        label: text(entry.label),
        departmentId: text(entry.departmentId),
        assetId: text(entry.assetId),
        assetName: text(entry.assetName),
        serviceId: text(entry.serviceId),
        serviceName: text(entry.serviceName),
        warnDays: integer(entry.warnDays),
        active: entry.active !== false,
        status,
        expiresAt: text(entry.expiresAt),
        issuer: text(entry.issuer),
        san: strings(entry.san),
        registrar: text(entry.registrar),
        checkMethod: method,
        lastError: text(entry.lastError),
        lastCheckedAt: text(entry.lastCheckedAt),
        ticketNumber: text(entry.ticketNumber),
      },
    ];
  });
}

export function parseBackupSettings(value: unknown): BackupSettings | null {
  if (!isRecord(value)) return null;
  const interval = integer(value.defaultIntervalHours);
  const grace = integer(value.defaultGraceHours);
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.autoResolve !== "boolean" ||
    typeof value.hasToken !== "boolean" ||
    interval === null ||
    grace === null
  ) {
    return null;
  }
  return {
    configured: value.configured === true,
    enabled: value.enabled,
    departmentId: text(value.departmentId),
    priorityKey: text(value.priorityKey),
    warningAction: value.warningAction === "ticket" ? "ticket" : "ignore",
    autoResolve: value.autoResolve,
    defaultIntervalHours: interval,
    defaultGraceHours: grace,
    senderPatterns: strings(value.senderPatterns),
    subjectPatterns: strings(value.subjectPatterns),
    hasToken: value.hasToken,
    tokenRotatedAt: text(value.tokenRotatedAt),
    lastReceivedAt: text(value.lastReceivedAt),
  };
}

const RESULTS: BackupResult[] = ["success", "warning", "failed"];
const asResult = (value: unknown): BackupResult | null =>
  RESULTS.includes(value as BackupResult) ? (value as BackupResult) : null;

export function parseBackupJobs(value: unknown): BackupJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string"
    ) {
      return [];
    }
    const reason = entry.ticketReason;
    return [
      {
        id: entry.id,
        name: entry.name,
        lastSource:
          entry.lastSource === "email" || entry.lastSource === "webhook"
            ? entry.lastSource
            : null,
        expectedIntervalHours: integer(entry.expectedIntervalHours),
        graceHours: integer(entry.graceHours),
        departmentId: text(entry.departmentId),
        assetId: text(entry.assetId),
        serviceId: text(entry.serviceId),
        active: entry.active !== false,
        lastResult: asResult(entry.lastResult),
        lastReportAt: text(entry.lastReportAt),
        lastSuccessAt: text(entry.lastSuccessAt),
        lastMessage: text(entry.lastMessage),
        reportCount: integer(entry.reportCount) ?? 0,
        missingAlertedAt: text(entry.missingAlertedAt),
        ticketNumber: text(entry.ticketNumber),
        ticketReason:
          reason === "failed" || reason === "warning" || reason === "missing"
            ? reason
            : null,
      },
    ];
  });
}

export function parseBackupReports(value: unknown): BackupReport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const result = asResult(entry.result);
    const reportedAt = text(entry.reportedAt);
    if (!result || !reportedAt) return [];
    return [
      {
        id: entry.id,
        result,
        source: entry.source === "webhook" ? "webhook" : "email",
        subject: text(entry.subject),
        summary: text(entry.summary),
        objectCount: integer(entry.objectCount),
        action: text(entry.action),
        reportedAt,
      },
    ];
  });
}

// Presentation --------------------------------------------------------------

export function expiryStatusChip(status: ExpiryStatus): {
  label: string;
  tone: Tone;
} {
  switch (status) {
    case "valid":
      return { label: "gültig", tone: "success" };
    case "expiring":
      return { label: "läuft bald ab", tone: "warning" };
    case "expired":
      return { label: "abgelaufen", tone: "danger" };
    case "error":
      return { label: "Fehler", tone: "danger" };
    default:
      return { label: "noch nicht geprüft", tone: "neutral" };
  }
}

export function backupResultChip(result: BackupResult | null): {
  label: string;
  tone: Tone;
} {
  switch (result) {
    case "success":
      return { label: "Erfolgreich", tone: "success" };
    case "warning":
      return { label: "Warnung", tone: "warning" };
    case "failed":
      return { label: "Fehlgeschlagen", tone: "danger" };
    default:
      return { label: "Keine Meldung", tone: "neutral" };
  }
}

/** Whole days until expiry (negative when expired). */
export function daysUntil(
  expiresAt: string | null,
  now = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const time = Date.parse(expiresAt);
  return Number.isNaN(time) ? null : Math.ceil((time - now) / 86_400_000);
}

export function expiryLabel(
  expiresAt: string | null,
  now = Date.now(),
): string {
  const days = daysUntil(expiresAt, now);
  if (days === null || !expiresAt) return "unbekannt";
  const date = new Date(expiresAt).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (days < 0)
    return `${date} (seit ${-days} ${-days === 1 ? "Tag" : "Tagen"} abgelaufen)`;
  if (days === 0) return `${date} (heute)`;
  return `${date} (in ${days} ${days === 1 ? "Tag" : "Tagen"})`;
}

export function targetDisplay(
  target: Pick<ExpiryTarget, "kind" | "host" | "port">,
): string {
  return target.kind === "certificate" &&
    target.port !== null &&
    target.port !== 443
    ? `${target.host}:${target.port}`
    : target.host;
}

/** Sort: problems first, then by next expiry. */
export function sortTargets(targets: ExpiryTarget[]): ExpiryTarget[] {
  const rank: Record<ExpiryStatus, number> = {
    expired: 0,
    error: 1,
    expiring: 2,
    pending: 3,
    valid: 4,
  };
  return [...targets].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus) return byStatus;
    const ax = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
    const bx = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
    return ax - bx || a.host.localeCompare(b.host);
  });
}

/** True when the job's report is overdue (expected interval + grace). */
export function backupOverdue(
  job: Pick<
    BackupJob,
    "active" | "expectedIntervalHours" | "graceHours" | "lastReportAt"
  >,
  defaultGraceHours: number,
  now = Date.now(),
): boolean {
  if (!job.active || !job.expectedIntervalHours || !job.lastReportAt)
    return false;
  const last = Date.parse(job.lastReportAt);
  if (Number.isNaN(last)) return false;
  const grace = job.graceHours ?? defaultGraceHours;
  return now > last + (job.expectedIntervalHours + grace) * 3_600_000;
}

export function intervalLabel(hours: number | null): string {
  if (!hours) return "nicht überwacht";
  if (hours % 168 === 0)
    return hours === 168 ? "wöchentlich" : `alle ${hours / 168} Wochen`;
  if (hours % 24 === 0)
    return hours === 24 ? "täglich" : `alle ${hours / 24} Tage`;
  return hours === 1 ? "stündlich" : `alle ${hours} Stunden`;
}

/** Splits a textarea (one pattern per line, also comma/semicolon). */
export function splitPatterns(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}
