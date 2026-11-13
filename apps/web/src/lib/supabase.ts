import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FORMALITY_PAIR_START, resolveFormalityPairs } from "./formality";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * Server texts can carry both forms of address as «⟦du␞sie⟧». Function
 * answers are resolved here, once, for the form the tenant uses.
 */
async function resolveFunctionResponse(response: Response): Promise<Response> {
  if (!response.url.includes("/functions/v1/")) return response;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json") && !type.includes("text")) return response;
  const text = await response.clone().text();
  if (!text.includes(FORMALITY_PAIR_START)) return response;
  return new Response(resolveFormalityPairs(text), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      global: {
        fetch: async (input, init) =>
          resolveFunctionResponse(await fetch(input, init)),
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The mounted application performs callback handling before its
        // workspace bootstrap. That prevents a new PKCE session from being
        // missed while the client is still initialising.
        detectSessionInUrl: false,
        flowType: "pkce",
        experimental: {
          // Preserve the exact verifier when a person opens more than one
          // authentication flow before the Microsoft callback returns.
          appendPkceFlowIdToRedirects: true,
        },
      },
    })
  : null;

export function appRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}
