import { supabase } from "./lib/supabase";

export async function callTeamSupervision<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("team-supervision", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Teamdaten konnten nicht geladen werden.");
  }
  return (data as { data: T }).data;
}
