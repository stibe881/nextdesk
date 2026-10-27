export type CustomerTicketEmailKind =
  "acknowledgement" | "agent_reply" | "resolution" | "test";

export type CustomerTicketEmailBrand = {
  accentColor: string;
  displayName: string;
  logoContentId: string | null;
  primaryColor: string;
  secondaryColor: string;
};

type CustomerTicketEmailInput = {
  attachmentNotice: boolean;
  branding: CustomerTicketEmailBrand;
  kind: CustomerTicketEmailKind;
  subject: string;
  text: string;
  ticketNumber: string;
};

type EmailPresentation = {
  eyebrow: string;
  intro: string;
  replyHint: string;
};

const DEFAULT_BRANDING: CustomerTicketEmailBrand = {
  accentColor: "#14B8A6",
  displayName: "nextDesk",
  logoContentId: null,
  primaryColor: "#2563EB",
  secondaryColor: "#0F172A",
};
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CONTENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

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

function color(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

/**
 * Keeps presentation values bounded before they become HTML attributes or
 * Outlook styles. The mail worker owns the server-side source of these values.
 */
export function normalizeCustomerTicketEmailBranding(
  input: Partial<CustomerTicketEmailBrand>,
): CustomerTicketEmailBrand {
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim().slice(0, 120)
      : DEFAULT_BRANDING.displayName;
  const logoContentId =
    typeof input.logoContentId === "string" &&
    CONTENT_ID.test(input.logoContentId)
      ? input.logoContentId
      : null;
  return {
    accentColor: color(input.accentColor, DEFAULT_BRANDING.accentColor),
    displayName,
    logoContentId,
    primaryColor: color(input.primaryColor, DEFAULT_BRANDING.primaryColor),
    secondaryColor: color(
      input.secondaryColor,
      DEFAULT_BRANDING.secondaryColor,
    ),
  };
}

function presentation(kind: CustomerTicketEmailKind): EmailPresentation {
  switch (kind) {
    case "acknowledgement":
      return {
        eyebrow: "Ticket erfasst",
        intro: "Ihre Anfrage ist eingegangen.",
        replyHint:
          "Sie können direkt auf diese E-Mail antworten. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
    case "resolution":
      return {
        eyebrow: "Ticket gelöst",
        intro: "Ihr Ticket wurde als gelöst markiert.",
        replyHint:
          "Ist noch etwas offen? Antworten Sie direkt auf diese E-Mail. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
    case "test":
      return {
        eyebrow: "E-Mail-Kanal",
        intro: "Testmail erfolgreich versendet.",
        replyHint:
          "Diese Testmail bestätigt die Zustellung über das konfigurierte Support-Postfach.",
      };
    case "agent_reply":
    default:
      return {
        eyebrow: "Neue Nachricht zu Ihrem Ticket",
        intro: "Sie haben eine neue Antwort erhalten.",
        replyHint:
          "Sie können direkt auf diese E-Mail antworten. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      };
  }
}

function messageHtml(value: string, secondaryColor: string): string {
  const paragraphs = value
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean);
  const rendered = paragraphs.map(
    (paragraph) =>
      `<p style="margin:0 0 16px;color:${secondaryColor};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;mso-line-height-rule:exactly;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
  );
  return (
    rendered.join("") ||
    `<p style="margin:0;color:${secondaryColor};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;">E-Mail ohne Text</p>`
  );
}

function brandMark(branding: CustomerTicketEmailBrand): string {
  if (branding.logoContentId) {
    return `<img src="cid:${escapeHtml(branding.logoContentId)}" width="112" alt="${escapeHtml(branding.displayName)}" style="display:block;max-width:112px;height:auto;border:0;outline:none;text-decoration:none;">`;
  }
  return `<span style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:20px;">${escapeHtml(branding.displayName)}</span>`;
}

/**
 * Renders presentation-only, Outlook-friendly HTML for customer-facing ticket
 * e-mails. All dynamic values are escaped locally; callers still own recipient,
 * channel, tenant and threading authorization.
 */
export function renderCustomerTicketEmail(
  input: CustomerTicketEmailInput,
): string {
  const branding = normalizeCustomerTicketEmailBranding(input.branding);
  const copy = presentation(input.kind);
  const attachmentNotice = input.attachmentNotice
    ? `<tr><td style="padding:0 32px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #F2CD74;border-radius:10px;background:#FFF8E8;"><tr><td style="padding:14px 16px;color:#6F4E12;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;"><strong>Anhänge im Portal</strong><br>Einige Anhänge sind für den E-Mail-Versand zu gross. Sie stehen im Ticketportal bereit.</td></tr></table></td></tr>`
    : "";

  return `<!doctype html>
<html lang="de-CH">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#EEF2F7;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#EEF2F7;">
      <tr><td align="center" style="padding:28px 16px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #DCE5F2;border-radius:16px;overflow:hidden;">
          <tr><td height="6" style="height:6px;line-height:6px;background:${branding.primaryColor};font-size:0;">&nbsp;</td></tr>
          <tr><td style="padding:26px 32px;background:${branding.secondaryColor};">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="top" style="padding:0 18px 0 0;">
                  <p style="margin:0;color:#DCE7FF;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.1px;line-height:16px;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
                  <h1 style="margin:8px 0 0;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:25px;font-weight:700;line-height:32px;mso-line-height-rule:exactly;">${escapeHtml(input.subject)}</h1>
                  <p style="margin:10px 0 0;color:#DCE7FF;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:18px;">Ticket ${escapeHtml(input.ticketNumber)}</p>
                </td>
                <td width="112" align="right" valign="top" style="width:112px;padding:2px 0 0;">${brandMark(branding)}</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:30px 32px 6px;">
            <p style="margin:0 0 18px;color:#607089;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:20px;">${escapeHtml(copy.intro)}</p>
            ${messageHtml(input.text, branding.secondaryColor)}
          </td></tr>
          ${attachmentNotice}
          <tr><td style="padding:14px 32px 26px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-left:4px solid ${branding.accentColor};background:#F6FAF9;">
              <tr><td style="padding:15px 17px;color:${branding.secondaryColor};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;">${escapeHtml(copy.replyHint)}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 32px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E0E8F2;border-radius:10px;background:#F8FAFD;">
              <tr><td style="padding:15px 17px;">
                <p style="margin:0 0 4px;color:#607089;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.8px;line-height:16px;text-transform:uppercase;">Ihr Ticket</p>
                <p style="margin:0;color:${branding.secondaryColor};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:20px;">${escapeHtml(input.ticketNumber)} · ${escapeHtml(input.subject)}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 32px;border-top:1px solid #E5EBF4;background:#FBFCFE;">
            <p style="margin:0;color:#71809A;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">${escapeHtml(branding.displayName)} · Ticketbenachrichtigung über nextDesk</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
