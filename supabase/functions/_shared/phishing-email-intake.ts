// «Phishing melden» per Weiterleitung: an e-mail sent to the configured report
// address becomes a security ticket instead of a normal ticket. The forwarded
// original is taken from an attached message (.eml / Outlook item) or from an
// inline forward. Attachment *contents* are only read for attached messages
// (to get their headers); nothing is executed, rendered or followed.

import {
  ensureSecurityCase,
  mergeIntoSecurityCase,
  openSecurityCaseFor,
  queueSecurityNotice,
  suppressAcknowledgement,
} from "./security-cases.ts";
import {
  analyzeMail,
  bytesToBinary,
  decodeEncodedWords,
  defangText,
  type MailAttachmentInfo,
  type MailHeader,
  type ParsedMail,
  parseMime,
  selectOriginal,
} from "./phishing-analysis.ts";
import {
  convertToSecurityTicket,
  finalizePhishingReport,
  isPhishingReportMail,
  loadPhishingSettings,
  type PhishingSettings,
  reportFingerprint,
  securityTicketDescription,
  tenantReferenceDomains,
  THANK_YOU_TEXT,
} from "./phishing-report-intake.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

/** Reads a Graph path relative to the channel mailbox ("/messages/…"). */
export type MailboxGraphReader = (
  path: string,
  init?: RequestInit,
) => Promise<Row>;

const MAX_ATTACHMENTS = 20;
const MAX_MESSAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function record(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(record) : [];
}
function personHeader(value: unknown): string | null {
  if (!record(value) || !record(value.emailAddress)) return null;
  const name = str(value.emailAddress.name);
  const address = str(value.emailAddress.address);
  if (!address) return name;
  return name && name !== address ? `${name} <${address}>` : address;
}

/** Graph message resource (e.g. an expanded item attachment) → ParsedMail. */
export function graphMessageToMail(item: Row): ParsedMail {
  let headers: MailHeader[] = rows(item.internetMessageHeaders)
    .map((entry) => ({ name: (str(entry.name) ?? "").toLowerCase(), value: str(entry.value) ?? "" }))
    .filter((entry) => entry.name);
  const add = (name: string, value: string | null) => {
    if (value && !headers.some((entry) => entry.name === name)) headers = [...headers, { name, value }];
  };
  add("from", personHeader(item.from) ?? personHeader(item.sender));
  add("reply-to", rows(item.replyTo).map(personHeader).filter(Boolean).join(", ") || null);
  add("subject", str(item.subject));
  add("date", str(item.sentDateTime) ?? str(item.receivedDateTime));
  add("message-id", str(item.internetMessageId));
  const body = record(item.body) ? item.body : {};
  const content = str(body.content) ?? "";
  const isHtml = str(body.contentType)?.toLowerCase() === "html";
  return {
    headers: headers.map((entry) => ({ ...entry, value: decodeEncodedWords(entry.value) })),
    text: isHtml ? "" : content,
    html: isHtml ? content : "",
    attachments: rows(item.attachments).map((entry) => ({
      filename: str(entry.name) ?? "Anhang",
      contentType: str(entry.contentType) ?? "application/octet-stream",
      size: typeof entry.size === "number" ? entry.size : 0,
    })),
    embedded: [],
  };
}

/** Whether this inbound message is a phishing report (cheap, no Graph call). */
export async function phishingReportSettingsFor(
  admin: Admin,
  input: {
    tenantId: string;
    mailboxAddress: string;
    recipients: readonly string[];
    subject?: string | null;
  },
): Promise<PhishingSettings | null> {
  try {
    const settings = await loadPhishingSettings(admin, input.tenantId);
    return isPhishingReportMail(settings, input) ? settings : null;
  } catch {
    return null;
  }
}

async function readAttachedOriginals(
  graph: MailboxGraphReader,
  messageId: string,
): Promise<{ embedded: ParsedMail[]; attachments: MailAttachmentInfo[] }> {
  const embedded: ParsedMail[] = [];
  const attachments: MailAttachmentInfo[] = [];
  const base = `/messages/${encodeURIComponent(messageId)}/attachments`;
  const list = await graph(`${base}?$top=${MAX_ATTACHMENTS}&$select=id,name,contentType,size,isInline`);
  for (const entry of rows(list.value).slice(0, MAX_ATTACHMENTS)) {
    const id = str(entry.id);
    const type = str(entry["@odata.type"]);
    const name = str(entry.name) ?? "Anhang";
    const contentType = (str(entry.contentType) ?? "application/octet-stream").toLowerCase();
    const size = typeof entry.size === "number" ? entry.size : 0;
    if (!id) continue;
    try {
      if (type === "#microsoft.graph.itemAttachment") {
        let item: Row | null = null;
        try {
          const expanded = await graph(
            `${base}/${encodeURIComponent(id)}?$expand=microsoft.graph.itemattachment/item($select=internetMessageHeaders,subject,from,sender,replyTo,body,sentDateTime,receivedDateTime,internetMessageId)`,
          );
          item = record(expanded.item) ? expanded.item : null;
        } catch {
          const expanded = await graph(`${base}/${encodeURIComponent(id)}?$expand=microsoft.graph.itemattachment/item`);
          item = record(expanded.item) ? expanded.item : null;
        }
        if (item) {
          embedded.push(graphMessageToMail(item));
          attachments.push({ filename: `${name}.eml`, contentType: "message/rfc822", size });
          continue;
        }
      } else if (
        type === "#microsoft.graph.fileAttachment" &&
        (contentType === "message/rfc822" || /\.eml$/i.test(name)) &&
        size > 0 && size <= MAX_MESSAGE_ATTACHMENT_BYTES
      ) {
        const file = await graph(`${base}/${encodeURIComponent(id)}?$select=contentBytes`);
        const bytes = str(file.contentBytes);
        if (bytes) {
          embedded.push(parseMime(bytesToBinary(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)))));
          attachments.push({ filename: name, contentType: "message/rfc822", size });
          continue;
        }
      }
    } catch {
      // Unreadable attachment: listed by name only.
    }
    // Ordinary attachments are listed by name/type/size only, never downloaded here.
    attachments.push({ filename: name.slice(0, 255), contentType, size });
  }
  return { embedded, attachments };
}

