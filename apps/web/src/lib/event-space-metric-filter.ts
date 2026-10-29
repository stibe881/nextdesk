export type EventSpaceMetricFilter =
  | "upcoming"
  | "in_preparation"
  | "ready"
  | "unassigned";

export type EventSpaceMetricRequest = Readonly<{
  assignedAgent?: unknown;
  endsAt: string;
  status: string;
}>;

export const eventSpaceMetricFilterLabels: Record<
  EventSpaceMetricFilter,
  string
> = {
  upcoming: "Bevorstehend",
  in_preparation: "In Vorbereitung",
  ready: "Bereit",
  unassigned: "Nicht zugewiesen",
};

export function matchesEventSpaceMetricFilter(
  request: EventSpaceMetricRequest,
  filter: EventSpaceMetricFilter,
  now: Date,
): boolean {
  if (filter === "upcoming") {
    return (
      request.status !== "completed" &&
      Number.isFinite(Date.parse(request.endsAt)) &&
      new Date(request.endsAt) >= now
    );
  }
  if (filter === "unassigned") {
    return request.status !== "completed" && request.assignedAgent == null;
  }
  return request.status === filter;
}

export function eventSpaceMetricCounts(
  requests: readonly EventSpaceMetricRequest[],
  now: Date,
): Record<EventSpaceMetricFilter, number> {
  return {
    upcoming: requests.filter((request) =>
      matchesEventSpaceMetricFilter(request, "upcoming", now),
    ).length,
    in_preparation: requests.filter((request) =>
      matchesEventSpaceMetricFilter(request, "in_preparation", now),
    ).length,
    ready: requests.filter((request) =>
      matchesEventSpaceMetricFilter(request, "ready", now),
    ).length,
    unassigned: requests.filter((request) =>
      matchesEventSpaceMetricFilter(request, "unassigned", now),
    ).length,
  };
}
