import { parseAction, readSubmission } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TENANT = "10000000-0000-4000-8000-000000000001";

Deno.test("Meldungen: Datei oder Text, nie beides", () => {
  assert(
    parseAction({ type: "submit", tenantId: TENANT, channel: "portal", rawText: "From: a@b.ch" })?.type === "submit",
    "Text",
  );
  assert(
    parseAction({ type: "submit", tenantId: TENANT, channel: "portal", fileName: "x.eml", fileBase64: "QQ==" }),
    "Datei",
  );
  assert(
    parseAction({ type: "submit", tenantId: TENANT, channel: "portal", fileName: "x.exe", fileBase64: "QQ==" }) === null,
    "falscher Dateityp",
  );
  assert(
    parseAction({
      type: "submit",
      tenantId: TENANT,
      channel: "portal",
      rawText: "x",
      fileName: "x.eml",
      fileBase64: "QQ==",
    }) === null,
    "beides",
  );
  assert(
    parseAction({ type: "saveSettings", tenantId: TENANT, enabled: true, reportAddress: "kein mail", priorityKey: "high" }) ===
      null,
    "ungültige Adresse",
  );
  const saved = parseAction({
    type: "saveSettings",
    tenantId: TENANT,
    enabled: true,
    reportAddress: "Phishing@Firma.CH",
    priorityKey: "urgent",
  });
  assert(saved?.type === "saveSettings" && saved.reportAddress === "phishing@firma.ch", "Adresse normalisiert");
});

Deno.test("Hochgeladene .eml-Weiterleitung wird ausgepackt", () => {
  const eml = [
    "From: anna@contoso.ch",
    "Subject: WG: Test",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain",
    "",
    "Bitte prüfen",
    "--b",
    "Content-Type: message/rfc822",
    "",
    "From: x@evil.example",
    "Subject: Gewinn",
    "",
    "Klick https://bit.ly/x",
    "--b--",
  ].join("\r\n");
  const result = readSubmission({ fileName: "meldung.eml", fileBase64: btoa(eml), rawText: null });
  assert(result?.source === "eml", "Quelle");
  assert(result.mail.headers.find((entry) => entry.name === "from")?.value === "x@evil.example", "Original");
  assert(readSubmission({ fileName: "x.msg", fileBase64: btoa("kein msg"), rawText: null }) === null, "kaputte .msg");
});
