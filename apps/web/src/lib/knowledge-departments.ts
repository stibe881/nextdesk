export type KnowledgeDepartment = { id: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Departments the person may file articles under (from `listArticles`).
 * Missing means none; anything malformed is rejected.
 */
export function parseKnowledgeDepartments(
  value: unknown,
): KnowledgeDepartment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const departments: KnowledgeDepartment[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.name !== "string" ||
      !item.name.trim()
    ) {
      return null;
    }
    departments.push({ id: item.id, name: item.name.trim() });
  }
  return departments;
}

/** An article's department; missing means none, other types are invalid. */
export function parseKnowledgeArticleDepartmentId(
  value: unknown,
): { valid: true; departmentId: string | null } | { valid: false } {
  if (value === undefined || value === null) {
    return { valid: true, departmentId: null };
  }
  return typeof value === "string" && value
    ? { valid: true, departmentId: value }
    : { valid: false };
}

/** Department names are shown only when the person works in several. */
export function knowledgeDepartmentLabel(
  departmentId: string | null,
  departments: readonly KnowledgeDepartment[],
): string | null {
  if (departments.length <= 1 || !departmentId) return null;
  return (
    departments.find((department) => department.id === departmentId)?.name ??
    null
  );
}

/**
 * Department preselected in the editor: the article's own, else the only
 * option. With several options a new article starts without a choice.
 */
export function initialKnowledgeDepartmentId(
  departmentId: string | null,
  departments: readonly KnowledgeDepartment[],
): string | null {
  if (departmentId) return departmentId;
  return departments.length === 1 ? (departments[0]?.id ?? null) : null;
}
