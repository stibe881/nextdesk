// E-Mail-Abo der öffentlichen Statusseite (Edge Function service-status-public).

export type StatusSubscriptionAction = {
  token: string;
  kind: "confirm" | "unsubscribe";
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Bestätigungs- bzw. Abmeldelink aus der Mail (?status-subscription=…). */
export function readStatusSubscriptionAction(
  search: string,
): StatusSubscriptionAction | null {
  const params = new URLSearchParams(search);
  const token = params.get("status-subscription");
  const kind = params.get("status-action");
  if (!token || !UUID.test(token)) return null;
  if (kind !== "confirm" && kind !== "unsubscribe") return null;
  return { token: token.toLowerCase(), kind };
}

/** Entfernt die Abo-Parameter wieder aus der Adresse. */
export function withoutStatusSubscriptionParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("status-subscription");
  url.searchParams.delete("status-action");
  return url.toString();
}

export function isValidSubscriberEmail(value: string): boolean {
  const email = value.trim();
  return email.length >= 3 && email.length <= 320 && EMAIL.test(email);
}

export function statusSubscriptionMessage(
  kind: "subscribe" | "confirm" | "unsubscribe",
  code: string | null,
): { tone: "success" | "error"; text: string } {
  if (code === null) {
    if (kind === "subscribe") {
      return {
        tone: "success",
        text: "Fast geschafft: Bitte bestätigen Sie die Anmeldung über den Link in der E-Mail, die wir Ihnen gerade geschickt haben.",
      };
    }
    return kind === "confirm"
      ? {
          tone: "success",
          text: "Ihre Anmeldung ist bestätigt. Sie erhalten ab jetzt eine E-Mail, wenn sich der Status eines Dienstes ändert.",
        }
      : {
          tone: "success",
          text: "Sie sind abgemeldet und erhalten keine Statusmeldungen mehr.",
        };
  }
  switch (code) {
    case "invalid_email":
      return {
        tone: "error",
        text: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      };
    case "status_subscription_not_found":
      return {
        tone: "error",
        text: "Dieser Link ist nicht mehr gültig. Melden Sie sich bei Bedarf erneut an.",
      };
    case "status_subscription_busy":
      return {
        tone: "error",
        text: "Gerade gehen sehr viele Anmeldungen ein. Bitte versuchen Sie es später erneut.",
      };
    case "status_mail_unavailable":
      return {
        tone: "error",
        text: "E-Mail-Benachrichtigungen sind für diese Statusseite zurzeit nicht verfügbar.",
      };
    default:
      return {
        tone: "error",
        text: "Das hat nicht geklappt. Bitte versuchen Sie es später erneut.",
      };
  }
}
