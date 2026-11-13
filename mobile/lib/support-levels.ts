import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseMobileSpamResult,
  parseMobileTicketSupportLevel,
  type MobileSpamResult,
  type MobileSupportLevel,
  type MobileTicketSupportLevel,
} from "@/lib/support-levels-model";

export * from "@/lib/support-levels-model";

/** Stufe, Ziele und Übergabenotiz des Tickets (Rechte prüft der Server). */
export async function getMobileTicketSupportLevel(
  tenantId: string,
  ticketId: string,
): Promise<MobileTicketSupportLevel | null> {
  return parseMobileTicketSupportLevel(
    await invokeNextDesk<unknown>("ticket-support-levels", {
      type: "getTicket",
      tenantId,
      ticketId,
    }),
  );
}

/** «An nächste Stufe übergeben» bzw. «Zurück an Stufe X». */
export async function handOverMobileTicketLevel(input: {
  tenantId: string;
  ticketId: string;
  targetTeamId: string;
  note: string;
  expectedLevel: MobileSupportLevel;
}): Promise<void> {
  await invokeNextDesk<unknown>("ticket-support-levels", {
    type: "handover",
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    targetTeamId: input.targetTeamId,
    targetAgentId: null,
    note: input.note.trim(),
    expectedLevel: input.expectedLevel,
  });
}

/**
 * «Als Spam/Phishing einstufen»: standard reply to the requester (as for a
 * phishing report from Outlook) and handover to the 2nd level team.
 */
export async function markMobileTicketSpam(
  tenantId: string,
  ticketId: string,
): Promise<MobileSpamResult> {
  const result = parseMobileSpamResult(
    await invokeNextDesk<unknown>("ticket-support-levels", {
      type: "markSpam",
      tenantId,
      ticketId,
    }),
  );
  if (!result)
    throw new Error("Die Einstufung hat keine verwertbare Antwort geliefert.");
  return result;
}
