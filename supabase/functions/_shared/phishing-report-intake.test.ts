import { assertEquals } from "jsr:@std/assert@1";
import { isMarkedPhishingReport } from "./phishing-report-intake.ts";

Deno.test("marked phishing reports by subject", () => {
  assertEquals(isMarkedPhishingReport("WG: Phishing Mail"), true);
  assertEquals(isMarkedPhishingReport("Verdächtige E-Mail"), true);
  // Outlook «Nachricht melden»
  assertEquals(
    isMarkedPhishingReport(
      "Junk:5b29a20a-f84b-4ec7-70a5-08df3ffe391d|noreply@example.com|(Newsletter) 11/11/2026 14:20:56",
    ),
    true,
  );
  assertEquals(isMarkedPhishingReport("Phish:abc|x@example.com|(Hallo) 1/1/2026"), true);
  assertEquals(isMarkedPhishingReport("  junk: abc"), true);
});

Deno.test("ordinary support mails and false-alarm reports are not reports", () => {
  assertEquals(isMarkedPhishingReport("Drucker im 2. OG druckt nicht"), false);
  assertEquals(isMarkedPhishingReport("Not junk:abc|x@example.com|(Hallo)"), false);
  assertEquals(isMarkedPhishingReport("Junkfood Bestellung"), false);
  assertEquals(isMarkedPhishingReport(null), false);
});
