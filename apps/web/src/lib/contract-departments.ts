// Departments of contracts and licenses (module contracts.management).

export type DepartmentOption = { id: string; name: string };

/**
 * Department options from a list response (`data.departments`). Entries that
 * are not `{ id, name }` strings are dropped; a missing list (older server)
 * yields no options, so the department picker stays hidden.
 */
export function parseDepartmentOptions(
  data: Record<string, unknown> | null,
): DepartmentOption[] {
  if (!data || !Array.isArray(data.departments)) return [];
  return data.departments.flatMap((item: unknown) =>
    item &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).id === "string" &&
    typeof (item as Record<string, unknown>).name === "string"
      ? [
          {
            id: (item as { id: string }).id,
            name: (item as { name: string }).name,
          },
        ]
      : [],
  );
}

/**
 * Department pre-selected in the form: the record's own one, otherwise the
 * only option (no choice needed), otherwise none.
 */
export function initialDepartmentId(
  recordDepartmentId: string | null | undefined,
  options: DepartmentOption[],
): string {
  if (recordDepartmentId) return recordDepartmentId;
  return options.length === 1 ? (options[0]?.id ?? "") : "";
}

/** Label shown in lists; only when the person works in several departments. */
export function departmentLabel(
  departmentId: string | null | undefined,
  options: DepartmentOption[],
): string | null {
  if (options.length <= 1 || !departmentId) return null;
  return (
    options.find((option) => option.id === departmentId)?.name ??
    "Andere Abteilung"
  );
}
