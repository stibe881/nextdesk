function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "support mailbox deletion requires confirmation, stays tenant-bound and preserves ticket history",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    const migration = await Deno.readTextFile(
      new URL(
        "../../migrations/0110_exchange_mail_channel_soft_delete.sql",
        import.meta.url,
      ),
    );
    const processing = await Deno.readTextFile(
      new URL("../_shared/exchange-mail-processing.ts", import.meta.url),
    );

    assert(
      source.includes('base.action === "deleteMailbox"'),
      "Die Löschaktion muss explizit erkannt werden.",
    );
    assert(
      source.includes('"confirmDelete"') &&
        source.includes("value.confirmDelete === true"),
      "Die Löschaktion muss eine ausdrückliche Bestätigung verlangen.",
    );
    assert(
      source.includes('.eq("id", channelId)') &&
        source.includes('.eq("tenant_id", tenantId)'),
      "Jeder Kanalzugriff muss nach Kanal und Mandant eingegrenzt sein.",
    );
    assert(
      source.includes('.is("deleted_at", null)'),
      "Entfernte Postfächer dürfen nicht erneut als aktive Konfiguration geladen werden.",
    );
    assert(
      source.includes('status: "paused"') &&
        source.includes("deleted_at: deletedAt"),
      "Löschen muss die Verarbeitung stoppen und das Postfach archivieren.",
    );
    assert(
      source.includes('ignore_reason: "channel_deleted"'),
      "Ausstehende Zustellungen müssen beim Löschen verworfen werden.",
    );
    assert(
      source.includes('"pending", "failed", "processing"'),
      "Auch bereits beanspruchte Zustellungen müssen als verworfen markiert werden.",
    );
    assert(
      source.includes('"pending", "failed", "processing"])\n    .select("id")'),
      "Das Entfernen muss die tatsächliche Zahl verworfener Queue-Einträge auditieren.",
    );
    assert(
      source.includes('action: "exchange_mail.channel.deleted"'),
      "Die Entfernung muss auditierbar sein.",
    );
    assert(
      !source.includes('.from("exchange_mail_channels")\n    .delete('),
      "Die Löschaktion darf keine verknüpften Tickets oder Telemetrie physisch entfernen.",
    );
    assert(
      migration.includes(
        "create trigger exchange_mail_messages_require_active_channel",
      ) && migration.includes("for share"),
      "Neue Queue-Einträge müssen mit der Postfachentfernung serialisiert werden.",
    );
    assert(
      processing.includes('channel?.deleted_at ? "channel_deleted"') &&
        processing.includes('"conflict",\n        channel?.deleted_at'),
      "Die Inlinebild-Wiederherstellung muss entfernte Postfächer terminal beenden.",
    );
    assert(
      /const queued = await admin[\s\S]*?subject: "nextDesk E-Mail-Kanal Test",[\s\S]*?\.select\("id"\);[\s\S]*?if \(!queued\.data\?\.length\)/u.test(
        source,
      ),
      "Eine wegen paralleler Entfernung verworfene Testmail darf keinen Erfolg melden.",
    );
  },
);
