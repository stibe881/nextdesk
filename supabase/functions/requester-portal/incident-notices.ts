// Sichtbarkeit von Störungsmeldungen für Mitarbeitende und die Bestellung der
// Push-Mitteilungen «Störungen».

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NoticeServiceLink = {
  noticeId: string;
  name: string;
  active: boolean;
  internal: boolean;
};

/**
 * Agents see every notice with all active services. Employees see no notice
 * that names services of which none is external and active, and only the
 * external service names of the others. Notices without services stay visible.
 */
export function incidentNoticeVisibility(
  links: readonly NoticeServiceLink[],
  agent: boolean,
): { hidden: Set<string>; names: Map<string, string[]> } {
  const linked = new Set<string>();
  const names = new Map<string, string[]>();
  for (const link of links) {
    linked.add(link.noticeId);
    if (!link.active || !link.name) continue;
    if (!agent && link.internal) continue;
    names.set(link.noticeId, [...(names.get(link.noticeId) ?? []), link.name]);
  }
  const hidden = new Set<string>();
  if (!agent) {
    const external = new Set(
      links.filter((link) => link.active && !link.internal).map((link) =>
        link.noticeId
      ),
    );
    for (const id of linked) if (!external.has(id)) hidden.add(id);
  }
  return { hidden, names };
}

/** `serviceIds: null` means all external services. */
export function parseIncidentPushSettings(
  value: Record<string, unknown>,
): { enabled: boolean; serviceIds: string[] | null } | null {
  const allowed = ["type", "tenantId", "enabled", "serviceIds"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  if (typeof value.enabled !== "boolean") return null;
  if (value.serviceIds === null || value.serviceIds === undefined) {
    return { enabled: value.enabled, serviceIds: null };
  }
  if (
    !Array.isArray(value.serviceIds) || value.serviceIds.length > 500 ||
    !value.serviceIds.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    serviceIds: [
      ...new Set((value.serviceIds as string[]).map((id) => id.toLowerCase())),
    ],
  };
}
