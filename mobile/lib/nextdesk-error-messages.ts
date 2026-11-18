// Maps stable nextDesk server error codes to clear German messages. The
// server deliberately returns codes only, so the app never shows raw
// technical texts such as "Edge Function returned a non-2xx status code".
import { tn } from "./formality";

const messagesByCode = (): Readonly<Record<string, string>> => ({
  invalid_request:
    tn("Die Anfrage war unvollständig oder ungültig. Bitte prüfe deine Eingaben.", "Die Anfrage war unvollständig oder ungültig. Bitte prüfen Sie Ihre Eingaben."),
  no_change: "Es gab keine Änderungen zum Speichern.",
  ticket_access_denied: tn("Du hast keinen Zugriff auf dieses Ticket.", "Sie haben keinen Zugriff auf dieses Ticket."),
  ticket_update_denied: tn("Du darfst dieses Ticket nicht bearbeiten.", "Sie dürfen dieses Ticket nicht bearbeiten."),
  ticket_close_denied: tn("Du darfst dieses Ticket nicht abschliessen.", "Sie dürfen dieses Ticket nicht abschliessen."),
  ticket_close_confirmation_required:
    tn("Bitte bestätige zuerst den Abschluss des Tickets.", "Bitte bestätigen Sie zuerst den Abschluss des Tickets."),
  ticket_assign_denied: tn("Du darfst dieses Ticket nicht zuweisen.", "Sie dürfen dieses Ticket nicht zuweisen."),
  status_invalid:
    tn("Der gewählte Status ist nicht mehr gültig. Bitte lade das Ticket neu.", "Der gewählte Status ist nicht mehr gültig. Bitte laden Sie das Ticket neu."),
  priority_invalid:
    tn("Die gewählte Priorität ist nicht mehr gültig. Bitte lade das Ticket neu.", "Die gewählte Priorität ist nicht mehr gültig. Bitte laden Sie das Ticket neu."),
  requester_contact_invalid:
    tn("Die anfragende Person wurde nicht gefunden. Bitte wähle sie erneut aus.", "Die anfragende Person wurde nicht gefunden. Bitte wählen Sie sie erneut aus."),
  assigned_agent_invalid:
    "Diese Person kann diesem Ticket nicht zugewiesen werden.",
  ticket_agents_lookup_failed:
    tn("Die verfügbaren Agenten konnten nicht geladen werden. Bitte versuche es erneut.", "Die verfügbaren Agenten konnten nicht geladen werden. Bitte versuchen Sie es erneut."),
  ticket_update_failed:
    tn("Das Ticket konnte nicht gespeichert werden. Bitte versuche es erneut.", "Das Ticket konnte nicht gespeichert werden. Bitte versuchen Sie es erneut."),
  ticket_feature_disabled:
    tn("Diese Funktion ist für deinen Mandanten nicht aktiviert.", "Diese Funktion ist für Ihren Mandanten nicht aktiviert."),
  ticket_feature_lookup_failed:
    tn("Die Funktionsfreigaben konnten nicht geprüft werden. Bitte versuche es gleich nochmals.", "Die Funktionsfreigaben konnten nicht geprüft werden. Bitte versuchen Sie es gleich nochmals."),
  internal_note_denied: tn("Du darfst keine internen Notizen schreiben.", "Sie dürfen keine internen Notizen schreiben."),
  external_comment_denied:
    tn("Du darfst keine Nachrichten an die anfragende Person senden.", "Sie dürfen keine Nachrichten an die anfragende Person senden."),
  comment_create_failed:
    tn("Die Nachricht konnte nicht gespeichert werden. Bitte versuche es erneut.", "Die Nachricht konnte nicht gespeichert werden. Bitte versuchen Sie es erneut."),
  invalid_checklist_item: "Der Checklistenpunkt ist leer oder zu lang.",
  checklist_item_create_failed:
    "Der Checklistenpunkt konnte nicht gespeichert werden.",
  checklist_item_update_failed:
    "Der Checklistenpunkt konnte nicht aktualisiert werden.",
  checklist_item_not_found: "Der Checklistenpunkt wurde nicht gefunden.",
  feature_disabled:
    tn("Push-Benachrichtigungen sind für deinen Mandanten noch nicht aktiviert.", "Push-Benachrichtigungen sind für Ihren Mandanten noch nicht aktiviert."),
  apns_not_configured:
    "Der Apple-Zugang für Push-Benachrichtigungen wird noch eingerichtet.",
  rate_limited:
    tn("Bitte warte einen Moment, bevor du eine weitere Testmitteilung sendest.", "Bitte warten Sie einen Moment, bevor Sie eine weitere Testmitteilung senden."),
  device_not_found: "Dieses iPhone ist nicht mehr als Push-Gerät registriert.",
  outside_work_hours: "Einchecken ist nur während der Arbeitszeit möglich.",
  check_in_not_required: tn("Für deinen Mandanten ist kein Check-in nötig.", "Für Ihren Mandanten ist kein Check-in nötig."),
});

function messageForStatus(status: number | undefined): string {
  if (status === 401)
    return tn("Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.", "Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.");
  if (status === 403) return tn("Dafür fehlt dir die Berechtigung.", "Dafür fehlt Ihnen die Berechtigung.");
  if (status === 404) return "Der Eintrag wurde nicht gefunden.";
  if (status === 409)
    return tn("Der Eintrag wurde inzwischen geändert. Bitte lade ihn neu.", "Der Eintrag wurde inzwischen geändert. Bitte laden Sie ihn neu.");
  if (status === 422)
    return tn("Die Änderung wurde nicht übernommen. Bitte prüfe deine Eingaben.", "Die Änderung wurde nicht übernommen. Bitte prüfen Sie Ihre Eingaben.");
  if (status === 429)
    return tn("Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.", "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment.");
  if (status !== undefined && status >= 500)
    return tn("nextDesk ist gerade nicht erreichbar. Bitte versuche es gleich nochmals.", "nextDesk ist gerade nicht erreichbar. Bitte versuchen Sie es gleich nochmals.");
  return tn("Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.", "Die Aktion konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.");
}

export function nextDeskErrorMessage(
  code: string | null,
  status?: number,
): string {
  const known = code ? messagesByCode()[code] : undefined;
  if (known) return known;
  const base = messageForStatus(status);
  // Unknown codes stay visible as a short reference for support requests.
  return code && /^[a-z0-9_.-]{1,80}$/i.test(code)
    ? `${base} (Code: ${code})`
    : base;
}

export class NextDeskRequestError extends Error {
  readonly code: string | null;
  readonly status: number | undefined;

  constructor(message: string, code: string | null, status?: number) {
    super(message);
    this.name = "NextDeskRequestError";
    this.code = code;
    this.status = status;
  }
}
