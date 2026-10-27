export type CustomerTicketEmailKind =
  "acknowledgement" | "agent_reply" | "resolution" | "test";

type CustomerTicketEmailInput = {
  attachmentNotice: boolean;
  kind: CustomerTicketEmailKind;
  portalName: string;
  subject: string;
  text: string;
  ticketNumber: string;
};

type EmailPresentation = {
  eyebrow: string;
  heading: string;
  replyHint: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function presentation(kind: CustomerTicketEmailKind): EmailPresentation {
  switch (kind) {
    case "acknowledgement":
      return {
        eyebrow: "Ticket erfasst",
        heading: "Ihre Anfrage ist eingegangen",
        replyHint:
          "Sie können direkt auf diese E-Mail antworten. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
    case "resolution":
      return {
        eyebrow: "Ticket aktualisiert",
        heading: "Ihr Ticket wurde als gelöst markiert",
        replyHint:
          "Ist noch etwas offen? Antworten Sie direkt auf diese E-Mail. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
    case "test":
      return {
        eyebrow: "E-Mail-Kanal",
        heading: "Testmail erfolgreich versendet",
        replyHint:
          "Diese Testmail bestätigt die Zustellung über das konfigurierte Support-Postfach.",
      };
    case "agent_reply":
    default:
      return {
        eyebrow: "Neue Nachricht",
        heading: "Antwort zu Ihrem Ticket",
        replyHint:
          "Sie können direkt auf diese E-Mail antworten. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
  }
}

function messageHtml(value: string): string {
  const paragraphs = value
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean);
  const rendered = paragraphs.map(
    (paragraph) =>
      `<p style="margin:0 0 16px;color:#17233c;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;mso-line-height-rule:exactly;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
  );
  return (
    rendered.join("") ||
    '<p style="margin:0;color:#17233c;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">E-Mail ohne Text</p>'
  );
}

/**
 * Renders presentation-only HTML for customer-facing ticket e-mails. All
 * values are escaped locally; callers still own recipient, channel, tenant
 * and threading authorization.
 */
export function renderCustomerTicketEmail(
  input: CustomerTicketEmailInput,
): string {
  const copy = presentation(input.kind);
  const attachmentNotice = input.attachmentNotice
    ? `<tr><td style="padding:0 32px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f2cd74;border-radius:10px;background:#fff8e8;"><tr><td style="padding:14px 16px;color:#6f4e12;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;"><strong>Anhänge im Portal</strong><br>Einige Anhänge sind für den E-Mail-Versand zu gross. Sie stehen im Ticketportal bereit.</td></tr></table></td></tr>`
    : "";

  return `<!doctype html>
<html lang="de-CH">
  <body style="margin:0;padding:0;background:#f4f7fb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;">
      <tr><td align="center" style="padding:28px 16px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dce5f2;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#245fd5;">
            <p style="margin:0;color:#dbe8ff;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:31px;mso-line-height-rule:exactly;">${escapeHtml(copy.heading)}</h1>
          </td></tr>
          <tr><td style="padding:28px 32px 8px;">${messageHtml(input.text)}</td></tr>
          ${attachmentNotice}
          <tr><td style="padding:16px 32px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #dce5f2;border-radius:10px;background:#f8faff;">
              <tr><td style="padding:14px 16px;">
                <p style="margin:0 0 5px;color:#52617a;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">Ihr Ticket</p>
                <p style="margin:0;color:#17233c;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:20px;">${escapeHtml(input.ticketNumber)} · ${escapeHtml(input.subject)}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 32px 28px;">
            <p style="margin:0;color:#52617a;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeHtml(copy.replyHint)}</p>
          </td></tr>
          <tr><td style="padding:16px 32px;border-top:1px solid #e5ebf4;background:#fbfcfe;">
            <p style="margin:0;color:#71809a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">${escapeHtml(input.portalName)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
