import { assertEquals } from "jsr:@std/assert@1";
import {
  corporateSignatureAnchors,
  extractSignatureContacts,
  normalizeInboundEmailText,
} from "./exchange-inbound-text.ts";

Deno.test("bereinigt technische Outlook-Reaktions- und Abo-Fusszeilen", () => {
  const result = normalizeInboundEmailText(`Microsoft Outlook

[Profile Image]
[like]     Elise Wicki hat auf Ihre Nachricht reagiert
Di 27.10.2026 09:48
Re: Passwort
Hallo Elise

Liebe Grüsse
Tamara
[#INC-33990]:507888:fs[#INC-33990]:507888:2:fs
Zu Nachricht wechseln<https://outlook.office365.com/owa/?item=opaque>
Führen Sie jetzt ein Upgrade auf das neueste Outlook durch, um Reaktionen zu senden.
Mac <https://apps.apple.com/>
Abonnement kündigen<https://outlook.office365.com/mail/deeplink/unsubscribe>`);

  const expected = `Elise Wicki hat auf Ihre Nachricht reagiert
Di 27.10.2026 09:48
Re: Passwort
Hallo Elise

Liebe Grüsse
Tamara`;
  if (result !== expected) {
    throw new Error(`Outlook-Text wurde nicht korrekt bereinigt: ${result}`);
  }
});

Deno.test(
  "bewahrt CID-Verweise ausschliesslich für die bestehende private Inlinebild-Pipeline",
  () => {
    const result = normalizeInboundEmailText(
      '<p>Hallo&nbsp;Team</p><img src="cid:Logo-1@Mail"><img src="https://tracker.example/pixel.png"><p>Grüsse</p>',
    );
    if (result !== "Hallo Team\n\n[cid:Logo-1@Mail]\n\nGrüsse") {
      throw new Error(`CID oder Text wurde unerwartet verändert: ${result}`);
    }
  },
);

Deno.test(
  "entfernt Skript- und private Bildmarker ohne externe Auflösung",
  () => {
    const result = normalizeInboundEmailText(
      '<p>Bitte prüfen</p><script>alert("never")</script>[[nextdesk-inline-image:11111111-1111-4111-8111-111111111111]]',
    );
    if (result !== "Bitte prüfen") {
      throw new Error(`Unsichere Marker blieben im Text: ${result}`);
    }
  },
);

Deno.test(
  "entfernt auch kodiertes oder unbekanntes HTML und bewahrt unquotierte Content-IDs",
  () => {
    const result = normalizeInboundEmailText(
      '&lt;script&gt;alert("never")&lt;/script&gt;<iframe src="https://tracker.example/"></iframe><p>Hallo</p>&lt;img alt="&lt;" src="https://tracker.example/pixel.png"&gt;<img alt="<" src=cid:logo@example />',
    );
    if (result !== "Hallo\n\n[cid:logo@example]") {
      throw new Error(
        `Kodiertes HTML oder unquotete CID wurde nicht korrekt behandelt: ${result}`,
      );
    }
  },
);

Deno.test(
  "entfernt mehrfach kodiertes, kommentiertes und verschachteltes HTML ohne Textartefakte",
  () => {
    const result = normalizeInboundEmailText(
      '&amp;lt;script&amp;gt;alert("never")&amp;lt;/script&amp;gt;&lt;!-- trace --&gt;<!DOCTYPE html><div title="1 > 2">Text</div><p data="<span>nested</span>">Weiter</p>',
    );
    if (result !== "Text\n\nWeiter") {
      throw new Error(
        `Verschachteltes HTML wurde nicht korrekt entfernt: ${result}`,
      );
    }
  },
);

Deno.test(
  "erzeugt aus Entity-Anführungszeichen keine zusätzlichen CID-Marker",
  () => {
    const result = normalizeInboundEmailText(
      '<img src="cid:one&quot;><img src=&quot;two">',
    );
    if (result !== "E-Mail ohne Text") {
      throw new Error(
        `Entity-Anführungszeichen erzeugten einen CID-Marker: ${result}`,
      );
    }
  },
);

Deno.test(
  "entfernt eindeutige Unternehmenssignaturen nur aus neuen Ticketbeschreibungen",
  () => {
    const input = `Hallo zusammen

Bitte helfen Sie beim Anmelden am Laptop.

Lieber Gruss
Mara

Mara Muster
Sozialpädagogik
t: 041 000 00 00
[Logo_Beispiel.png]
<https://www.linkedin.com/company/beispiel> <https://www.instagram.com/beispiel>
https://www.linkedin.com/company/beispiel https://www.instagram.com/beispiel
BEISPIEL
CH-6340 Baar
m: info@beispiel.ch
w: beispiel.ch<https://www.beispiel.ch/>
[Skizze.png]`;
    const result = normalizeInboundEmailText(input, undefined, {
      formatCorporateSignature: true,
    });
    const expected = `Hallo zusammen

Bitte helfen Sie beim Anmelden am Laptop.

Lieber Gruss
Mara`;
    if (result !== expected) {
      throw new Error(`Signatur wurde nicht entfernt: ${result}`);
    }
    const contacts = extractSignatureContacts(input);
    if (
      JSON.stringify(contacts) !==
      JSON.stringify({
        phones: ["041 000 00 00"],
        emails: ["info@beispiel.ch"],
      })
    ) {
      throw new Error(`Kontaktdaten falsch: ${JSON.stringify(contacts)}`);
    }

    const replyResult = normalizeInboundEmailText(input);
    if (
      !replyResult.includes("Mara Muster") ||
      !replyResult.includes("Logo_Beispiel.png")
    ) {
      throw new Error(
        "Eine bestehende Ticketunterhaltung wurde unerwartet wie eine neue Ticketbeschreibung gekürzt.",
      );
    }
  },
);

