// Empfänger einer Push-Mitteilung: alle, nach Rolle oder nach Abteilung.

export type AudienceKind = "all" | "roles" | "departments";

export type Audience = { kind: AudienceKind; ids: string[] };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAudience(value: unknown): Audience | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { kind?: unknown; ids?: unknown };
  if (record.kind === "all") return { kind: "all", ids: [] };
  if (record.kind !== "roles" && record.kind !== "departments") return null;
  if (!Array.isArray(record.ids)) return null;
  const ids = [
    ...new Set(
      record.ids
        .filter((id): id is string => typeof id === "string" && UUID.test(id))
        .map((id) => id.toLowerCase()),
    ),
  ];
  if (ids.length === 0 || ids.length > 50) return null;
  return { kind: record.kind, ids };
}

/** Personen (user_id) des Arbeitsbereichs, die zur Zielgruppe gehören. */
export async function resolveAudienceUsers(
  admin: any,
  tenantId: string,
  audience: Audience,
): Promise<string[]> {
  const { data: members } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  const active = new Set<string>(
    ((members ?? []) as { user_id: string }[]).map((row) => row.user_id),
  );
  if (audience.kind === "all") return [...active];

  const selected = new Set<string>();
  if (audience.kind === "departments") {
    const { data: departments } = await admin
      .from("departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", audience.ids);
    const departmentIds = ((departments ?? []) as { id: string }[]).map(
      (row) => row.id,
    );
    if (departmentIds.length === 0) return [];
    const { data: rows } = await admin
      .from("department_memberships")
      .select("user_id")
      .eq("status", "active")
      .in("department_id", departmentIds);
    for (const row of (rows ?? []) as { user_id: string }[]) {
      selected.add(row.user_id);
    }
  } else {
    const now = new Date().toISOString();
    const { data: roles } = await admin
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .in("id", audience.ids);
    const roleIds = ((roles ?? []) as { id: string }[]).map((row) => row.id);
    if (roleIds.length === 0) return [];
    const { data: rows } = await admin
      .from("user_role_assignments")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .in("role_id", roleIds)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`);
    for (const row of (rows ?? []) as { user_id: string }[]) {
      selected.add(row.user_id);
    }
  }
  return [...selected].filter((userId) => active.has(userId));
}
