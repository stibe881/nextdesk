import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  EMAIL_TEMPLATES,
  fillEmailTemplate,
  resolveEmailTemplate,
  sanitizeTemplateFields,
} from "./email-templates.ts";

Deno.test("fills placeholders and drops unknown ones", () => {
  assertEquals(
    fillEmailTemplate("[{{ticketNumber}}] {{x}}!", { ticketNumber: "NX-1" }),
    "[NX-1] !",
  );
});

Deno.test("uses defaults, enabled by default", () => {
  const template = resolveEmailTemplate("resolution", null);
  assertEquals(template.enabled, true);
  assertEquals(
    template.text("intro", {}),
    "Ihr Ticket wurde als gelöst markiert.",
  );
});

Deno.test("uses custom text and respects the switch", () => {
  const template = resolveEmailTemplate("resolution", {
    enabled: false,
    fields: { intro: "Erledigt, {{ticketNumber}}", hint: "  " },
  });
  assertEquals(template.enabled, false);
  assertEquals(
    template.text("intro", { ticketNumber: "NX-2" }),
    "Erledigt, NX-2",
  );
  assertStringIncludes(template.text("hint", {}), "Ist noch etwas offen");
});

Deno.test("keeps only known, changed fields and single-line subjects", () => {
  const fields = sanitizeTemplateFields("acknowledgement", {
    subject: "Hallo\nBcc: x@y.z",
    intro: "Ihre Anfrage ist eingegangen.",
    evil: "x",
  });
  assertEquals(fields, { subject: "Hallo Bcc: x@y.z" });
  assertEquals(sanitizeTemplateFields("nope", {}), null);
});

Deno.test("keys are unique and defaults use known placeholders", () => {
  const keys = EMAIL_TEMPLATES.map((template) => template.key);
  assertEquals(new Set(keys).size, keys.length);
  for (const template of EMAIL_TEMPLATES) {
    const known = new Set(template.placeholders.map((p) => p.name));
    for (const field of template.fields) {
      for (const match of field.default.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
        assert(known.has(match[1]!), `${template.key}.${field.key}`);
      }
    }
  }
});
