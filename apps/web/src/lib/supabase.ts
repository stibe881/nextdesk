import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
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
