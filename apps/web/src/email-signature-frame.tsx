const SIGNATURE_MARKER = "\n\nE-Mail-Signatur\n";

/**
 * Splits a ticket description into the message and the plain-text signature
 * section that older versions of the mail worker appended under
 * "E-Mail-Signatur". Signatures are no longer shown, so only the message is
 * displayed.
 */
export function splitPlainTextSignature(description: string): {
  message: string;
  hasPlainSignature: boolean;
} {
  const index = description.indexOf(SIGNATURE_MARKER);
  if (index < 0) return { message: description, hasPlainSignature: false };
  return {
    message: description.slice(0, index).trimEnd(),
    hasPlainSignature: true,
  };
}

export type EmailSenderContacts = { phones: string[]; emails: string[] };

/** Parses a ticket_email_signatures row (phones, emails). */
export function parseEmailSenderContacts(
  value: unknown,
): EmailSenderContacts | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as { phones?: unknown; emails?: unknown };
  const strings = (list: unknown) =>
    Array.isArray(list)
      ? list.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
      : [];
  const phones = strings(row.phones);
  const emails = strings(row.emails);
  return phones.length || emails.length ? { phones, emails } : null;
}

/** tel: link target: digits and a leading plus only. */
export function phoneHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}
