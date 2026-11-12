export type CustomerTicketEmailKind =
  | "acknowledgement"
  | "agent_reply"
  | "resolution"
  | "rating_reminder"
  | "test"
  /** nextDesk notification to an agent or member (no reply expected). */
  | "notification"
  /** Thanks, result or question to a person who reported a phishing mail. */
  | "security_notice";

export type CustomerTicketEmailBrand = {
  accentColor: string;
  displayName: string;
  logoContentId: string | null;
  /** Public https URL of the logo, used where no inline logo can be sent. */
  logoUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
};

/** One-click buttons (e.g. reminder answers). Only https links are rendered. */
export type CustomerTicketEmailAction = {
  label: string;
  url: string;
  primary?: boolean;
};

/** Main call to action under the headline. Only https links are rendered. */
export type CustomerTicketEmailPrimaryAction = { label: string; url: string };

export type CustomerTicketEmailNoticeColor =
  | "brand"
  | "info"
  | "success"
  | "warning";

/** Optional «Hinweisblock der ICT», shown below the content. Only https links. */
export type CustomerTicketEmailNotice = {
  title: string;
  body: string;
  buttonLabel: string;
  url: string;
  /** Large character on the left, at most 4 characters. */
  symbol?: string | null;
  color: CustomerTicketEmailNoticeColor;
};

/** Star links of the «ticket resolved» e-mail: one https link per star count. */
export type CustomerTicketEmailRatingLink = { score: number; url: string };

type CustomerTicketEmailInput = {
  actions?: readonly CustomerTicketEmailAction[];
  /** Big main button (or, with star links, a second outlined button). */
  primaryAction?: CustomerTicketEmailPrimaryAction;
  /** Optional ICT notice block; never rendered for security notices. */
  notice?: CustomerTicketEmailNotice;
  /** One line below the footer, e.g. a contact address. */
  footerContact?: string;
  /** Five star links; only rendered when all five are https links. */
  ratingLinks?: readonly CustomerTicketEmailRatingLink[];
  attachmentNotice: boolean;
  branding: CustomerTicketEmailBrand;
  kind: CustomerTicketEmailKind;
  subject: string;
  text: string;
  /** Omitted for notifications without a ticket (e.g. shop, infrastructure). */
  ticketNumber: string | null;
  /** Overrides the highlighted first line (e.g. the notification title). */
  intro?: string;
  /** Overrides the hint below the message. */
  replyHint?: string;
  /** Overrides the small heading above the headline. */
  eyebrow?: string;
};

type EmailPresentation = {
  eyebrow: string;
  intro: string;
  replyHint: string;
};

