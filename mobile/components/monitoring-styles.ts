import type { useIncidentStyles } from "@/components/incident-styles";
import type { MonitoringState } from "@/lib/monitoring-model";

/** Badge style of a state (same colours as incidents). */
export function stateBadge(
  styles: ReturnType<typeof useIncidentStyles>,
  state: MonitoringState,
) {
  if (state === "down") return styles.badgeBad;
  if (state === "warning") return styles.badgeWarn;
  if (state === "up") return styles.badgeOk;
  return null;
}

export function stateBar(
  styles: ReturnType<typeof useIncidentStyles>,
  state: MonitoringState,
) {
  if (state === "down") return styles.sevBad;
  if (state === "warning") return styles.sevWarn;
  if (state === "up") return styles.sevOk;
  return null;
}
