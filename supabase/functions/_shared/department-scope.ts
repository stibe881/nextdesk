// Department scoping for module data (records with a department_id column).
//
// A person sees records of the departments returned by
// userFeatureDepartments(...) for the module, plus records without a
// department. Edge functions that read with the service role apply this
// filter themselves; reads through the user's own client are already limited
// by the restrictive RLS policy `<table>_department_scope` (migration 0177).

import { msg } from "./formality.ts";
import { userFeatureDepartments } from "./tenant-features.ts";

export type DepartmentScope = {
  /** Departments whose records the person may see and edit. */
  departments: string[];
  /** False while the module is off for the whole tenant: nothing is scoped. */
  scoped: boolean;
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function loadDepartmentScope(
  admin: Admin,
  tenantId: string,
  userId: string,
  featureKey: string,
): Promise<DepartmentScope | null> {
  const departments = await userFeatureDepartments(
    admin,
    tenantId,
    userId,
    featureKey,
  );
  if (departments === null) return null;
  return { departments, scoped: true };
}

/** True when the record (by its department_id) is visible in the scope. */
export function departmentVisible(
  scope: DepartmentScope,
  departmentId: unknown,
): boolean {
  if (!scope.scoped) return true;
  if (departmentId === null || departmentId === undefined) return true;
  return scope.departments.includes(String(departmentId));
}

/**
 * Adds the department filter to a PostgREST query on a table with a
 * department_id column (optionally through a prefix for embedded tables).
 */
// deno-lint-ignore no-explicit-any
export function applyDepartmentScope<Q extends { or: (...args: any[]) => Q }>(
  query: Q,
  scope: DepartmentScope,
  column = "department_id",
): Q {
  if (!scope.scoped) return query;
  if (scope.departments.length === 0) return query.or(`${column}.is.null`);
  return query.or(
    `${column}.is.null,${column}.in.(${scope.departments.join(",")})`,
  );
}

/**
 * Department for a new or edited record: the requested one when it is in the
 * scope, otherwise the only department of the person. Throws a readable
 * error message (German) when a choice is needed or not allowed.
 */
export function resolveRecordDepartment(
  scope: DepartmentScope,
  requested: unknown,
): { departmentId: string | null } | { error: string } {
  if (requested === undefined || requested === null || requested === "") {
    if (scope.departments.length === 0) return { departmentId: null };
    if (scope.departments.length === 1) {
      return { departmentId: scope.departments[0] ?? null };
    }
    return { error: msg("Bitte wähle eine Abteilung.", "Bitte wählen Sie eine Abteilung.") };
  }
  const id = String(requested).toLowerCase();
  if (!scope.departments.includes(id)) {
    return { error: "Die Abteilung ist ungültig." };
  }
  return { departmentId: id };
}

/** Names of the departments in the scope, for department pickers. */
export async function scopeDepartmentOptions(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
): Promise<{ id: string; name: string }[]> {
  if (scope.departments.length === 0) return [];
  const { data } = await admin
    .from("departments")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", scope.departments)
    .order("name");
  return ((data ?? []) as { id: string; name: string }[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));
}
