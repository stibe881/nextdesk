type ErrorEnvelope = {
  error?: {
    code?: unknown;
    title?: unknown;
    detail?: unknown;
    retryable?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.code === "string" ? value.error.code : null;
}

async function errorPayload(error: unknown): Promise<ErrorEnvelope | null> {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (!(context instanceof Response)) return null;

  try {
    const parsed = await context.clone().json();
    return isRecord(parsed) ? (parsed as ErrorEnvelope) : null;
  } catch {
    return null;
  }
}

export function functionErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  const context = error.context;
  if (context instanceof Response) return context.status;
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

/**
 * Converts a backend failure into a concise, non-technical user message.
 * Backend messages are deliberately not exposed so database/provider details
 * cannot leak into tenant-facing screens.
 */
export async function functionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const payload = await errorPayload(error);
  const code = errorCode(payload);
  const status = functionErrorStatus(error);

  switch (code) {
    case "invalid_request":
    case "validation_failed":
      return "Die Eingaben sind unvollständig oder ungültig. Bitte prüfen Sie die markierten Felder.";
    case "tenant_admin_required":
    case "permission_denied":
    case "forbidden":
      return "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.";
    case "not_found":
    case "ticket_not_found":
      return "Der angeforderte Eintrag ist nicht mehr verfügbar oder Sie haben keinen Zugriff darauf.";
    case "conflict":
    case "version_conflict":
      return "Die Daten wurden inzwischen geändert. Bitte laden Sie die Ansicht neu und versuchen Sie es erneut.";
    case "saved_view_name_conflict":
      return "Dieser Name wird für eine Ansicht mit derselben Sichtbarkeit bereits verwendet. Bitte wählen Sie einen anderen Namen.";
    case "saved_view_tenant_access_denied":
    case "saved_view_manage_denied":
      return "Für diese gespeicherte Ansicht fehlt Ihnen die erforderliche Berechtigung.";
    case "bulk_status_permission_denied":
    case "bulk_status_tenant_access_denied":
      return "Für die ausgewählten Tickets fehlt Ihnen mindestens eine erforderliche Berechtigung.";
    case "saved_view_not_found":
      return "Die gespeicherte Ansicht ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.";
    case "bulk_status_target_missing":
      return "Mindestens eines der ausgewählten Tickets ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.";
    case "bulk_status_invalid":
      return "Die ausgewählten Tickets oder der gewünschte Status sind ungültig. Bitte laden Sie die Ticketliste neu.";
    case "rate_limited":
      return "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
    case "authorization_check_failed":
    case "audit_log_read_failed":
    case "audit_log_actor_read_failed":
      return "Die Berechtigungsprüfung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.";
    default:
      break;
  }

  if (status === 401) {
    return "Ihre Anmeldung ist nicht mehr gültig. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.";
  }
  if (status === 409) {
    return "Die Daten wurden inzwischen geändert. Bitte laden Sie die Ansicht neu und versuchen Sie es erneut.";
  }
  if (status === 422) {
    return "Die Eingaben sind unvollständig oder ungültig. Bitte prüfen Sie die markierten Felder.";
  }
  if (status === 429) {
    return "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
  }
  if (status !== null && status >= 500) {
    return "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in wenigen Minuten erneut.";
  }

  return fallback;
}
