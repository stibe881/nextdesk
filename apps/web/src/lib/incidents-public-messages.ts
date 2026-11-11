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

export type IncidentMessage = {
  id: string;
  state: IncidentMessageState;
  title: string;
  body: string;
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
