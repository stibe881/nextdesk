export type ServiceAvailabilityStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";

export type ServiceStatusHistoryInput = {
  history: Array<{ changedAt: string; status: ServiceAvailabilityStatus }>;
  status: ServiceAvailabilityStatus;
};

/**
 * Resolves one status per local calendar day. The first history item may be a
 * server-authorized baseline from before the visible 90-day window.
 */
export function buildServiceStatusHistoryDays(
  service: ServiceStatusHistoryInput,
  now = new Date(),
): ServiceAvailabilityStatus[] {
  const days = Array.from({ length: 90 }, (_, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (89 - index));
    day.setHours(0, 0, 0, 0);
    const start = day.getTime();
    day.setHours(23, 59, 59, 999);
    return { end: day.getTime(), start };
  });
  const events = [...service.history]
    .map((event) => ({
      ...event,
      timestamp: new Date(event.changedAt).getTime(),
    }))
    .filter((event) => Number.isFinite(event.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);

  let eventIndex = 0;
  let activeStatus = service.status;
  const firstDayStart = days[0]?.start ?? now.getTime();
  while (
    eventIndex < events.length &&
    events[eventIndex]!.timestamp < firstDayStart
  ) {
    activeStatus = events[eventIndex]!.status;
    eventIndex += 1;
  }

  return days.map((day) => {
    while (
      eventIndex < events.length &&
      events[eventIndex]!.timestamp <= day.end
    ) {
      activeStatus = events[eventIndex]!.status;
      eventIndex += 1;
    }
    return activeStatus;
  });
}
