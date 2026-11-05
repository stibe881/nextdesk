function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_MESSAGE_LENGTH = 300;

/** HTTP status of a failed supabase.functions.invoke call, if known. */
function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  const context = error.context;
  if (context instanceof Response) return context.status;
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

/**
 * The readable German message of a knowledge-related edge function failure
 * (`{ error: { code, message } }`), e.g. "Bitte wählen Sie eine Abteilung.".
 * The knowledge functions only ever put curated texts into `message`; server
 * failures (5xx) and anything that does not look like a short sentence are
 * ignored so the caller falls back to its own generic text.
 */
export function knowledgeBackendMessage(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const message = payload.error.message;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_MESSAGE_LENGTH ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    /[<>{}]/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/** Reads knowledgeBackendMessage from a failed functions.invoke error. */
export async function knowledgeErrorBackendMessage(
  error: unknown,
): Promise<string | null> {
  const status = errorStatus(error);
  if (status !== null && status >= 500) return null;
  if (!isRecord(error) || !(error.context instanceof Response)) return null;
  try {
    return knowledgeBackendMessage(await error.context.clone().json());
  } catch {
    return null;
  }
}
