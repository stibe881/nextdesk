import { acceptProjectInvitations } from "./projects-api";
import { supabase } from "./supabase";

export async function acceptTenantInvitations() {
  if (!supabase) return 0;
  // Gast-Einladungen in Projekte legen die Mandantenmitgliedschaft an und
  // müssen deshalb vor dem Laden der Mandanten eingelöst sein.
  await acceptProjectInvitations();
  const { data, error } = await supabase.functions.invoke("tenant-users", {
    body: { type: "acceptMyInvitations" },
  });
  if (error) return 0;
  const accepted = (data as { data?: { accepted?: unknown } } | null)?.data
    ?.accepted;
  return typeof accepted === "number" ? accepted : 0;
}
