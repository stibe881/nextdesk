export type TeamQueuesPanelState = "loading" | "ready" | "unavailable";

export function shouldShowTeamQueuesPanel(
  state: TeamQueuesPanelState,
): boolean {
  return state !== "unavailable";
}