/**
 * Converts the freshly created mail ticket into a security ticket. Never
 * throws: on failure the ordinary ticket stays as it is.
 */
export async function processPhishingEmailReport(
  admin: Admin,
  input: {
    tenantId: string;
    ticketId: string;
    ticketNumber: string;
    settings: PhishingSettings;
    graphMessage: Row;
    graph: MailboxGraphReader;
    sender: string;
    serviceIdentityId: string;
    thankYou: { channelId: string; configurationVersion: number; mailboxAddress: string } | null;
  },
): Promise<boolean> {
  try {
    const messageId = str(input.graphMessage.id);
    const textBody = record(input.graphMessage.body) ? str(input.graphMessage.body.content) ?? "" : "";
    let html = "";
    if (messageId) {
      try {
        const htmlMessage = await input.graph(`/messages/${encodeURIComponent(messageId)}?$select=body`, {
          headers: { Prefer: 'outlook.body-content-type="html"' },
        });
        html = record(htmlMessage.body) ? str(htmlMessage.body.content) ?? "" : "";
      } catch {
        html = "";
      }
    }
    const attached = messageId && input.graphMessage.hasAttachments === true
      ? await readAttachedOriginals(input.graph, messageId).catch(() => ({ embedded: [], attachments: [] }))
      : { embedded: [], attachments: [] };
    // The reporter's own headers are irrelevant for the analysis.
    const outer: ParsedMail = {
      headers: [],
      text: textBody,
      html,
      attachments: attached.attachments.filter((entry) => entry.contentType !== "message/rfc822"),
      embedded: attached.embedded,
    };
    const selected = selectOriginal(outer, "text", { preferInline: true });
    const references = await tenantReferenceDomains(admin, input.tenantId);
    const analysis = analyzeMail(selected.mail, { source: selected.source, referenceDomains: references });
    const fingerprint = await reportFingerprint(selected.mail);
    const quoted = defangText(selected.mail.text || textBody).slice(0, 20_000);
    // A phishing report never gets the «we received your request» mail.
    await suppressAcknowledgement(admin, input.ticketId);
    // The same mail reported again: attach the report to the open case.
    const existing = await openSecurityCaseFor(admin, input.tenantId, fingerprint);
    let caseTicketId = input.ticketId;
    let caseTicketNumber = input.ticketNumber;
    if (existing && existing.id !== input.ticketId) {
      await mergeIntoSecurityCase(admin, {
        tenantId: input.tenantId,
        duplicateTicketId: input.ticketId,
        caseTicketId: existing.id,
        actorId: input.serviceIdentityId,
      });
      caseTicketId = existing.id;
      caseTicketNumber = existing.ticketNumber;
    } else {
      await convertToSecurityTicket(admin, {
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        settings: input.settings,
        analysis,
        description: `${securityTicketDescription(analysis, input.sender)}\n\nInhalt der gemeldeten E-Mail (Links entschärft):\n\n${quoted || "–"}`,
      });
      await ensureSecurityCase(admin, {
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        fingerprint,
        riskLevel: analysis.level,
      });
    }
    await finalizePhishingReport(admin, {
      tenantId: input.tenantId,
      ticketId: caseTicketId,
      ticketNumber: caseTicketNumber,
      noteAuthorId: input.serviceIdentityId,
      reporterId: null,
      reporterEmail: input.sender,
      channel: "email",
      analysis,
      fingerprint,
      bundled: caseTicketId !== input.ticketId,
    });
    if (input.thankYou) {
      await queueSecurityNotice(admin, {
        tenantId: input.tenantId,
        ticketId: caseTicketId,
        authorId: input.serviceIdentityId,
        subject: "Danke für Ihre Phishing-Meldung",
        body: THANK_YOU_TEXT,
        recipients: [input.sender],
        note: `Dankesnachricht an ${input.sender}:`,
      });
    }
    return true;
  } catch (error) {
    console.error("phishing_email_report_failed", error instanceof Error ? error.message : "");
    return false;
  }
}
