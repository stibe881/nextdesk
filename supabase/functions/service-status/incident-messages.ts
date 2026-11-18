// Öffentliche Störungsmeldungen (service_incident_notices) in der Funktion
// service-status: Validierung der Aktionen und Abbildung der Zeilen.
//
// Vertrag für die Störungsansicht (Monitoring):
//   publishIncidentMessage { tenantId, monitoringIncidentId, serviceIds, state, title, body,
//                            serviceStatuses? }  (serviceStatuses: { dienstId: Betriebszustand })
//     → { data: { messageId } }
//   updateIncidentMessage  { tenantId, messageId, state, body, title?, serviceIds?, publicEnabled? }
//     → { data: { messageId } }
//   incidentMessages       { tenantId, monitoringIncidentId }
//     → { data: { messages: { id, state, title, body, createdAt, updatedAt, … }[] } }

export const INCIDENT_STATES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];
export const MAX_INCIDENT_SERVICES = 100;
/** Betriebszustand eines Dienstes (services.status). */
export const SERVICE_STATUSES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;
export type ServiceStatusValue = (typeof SERVICE_STATUSES)[number];

export type IncidentAction =
  | {
      type: "publishIncidentMessage";
      tenantId: string;
      monitoringIncidentId: string | null;
      serviceIds: string[];
      state: IncidentState;
      title: string;
      body: string;
      publicEnabled: boolean;
      serviceStatuses?: Record<string, ServiceStatusValue>;
    }
  | {
      type: "updateIncidentMessage";
      tenantId: string;
      messageId: string;
      state: IncidentState;
      body: string;
      title?: string;
      serviceIds?: string[];
      publicEnabled?: boolean;
      serviceStatuses?: Record<string, ServiceStatusValue>;
    }
  | {
      type: "incidentMessages";
      tenantId: string;
      monitoringIncidentId: string;
    }
  | { type: "listIncidentMessages"; tenantId: string };

export type IncidentMessageUpdate = {
  id: string;
  state: IncidentState;
  title: string;
  body: string;
  createdAt: string;
};

export type IncidentMessage = {
  id: string;
  state: IncidentState;
  title: string;
  body: string;
  publicEnabled: boolean;
  monitoringIncidentId: string | null;
  serviceIds: string[];
  startsAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updates: IncidentMessageUpdate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isIncidentState(value: unknown): value is IncidentState {
  return (
    typeof value === "string" &&
    (INCIDENT_STATES as readonly string[]).includes(value)
  );
}

function safeText(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= min && length <= max ? trimmed : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Optionaler neuer Betriebszustand je Dienst ({ dienstId: status }); jeder
 * Dienst muss auch in serviceIds der Meldung stehen.
 */
export function parseServiceStatuses(
  value: unknown,
  serviceIds: readonly string[],
): Record<string, ServiceStatusValue> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_INCIDENT_SERVICES) return null;
  const allowed = new Set(serviceIds);
  const result: Record<string, ServiceStatusValue> = {};
  for (const [id, status] of entries) {
    const key = id.toLowerCase();
    if (
      !isUuid(id) ||
      !allowed.has(key) ||
      typeof status !== "string" ||
      !(SERVICE_STATUSES as readonly string[]).includes(status)
    ) {
      return null;
    }
    result[key] = status as ServiceStatusValue;
  }
  return result;
}

/** 0–100 eindeutige Dienst-IDs (eine Meldung kann ohne Dienst sein). */
export function parseIncidentServiceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_INCIDENT_SERVICES) {
    return null;
  }
  if (!value.every(isUuid)) return null;
  const ids = (value as string[]).map((id) => id.toLowerCase());
  return new Set(ids).size === ids.length ? ids : null;
}

