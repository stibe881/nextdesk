// Request parsing of the license-reclaim Edge Function (pure, tested).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReclaimAction =
  | { type: "overview"; tenantId: string }
  | { type: "listAssignments"; tenantId: string; licenseId: string }
  | { type: "listPeople"; tenantId: string }
  | {
      type: "assign";
      tenantId: string;
      licenseId: string;
      userId: string | null;
      entraObjectId: string | null;
      note: string | null;
    }
  | {
      type: "release";
      tenantId: string;
      assignmentId: string;
      removeM365: boolean;
      reason: string | null;
    }
  | {
      type: "saveSettings";
      tenantId: string;
      inactivityDays: number;
      useEntraSignIn: boolean;
      allowM365Removal: boolean;
    }
  | { type: "refreshSignIns"; tenantId: string };

const uuid = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.includes("\u0000")) return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return Array.from(text).length <= max ? text : undefined;
}

export function parseAction(
  value: Record<string, unknown>,
): ReclaimAction | null {
  const tenantId = uuid(value.tenantId);
  if (!tenantId || typeof value.type !== "string") return null;
  switch (value.type) {
    case "overview":
    case "listPeople":
    case "refreshSignIns":
      return { type: value.type, tenantId };
    case "listAssignments": {
      const licenseId = uuid(value.licenseId);
      return licenseId
        ? { type: "listAssignments", tenantId, licenseId }
        : null;
    }
    case "assign": {
      const licenseId = uuid(value.licenseId);
      const userId = value.userId == null ? null : uuid(value.userId);
      const entraObjectId =
        value.entraObjectId == null ? null : uuid(value.entraObjectId);
      const note = optionalText(value.note, 500);
      if (
        !licenseId ||
        note === undefined ||
        (value.userId != null && !userId) ||
        (value.entraObjectId != null && !entraObjectId) ||
        (!userId && !entraObjectId)
      ) {
        return null;
      }
      return {
        type: "assign",
        tenantId,
        licenseId,
        userId,
        entraObjectId,
        note,
      };
    }
    case "release": {
      const assignmentId = uuid(value.assignmentId);
      const reason = optionalText(value.reason, 400);
      if (
        !assignmentId ||
        reason === undefined ||
        (value.removeM365 !== undefined &&
          typeof value.removeM365 !== "boolean")
      ) {
        return null;
      }
      return {
        type: "release",
        tenantId,
        assignmentId,
        removeM365: value.removeM365 === true,
        reason,
      };
    }
    case "saveSettings": {
      const days = value.inactivityDays;
      if (
        typeof days !== "number" ||
        !Number.isInteger(days) ||
        days < 7 ||
        days > 365 ||
        typeof value.useEntraSignIn !== "boolean" ||
        typeof value.allowM365Removal !== "boolean"
      ) {
        return null;
      }
      return {
        type: "saveSettings",
        tenantId,
        inactivityDays: days,
        useEntraSignIn: value.useEntraSignIn,
        allowM365Removal: value.allowM365Removal,
      };
    }
    default:
      return null;
  }
}
