import type { Tone } from "./status-tones";

/** Intune-Zuweisung einer Software-Bestellzeile (Shop). */
export type SoftwareStatus = "pending" | "installing" | "assigned" | "failed";

export type LineSoftware = {
  deploymentId: string;
  status: SoftwareStatus;
  label: string;
  appName: string;
  errorMessage: string | null;
  assignedAt: string | null;
  canRetry: boolean;
};

export const SOFTWARE_STATUS_LABEL: Record<SoftwareStatus, string> = {
  pending: "Wird installiert",
  installing: "Wird installiert",
  assigned: "Zugewiesen",
  failed: "Fehler",
};

export function softwareStatusLabel(status: string): string {
  return SOFTWARE_STATUS_LABEL[status as SoftwareStatus] ?? "Wird installiert";
}

export function softwareTone(status: string): Tone {
  if (status === "assigned") return "success";
  if (status === "failed") return "danger";
  return "info";
}

/** Hinweis unter dem Status (für die bestellende Person in Du-Form). */
export function softwareHint(software: LineSoftware): string | null {
  if (software.status === "failed") {
    return (
      software.errorMessage ??
      "Die Installation konnte nicht zugewiesen werden."
    );
  }
  if (software.status === "assigned") {
    return "Die Software erscheint in Kürze im Unternehmensportal oder wird automatisch installiert.";
  }
  return "Die Software wird deinem Konto über Intune zugewiesen.";
}

export const SOFTWARE_EVENT_LABEL: Record<string, string> = {
  software_queued: "Software wird zugewiesen",
  software_assigned: "Software zugewiesen",
  software_failed: "Software-Zuweisung fehlgeschlagen",
  software_retry: "Software-Zuweisung neu gestartet",
};
