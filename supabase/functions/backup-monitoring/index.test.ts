import { assertEquals } from "jsr:@std/assert@1";

import { backupWebhookUrl, parseJobInput, parseSettingsInput } from "./index.ts";

const id = "00000000-0000-4000-8000-000000000001";

Deno.test("backup settings validate sender patterns and numbers", () => {
  const settings = parseSettingsInput({
    enabled: true,
    autoResolve: true,
    warningAction: "ticket",
    defaultIntervalHours: 24,
    defaultGraceHours: "6",
    senderPatterns: "Veeam@Kunde.ch\n@backup.kunde.ch, *@nas.kunde.ch",
    subjectPatterns: ["[Success]", "[Failed]", ""],
  });
  assertEquals(settings?.senderPatterns, ["veeam@kunde.ch", "@backup.kunde.ch", "*@nas.kunde.ch"]);
  assertEquals(settings?.subjectPatterns, ["[Success]", "[Failed]"]);
  assertEquals(settings?.defaultGraceHours, 6);
  assertEquals(
    parseSettingsInput({
      enabled: true,
      autoResolve: true,
      warningAction: "comment",
      defaultIntervalHours: 24,
      defaultGraceHours: 6,
    }),
    null,
  );
  assertEquals(
    parseSettingsInput({
      enabled: true,
      autoResolve: true,
      warningAction: "ignore",
      defaultIntervalHours: 24,
      defaultGraceHours: 6,
      senderPatterns: ["not an address"],
    }),
    null,
  );
});

Deno.test("job input allows unwatched jobs", () => {
  assertEquals(parseJobInput({ id, expectedIntervalHours: null, active: true })?.expectedIntervalHours, null);
  assertEquals(parseJobInput({ id, expectedIntervalHours: 0, active: true }), null);
  assertEquals(parseJobInput({ id: "x", active: true }), null);
  assertEquals(
    backupWebhookUrl("https://abc.supabase.co/", "t0k"),
    "https://abc.supabase.co/functions/v1/backup-monitoring?token=t0k",
  );
});
