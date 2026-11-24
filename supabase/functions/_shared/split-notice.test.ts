import { assert, assertEquals } from "jsr:@std/assert@1";
import { firstNameOf, splitNoticeText } from "./exchange-mail-processing.ts";

Deno.test("split notice lists the parts and asks for one ticket per request", () => {
  const text = splitNoticeText({
    formality: "du",
    firstName: "Martin",
    originalNumber: "ICT-2026-000209",
    parts: [
      { number: "ICT-2026-000210", subject: "Freischaltung Team 1" },
      { number: "ICT-2026-000211", subject: "Kopfhörer" },
    ],
  });
  assert(text.startsWith("Hallo Martin\n\nDeine Anfrage enthielt mehrere Anliegen."));
  assert(text.includes("in 2 Tickets aufgeteilt:\n• ICT-2026-000210 – Freischaltung Team 1\n• ICT-2026-000211 – Kopfhörer"));
  assert(text.includes("Das ursprüngliche Ticket ICT-2026-000209 wird nicht weitergeführt."));
  assert(text.includes("Unsere Bitte: Erstelle künftig pro Anliegen ein eigenes Ticket"));
});

Deno.test("split notice uses the formal tone", () => {
  const text = splitNoticeText({
    formality: "sie",
    firstName: null,
    originalNumber: "ICT-1",
    parts: [
      { number: "ICT-2", subject: "A" },
      { number: "ICT-3", subject: "B" },
    ],
  });
  assert(text.startsWith("Guten Tag\n\nIhre Anfrage"));
  assert(text.includes("Erstellen Sie künftig"));
});

Deno.test("first name comes from the contact display name", () => {
  assertEquals(firstNameOf("martin stalder"), "Martin");
  assertEquals(firstNameOf("E-Mail-Anfragende Person"), null);
  assertEquals(firstNameOf(null), null);
});
