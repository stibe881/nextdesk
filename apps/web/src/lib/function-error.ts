import { tn } from "./formality";

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

/** Error code of a failed function call (e.g. "notification_not_found"). */
export async function functionErrorCode(
  error: unknown,
): Promise<string | null> {
  return errorCode(await errorPayload(error));
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
    case "ticket_status_new_locked":
      return "Ein Ticket kann nicht auf «Neu» zurückgesetzt werden.";
    case "ticket_assignee_required":
      return "Der Status «Neu» kann erst geändert werden, wenn das Ticket einer Person zugewiesen ist.";
    case "sla_breach_reason_required":
      return "Bitte zuerst die Ursache der SLA-Verletzung im Ticket erfassen. Danach lässt sich das Ticket lösen oder schliessen.";
    case "ticket_children_open":
      return "Das Ticket kann erst gelöst oder geschlossen werden, wenn alle Teil-Tickets gelöst oder geschlossen sind.";
    case "ticket_required_fields_missing": {
      const labels: Record<string, string> = {
        category: "Kategorie",
        team: "Team",
        assignee: "Zuweisung",
      };
      const fields = (payload?.error as { fields?: unknown } | undefined)
        ?.fields;
      const missing = Array.isArray(fields)
        ? fields
            .map((field) => labels[String(field)])
            .filter((label): label is string => Boolean(label))
        : [];
      return missing.length > 0
        ? `Bevor das Ticket geschlossen werden kann, bitte zuerst ausfüllen: ${missing.join(", ")}.`
        : "Bevor das Ticket geschlossen werden kann, bitte Kategorie, Team und Zuweisung ausfüllen.";
    }
    case "invalid_request":
    case "validation_failed":
      return tn(
        "Die Eingaben sind unvollständig oder ungültig. Bitte prüfe die markierten Felder.",
        "Die Eingaben sind unvollständig oder ungültig. Bitte prüfen Sie die markierten Felder.",
      );
    case "tenant_admin_required":
    case "permission_denied":
    case "forbidden":
      return tn(
        "Für diese Aktion fehlt dir die erforderliche Berechtigung.",
        "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "tenant_sso_required":
      return "Für diesen Mandanten ist die Anmeldung über das Unternehmens-SSO erforderlich.";
    case "tenant_sso_membership_required":
    case "tenant_invitation_required":
      return tn(
        "Dein Unternehmenslogin wurde erkannt, aber du bist für diesen Mandanten noch nicht eingeladen. Bitte wende dich an die Mandantenadministration.",
        "Ihr Unternehmenslogin wurde erkannt, aber Sie sind für diesen Mandanten noch nicht eingeladen. Bitte wenden Sie sich an die Mandantenadministration.",
      );
    case "tenant_sso_identity_mismatch":
    case "sso_tenant_claim_mismatch":
      return "Die Entra-Identität passt nicht zur SSO-Konfiguration dieses Mandanten.";
    case "sso_tenant_claim_required":
      return tn(
        "Die Entra-Anmeldung enthält keinen prüfbaren Mandantenbezug. Bitte wende dich an die Mandantenadministration.",
        "Die Entra-Anmeldung enthält keinen prüfbaren Mandantenbezug. Bitte wenden Sie sich an die Mandantenadministration.",
      );
    case "sso_email_claim_required":
      return tn(
        "Deine Entra-Anmeldung enthält keine verwendbare Unternehmens-E-Mail-Adresse. Bitte wende dich an die Mandantenadministration.",
        "Ihre Entra-Anmeldung enthält keine verwendbare Unternehmens-E-Mail-Adresse. Bitte wenden Sie sich an die Mandantenadministration.",
      );
    case "tenant_person_removed":
      return tn(
        "Dein Zugang zu diesem Mandanten wurde deaktiviert. Bitte wende dich an die Mandantenadministration.",
        "Ihr Zugang zu diesem Mandanten wurde deaktiviert. Bitte wenden Sie sich an die Mandantenadministration.",
      );
    case "sso_person_provision_failed":
    case "sso_domain_lookup_failed":
      return tn(
        "Deine Person konnte für diesen Mandanten nicht automatisch eingerichtet werden. Bitte versuche es erneut oder wende dich an die Mandantenadministration.",
        "Ihre Person konnte für diesen Mandanten nicht automatisch eingerichtet werden. Bitte versuchen Sie es erneut oder wenden Sie sich an die Mandantenadministration.",
      );
    case "sso_configuration_not_active":
    case "sso_configuration_not_found":
    case "sso_issuer_and_discovery_required":
    case "sso_email_domain_required":
      return "Die SSO-Konfiguration dieses Mandanten ist noch nicht vollständig aktiv.";
    case "directory_sso_binding_required":
      return "Für das Entra-Verzeichnis ist eine aktive, mandantenspezifische Microsoft-Entra-SSO-Konfiguration erforderlich.";
    case "directory_sync_not_ready":
      return tn(
        "Der Entra-Verzeichnisconnector ist noch nicht bereit. Speichere und prüfe zuerst die gebundene Konfiguration.",
        "Der Entra-Verzeichnisconnector ist noch nicht bereit. Speichern und prüfen Sie zuerst die gebundene Konfiguration.",
      );
    case "directory_connection_failed":
      return tn(
        "Die Entra-Verbindung konnte nicht geprüft werden. Kontrolliere die Freigabe und versuche es später erneut.",
        "Die Entra-Verbindung konnte nicht geprüft werden. Kontrollieren Sie die Freigabe und versuchen Sie es später erneut.",
      );
    case "directory_sync_in_progress":
      return tn(
        "Für diesen Mandanten läuft bereits ein Entra-Abgleich. Bitte warte, bis dieser abgeschlossen ist.",
        "Für diesen Mandanten läuft bereits ein Entra-Abgleich. Bitte warten Sie, bis dieser abgeschlossen ist.",
      );
    case "directory_sync_failed":
      return "Der Entra-Abgleich konnte nicht abgeschlossen werden. Es wurden keine technischen Providerdetails angezeigt.";
    case "not_found":
    case "ticket_not_found":
      return tn(
        "Der angeforderte Eintrag ist nicht mehr verfügbar oder du hast keinen Zugriff darauf.",
        "Der angeforderte Eintrag ist nicht mehr verfügbar oder Sie haben keinen Zugriff darauf.",
      );
    case "conflict":
    case "version_conflict":
      return tn(
        "Die Daten wurden inzwischen geändert. Bitte lade die Ansicht neu und versuche es erneut.",
        "Die Daten wurden inzwischen geändert. Bitte laden Sie die Ansicht neu und versuchen Sie es erneut.",
      );
    case "saved_view_name_conflict":
      return tn(
        "Dieser Name wird für eine Ansicht mit derselben Sichtbarkeit bereits verwendet. Bitte wähle einen anderen Namen.",
        "Dieser Name wird für eine Ansicht mit derselben Sichtbarkeit bereits verwendet. Bitte wählen Sie einen anderen Namen.",
      );
    case "saved_view_tenant_access_denied":
    case "saved_view_manage_denied":
      return tn(
        "Für diese gespeicherte Ansicht fehlt dir die erforderliche Berechtigung.",
        "Für diese gespeicherte Ansicht fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "bulk_status_permission_denied":
    case "bulk_status_tenant_access_denied":
    case "bulk_ticket_delete_permission_denied":
    case "bulk_ticket_delete_tenant_access_denied":
      return tn(
        "Für die ausgewählten Tickets fehlt dir mindestens eine erforderliche Berechtigung.",
        "Für die ausgewählten Tickets fehlt Ihnen mindestens eine erforderliche Berechtigung.",
      );
    case "saved_view_not_found":
      return tn(
        "Die gespeicherte Ansicht ist nicht mehr verfügbar. Bitte lade die Ticketliste neu.",
        "Die gespeicherte Ansicht ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.",
      );
    case "bulk_status_target_missing":
    case "bulk_ticket_delete_target_missing":
      return tn(
        "Mindestens eines der ausgewählten Tickets ist nicht mehr verfügbar. Bitte lade die Ticketliste neu.",
        "Mindestens eines der ausgewählten Tickets ist nicht mehr verfügbar. Bitte laden Sie die Ticketliste neu.",
      );
    case "bulk_status_invalid":
      return tn(
        "Die ausgewählten Tickets oder der gewünschte Status sind ungültig. Bitte lade die Ticketliste neu.",
        "Die ausgewählten Tickets oder der gewünschte Status sind ungültig. Bitte laden Sie die Ticketliste neu.",
      );
    case "bulk_ticket_delete_invalid":
      return tn(
        "Die ausgewählten Tickets sind ungültig. Bitte lade die Ticketliste neu.",
        "Die ausgewählten Tickets sind ungültig. Bitte laden Sie die Ticketliste neu.",
      );
    case "bulk_status_close_confirmation_required":
      return tn(
        "Bitte bestätige den Abschluss der ausgewählten Tickets ausdrücklich.",
        "Bitte bestätigen Sie den Abschluss der ausgewählten Tickets ausdrücklich.",
      );
    case "bulk_ticket_delete_confirmation_required":
      return tn(
        "Bitte bestätige die endgültige Löschung der ausgewählten Tickets ausdrücklich.",
        "Bitte bestätigen Sie die endgültige Löschung der ausgewählten Tickets ausdrücklich.",
      );
    case "bulk_ticket_delete_legal_hold":
      return "Die endgültige Löschung ist für diesen Mandanten wegen eines aktiven Legal Hold gesperrt.";
    case "bulk_ticket_delete_dependency_blocked":
      return "Dieses Ticket enthält noch einen Eintrag, der vor der endgültigen Löschung zuerst bereinigt werden muss.";
    case "ticket_close_confirmation_required":
      return tn(
        "Bitte bestätige den Ticketabschluss ausdrücklich, bevor der geschlossene Status gespeichert wird.",
        "Bitte bestätigen Sie den Ticketabschluss ausdrücklich, bevor der geschlossene Status gespeichert wird.",
      );
    case "ticket_feature_disabled":
      return tn(
        "Diese Ticketfunktion ist für deinen Mandanten derzeit deaktiviert.",
        "Diese Ticketfunktion ist für Ihren Mandanten derzeit deaktiviert.",
      );
    case "asset_feature_disabled":
      return tn(
        "Asset-Management ist für deinen Mandanten derzeit deaktiviert.",
        "Asset-Management ist für Ihren Mandanten derzeit deaktiviert.",
      );
    case "asset_integration_manage_required":
      return tn(
        "Für die Intune-Konfiguration und lokale Prüfungen fehlt dir die erforderliche Berechtigung.",
        "Für die Intune-Konfiguration und lokale Prüfungen fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "intune_preflight_not_ready":
      return tn(
        "Die lokale Intune-Prüfung ist noch nicht bereit. Speichere zuerst die gebundene Konfiguration.",
        "Die lokale Intune-Prüfung ist noch nicht bereit. Speichern Sie zuerst die gebundene Konfiguration.",
      );
    case "intune_preflight_not_found":
      return "Der angeforderte lokale Intune-Prüflauf ist nicht mehr verfügbar.";
    case "intune_configuration_read_failed":
    case "intune_preflight_read_failed":
      return tn(
        "Die lokale Intune-Konfiguration konnte nicht sicher verarbeitet werden. Bitte lade die Ansicht neu.",
        "Die lokale Intune-Konfiguration konnte nicht sicher verarbeitet werden. Bitte laden Sie die Ansicht neu.",
      );
    case "intune_manual_sync_not_ready":
      return tn(
        "Der manuelle Intune-Abgleich ist noch nicht bereit. Prüfe die gespeicherte Intune-Konfiguration und die Azure-SSO-Bindung.",
        "Der manuelle Intune-Abgleich ist noch nicht bereit. Prüfen Sie die gespeicherte Intune-Konfiguration und die Azure-SSO-Bindung.",
      );
    case "intune_manual_sync_in_progress":
      return tn(
        "Für diesen Mandanten läuft bereits ein manueller Intune-Abgleich. Bitte warte auf dessen Abschluss.",
        "Für diesen Mandanten läuft bereits ein manueller Intune-Abgleich. Bitte warten Sie auf dessen Abschluss.",
      );
    case "intune_manual_sync_invalidated":
      return tn(
        "Die Intune-Konfiguration oder deine Berechtigung wurde geändert. Starte den Abgleich nach dem Neuladen erneut.",
        "Die Intune-Konfiguration oder Ihre Berechtigung wurde geändert. Starten Sie den Abgleich nach dem Neuladen erneut.",
      );
    case "intune_manual_sync_service_unavailable":
      return tn(
        "Der manuelle Intune-Abgleich ist derzeit nicht verfügbar. Bitte versuche es später erneut.",
        "Der manuelle Intune-Abgleich ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.",
      );
    case "intune_provider_not_configured":
      return "Die serverseitige Intune-Anbindung ist noch nicht vollständig eingerichtet. Die Mandantenadministration muss die separate Microsoft-Graph-Anwendung konfigurieren.";
    case "intune_provider_rate_limited":
      return tn(
        "Microsoft Intune begrenzt den Abgleich derzeit. Warte kurz und starte bei Bedarf eine bewusste manuelle Wiederholung.",
        "Microsoft Intune begrenzt den Abgleich derzeit. Warten Sie kurz und starten Sie bei Bedarf eine bewusste manuelle Wiederholung.",
      );
    case "intune_provider_response_invalid":
    case "intune_provider_unavailable":
      return tn(
        "Microsoft Intune konnte nicht sicher verarbeitet werden. Es wurden keine Providerdetails angezeigt; versuche es später erneut.",
        "Microsoft Intune konnte nicht sicher verarbeitet werden. Es wurden keine Providerdetails angezeigt; versuchen Sie es später erneut.",
      );
    case "knowledge_feature_disabled":
      return tn(
        "Die Wissensdatenbank ist für deinen Mandanten derzeit deaktiviert.",
        "Die Wissensdatenbank ist für Ihren Mandanten derzeit deaktiviert.",
      );
    case "article_search_failed":
      return tn(
        "Die Volltextsuche konnte nicht ausgeführt werden. Bitte versuche es erneut.",
        "Die Volltextsuche konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.",
      );
    case "global_search_failed":
    case "global_search_response_invalid":
      return tn(
        "Die globale Suche konnte nicht ausgeführt werden. Bitte versuche es erneut.",
        "Die globale Suche konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.",
      );
    case "event_space_permission_denied":
      return tn(
        "Für die Raumplanung fehlt dir die erforderliche Berechtigung.",
        "Für die Raumplanung fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "event_space_reference_invalid":
      return tn(
        "Der ausgewählte Raum oder die verantwortliche Person ist nicht mehr verfügbar. Bitte wähle die Angaben erneut.",
        "Der ausgewählte Raum oder die verantwortliche Person ist nicht mehr verfügbar. Bitte wählen Sie die Angaben erneut.",
      );
    case "event_space_conflicts_confirmation_required":
      return tn(
        "Es gibt eine Überschneidung. Bitte prüfe den Auftrag und bestätige ihn bei Bedarf ausdrücklich.",
        "Es gibt eine Überschneidung. Bitte prüfen Sie den Auftrag und bestätigen Sie ihn bei Bedarf ausdrücklich.",
      );
    case "event_space_conflict_check_too_broad":
      return tn(
        "Dieser Zeitraum überschneidet sich mit zu vielen bestehenden Aufträgen. Bitte plane einen kürzeren Zeitraum oder eine kleinere Serie.",
        "Dieser Zeitraum überschneidet sich mit zu vielen bestehenden Aufträgen. Bitte planen Sie einen kürzeren Zeitraum oder eine kleinere Serie.",
      );
    case "event_space_template_unavailable":
    case "event_space_service_unavailable":
      return tn(
        "Die Raumplanung ist derzeit nicht verfügbar. Bitte versuche es in wenigen Minuten erneut.",
        "Die Raumplanung ist derzeit nicht verfügbar. Bitte versuchen Sie es in wenigen Minuten erneut.",
      );
    case "event_space_request_not_found":
    case "event_space_task_not_found":
      return tn(
        "Der Raumauftrag oder die Aufgabe ist nicht mehr verfügbar. Bitte lade die Planung neu.",
        "Der Raumauftrag oder die Aufgabe ist nicht mehr verfügbar. Bitte laden Sie die Planung neu.",
      );
    case "onboarding_permission_denied":
      return tn(
        "Für diesen Onboarding-Schritt fehlt dir die erforderliche Berechtigung.",
        "Für diesen Onboarding-Schritt fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "onboarding_reference_invalid":
      return tn(
        "Die gewählte Person, Vorlage, Aufgabe oder Ticketreferenz ist nicht mehr verfügbar. Bitte lade die Ansicht neu.",
        "Die gewählte Person, Vorlage, Aufgabe oder Ticketreferenz ist nicht mehr verfügbar. Bitte laden Sie die Ansicht neu.",
      );
    case "onboarding_entry_not_found":
    case "onboarding_task_not_found":
      return tn(
        "Der Eintritt oder die Onboarding-Aufgabe ist nicht mehr verfügbar. Bitte lade die Ansicht neu.",
        "Der Eintritt oder die Onboarding-Aufgabe ist nicht mehr verfügbar. Bitte laden Sie die Ansicht neu.",
      );
    case "onboarding_conflict":
      return "Diese Ticketverknüpfung besteht bereits.";
    case "onboarding_service_unavailable":
      return tn(
        "Das Onboarding ist derzeit nicht verfügbar. Bitte versuche es in wenigen Minuten erneut.",
        "Das Onboarding ist derzeit nicht verfügbar. Bitte versuchen Sie es in wenigen Minuten erneut.",
      );
    case "reporting_feature_disabled":
      return tn(
        "Service-Reporting ist für deinen Mandanten derzeit deaktiviert.",
        "Service-Reporting ist für Ihren Mandanten derzeit deaktiviert.",
      );
    case "sla_feature_disabled":
    case "automation_feature_inactive":
      return tn(
        "Die SLA-Automatisierung ist für deinen Mandanten derzeit deaktiviert.",
        "Die SLA-Automatisierung ist für Ihren Mandanten derzeit deaktiviert.",
      );
    case "automation_manage_denied":
      return tn(
        "Für die Steuerung von Automatisierungen fehlt dir die erforderliche Berechtigung.",
        "Für die Steuerung von Automatisierungen fehlt Ihnen die erforderliche Berechtigung.",
      );
    case "automation_auto_close_inactive":
      return "Die kontrollierte Ticket-Schliessung ist für diesen Mandanten nicht aktiviert.";
    case "automation_auto_close_candidates_changed":
      return tn(
        "Die geprüften Tickets oder die Regel wurden inzwischen geändert. Erstelle eine neue Vorschau.",
        "Die geprüften Tickets oder die Regel wurden inzwischen geändert. Erstellen Sie eine neue Vorschau.",
      );
    case "automation_auto_close_confirmation_expired":
    case "automation_auto_close_confirmation_unavailable":
      return tn(
        "Die Bestätigungsfreigabe ist nicht mehr verfügbar. Erstelle eine neue Vorschau.",
        "Die Bestätigungsfreigabe ist nicht mehr verfügbar. Erstellen Sie eine neue Vorschau.",
      );
    case "automation_history_query_failed":
      return tn(
        "Die Automationshistorie konnte nicht geladen werden. Bitte lade die Ansicht neu.",
        "Die Automationshistorie konnte nicht geladen werden. Bitte laden Sie die Ansicht neu.",
      );
    case "tenant_feature_lookup_failed":
      return tn(
        "Die Funktionsberechtigung konnte nicht geprüft werden. Bitte versuche es erneut.",
        "Die Funktionsberechtigung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.",
      );
    case "entra_person_not_active":
      return "Diese Entra-Person ist nicht mehr aktiv und kann deshalb nicht als Support-Agent zugeordnet werden.";
    case "entra_person_removed":
      return tn(
        "Diese Person wurde aus dem Mandanten entfernt. Reaktiviere sie zuerst über die Personenverwaltung.",
        "Diese Person wurde aus dem Mandanten entfernt. Reaktivieren Sie sie zuerst über die Personenverwaltung.",
      );
    case "entra_person_already_support_agent":
      return "Diese Person hat bereits einen Support-Agentenzugang aus einer anderen administrativen Zuweisung.";
    case "entra_agent_request_not_configured":
      return "Diese Agentenrolle wurde nicht über die Entra-Zuordnung gesetzt und kann hier nicht aufgehoben werden.";
    case "entra_agent_assignment_managed_separately":
      return tn(
        "Diese Agentenzuordnung wird über die synchronisierte Entra-Person verwaltet. Ändere sie dort gezielt.",
        "Diese Agentenzuordnung wird über die synchronisierte Entra-Person verwaltet. Ändern Sie sie dort gezielt.",
      );
    case "entra_agent_assignment_lookup_failed":
      return tn(
        "Die Herkunft der Agentenzuordnung konnte nicht geprüft werden. Bitte versuche es erneut.",
        "Die Herkunft der Agentenzuordnung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.",
      );
    case "agent_department_required":
      return "Für eine Agentenzuordnung ist eine aktive Abteilung erforderlich.";
    case "department_not_in_tenant":
      return "Die ausgewählte Abteilung gehört nicht zu diesem Mandanten oder ist nicht mehr aktiv.";
    case "agent_role_not_found":
      return tn(
        "Die Support-Agentenrolle ist für diesen Mandanten nicht verfügbar. Bitte wende dich an die Mandantenadministration.",
        "Die Support-Agentenrolle ist für diesen Mandanten nicht verfügbar. Bitte wenden Sie sich an die Mandantenadministration.",
      );
    case "ticket_category_change_denied":
      return tn(
        "Du darfst die Kategorie dieses Tickets nicht ändern.",
        "Sie dürfen die Kategorie dieses Tickets nicht ändern.",
      );
    case "invalid_ticket_category":
      return tn(
        "Kategorie und Unterkategorie passen nicht zum Ticketbereich. Bitte wähle die Einordnung erneut.",
        "Kategorie und Unterkategorie passen nicht zum Ticketbereich. Bitte wählen Sie die Einordnung erneut.",
      );
    case "ticket_tags_retired":
      return tn(
        "Tags werden in nextDesk nicht mehr verwendet. Bitte nutze Kategorien und Unterkategorien.",
        "Tags werden in nextDesk nicht mehr verwendet. Bitte nutzen Sie Kategorien und Unterkategorien.",
      );
    case "ai_provider_not_configured":
      return tn(
        "Die serverseitige Anthropic-Konfiguration ist noch nicht vollständig. Bitte lass API-Zugang und Modell durch die Administration prüfen.",
        "Die serverseitige Anthropic-Konfiguration ist noch nicht vollständig. Bitte lassen Sie API-Zugang und Modell durch die Administration prüfen.",
      );
    case "ai_provider_authentication_failed":
      return tn(
        "Der serverseitige Anthropic-API-Zugang wurde nicht akzeptiert. Bitte prüfe den hinterlegten API-Schlüssel.",
        "Der serverseitige Anthropic-API-Zugang wurde nicht akzeptiert. Bitte prüfen Sie den hinterlegten API-Schlüssel.",
      );
    case "ai_provider_access_denied":
      return tn(
        "Der serverseitige Anthropic-API-Zugang ist für dieses Modell oder diesen Workspace nicht berechtigt. Bitte prüfe die Anbieterfreigabe.",
        "Der serverseitige Anthropic-API-Zugang ist für dieses Modell oder diesen Workspace nicht berechtigt. Bitte prüfen Sie die Anbieterfreigabe.",
      );
    case "ai_provider_model_not_found":
      return tn(
        "Die serverseitig konfigurierte Anthropic-Modellkennung ist nicht verfügbar. Bitte prüfe den hinterlegten Modellwert.",
        "Die serverseitig konfigurierte Anthropic-Modellkennung ist nicht verfügbar. Bitte prüfen Sie den hinterlegten Modellwert.",
      );
    case "ai_provider_request_rejected":
      return tn(
        "Anthropic hat die KI-Anfrage abgelehnt. Bitte prüfe die serverseitige Modellkennung und versuche es erneut.",
        "Anthropic hat die KI-Anfrage abgelehnt. Bitte prüfen Sie die serverseitige Modellkennung und versuchen Sie es erneut.",
      );
    case "ai_provider_rate_limited":
      return tn(
        "Anthropic begrenzt die Aufbereitung derzeit. Bitte warte kurz und starte anschliessend bewusst einen neuen Versuch.",
        "Anthropic begrenzt die Aufbereitung derzeit. Bitte warten Sie kurz und starten Sie anschliessend bewusst einen neuen Versuch.",
      );
    case "ai_provider_request_failed":
    case "ai_provider_response_invalid":
      return tn(
        "Anthropic konnte den Entwurf nicht verarbeiten. Der Artikelentwurf wurde nicht verändert. Bitte versuche es später erneut.",
        "Anthropic konnte den Entwurf nicht verarbeiten. Der Artikelentwurf wurde nicht verändert. Bitte versuchen Sie es später erneut.",
      );
    case "rate_limited":
      return tn(
        "Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment und versuche es erneut.",
        "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
      );
    case "outside_work_hours":
      return "Einchecken ist nur während der Arbeitszeit möglich.";
    case "check_in_not_required":
      return "Für diesen Mandanten ist kein Check-in erforderlich.";
    case "authorization_check_failed":
    case "audit_log_read_failed":
    case "audit_log_actor_read_failed":
      return tn(
        "Die Berechtigungsprüfung konnte nicht abgeschlossen werden. Bitte versuche es erneut.",
        "Die Berechtigungsprüfung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
      );
    default:
      break;
  }

  if (status === 401) {
    return tn(
      "Deine Anmeldung ist nicht mehr gültig. Bitte melde dich erneut an.",
      "Ihre Anmeldung ist nicht mehr gültig. Bitte melden Sie sich erneut an.",
    );
  }
  if (status === 403) {
    return tn(
      "Für diese Aktion fehlt dir die erforderliche Berechtigung.",
      "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
    );
  }
  if (status === 409) {
    return tn(
      "Die Daten wurden inzwischen geändert. Bitte lade die Ansicht neu und versuche es erneut.",
      "Die Daten wurden inzwischen geändert. Bitte laden Sie die Ansicht neu und versuchen Sie es erneut.",
    );
  }
  if (status === 422) {
    return tn(
      "Die Eingaben sind unvollständig oder ungültig. Bitte prüfe die markierten Felder.",
      "Die Eingaben sind unvollständig oder ungültig. Bitte prüfen Sie die markierten Felder.",
    );
  }
  if (status === 429) {
    return tn(
      "Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment und versuche es erneut.",
      "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    );
  }
  if (status !== null && status >= 500) {
    return tn(
      "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuche es in wenigen Minuten erneut.",
      "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in wenigen Minuten erneut.",
    );
  }

  return fallback;
}