Deno.test(
  "behält persönliche Abschlüsse ohne eindeutige Unternehmenssignatur bei",
  () => {
    const input = `Danke für Ihre Hilfe.

Liebe Grüsse
Mara

PS: Ich bin morgen wieder erreichbar.`;
    const result = normalizeInboundEmailText(input, undefined, {
      formatCorporateSignature: true,
    });
    if (result !== input) {
      throw new Error(
        `Persönlicher Abschluss wurde unerwartet gekürzt: ${result}`,
      );
    }
  },
);

Deno.test(
  "bewahrt einzelne CID- und Bilddateiverweise nach einer Grussformel",
  () => {
    for (const attachment of ["[cid:screenshot@message]", "[Skizze.png]"]) {
      const input = `Freundliche Grüsse
Mara
${attachment}`;
      const result = normalizeInboundEmailText(input, undefined, {
        formatCorporateSignature: true,
      });
      if (result !== input) {
        throw new Error(
          `Ein einzelner legitimer Bildverweis wurde als Signatur entfernt: ${attachment}`,
        );
      }
    }
  },
);

Deno.test("behält einen persönlichen Nachtrag mit Link und Adresse bei", () => {
  const input = `Freundliche Grüsse
Mara

PS: Der Ablauf steht unter https://beispiel.ch/ablauf.
Treffpunkt: 8000 Zürich`;
  const result = normalizeInboundEmailText(input, undefined, {
    formatCorporateSignature: true,
  });
  if (result !== input) {
    throw new Error(
      `Persönlicher Nachtrag wurde unerwartet gekürzt: ${result}`,
    );
  }
});

Deno.test(
  "ordnet einen persönlichen Nachtrag ausserhalb der sichtbaren Signatur ein",
  () => {
    const input = `Danke für die Rückmeldung.

Freundliche Grüsse
Mara

Mara Muster
t: 041 000 00 00
m: mara@beispiel.ch

PS: Der Ablauf steht unter https://beispiel.ch/ablauf.`;
    const result = normalizeInboundEmailText(input, undefined, {
      formatCorporateSignature: true,
    });
    const expected = `Danke für die Rückmeldung.

Freundliche Grüsse
Mara

PS: Der Ablauf steht unter https://beispiel.ch/ablauf.`;
    if (result !== expected) {
      throw new Error(
        `Persönlicher Nachtrag wurde falsch eingeordnet: ${result}`,
      );
    }
  },
);

Deno.test("entfernt auch Bilder einer erkannten Signatur", () => {
  const input = `Freundliche Grüsse
Mara

Mara Muster
t: 041 000 00 00
m: +41 79 123 45 67
mara@beispiel.ch
[cid:logo@message]`;
  const result = normalizeInboundEmailText(input, undefined, {
    formatCorporateSignature: true,
  });
  if (result !== "Freundliche Grüsse\nMara") {
    throw new Error(`Signatur wurde nicht entfernt: ${result}`);
  }
  const contacts = extractSignatureContacts(input);
  if (
    JSON.stringify(contacts.phones) !==
      JSON.stringify(["041 000 00 00", "+41 79 123 45 67"]) ||
    JSON.stringify(contacts.emails) !== JSON.stringify(["mara@beispiel.ch"])
  ) {
    throw new Error(`Kontaktdaten falsch: ${JSON.stringify(contacts)}`);
  }
});

Deno.test(
  "erkennt eine Signatur nach einer Grussformel am Satzende (Gruess)",
  () => {
    const mail = `Hallo Zusammen

Sara Zulian erhält keine Anrufe.

Danke für eure Hilfe und e liebe Gruess

Melanie Sauter
Sozialpädagoge*in
Integration
t: 041 767 39 62
[Logo_Sonnenberg_Baar_CMYK.png]
[https://eucattachment.freshservice.com/inline/attachment?token=abc]<https://www.linkedin.com/company/x> [https://eucattachment.freshservice.com/inline/attachment?token=def] <https://www.facebook.com/SonnenbergBaar>
SONNENBERG
Landhausstrasse 20
CH-6340 Baar (ZG)
m: info@sonnenberg-baar.ch
w: sonnenberg-baar.ch<https://www.sonnenberg-baar.ch/>`;
    const anchors = corporateSignatureAnchors(mail);
    if (anchors?.firstLine !== "Sozialpädagoge*in") {
      throw new Error(`Signatur nicht erkannt: ${JSON.stringify(anchors)}`);
    }
    const result = normalizeInboundEmailText(mail, undefined, {
      formatCorporateSignature: true,
    });
    if (
      !result.endsWith("e liebe Gruess\n\nMelanie Sauter") ||
      result.includes("Sozialpädagoge*in") ||
      result.includes("freshservice") ||
      result.includes("Logo_Sonnenberg")
    ) {
      throw new Error(`Signatur nicht bereinigt: ${result}`);
    }
  },
);

