// Die Person, die einen Eintritt per Mail meldet, ist dessen vorgesetzte
// Person. Sie wird als Mitglied gesucht; hat sie noch kein Konto, aber ist sie
// im Entra-Verzeichnis, wird ihr Konto angelegt (wie bei Bestellungen für
// andere). Niemals wird stattdessen eine andere Person eingetragen.

import { ensureEntraPersonAccount } from "./entra-person-account.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

const normalized = (value: string | null | undefined): string =>
  (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("de-CH");

/** Konto der meldenden Person (Mitglied des Mandanten) oder null. */
export async function resolveReporterAccount(
  admin: Admin,
  tenantId: string,
  reporter: { email?: string | null; name?: string | null },
  actorId: string,
): Promise<string | null> {
  const email = normalized(reporter.email);
  const name = normalized(reporter.name);
  if (!email.includes("@") && !name) return null;

  // 1. Entra-Verzeichnis: über die Adresse, sonst eindeutig über den Namen.
  const people = await admin
    .from("tenant_entra_directory_people")
    .select("entra_object_id, email, display_name, local_user_id")
    .eq("tenant_id", tenantId)
    .eq("account_enabled", true)
    .is("inactive_at", null)
    .or(
      [
        email.includes("@") ? `email.ilike.${email.replace(/[,()]/g, "")}` : null,
        name ? `display_name.ilike.${name.replace(/[,()%_]/g, "")}` : null,
      ].filter(Boolean).join(","),
    )
    .limit(20);
  if (!people.error) {
    const rows = (people.data ?? []) as Record<string, unknown>[];
    const byEmail = rows.filter((row) => email && normalized(String(row.email ?? "")) === email);
    const byName = rows.filter((row) => name && normalized(String(row.display_name ?? "")) === name);
    const person = byEmail[0] ?? (byName.length === 1 ? byName[0] : null);
    if (person) {
      try {
        return await ensureEntraPersonAccount(
          admin,
          tenantId,
          String(person.entra_object_id),
          actorId,
        );
      } catch {
        // Gesperrt oder ohne Adresse: weiter mit den bestehenden Konten.
      }
    }
  }

  // 2. Bestehendes Konto mit dieser Adresse, das Mitglied ist.
  if (email.includes("@")) {
    const { data: userId } = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
    if (typeof userId === "string") {
      const { data: membership } = await admin
        .from("tenant_memberships")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membership?.status === "active") return userId;
    }
  }
  return null;
}
