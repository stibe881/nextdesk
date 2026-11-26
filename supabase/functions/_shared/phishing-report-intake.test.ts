import { assertEquals } from "jsr:@std/assert@1";
import { isMarkedPhishingReport, isNotJunkReport, isPhishingReportMail } from "./phishing-report-intake.ts";

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

Deno.test("Outlook «Kein Junk» reports are recognised in the support mailbox", () => {
  if (!isNotJunkReport("Not junk:9233415f-efcf|j.penuela@utp.edu.co|(Open position.)")) {
    throw new Error("not junk missed");
  }
  if (isNotJunkReport("Junk:abc|x@y.ch|(Gewinn)")) throw new Error("junk taken as not junk");
  if (isNotJunkReport("Re: Not junk mail")) throw new Error("ordinary subject taken");
});

Deno.test("report address that is another support mailbox needs a marked subject", () => {
  const settings = { enabled: true, reportAddress: "support-ict@example.ch" } as unknown as Parameters<
    typeof isPhishingReportMail
  >[0];
  const base = {
    mailboxAddress: "support@example.ch",
    recipients: ["support@example.ch", "support-ict@example.ch"],
    supportMailboxes: ["support@example.ch", "support-ict@example.ch"],
  };
  assertEquals(isPhishingReportMail(settings, { ...base, subject: "Laptop und Druckerkarte" }), false);
  assertEquals(isPhishingReportMail(settings, { ...base, subject: "Junk:abc|x@y.ch|(Gewinn)" }), true);
  // A pure alias (no support mailbox) still counts for every mail.
  assertEquals(
    isPhishingReportMail(settings, { ...base, supportMailboxes: ["support@example.ch"], subject: "WG: Rechnung" }),
    true,
  );
});
