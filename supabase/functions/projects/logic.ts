/** Reine Regeln der Projekte-Funktion: Rollen, erlaubte Werte, Datum. */

export const PROJECT_STATUSES = new Set([
  "planning",
  "active",
  "paused",
  "completed",
]);
export const HEALTH = new Set(["green", "yellow", "red"]);
export const TASK_KINDS = new Set(["phase", "milestone", "task"]);
export const TASK_STATUSES = new Set([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);
export const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
export const BILLING_KINDS = new Set(["internal", "billable", "goodwill"]);
export const DEPENDENCY_TYPES = new Set([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);
/** Same list as the private record-attachments bucket accepts. */
export const ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type LinkKind =
  | "ticket"
  | "shop_order"
  | "ipam_prefix"
  | "ipam_vlan"
  | "ipam_address"
  | "monitoring_sensor"
  | "asset";

export const LINK_COLUMNS: Record<LinkKind, string> = {
  ticket: "ticket_id",
  shop_order: "shop_order_id",
  ipam_prefix: "ipam_prefix_id",
  ipam_vlan: "ipam_vlan_id",
  ipam_address: "ipam_address_id",
  monitoring_sensor: "monitoring_sensor_id",
  asset: "asset_id",
};
export const LINK_KINDS = new Set(Object.keys(LINK_COLUMNS));

export type Permissions = { read: boolean; create: boolean; manage: boolean };

export type ProjectRole =
  "manager" | "member" | "viewer" | "guest_comment" | "guest_read";

export type ProjectAccess = {
  role: ProjectRole;
  /** Projektdaten, Mitglieder, Archiv. */
  canAdmin: boolean;
  /** Plan, Zeiten, Dokumente, Verknüpfungen. */
  canEdit: boolean;
  canComment: boolean;
  /** Sieht nur den Plan und als extern Markiertes. */
  isGuest: boolean;
};

const access = (
  role: ProjectRole,
  canAdmin: boolean,
  canEdit: boolean,
  canComment: boolean,
  isGuest: boolean,
): ProjectAccess => ({ role, canAdmin, canEdit, canComment, isGuest });

/**
 * The strongest role wins. null means the project does not exist for this
 * person.
 */
export function accessFor(
  permissions: Permissions,
  leadsProject: boolean,
  memberRole: string | null,
): ProjectAccess | null {
  if (permissions.manage || leadsProject || memberRole === "manager") {
    return access("manager", true, true, true, false);
  }
  if (memberRole === "member")
    return access("member", false, true, true, false);
  if (permissions.read) return access("viewer", false, false, true, false);
  if (memberRole === "guest_comment") {
    return access("guest_comment", false, false, true, true);
  }
  if (memberRole === "guest_read") {
    return access("guest_read", false, false, false, true);
  }
  return null;
}

export function swissToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