Deno.test(
  "hält einen langen Satz mit «Gruss» nicht für eine Grussformel",
  () => {
    const anchors = corporateSignatureAnchors(`Hallo

Bitte richte der ganzen Abteilung im zweiten Stock einen herzlichen Gruss aus

Anna
t: 041 000 00 00
m: anna@example.ch`);
    if (anchors !== null) {
      throw new Error(`Unerwartete Signatur: ${JSON.stringify(anchors)}`);
    }
  },
);

Deno.test("erkennt Grussformel und Namen auf derselben Zeile", () => {
  const mail = `Salut zusammen

Wie kann ich Dateien auf meinem OneDrive privat halten?

Danke für eure Rückmeldung.

Beste Grüsse, Gabriela


Gabriela Leone
Heilpädagoge*in
Zyklus 3
t:
[Logo_Sonnenberg_Baar_CMYK.png]
<https://www.linkedin.com/company/x>  <https://www.facebook.com/SonnenbergBaar>
SONNENBERG
Landhausstrasse 20
CH-6340 Baar (ZG)
t:   +41 41 767 78 33
m: info@sonnenberg-baar.ch`;
  const result = normalizeInboundEmailText(mail, undefined, {
    formatCorporateSignature: true,
  });
  if (
    !result.endsWith("Beste Grüsse, Gabriela") ||
    result.includes("SONNENBERG")
  ) {
    throw new Error(`Signatur nicht entfernt: ${result}`);
  }
  const contacts = extractSignatureContacts(mail);
  if (
    JSON.stringify(contacts) !==
    JSON.stringify({
      phones: ["+41 41 767 78 33"],
      emails: ["info@sonnenberg-baar.ch"],
    })
  ) {
    throw new Error(`Kontaktdaten falsch: ${JSON.stringify(contacts)}`);
  }
});

Deno.test(
  "erkennt zweisprachige Grussformel, Firmenzeile vor Namen und Outlook-Hinweis",
  () => {
    const mail = [
      "Sie erhalten nicht häufig E-Mails von philippe.ramel@dormakaba.com. Erfahren Sie, warum dies wichtig ist<https://aka.ms/LearnAboutSenderIdentification>",
      "",
      "Guten Tag Herr Petrovic",
      "",
      "Für heute sind wir fertig mit der Inbetriebnahme.",
      "",
      "Freundliche Grüsse / Best regards",
      "",
      "dormakaba Schweiz AG",
      "",
      "Philippe Ramel",
      "",
      "SW-Installationen Zutritt",
      "",
      "Helpdesk: +41 (0)44 818 91 50",
      "",
      "philippe.ramel@dormakaba.com",
      "",
      "www.dormakaba.com<http://www.dormakaba.com/>",
      "",
      "dormakaba Schweiz AG | Mühlebühlstrasse 23 | 8620 Wetzikon | Schweiz | T +41 848 85 86 87",
      "",
      "This e-mail may contain confidential information.",
    ].join("\n");
    const text = normalizeInboundEmailText(mail, "x", {
      formatCorporateSignature: true,
    });
    assertEquals(
      text,
      [
        "Guten Tag Herr Petrovic",
        "",
        "Für heute sind wir fertig mit der Inbetriebnahme.",
        "",
        "Freundliche Grüsse / Best regards",
        "",
        "dormakaba Schweiz AG",
        "",
        "Philippe Ramel",
      ].join("\n"),
    );
    assertEquals(extractSignatureContacts(mail), {
      phones: ["+41 (0)44 818 91 50", "+41 848 85 86 87"],
      emails: ["philippe.ramel@dormakaba.com"],
    });
  },
);

Deno.test(
  "erkennt englische Grussformeln und «Mit freundlichen Grüssen»",
  () => {
    for (const farewell of [
      "Kind regards",
      "Best regards,",
      "Mit freundlichen Grüssen",
    ]) {
      const mail = [
        "Hallo",
        "",
        "Der Drucker geht nicht.",
        "",
        farewell,
        "Anna Muster",
        "Tel: +41 41 123 45 67",
        "anna@example.com",
      ].join("\n");
      assertEquals(
        normalizeInboundEmailText(mail, "x", {
          formatCorporateSignature: true,
        }),
        [
          "Hallo",
          "",
          "Der Drucker geht nicht.",
          "",
          farewell,
          "Anna Muster",
        ].join("\n"),
      );
    }
  },
);
