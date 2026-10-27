import {
  customerTicketEmailKindForOutbound,
  supportsInlineCustomerEmailLogo,
  tenantBrandingStoragePath,
} from "./exchange-mail-processing.ts";

Deno.test(
  "Kundschaftsvorlage wird nur für erlaubte externe Nachrichtenarten gewählt",
  () => {
    const expected = new Map([
      ["agent_reply", "agent_reply"],
      ["acknowledgement", "acknowledgement"],
      ["resolution", "resolution"],
      ["test", "test"],
    ]);
    for (const [kind, templateKind] of expected) {
      if (customerTicketEmailKindForOutbound(kind) !== templateKind) {
        throw new Error(`Falsche Kundschaftsvorlage für ${kind}.`);
      }
    }
    for (const kind of [
      "department_question",
      "department_answer",
      "other",
      null,
    ]) {
      if (customerTicketEmailKindForOutbound(kind) !== null) {
        throw new Error(
          `Interne oder unbekannte Nachrichtenart darf keine Kundschaftsvorlage wählen: ${kind}`,
        );
      }
    }
  },
);

Deno.test(
  "Mandantenlogo wird nur aus dem eigenen Branding-Speicherpfad gelesen",
  () => {
    const tenantId = "1c000000-0000-4000-8000-000000000001";
    const objectId = "2c000000-0000-4000-8000-000000000002";
    const expected = `tenant/${tenantId}/${objectId}.png`;
    const valid = `https://ewizsylzrwogsztsthbl.supabase.co/storage/v1/object/public/tenant-branding/${expected}`;
    if (tenantBrandingStoragePath(valid, tenantId) !== expected) {
      throw new Error("Der gültige eigene Mandantenlogopfad wurde abgelehnt.");
    }
    for (const invalid of [
      valid.replace(tenantId, "3c000000-0000-4000-8000-000000000003"),
      valid.replace("https://", "http://"),
      `${valid}?tracking=1`,
      "https://example.invalid/logo.png",
      `https://ewizsylzrwogsztsthbl.supabase.co/storage/v1/object/public/tenant-branding/tenant/${tenantId}/logo.png`,
    ]) {
      if (tenantBrandingStoragePath(invalid, tenantId) !== null) {
        throw new Error(`Unsicherer Logopfad wurde akzeptiert: ${invalid}`);
      }
    }
  },
);

Deno.test(
  "Thread-Antworten erhalten keinen nicht unterstützten CID-Anhang",
  () => {
    if (supportsInlineCustomerEmailLogo("agent_reply")) {
      throw new Error("Eine Graph-Reply darf keinen JSON-CID-Anhang erhalten.");
    }
    for (const kind of ["acknowledgement", "resolution", "test"] as const) {
      if (!supportsInlineCustomerEmailLogo(kind)) {
        throw new Error(
          `Neue Kundschafts-Mail ${kind} darf das CID-Logo verwenden.`,
        );
      }
    }
  },
);

Deno.test(
  "Inlinebild-Wiederherstellung verlangt eine dauerhaft gespeicherte Statusänderung",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./exchange-mail-processing.ts", import.meta.url),
    );

    for (const required of [
      "async function updateInlineMediaStatus(",
      'const updated = await admin\n    .from("mail_messages")',
      '.eq("tenant_id", message.tenant_id)\n    .select("id")',
      "if (updated.error || !updated.data?.length)",
      'throw new Error("inline_media_status_update_failed")',
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `Die Inlinebild-Wiederherstellung prüft die Statusspeicherung nicht fehlerschwer: ${required}`,
        );
      }
    }
  },
);
