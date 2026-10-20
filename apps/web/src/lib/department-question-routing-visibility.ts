export type DepartmentQuestionRoutingState =
  "loading" | "ready" | "unavailable";

export function shouldShowDepartmentQuestionRouting(
  state: DepartmentQuestionRoutingState,
): boolean {
  return state !== "unavailable";
}