export function parseIncidentAction(
  value: Record<string, unknown>,
  tenantId: string,
): IncidentAction | null {
  if (value.type === "listIncidentMessages") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "incidentMessages") {
    if (
      !hasOnlyKeys(value, ["type", "tenantId", "monitoringIncidentId"]) ||
      !isUuid(value.monitoringIncidentId)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      monitoringIncidentId: value.monitoringIncidentId.toLowerCase(),
    };
  }
  if (value.type === "publishIncidentMessage") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "monitoringIncidentId",
        "serviceIds",
        "state",
        "title",
        "body",
        "publicEnabled",
        "serviceStatuses",
      ])
    ) {
      return null;
    }
    const title = safeText(value.title, 3, 240);
    const body = safeText(value.body, 3, 10_000);
    const serviceIds =
      value.serviceIds === undefined
        ? []
        : parseIncidentServiceIds(value.serviceIds);
    const monitoringIncidentId =
      value.monitoringIncidentId === undefined ||
      value.monitoringIncidentId === null
        ? null
        : isUuid(value.monitoringIncidentId)
          ? value.monitoringIncidentId.toLowerCase()
          : undefined;
    const serviceStatuses =
      value.serviceStatuses === undefined || !serviceIds
        ? undefined
        : parseServiceStatuses(value.serviceStatuses, serviceIds);
    if (
      !title ||
      !body ||
      !serviceIds ||
      serviceStatuses === null ||
      monitoringIncidentId === undefined ||
      !isIncidentState(value.state) ||
      (value.publicEnabled !== undefined &&
        typeof value.publicEnabled !== "boolean")
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      monitoringIncidentId,
      serviceIds,
      state: value.state,
      title,
      body,
      publicEnabled: value.publicEnabled !== false,
      ...(serviceStatuses && Object.keys(serviceStatuses).length
        ? { serviceStatuses }
        : {}),
    };
  }
  if (value.type === "updateIncidentMessage") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "messageId",
        "state",
        "title",
        "body",
        "serviceIds",
        "publicEnabled",
        "serviceStatuses",
      ]) ||
      !isUuid(value.messageId) ||
      !isIncidentState(value.state)
    ) {
      return null;
    }
    const body = safeText(value.body, 3, 10_000);
    const title =
      value.title === undefined ? undefined : safeText(value.title, 3, 240);
    const serviceIds =
      value.serviceIds === undefined
        ? undefined
        : parseIncidentServiceIds(value.serviceIds);
    const serviceStatuses =
      value.serviceStatuses === undefined
        ? undefined
        : serviceIds
          ? parseServiceStatuses(value.serviceStatuses, serviceIds)
          : null;
    if (
      !body ||
      title === null ||
      serviceIds === null ||
      serviceStatuses === null ||
      (value.publicEnabled !== undefined &&
        typeof value.publicEnabled !== "boolean")
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      messageId: value.messageId.toLowerCase(),
      state: value.state,
      body,
      ...(title !== undefined ? { title } : {}),
      ...(serviceIds !== undefined ? { serviceIds } : {}),
      ...(typeof value.publicEnabled === "boolean"
        ? { publicEnabled: value.publicEnabled }
        : {}),
      ...(serviceStatuses && Object.keys(serviceStatuses).length
        ? { serviceStatuses }
        : {}),
    };
  }
  return null;
}

/** Baut Meldungen aus Zeilen; ungültige Zeilen werden ausgelassen. */
export function buildIncidentMessages(
  notices: readonly unknown[],
  links: readonly unknown[],
  updates: readonly unknown[],
): IncidentMessage[] {
  const servicesByNotice = new Map<string, string[]>();
  for (const link of links) {
    if (!isRecord(link) || !isUuid(link.notice_id) || !isUuid(link.service_id)) {
      continue;
    }
    const key = link.notice_id.toLowerCase();
    servicesByNotice.set(key, [
      ...(servicesByNotice.get(key) ?? []),
      link.service_id.toLowerCase(),
    ]);
  }
  const updatesByNotice = new Map<string, IncidentMessageUpdate[]>();
  for (const update of updates) {
    if (
      !isRecord(update) ||
      !isUuid(update.id) ||
      !isUuid(update.notice_id) ||
      !isIncidentState(update.status) ||
      typeof update.created_at !== "string"
    ) {
      continue;
    }
    const title = safeText(update.title, 1, 240);
    const body = safeText(update.body, 1, 10_000);
    if (!title || !body) continue;
    const key = update.notice_id.toLowerCase();
    updatesByNotice.set(key, [
      ...(updatesByNotice.get(key) ?? []),
      {
        id: update.id.toLowerCase(),
        state: update.status,
        title,
        body,
        createdAt: update.created_at,
      },
    ]);
  }
  const messages: IncidentMessage[] = [];
  for (const notice of notices) {
    if (
      !isRecord(notice) ||
      !isUuid(notice.id) ||
      !isIncidentState(notice.status) ||
      typeof notice.created_at !== "string" ||
      typeof notice.updated_at !== "string" ||
      typeof notice.starts_at !== "string"
    ) {
      continue;
    }
    const title = safeText(notice.title, 1, 240);
    const body = safeText(notice.description, 1, 10_000);
    if (!title || !body) continue;
    const id = notice.id.toLowerCase();
    messages.push({
      id,
      state: notice.status,
      title,
      body,
      publicEnabled: notice.public_enabled === true,
      monitoringIncidentId: isUuid(notice.monitoring_incident_id)
        ? notice.monitoring_incident_id.toLowerCase()
        : null,
      serviceIds: (servicesByNotice.get(id) ?? []).sort(),
      startsAt: notice.starts_at,
      resolvedAt:
        typeof notice.resolved_at === "string" ? notice.resolved_at : null,
      createdAt: notice.created_at,
      updatedAt: notice.updated_at,
      updates: (updatesByNotice.get(id) ?? []).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    });
  }
  return messages;
}

/** Aktuell (nicht gelöst) oder in den letzten `days` Tagen gelöst. */
export function isRecentIncidentMessage(
  message: Pick<IncidentMessage, "state" | "resolvedAt">,
  now: number,
  days = 14,
): boolean {
  if (message.state !== "resolved") return true;
  const resolved = Date.parse(message.resolvedAt ?? "");
  return Number.isFinite(resolved) && now - resolved <= days * 86_400_000;
}
