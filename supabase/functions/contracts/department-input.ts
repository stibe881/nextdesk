// Department of contracts and licenses (both module contracts.management).
// Pure helpers, shared by the contracts and licenses edge functions.

import {
  type DepartmentScope,
  resolveRecordDepartment,
} from "../_shared/department-scope.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The optional `departmentId` of submitted values: undefined when not sent
 * (older clients), null for "no choice", a lower-case UUID, or false when the
 * value is malformed.
 */
export function parseDepartmentInput(
  values: Record<string, unknown>,
): string | null | undefined | false {
  if (!("departmentId" in values)) return undefined;
  const value = values.departmentId;
  if (value === null || value === "") return null;
  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : false;
}

/**
 * Department to store on a create (existing: undefined) or an update.
 * `{ keep: true }`: leave the stored department unchanged.
 */
export function departmentForSave(
  scope: DepartmentScope,
  requested: string | null | undefined,
  existing?: string | null,
): { departmentId: string | null } | { keep: true } | { error: string } {
  if (existing !== undefined) {
    // Not sent, or unchanged: an edit never forces a new choice.
    if (requested === undefined || requested === (existing ?? null)) {
      return { keep: true };
    }
  }
  return resolveRecordDepartment(scope, requested);
}
