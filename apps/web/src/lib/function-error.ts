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
    case "tenant_sso_required":
      return "Für diesen Mandanten ist die Anmeldung über das Unternehmens-SSO erforderlich.";
    case "tenant_sso_membership_required":
    case "tenant_invitation_required":
      return "Ihr Unternehmenslogin wurde erkannt, aber Sie sind für diesen Mandanten noch nicht eingeladen. Bitte wenden Sie sich an die Mandantenadministration.";
    case "tenant_sso_identity_mismatch":
    case "sso_tenant_claim_mismatch":
      return "Die Entra-Identität passt nicht zur SSO-Konfiguration dieses Mandanten.";
    case "sso_tenant_claim_required":
      return "Die Entra-Anmeldung enthält keinen prüfbaren Mandantenbezug. Bitte wenden Sie sich an die Mandantenadministration.";
    case "sso_email_claim_required":
      return "Ihre Entra-Anmeldung enthält keine verwendbare Unternehmens-E-Mail-Adresse. Bitte wenden Sie sich an die Mandantenadministration.";
    case "tenant_person_removed":
      return "Ihr Zugang zu diesem Mandanten wurde deaktiviert. Bitte wenden Sie sich an die Mandantenadministration.";
    case "sso_person_provision_failed":
    case "sso_domain_lookup_failed":
      return "Ihre Person konnte für diesen Mandanten nicht automatisch eingerichtet werden. Bitte versuchen Sie es erneut oder wenden Sie sich an die Mandantenadministration.";
    case "sso_configuration_not_active":
    case "sso_configuration_not_found":
    case "sso_issuer_and_discovery_required":
    case "sso_email_domain_required":
      return "Die SSO-Konfiguration dieses Mandanten ist noch nicht vollständig aktiv.";
    case "directory_sso_binding_required":
      return "Für das Entra-Verzeichnis ist eine aktive, mandantenspezifische Microsoft-Entra-SSO-Konfiguration erforderlich.";
    case "directory_sync_not_ready":
      return "Der Entra-Verzeichnisconnector ist noch nicht bereit. Speichern und prüfen Sie zuerst die gebundene Konfiguration.";
    case "directory_connection_failed":
      return "Die Entra-Verbindung konnte nicht geprüft werden. Kontrollieren Sie die Freigabe und versuchen Sie es später erneut.";
    case "directory_sync_in_progress":
      return "Für diesen Mandanten läuft bereits ein Entra-Abgleich. Bitte warten Sie, bis dieser abgeschlossen ist.";
    case "directory_sync_failed":
      return "Der Entra-Abgleich konnte nicht abgeschlossen werden. Es wurden keine technischen Providerdetails angezeigt.";
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
    case "bulk_ticket_delete_permission_denied":
    case "bulk_ticket_delete_tenant_access_denied":
      return "Für die ausgewählten Tickets fehlt Ihnen mindestens eine erforderliche Berechtigung.";
    case "saved_view_not_found":
      return "Die gespeicherte Ansicht ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.";
    case "bulk_status_target_missing":
    case "bulk_ticket_delete_target_missing":
      return "Mindestens eines der ausgewählten Tickets ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.";
    case "bulk_status_invalid":
      return "Die ausgewählten Tickets oder der gewünschte Status sind ungültig. Bitte laden Sie die Ticketliste neu.";
    case "bulk_ticket_delete_invalid":
      return "Die ausgewählten Tickets sind ungültig. Bitte laden Sie die Ticketliste neu.";
    case "bulk_status_close_confirmation_required":
      return "Bitte bestätigen Sie den Abschluss der ausgewählten Tickets ausdrücklich.";
    case "bulk_ticket_delete_confirmation_required":
      return "Bitte bestätigen Sie die endgültige Löschung der ausgewählten Tickets ausdrücklich.";
    case "bulk_ticket_delete_legal_hold":
      return "Die endgültige Löschung ist für diesen Mandanten wegen eines aktiven Legal Hold gesperrt.";
    case "ticket_close_confirmation_required":
      return "Bitte bestätigen Sie den Ticketabschluss ausdrücklich, bevor der geschlossene Status gespeichert wird.";
    case "ticket_feature_disabled":
      return "Diese Ticketfunktion ist für Ihren Mandanten derzeit deaktiviert.";
    case "asset_feature_disabled":
      return "Asset-Management ist für Ihren Mandanten derzeit deaktiviert.";
    case "asset_integration_manage_required":
      return "Für die Intune-Konfiguration und lokale Prüfungen fehlt Ihnen die erforderliche Berechtigung.";
    case "intune_preflight_not_ready":
      return "Die lokale Intune-Prüfung ist noch nicht bereit. Speichern Sie zuerst die gebundene Konfiguration.";
    case "intune_preflight_not_found":
      return "Der angeforderte lokale Intune-Prüflauf ist nicht mehr verfügbar.";
    case "intune_configuration_read_failed":
    case "intune_preflight_read_failed":
      return "Die lokale Intune-Konfiguration konnte nicht sicher verarbeitet werden. Bitte laden Sie die Ansicht neu.";
    case "knowledge_feature_disabled":
      return "Die Wissensdatenbank ist für Ihren Mandanten derzeit deaktiviert.";
    case "reporting_feature_disabled":
      return "Service-Reporting ist für Ihren Mandanten derzeit deaktiviert.";
    case "sla_feature_disabled":
    case "automation_feature_inactive":
      return "Die SLA-Automatisierung ist für Ihren Mandanten derzeit deaktiviert.";
    case "tenant_feature_lookup_failed":
      return "Die Funktionsberechtigung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.";
    case "entra_person_not_active":
      return "Diese Entra-Person ist nicht mehr aktiv und kann deshalb nicht als Support-Agent zugeordnet werden.";
    case "entra_person_removed":
      return "Diese Person wurde aus dem Mandanten entfernt. Reaktivieren Sie sie zuerst über die Personenverwaltung.";
    case "entra_person_already_support_agent":
      return "Diese Person hat bereits einen Support-Agentenzugang aus einer anderen administrativen Zuweisung.";
    case "entra_agent_request_not_configured":
      return "Diese Agentenrolle wurde nicht über die Entra-Zuordnung gesetzt und kann hier nicht aufgehoben werden.";
    case "entra_agent_assignment_managed_separately":
      return "Diese Agentenzuordnung wird über die synchronisierte Entra-Person verwaltet. Ändern Sie sie dort gezielt.";
    case "entra_agent_assignment_lookup_failed":
      return "Die Herkunft der Agentenzuordnung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.";
    case "agent_department_required":
      return "Für eine Agentenzuordnung ist eine aktive Abteilung erforderlich.";
    case "department_not_in_tenant":
      return "Die ausgewählte Abteilung gehört nicht zu diesem Mandanten oder ist nicht mehr aktiv.";
    case "agent_role_not_found":
      return "Die Support-Agentenrolle ist für diesen Mandanten nicht verfügbar. Bitte wenden Sie sich an die Mandantenadministration.";
    case "ticket_category_change_denied":
      return "Sie dürfen die Kategorie dieses Tickets nicht ändern.";
    case "invalid_ticket_category":
      return "Kategorie und Unterkategorie passen nicht zum Ticketbereich. Bitte wählen Sie die Einordnung erneut.";
    case "ticket_tags_retired":
      return "Tags werden in nextDesk nicht mehr verwendet. Bitte nutzen Sie Kategorien und Unterkategorien.";
    case "rate_limited":
      return "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
    case "outside_work_hours":
      return "Einchecken ist nur während der Arbeitszeit möglich.";
    case "check_in_not_required":
      return "Für diesen Mandanten ist kein Check-in erforderlich.";
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