const DEFAULT_BRANDING: CustomerTicketEmailBrand = {
  accentColor: "#14B8A6",
  displayName: "Support",
  logoContentId: null,
  logoUrl: null,
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
  let logoUrl: string | null = null;
  if (typeof input.logoUrl === "string") {
    try {
      const url = new URL(input.logoUrl);
      if (url.protocol === "https:" && !url.username && !url.password) {
        logoUrl = url.toString();
      }
    } catch {
      logoUrl = null;
    }
  }
  return {
    accentColor: color(input.accentColor, DEFAULT_BRANDING.accentColor),
    displayName,
    logoContentId,
    logoUrl,
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
    case "rating_reminder":
      return {
        eyebrow: "Ihre Meinung zählt",
        intro: "Wie zufrieden waren Sie mit dem Support?",
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
    case "notification":
      return {
        eyebrow: "Benachrichtigung",
        intro: "Es gibt eine Neuigkeit.",
        replyHint: "Bitte antworten Sie nicht auf diese E-Mail.",
      };
    case "security_notice":
      return {
        eyebrow: "Sicherheit",
        intro: "Nachricht zu Ihrer Phishing-Meldung",
        replyHint:
          "Bitte antworten Sie nicht auf diese E-Mail. Bei Fragen wenden Sie sich an den Support.",
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

/** Mixes a #RRGGBB colour with white; share 0 is white, 1 the colour. */
function tint(hex: string, share: number): string {
  const channels = [1, 3, 5].map((index) =>
    Math.round(
      255 - (255 - Number.parseInt(hex.slice(index, index + 2), 16)) * share,
    ),
  );
  return `#${channels
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
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

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const NOTICE_COLORS: Record<
  Exclude<CustomerTicketEmailNoticeColor, "brand">,
  string
> = {
  info: "#075985",
  success: "#1F7A45",
  warning: "#B45309",
};

/** Mixes a #RRGGBB colour with black; factor 1 keeps the colour. */
function shade(hex: string, factor: number): string {
  const channels = [1, 3, 5].map((index) =>
    Math.round(Number.parseInt(hex.slice(index, index + 2), 16) * factor),
  );
  return `#${channels
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function isHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function brandMark(branding: CustomerTicketEmailBrand): string {
  const source = branding.logoContentId
    ? `cid:${branding.logoContentId}`
    : branding.logoUrl;
  if (source) {
    return `<img src="${escapeHtml(source)}" width="140" alt="${escapeHtml(branding.displayName)}" style="display:block;margin:0 auto;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;">`;
  }
  return `<span style="color:${branding.primaryColor};${FONT}font-size:15px;font-weight:700;letter-spacing:.6px;line-height:20px;">${escapeHtml(branding.displayName)}</span>`;
}

/** Bulletproof button: coloured cell with the link filling it. */
function buttonHtml(
  label: string,
  url: string,
  options: {
    background: string;
    border: string;
    foreground: string;
    large?: boolean;
  },
): string {
  const padding = options.large ? "15px 34px" : "12px 22px";
  const size = options.large ? 17 : 15;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr><td align="center" bgcolor="${options.background}" style="border-radius:10px;background-color:${options.background};"><a href="${escapeHtml(url)}" style="display:inline-block;padding:${padding};border:2px solid ${options.border};border-radius:10px;color:${options.foreground};${FONT}font-size:${size}px;font-weight:700;line-height:22px;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function primaryActionOf(
  action: CustomerTicketEmailPrimaryAction | undefined,
): { label: string; url: string } | null {
  if (!action || !isHttps(action.url)) return null;
  const label =
    typeof action.label === "string" ? action.label.trim().slice(0, 60) : "";
  return label ? { label, url: action.url } : null;
}

function actionsHtml(
  actions: readonly CustomerTicketEmailAction[] | undefined,
  branding: CustomerTicketEmailBrand,
): string {
  const safe = (actions ?? [])
    .filter((action) => isHttps(action.url))
    .slice(0, 3);
  if (safe.length === 0) return "";
  const buttons = safe
    .map((action) => {
      const background = action.primary ? branding.primaryColor : "#FFFFFF";
      const foreground = action.primary ? "#FFFFFF" : branding.secondaryColor;
      return `<td style="padding:0 5px 10px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="${background}" style="border-radius:10px;background-color:${background};"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;border:2px solid ${branding.primaryColor};border-radius:10px;color:${foreground};${FONT}font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(action.label.slice(0, 60))}</a></td></tr></table></td>`;
    })
    .join("");
  return `<tr><td align="center" style="padding:4px 32px 14px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr>${buttons}</tr></table><p style="margin:0;color:#607089;${FONT}font-size:12px;line-height:18px;text-align:center;">Die Links sind persönlich, einmal verwendbar und 14 Tage gültig.</p></td></tr>`;
}

/** Five big star tiles; empty unless all five links are valid https links. */
function ratingHtml(
  links: readonly CustomerTicketEmailRatingLink[] | undefined,
  branding: CustomerTicketEmailBrand,
): string {
  const safe = (links ?? []).filter(
    (link) =>
      isHttps(link.url) &&
      Number.isInteger(link.score) &&
      link.score >= 1 &&
      link.score <= 5,
  );
  if (safe.length !== 5) return "";
  const stars = [...safe]
    .sort((left, right) => left.score - right.score)
    .map(
      (link) =>
        `<td align="center" width="44" style="padding:0 4px;"><a href="${escapeHtml(link.url)}" title="${link.score} von 5 Sternen" style="display:block;width:44px;height:44px;border:1px solid #F2CD74;border-radius:10px;background-color:#FFF8E1;color:#F2A900;${FONT}font-size:28px;line-height:44px;text-align:center;text-decoration:none;">&#9733;</a></td>`,
    )
    .join("");
  return `<p style="margin:18px 0 10px;color:${branding.secondaryColor};${FONT}font-size:16px;font-weight:700;line-height:22px;text-align:center;">Wie zufrieden waren Sie?</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;"><tr>${stars}</tr></table><p style="margin:10px 0 0;color:#607089;${FONT}font-size:12px;line-height:18px;text-align:center;">1 Stern bedeutet unzufrieden, 5 Sterne sehr zufrieden. Der Link ist persönlich und 14 Tage gültig.</p>`;
}

function noticeHtml(
  notice: CustomerTicketEmailNotice | undefined,
  branding: CustomerTicketEmailBrand,
): string {
  if (!notice || !isHttps(notice.url)) return "";
  const title = String(notice.title ?? "").trim().slice(0, 80);
  if (!title) return "";
  const body = String(notice.body ?? "").trim().slice(0, 260);
  const buttonLabel =
    String(notice.buttonLabel ?? "").trim().slice(0, 40) || "Mehr erfahren";
  const base =
    notice.color in NOTICE_COLORS
      ? NOTICE_COLORS[notice.color as keyof typeof NOTICE_COLORS]
      : branding.primaryColor;
  const symbol =
    typeof notice.symbol === "string"
      ? [...notice.symbol.trim()].slice(0, 4).join("")
      : "";
  const symbolCell = symbol
    ? `<td width="72" valign="middle" style="width:72px;padding:0 16px 0 0;color:#FFFFFF;${FONT}font-size:44px;line-height:52px;text-align:center;">${escapeHtml(symbol)}</td>`
    : "";
  return `<tr><td style="padding:6px 32px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${base}" style="border-radius:14px;background-color:${base};background-image:linear-gradient(135deg,${base},${shade(base, 0.8)});">
              <tr><td style="padding:24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
                  ${symbolCell}
                  <td valign="middle">
                    <p style="margin:0 0 6px;color:#FFFFFF;${FONT}font-size:11px;font-weight:700;letter-spacing:1.2px;line-height:16px;opacity:.9;">NEU BEI DER ICT</p>
                    <p style="margin:0 0 6px;color:#FFFFFF;${FONT}font-size:20px;font-weight:700;line-height:26px;mso-line-height-rule:exactly;">${escapeHtml(title)}</p>
                    ${body ? `<p style="margin:0 0 14px;color:#FFFFFF;${FONT}font-size:14px;line-height:21px;">${escapeHtml(body)}</p>` : ""}
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#FFFFFF" style="border-radius:8px;background-color:#FFFFFF;"><a href="${escapeHtml(notice.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;color:#16213B;${FONT}font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(buttonLabel)}</a></td></tr></table>
                  </td>
                </tr></table>
              </td></tr>
            </table>
          </td></tr>`;
}

/** Headline per kind; kinds without own title show the subject line. */
function headline(kind: CustomerTicketEmailKind): string | null {
  switch (kind) {
    case "acknowledgement":
      return "Wir haben Ihre Anfrage erhalten";
    case "agent_reply":
      return "Neue Antwort zu Ihrem Ticket";
    case "resolution":
      return "Ihr Ticket ist gelöst";
    case "rating_reminder":
      return "Bitte bewerten Sie den Support";
    default:
      return null;
  }
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
  const base = presentation(input.kind);
  const copy = {
    ...base,
    eyebrow: input.eyebrow ?? base.eyebrow,
    intro: input.intro ?? base.intro,
    replyHint: input.replyHint ?? base.replyHint,
  };
  const ticketNumber = input.ticketNumber;
  const title = headline(input.kind);
  const ticketLine = ticketNumber
    ? title
      ? `${escapeHtml(ticketNumber)} · ${escapeHtml(input.subject)}`
      : `Ticket ${escapeHtml(ticketNumber)}`
    : "";
  const stars = ratingHtml(input.ratingLinks, branding);
  const action = primaryActionOf(input.primaryAction);
  const topAction =
    !stars && action
      ? `${buttonHtml(action.label, action.url, { background: branding.primaryColor, border: branding.primaryColor, foreground: "#FFFFFF", large: true })}`
      : "";
  const focus = stars || topAction;
  const focusRow = focus
    ? `<tr><td align="center" style="padding:6px 32px 22px;">${focus}</td></tr>`
    : "";
  const secondAction =
    stars && action
      ? `<tr><td align="center" style="padding:0 32px 20px;">${buttonHtml(action.label, action.url, { background: "#FFFFFF", border: branding.primaryColor, foreground: branding.primaryColor })}</td></tr>`
      : "";
  const attachmentNotice = input.attachmentNotice
    ? `<tr><td style="padding:0 32px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFF8E8" style="border:1px solid #F2CD74;border-radius:10px;background-color:#FFF8E8;"><tr><td style="padding:14px 16px;color:#6F4E12;${FONT}font-size:13px;line-height:19px;"><strong>Anhänge im Portal</strong><br>Einige Anhänge sind für den E-Mail-Versand zu gross. Sie stehen im Ticketportal bereit.</td></tr></table></td></tr>`
    : "";
  const notice =
    input.kind === "security_notice" ? "" : noticeHtml(input.notice, branding);
  const footerContact = input.footerContact?.replace(/\s+/g, " ").trim();

  return `<!doctype html>
<html lang="de-CH">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#EEF2F7;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;">
      <tr><td align="center" style="padding:28px 16px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #DCE5F2;border-radius:16px;overflow:hidden;">
          <tr><td height="6" style="height:6px;line-height:6px;font-size:0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="6" bgcolor="${branding.primaryColor}" style="height:6px;line-height:6px;background-color:${branding.primaryColor};font-size:0;">&nbsp;</td><td width="20%" height="6" bgcolor="${branding.accentColor}" style="width:20%;height:6px;line-height:6px;background-color:${branding.accentColor};font-size:0;">&nbsp;</td></tr></table></td></tr>
          <tr><td align="center" style="padding:28px 32px 14px;text-align:center;">
            ${brandMark(branding)}
            <p style="margin:18px 0 0;color:${branding.primaryColor};${FONT}font-size:11px;font-weight:700;letter-spacing:1.1px;line-height:16px;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
            <h1 style="margin:8px 0 0;color:${branding.secondaryColor};${FONT}font-size:26px;font-weight:700;line-height:33px;mso-line-height-rule:exactly;">${escapeHtml(title ?? input.subject)}</h1>
            ${ticketLine ? `<p style="margin:10px 0 0;color:#607089;${FONT}font-size:14px;line-height:20px;">${ticketLine}</p>` : ""}
          </td></tr>
          ${focusRow}
          <tr><td style="padding:8px 32px 20px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${tint(branding.primaryColor, 0.06)}" style="border:1px solid ${tint(branding.primaryColor, 0.25)};border-left:6px solid ${branding.primaryColor};border-radius:12px;background-color:${tint(branding.primaryColor, 0.06)};">
              <tr><td style="padding:20px 24px 6px;">
                <p style="margin:0 0 12px;color:${branding.primaryColor};${FONT}font-size:15px;font-weight:700;line-height:22px;mso-line-height-rule:exactly;">${escapeHtml(copy.intro)}</p>
                ${messageHtml(input.text, branding.secondaryColor)}
              </td></tr>
              <tr><td style="padding:0 24px 18px;color:#607089;${FONT}font-size:13px;line-height:19px;">${escapeHtml(copy.replyHint)}</td></tr>
            </table>
          </td></tr>
          ${secondAction}
          ${actionsHtml(input.actions, branding)}
          ${attachmentNotice}
          ${notice}
          <tr><td align="center" style="padding:18px 32px;border-top:1px solid #E5EBF4;background:#FBFCFE;text-align:center;">
            <p style="margin:0;color:#71809A;${FONT}font-size:12px;line-height:18px;">${input.kind === "notification" ? "Benachrichtigung" : "Ticketbenachrichtigung"} über ${escapeHtml(branding.displayName)}</p>
            ${notice ? `<p style="margin:6px 0 0;color:#71809A;${FONT}font-size:12px;line-height:18px;">Hinweise der ICT erscheinen nur gelegentlich und nie in Sicherheitsmeldungen.</p>` : ""}
            ${footerContact ? `<p style="margin:6px 0 0;color:#71809A;${FONT}font-size:12px;line-height:18px;">${escapeHtml(footerContact)}</p>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
