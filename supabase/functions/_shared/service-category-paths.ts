type Admin = any;

const MAX_CATEGORIES = 1_000;

/**
 * Maps each service category to its name path (top level first). The top level
 * is presented as the location. A failed lookup yields an empty map so a
 * status page never fails because of the optional grouping.
 */
export async function readServiceCategoryPaths(
  admin: Admin,
  tenantId: string,
): Promise<Map<string, string[]>> {
  const result = await admin
    .from("service_categories")
    .select("id, name, parent_id")
    .eq("tenant_id", tenantId)
    .limit(MAX_CATEGORIES);
  if (result.error || !Array.isArray(result.data)) return new Map();
  const byId = new Map<string, { name: string; parentId: string | null }>();
  for (const row of result.data) {
    if (
      row &&
      typeof row.id === "string" &&
      typeof row.name === "string" &&
      (row.parent_id === null || typeof row.parent_id === "string")
    ) {
      byId.set(row.id, { name: row.name.trim(), parentId: row.parent_id });
    }
  }
  const paths = new Map<string, string[]>();
  for (const id of byId.keys()) {
    const path: string[] = [];
    let current: string | null = id;
    for (let depth = 0; current && depth < 3; depth += 1) {
      const category = byId.get(current);
      if (!category) break;
      path.unshift(category.name);
      current = category.parentId;
    }
    paths.set(id, path);
  }
  return paths;
}

export function serviceCategoryPath(
  paths: ReadonlyMap<string, string[]>,
  categoryId: unknown,
): string[] {
  return typeof categoryId === "string" ? (paths.get(categoryId) ?? []) : [];
}
