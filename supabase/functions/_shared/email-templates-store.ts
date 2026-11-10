// Lädt die vom Mandanten angepasste Vorlage; ohne Eintrag gelten die
// Standardtexte und der Versand ist eingeschaltet.
import {
  resolveEmailTemplate,
  type ResolvedEmailTemplate,
  type StoredEmailTemplate,
} from "./email-templates.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function loadEmailTemplate(
  admin: Admin,
  tenantId: string,
  key: string,
): Promise<ResolvedEmailTemplate> {
  let stored: StoredEmailTemplate | null = null;
  const result = await admin
    .from("tenant_email_templates")
    .select("enabled, fields")
    .eq("tenant_id", tenantId)
    .eq("template_key", key)
    .maybeSingle();
  if (!result.error && result.data) {
    const fields: Record<string, string> = {};
    if (result.data.fields && typeof result.data.fields === "object") {
      for (const [name, value] of Object.entries(result.data.fields)) {
        if (typeof value === "string") fields[name] = value;
      }
    }
    stored = { enabled: result.data.enabled !== false, fields };
  }
  return resolveEmailTemplate(key, stored);
}
