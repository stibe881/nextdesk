import { normalizeInboundEmailText } from "./exchange-inbound-text.ts";

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
  "entfernt eindeutige Unternehmenssignaturen nur für neue Ticketbeschreibungen",
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
BEISPIEL
CH-6340 Baar
m: info@beispiel.ch
w: beispiel.ch<https://www.beispiel.ch/>`;
    const result = normalizeInboundEmailText(input, undefined, {
      removeCorporateSignature: true,
    });
    const expected = `Hallo zusammen

Bitte helfen Sie beim Anmelden am Laptop.

Lieber Gruss
Mara`;
    if (result !== expected) {
      throw new Error(`Unternehmenssignatur blieb sichtbar: ${result}`);
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
      removeCorporateSignature: true,
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
        removeCorporateSignature: true,
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
    removeCorporateSignature: true,
  });
  if (result !== input) {
    throw new Error(
      `Persönlicher Nachtrag wurde unerwartet gekürzt: ${result}`,
    );
  }
});
