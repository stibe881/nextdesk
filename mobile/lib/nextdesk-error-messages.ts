// Maps stable nextDesk server error codes to clear German messages. The
// server deliberately returns codes only, so the app never shows raw
// technical texts such as "Edge Function returned a non-2xx status code".
const messagesByCode: Readonly<Record<string, string>> = {
  invalid_request:
    "Die Anfrage war unvollständig oder ungültig. Bitte prüfe deine Eingaben.",
  no_change: "Es gab keine Änderungen zum Speichern.",
  ticket_access_denied: "Du hast keinen Zugriff auf dieses Ticket.",
  ticket_update_denied: "Du darfst dieses Ticket nicht bearbeiten.",
  ticket_close_denied: "Du darfst dieses Ticket nicht abschliessen.",
  ticket_close_confirmation_required:
    "Bitte bestätige zuerst den Abschluss des Tickets.",
  ticket_assign_denied: "Du darfst dieses Ticket nicht zuweisen.",
  status_invalid:
    "Der gewählte Status ist nicht mehr gültig. Bitte lade das Ticket neu.",
  priority_invalid:
    "Die gewählte Priorität ist nicht mehr gültig. Bitte lade das Ticket neu.",
  requester_contact_invalid:
    "Die anfragende Person wurde nicht gefunden. Bitte wähle sie erneut aus.",
  assigned_agent_invalid:
    "Diese Person kann diesem Ticket nicht zugewiesen werden.",
  ticket_agents_lookup_failed:
    "Die verfügbaren Agenten konnten nicht geladen werden. Bitte versuche es erneut.",
  ticket_update_failed:
    "Das Ticket konnte nicht gespeichert werden. Bitte versuche es erneut.",
  ticket_feature_disabled:
    "Diese Funktion ist für deinen Mandanten nicht aktiviert.",
  ticket_feature_lookup_failed:
    "Die Funktionsfreigaben konnten nicht geprüft werden. Bitte versuche es gleich nochmals.",
  internal_note_denied: "Du darfst keine internen Notizen schreiben.",
  external_comment_denied:
    "Du darfst keine Nachrichten an die anfragende Person senden.",
  comment_create_failed:
    "Die Nachricht konnte nicht gespeichert werden. Bitte versuche es erneut.",
  invalid_checklist_item: "Der Checklistenpunkt ist leer oder zu lang.",
  checklist_item_create_failed:
    "Der Checklistenpunkt konnte nicht gespeichert werden.",
  checklist_item_update_failed:
    "Der Checklistenpunkt konnte nicht aktualisiert werden.",
  checklist_item_not_found: "Der Checklistenpunkt wurde nicht gefunden.",
  feature_disabled:
    "Push-Benachrichtigungen sind für deinen Mandanten noch nicht aktiviert.",
  apns_not_configured:
    "Der Apple-Zugang für Push-Benachrichtigungen wird noch eingerichtet.",
  rate_limited:
    "Bitte warte einen Moment, bevor du eine weitere Testmitteilung sendest.",
  device_not_found: "Dieses iPhone ist nicht mehr als Push-Gerät registriert.",
};

function messageForStatus(status: number | undefined): string {
  if (status === 401)
    return "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.";
  if (status === 403) return "Dafür fehlt dir die Berechtigung.";
  if (status === 404) return "Der Eintrag wurde nicht gefunden.";
  if (status === 409)
    return "Der Eintrag wurde inzwischen geändert. Bitte lade ihn neu.";
  if (status === 422)
    return "Die Änderung wurde nicht übernommen. Bitte prüfe deine Eingaben.";
  if (status === 429)
    return "Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.";
  if (status !== undefined && status >= 500)
    return "nextDesk ist gerade nicht erreichbar. Bitte versuche es gleich nochmals.";
  return "Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.";
}

export function nextDeskErrorMessage(
  code: string | null,
  status?: number,
): string {
  if (code && messagesByCode[code]) return messagesByCode[code];
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
