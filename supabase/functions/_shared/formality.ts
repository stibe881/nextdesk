/**
 * Form of address of a tenant: informal «du» (default) or formal «Sie».
 *
 * Texts that address a person are written twice:
 *  - `tone(formality, du, sie)` for texts the function renders itself (e-mails,
 *    push messages, PDF): load the tenant's form with `loadFormality()`.
 *  - `msg(du, sie)` for texts in a JSON answer: both forms travel as one
 *    «⟦du␞sie⟧» marker and the web/mobile client picks the right one.
 *
 * `scripts/verify-formality.mjs` fails when a formal form («Sie», «Ihr …»)
 * appears outside the last argument of these helpers.
 */
export type Formality = "du" | "sie";

export function parseFormality(value: unknown): Formality {
  return value === "sie" ? "sie" : "du";
}

export function tone<T>(formality: Formality, du: T, sie: T): T {
  return formality === "sie" ? sie : du;
}

/** Both wordings in one string; the client resolves it (see web `lib/formality.ts`). */
export function msg(du: string, sie: string): string {
  return `⟦${du}␞${sie}⟧`;
}

const PAIR_PATTERN = /⟦([^⟦⟧␞]*)␞([^⟦⟧]*)⟧/g;

/** Resolves «⟦du␞sie⟧» pairs for server-side use (logs, e-mails built from messages). */
export function resolvePairs(text: string, formality: Formality): string {
  return text.replace(PAIR_PATTERN, (_match, du: string, sie: string) =>
    formality === "sie" ? sie : du,
  );
}

/** The tenant's form of address; «du» when nothing is stored. */
export async function loadFormality(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tenantId: string,
): Promise<Formality> {
  const { data } = await admin
    .from("tenant_settings")
    .select("formality")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return parseFormality(data?.formality);
}
