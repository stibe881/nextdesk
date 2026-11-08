import type {
  SoftwareAssignmentMode,
  SoftwareLink,
  SoftwareStatus,
} from "./shop";

/** Software-Artikel im Shop: Intune-Verknüpfung und Zuweisungsstand. */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string): boolean {
  return GUID.test(value.trim());
}

export type SoftwareDraft = {
  enabled: boolean;
  appId: string;
  appName: string;
  groupId: string;
  mode: SoftwareAssignmentMode;
  ensureAppAssignment: boolean;
};

export const EMPTY_SOFTWARE_DRAFT: SoftwareDraft = {
  enabled: false,
  appId: "",
  appName: "",
  groupId: "",
  mode: "user_group",
  ensureAppAssignment: false,
};

export function softwareDraftFromLink(
  link: SoftwareLink | null | undefined,
): SoftwareDraft {
  if (!link) return { ...EMPTY_SOFTWARE_DRAFT };
  return {
    enabled: true,
    appId: link.appId,
    appName: link.appName ?? "",
    groupId: link.groupId,
    mode: link.mode,
    ensureAppAssignment: link.ensureAppAssignment,
  };
}

/** Wert für das Feld `software` beim Speichern, oder eine Fehlermeldung. */
export function softwarePayload(
  draft: SoftwareDraft,
  kind: "order" | "loan",
): { value: SoftwareLink | null } | { error: string } {
  if (!draft.enabled) return { value: null };
  if (kind !== "order") {
    return { error: "Software kann nur bestellt, nicht ausgeliehen werden." };
  }
  if (!isGuid(draft.appId)) {
    return {
      error: "Bitte eine Intune-App wählen oder ihre ID (GUID) eintragen.",
    };
  }
  if (!isGuid(draft.groupId)) {
    return { error: "Bitte die Objekt-ID der Entra-Gruppe (GUID) eintragen." };
  }
  return {
    value: {
      appId: draft.appId.trim().toLowerCase(),
      appName: draft.appName.trim() || null,
      mode: draft.mode,
      groupId: draft.groupId.trim().toLowerCase(),
      ensureAppAssignment: draft.ensureAppAssignment,
    },
  };
}

export const SOFTWARE_STATUS_LABEL: Record<SoftwareStatus, string> = {
  pending: "Wird installiert",
  installing: "Wird installiert",
  assigned: "Zugewiesen",
  failed: "Fehler",
};

/** Farbton (status-tokens.css) für den Zuweisungsstand. */
export function softwareTone(
  status: SoftwareStatus,
): "info" | "success" | "danger" {
  if (status === "assigned") return "success";
  if (status === "failed") return "danger";
  return "info";
}

/** Apps nach Suchtext filtern (Name oder Herausgeber). */
export function filterIntuneApps<
  T extends { displayName: string; publisher: string | null },
>(apps: T[], query: string, limit = 50): T[] {
  const needle = query.trim().toLocaleLowerCase("de");
  const matches = needle
    ? apps.filter((app) =>
        `${app.displayName} ${app.publisher ?? ""}`
          .toLocaleLowerCase("de")
          .includes(needle),
      )
    : apps;
  return matches.slice(0, limit);
}
