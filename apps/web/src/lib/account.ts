import { supabase } from "./supabase";

/** Self-service account functions (personal workspace, account deletion). */

async function errorMessage(error: unknown, fallback: string) {
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : undefined;
  if (context instanceof Response) {
    const payload: unknown = await context
      .clone()
      .json()
      .catch(() => null);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? (payload as { error: { message: string } }).error.message
        : null;
    if (message) return message;
  }
  return fallback;
}

export async function createPersonalWorkspace(name: string): Promise<void> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { error } = await supabase.functions.invoke("account", {
    body: { type: "createPersonalWorkspace", name },
  });
  if (error) {
    throw new Error(
      await errorMessage(
        error,
        "Der Arbeitsbereich konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
      ),
    );
  }
}

export async function deleteAccount(): Promise<void> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { error } = await supabase.functions.invoke("account", {
    body: { type: "deleteAccount", confirmation: "LÖSCHEN" },
  });
  if (error) {
    throw new Error(
      await errorMessage(
        error,
        "Das Konto konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
      ),
    );
  }
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
