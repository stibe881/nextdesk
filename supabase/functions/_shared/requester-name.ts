// Display names of requester contacts (ticket_requesters) created from
// incoming e-mail. A good name is never replaced by a worse one: the Entra
// directory wins, then the sender name in the mail, and only then a name
// derived from the address («luana.nett@…» → «Luana Nett»).

// deno-lint-ignore no-explicit-any
type Admin = any;

/** The local part as words, without capitalisation («luana nett»). */
export function rawNameFromAddress(address: string): string {
  const at = address.lastIndexOf("@");
  const local = at >= 0 ? address.slice(0, at) : address;
  return local
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/(^|\s)-+|-+(?=\s|$)/g, "$1")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/** «luana.nett@…» → «Luana Nett», «hans-peter.muster@…» → «Hans-Peter Muster». */
export function nameFromAddress(address: string): string {
  const raw = rawNameFromAddress(address);
  if (!raw) return "E-Mail-Kontakt";
  return raw.replace(
    /(^|[\s-])(\p{L})/gu,
    (_, before: string, letter: string) => before + letter.toLocaleUpperCase("de-CH"),
  );
}

/** True for a name that was only derived from the address (any case). */
export function isDerivedName(name: string | null | undefined, address: string): boolean {
  if (!name || !name.trim()) return true;
  const normalized = name.trim().toLocaleLowerCase("de-CH");
  return normalized === "e-mail-kontakt" ||
    normalized === rawNameFromAddress(address).toLocaleLowerCase("de-CH") ||
    // Older derivation that turned hyphens into spaces.
    normalized === rawNameFromAddress(address).replace(/-/g, " ").toLocaleLowerCase("de-CH");
}

/** A usable sender name from the mail header (not an address, not empty). */
export function senderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/["']/g, "").replace(/\s+/g, " ").trim();
  if (!name || name.includes("@") || name.length > 120) return null;
  return name;
}

/** Best name for a new contact. */
export function pickRequesterName(input: {
  address: string;
  directoryName?: string | null;
  senderName?: string | null;
}): string {
  for (const candidate of [input.directoryName, input.senderName]) {
    const name = senderName(candidate);
    if (name && !isDerivedName(name, input.address)) return name;
    // «luana nett» from the header is still better capitalised.
    if (name && name !== name.toLocaleLowerCase("de-CH")) return name;
  }
  return nameFromAddress(input.address);
}

async function directoryName(admin: Admin, tenantId: string, address: string) {
  const { data } = await admin
    .from("tenant_entra_directory_people")
    .select("display_name")
    .eq("tenant_id", tenantId)
    .ilike("email", address.replace(/[\\%_]/g, (char) => `\\${char}`))
    .limit(1)
    .maybeSingle();
  return typeof data?.display_name === "string" ? data.display_name : null;
}

/**
 * Finds or creates the contact for an e-mail sender. An existing name is
 * kept unless it was only derived from the address; then it is upgraded.
 */
export async function ensureRequesterContact(
  admin: Admin,
  input: { tenantId: string; address: string; senderName?: string | null },
): Promise<{ id: string; email: string } | null> {
  const address = input.address.trim().toLowerCase();
  const existing = await admin
    .from("ticket_requesters")
    .select("id, email, display_name")
    .eq("tenant_id", input.tenantId)
    .eq("email", address)
    .maybeSingle();
  if (existing.error) return null;
  if (existing.data?.id) {
    if (isDerivedName(existing.data.display_name, address)) {
      const better = pickRequesterName({
        address,
        directoryName: await directoryName(admin, input.tenantId, address),
        senderName: input.senderName,
      });
      if (better !== existing.data.display_name) {
        await admin.from("ticket_requesters").update({ display_name: better })
          .eq("id", existing.data.id);
      }
    }
    return { id: existing.data.id, email: existing.data.email };
  }
  const name = pickRequesterName({
    address,
    directoryName: await directoryName(admin, input.tenantId, address),
    senderName: input.senderName,
  });
  const created = await admin
    .from("ticket_requesters")
    .upsert(
      { tenant_id: input.tenantId, email: address, display_name: name, source: "email" },
      { onConflict: "tenant_id,email", ignoreDuplicates: true },
    )
    .select("id, email")
    .maybeSingle();
  if (created.data?.id) return { id: created.data.id, email: created.data.email };
  // Created at the same moment by another worker.
  const again = await admin
    .from("ticket_requesters")
    .select("id, email")
    .eq("tenant_id", input.tenantId)
    .eq("email", address)
    .maybeSingle();
  return again.data?.id ? { id: again.data.id, email: again.data.email } : null;
}
