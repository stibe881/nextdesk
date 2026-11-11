// Aufrufe der Edge Function `ipam` aus der Web-App.

import { supabase } from "./supabase";
import type { IpamFile } from "./ipam-model";

/** Calls the `ipam` function; throws an Error with the German message. */
export async function ipamCall<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ipam", { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Anfrage konnte nicht ausgeführt werden.");
  }
  return (data as { data: T }).data;
}

/** Offers an export from the function as a file download. */
export function downloadFile(file: IpamFile): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
