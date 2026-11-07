import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseMobileTicketSupportLevel,
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
