// «Phishing melden» (mobile): calls of the phishing-reports edge function.
// In the app the person pastes the headers or the source of the e-mail; the
// server analyses it without opening links or attachments.

import { invokeNextDesk } from "./nextdesk-client";

export const MAX_PHISHING_PASTE_CHARACTERS = 1_000_000;

export type PhishingConfig = { enabled: boolean; reportAddress: string | null };

export type PhishingSubmitResult = {
  ticketId: string;
  ticketNumber: string;
  duplicate: boolean;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

export function parsePhishingConfig(value: unknown): PhishingConfig {
  const data = isRecord(value) && isRecord(value.data) ? value.data : {};
  return {
    enabled: data.enabled === true,
    reportAddress: text(data.reportAddress, 320),
  };
}

export function parsePhishingSubmit(
  value: unknown,
): PhishingSubmitResult | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const ticketId = text(data.ticketId, 64);
  const ticketNumber = text(data.ticketNumber, 64);
  const message = text(data.message, 1000);
  if (!ticketId || !ticketNumber || !message) return null;
  return {
    ticketId,
    ticketNumber,
    duplicate: data.duplicate === true,
    message,
  };
}

/** The server answers in «Sie»; the app talks to the person with «du». */
export function informalThanks(result: PhishingSubmitResult): string {
  return result.duplicate
    ? `Danke für die Meldung! Diese E-Mail hast du bereits gemeldet (${result.ticketNumber}) – unser Sicherheitsteam ist informiert.`
    : `Danke für die Meldung! Unser Sicherheitsteam prüft die E-Mail (${result.ticketNumber}). Klicke keine Links an und öffne keine Anhänge. Falls du schon Daten eingegeben hast, melde dich bitte sofort beim Support.`;
}

export async function loadPhishingConfig(
  tenantId: string,
): Promise<PhishingConfig> {
  try {
    return parsePhishingConfig(
      await invokeNextDesk<unknown>("phishing-reports", {
        type: "getConfig",
        tenantId,
      }),
    );
  } catch {
    return { enabled: false, reportAddress: null };
  }
}

export async function submitPhishingReport(
  tenantId: string,
  rawText: string,
): Promise<PhishingSubmitResult> {
  const trimmed = rawText.slice(0, MAX_PHISHING_PASTE_CHARACTERS);
  if (!trimmed.trim()) {
    throw new Error("Füge zuerst die Kopfzeilen oder den Text der E-Mail ein.");
  }
  const result = parsePhishingSubmit(
    await invokeNextDesk<unknown>("phishing-reports", {
      type: "submit",
      tenantId,
      channel: "mobile",
      rawText: trimmed,
    }),
  );
  if (!result) throw new Error("Die Meldung konnte nicht bestätigt werden.");
  return result;
}
