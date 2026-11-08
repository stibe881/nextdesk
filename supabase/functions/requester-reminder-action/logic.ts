export type ReminderActionError = {
  status: number;
  code: string;
  message: string;
};

const ERRORS: Record<string, Omit<ReminderActionError, "code">> = {
  invalid_request: { status: 400, message: "Die Anfrage ist ungültig." },
  token_invalid: {
    status: 400,
    message: "Dieser Link ist ungültig. Bitte öffnen Sie das Ticket im Portal.",
  },
  token_expired: {
    status: 410,
    message: "Dieser Link ist abgelaufen. Bitte öffnen Sie das Ticket im Portal.",
  },
  token_used: {
    status: 409,
    message: "Dieser Link wurde bereits verwendet.",
  },
  actions_disabled: {
    status: 409,
    message: "Diese Aktion ist nicht mehr verfügbar. Bitte antworten Sie auf die E-Mail.",
  },
  ticket_not_waiting: {
    status: 409,
    message: "Das Ticket wartet nicht mehr auf Ihre Rückmeldung.",
  },
  ticket_not_available: {
    status: 404,
    message: "Das Ticket ist nicht verfügbar.",
  },
  status_rule: {
    status: 409,
    message:
      "Der Status kann gerade nicht geändert werden. Bitte antworten Sie auf die E-Mail.",
  },
  status_missing: {
    status: 409,
    message: "Diese Aktion ist für Ihr Ticket nicht eingerichtet.",
  },
  message_too_long: { status: 422, message: "Die Nachricht ist zu lang." },
  unavailable: {
    status: 503,
    message: "Der Dienst ist gerade nicht erreichbar. Bitte versuchen Sie es später.",
  },
  failed: {
    status: 500,
    message: "Die Aktion konnte nicht abgeschlossen werden.",
  },
};

/** Maps database hints and verification results to safe, German messages. */
export function reminderActionError(code: string): ReminderActionError {
  const known = ERRORS[code];
  if (known) return { code, ...known };
  // Status rules raise their own hints (e.g. ticket_assignee_required).
  if (code.startsWith("ticket_")) return { code: "status_rule", ...ERRORS.status_rule };
  return { code: "failed", ...ERRORS.failed };
}
