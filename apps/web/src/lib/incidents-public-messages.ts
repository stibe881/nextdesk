// Public status messages linked to a monitoring incident. The messages live
// in the status page (service-status function, actions
// publishIncidentMessage / incidentMessages); this only parses the answer.

export const INCIDENT_MESSAGE_STATES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;
export type IncidentMessageState = (typeof INCIDENT_MESSAGE_STATES)[number];

export const INCIDENT_MESSAGE_STATE_LABELS: Record<
  IncidentMessageState,
  string
> = {
  investigating: "Wird untersucht",
  identified: "Ursache bekannt",
  monitoring: "Wird beobachtet",
  resolved: "Behoben",
};

export const SERVICE_OPERATING_STATES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;
export type ServiceOperatingState = (typeof SERVICE_OPERATING_STATES)[number];

export const SERVICE_OPERATING_STATE_LABELS: Record<
  ServiceOperatingState,
  string
> = {
  operational: "Betriebsbereit",
  degraded: "Beeinträchtigte Leistung",
  partial_outage: "Teilweiser Ausfall",
  major_outage: "Schwerwiegender Ausfall",
  maintenance: "Wird gewartet",
};

/** A service of the status page with its current operating state. */
export type StatusPageService = {
  id: string;
  name: string;
  category: string;
  status: ServiceOperatingState;
};

export type IncidentMessage = {
  id: string;
  state: IncidentMessageState;
  title: string;
  body: string;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string | null;
};

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

/** `{ data: { messages: [...] } }` → newest first. */
export function parseIncidentMessages(value: unknown): IncidentMessage[] {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  const rows = data && Array.isArray(data.messages) ? data.messages : [];
  return rows
    .filter(isRecord)
    .flatMap((row) => {
      const id = str(row.id);
      const createdAt = str(row.createdAt);
      const state = INCIDENT_MESSAGE_STATES.find(
        (entry) => entry === row.state,
      );
      return id && createdAt && state
        ? [
            {
              id,
              state,
              title: str(row.title) ?? "",
              body: str(row.body) ?? "",
              serviceIds: Array.isArray(row.serviceIds)
                ? row.serviceIds.filter(
                    (entry): entry is string => typeof entry === "string",
                  )
                : [],
              createdAt,
              updatedAt: str(row.updatedAt),
            },
          ]
        : [];
    })
    .sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    );
}

/** Services from service-status `getStatusOverview`, sorted by name. */
export function parseStatusPageServices(value: unknown): StatusPageService[] {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  const rows = data && Array.isArray(data.services) ? data.services : [];
  return rows
    .filter(isRecord)
    .flatMap((row) => {
      const id = str(row.id);
      const name = str(row.name);
      const status = SERVICE_OPERATING_STATES.find(
        (entry) => entry === row.status,
      );
      if (!id || !name || !status) return [];
      const path = Array.isArray(row.categoryPath)
        ? row.categoryPath.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      return [{ id, name, category: path.join(" › "), status }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
}

/**
 * Suggested operating state for a service newly added to a message: an
 * already disturbed service keeps its state, otherwise «Teilweiser Ausfall»
 * (or «Betriebsbereit» once the message reports the issue as resolved).
 */
export function suggestedServiceState(
  current: ServiceOperatingState,
  messageState: IncidentMessageState,
): ServiceOperatingState {
  if (messageState === "resolved") return "operational";
  return current === "operational" ? "partial_outage" : current;
}

/** Services whose name or category contain every word of the query. */
export function filterStatusPageServices(
  services: readonly StatusPageService[],
  query: string,
): StatusPageService[] {
  const words = query.toLocaleLowerCase("de-CH").split(/\s+/).filter(Boolean);
  if (!words.length) return [...services];
  return services.filter((service) => {
    const text = `${service.name} ${service.category}`.toLocaleLowerCase(
      "de-CH",
    );
    return words.every((word) => text.includes(word));
  });
}
