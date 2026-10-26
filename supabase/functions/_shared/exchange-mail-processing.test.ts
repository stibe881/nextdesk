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
