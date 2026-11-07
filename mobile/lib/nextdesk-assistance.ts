// Calls of the reply-snippets and portal-assistant edge functions (mobile).
// The pure parsing lives in reply-snippets.ts and portal-assistant.ts, which
// are identical copies of the web files.

import { invokeNextDesk } from "./nextdesk-client";
import {
  messagesForTurn,
  parseAssistantSettings,
  parseAssistantTurn,
  type AssistantMessage,
  type AssistantTurn,
} from "./portal-assistant";
import {
  parseSnippetResponse,
  type ReplySnippet,
  type SnippetContext,
} from "./reply-snippets";

/** Snippets and placeholder values for a ticket (agents only). */
export async function loadTicketSnippets(
  tenantId: string,
  ticketId: string,
): Promise<{ snippets: ReplySnippet[]; context: SnippetContext }> {
  const parsed = parseSnippetResponse(
    await invokeNextDesk<unknown>("reply-snippets", {
      type: "listForTicket",
      tenantId,
      ticketId,
    }),
  );
  if (!parsed) throw new Error("Die Antwort-Bausteine sind nicht verfügbar.");
  return { snippets: parsed.snippets, context: parsed.context };
}

/** Whether the self-service assistant is switched on (off by default). */
export async function loadPortalAssistantEnabled(
  tenantId: string,
): Promise<boolean> {
  try {
    return parseAssistantSettings(
      await invokeNextDesk<unknown>("portal-assistant", {
        type: "getSettings",
        tenantId,
      }),
    ).enabled;
  } catch {
    return false;
  }
}

export async function sendAssistantTurn(input: {
  tenantId: string;
  sessionId: string | null;
  departmentId: string | null;
  messages: AssistantMessage[];
}): Promise<AssistantTurn> {
  const turn = parseAssistantTurn(
    await invokeNextDesk<unknown>("portal-assistant", {
      type: "turn",
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      departmentId: input.departmentId,
      address: "informal",
      messages: messagesForTurn(input.messages),
    }),
  );
  if (!turn) throw new Error("Die Antwort des Assistenten ist ungültig.");
  return turn;
}

/** Records how an assistant conversation ended; errors are ignored. */
export async function recordAssistantOutcome(input: {
  tenantId: string;
  sessionId: string;
  outcome: "solved_by_article" | "ticket_created" | "abandoned";
  articleId?: string;
  ticketId?: string;
}): Promise<void> {
  try {
    await invokeNextDesk("portal-assistant", { type: "finish", ...input });
  } catch {
    // Reporting must never block the person.
  }
}
