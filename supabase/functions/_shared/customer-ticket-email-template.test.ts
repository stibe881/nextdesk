import {
  normalizeCustomerTicketEmailBranding,
  renderCustomerTicketEmail,
  type CustomerTicketEmailBrand,
  type CustomerTicketEmailKind,
} from "./customer-ticket-email-template.ts";

const branding: CustomerTicketEmailBrand = {
  accentColor: "#1C8276",
  displayName: "Verein SONNENBERG Baar",
  logoContentId: "nextdesk-tenant-brand-logo",
  primaryColor: "#1B67C9",
  secondaryColor: "#15365F",
};

function render(kind: CustomerTicketEmailKind, text = "Bitte kurz testen.") {
  return renderCustomerTicketEmail({
    attachmentNotice: false,
    branding,
    kind,
    subject: "VPN einrichten",
    text,
    ticketNumber: "ICT-2026-000011",
  });
}

Deno.test(
  "Kundschafts-E-Mail verwendet Mandantenfarben und eine sichere Textmarke",
  () => {
    const html = renderCustomerTicketEmail({
      attachmentNotice: false,
      branding: { ...branding, logoContentId: null },
      kind: "agent_reply",
      subject: "VPN einrichten",
      text: "Kannst du es bitte kurz <testen>?",
      ticketNumber: "ICT-2026-000011",
    });
    for (const required of [
      "Neue Nachricht zu Ihrem Ticket",
      "VPN einrichten",
      "ICT-2026-000011 · VPN einrichten",
      "Ticketbenachrichtigung über Verein SONNENBERG Baar",
      "#1B67C9",
      "#15365F",
      "#1C8276",
      "Kannst du es bitte kurz &lt;testen&gt;?",
      'role="presentation" width="640"',
    ]) {
      if (!html.includes(required))
        throw new Error(`Fehlendes E-Mail-Element: ${required}`);
    }
    if (html.includes("<testen>")) {
      throw new Error("Nachrichtentext wurde nicht HTML-escaped.");
    }
    if (
      html.includes("cid:") ||
      html.includes("https://") ||
      html.includes("http://")
    ) {
      throw new Error(
        "Die Thread-Antwort darf keine externe oder CID-Ressource laden.",
      );
    }
  },
);

Deno.test(
  "Neue Kundschafts-Mails können ein eingebettetes Mandantenlogo anzeigen",
  () => {
    const html = render("acknowledgement");
    if (!html.includes("cid:nextdesk-tenant-brand-logo")) {
      throw new Error(
        "Das sichere CID-Logo fehlt in einer neuen Kundschafts-Mail.",
      );
    }
  },
);

Deno.test(
  "Kundschafts-E-Mail escaped Ticketnummer, Betreff und Markenbezeichnung",
  () => {
    const html = renderCustomerTicketEmail({
      attachmentNotice: false,
      branding: { ...branding, displayName: "Support <Portal>" },
      kind: "agent_reply",
      subject: "VPN & <Test>",
      text: "Antwort",
      ticketNumber: "ICT-2026-<000011>",
    });
    for (const required of [
      "ICT-2026-&lt;000011&gt; · VPN &amp; &lt;Test&gt;",
      "Ticketbenachrichtigung über Support &lt;Portal&gt;",
    ]) {
      if (!html.includes(required)) {
        throw new Error(`Wert wurde nicht HTML-escaped: ${required}`);
      }
    }
  },
);

Deno.test(
  "Kundschafts-E-Mail unterscheidet Bestätigung, Lösung und Testmail",
  () => {
    const expectations: Array<[CustomerTicketEmailKind, string]> = [
      ["acknowledgement", "Ihre Anfrage ist eingegangen."],
      ["resolution", "Ihr Ticket wurde als gelöst markiert."],
      ["test", "Testmail erfolgreich versendet."],
    ];
    for (const [kind, text] of expectations) {
      if (!render(kind).includes(text)) {
        throw new Error(`Falscher Text für ${kind}.`);
      }
    }
  },
);

Deno.test("Kundschafts-E-Mail weist auf grosse Anhänge hin", () => {
  const html = renderCustomerTicketEmail({
    attachmentNotice: true,
    branding,
    kind: "agent_reply",
    subject: "VPN einrichten",
    text: "Antwort",
    ticketNumber: "ICT-2026-000011",
  });
  if (!html.includes("Einige Anhänge sind für den E-Mail-Versand zu gross.")) {
    throw new Error("Der Hinweis zu grossen Anhängen fehlt.");
  }
});

Deno.test(
  "Ungültige Brandingwerte fallen auf sichere Darstellung zurück",
  () => {
    const normalized = normalizeCustomerTicketEmailBranding({
      accentColor: "url(javascript:alert(1))",
      displayName: "",
      logoContentId: "cid:extern",
      logoUrl: "javascript:alert(1)",
      primaryColor: "blue",
      secondaryColor: "#12",
    });
    if (
      normalized.primaryColor !== "#2563EB" ||
      normalized.secondaryColor !== "#0F172A" ||
      normalized.accentColor !== "#14B8A6" ||
      normalized.logoContentId !== null ||
      normalized.logoUrl !== null ||
      normalized.displayName !== "Support"
    ) {
      throw new Error(
        "Ungültige Brandingwerte wurden nicht sicher normalisiert.",
      );
    }
  },
);

Deno.test("Kundschafts-E-Mail zeigt das öffentliche Logo, wenn kein Inline-Logo möglich ist", () => {
  const html = renderCustomerTicketEmail({
    attachmentNotice: false,
    branding: {
      accentColor: "#1C8276",
      displayName: "SONNENBERG",
      logoContentId: null,
      logoUrl: "https://example.supabase.co/storage/v1/object/public/tenant-branding/tenant/x/logo.png",
      primaryColor: "#2563EB",
      secondaryColor: "#0F172A",
    },
    kind: "agent_reply",
    subject: "Drucker",
    text: "Hallo",
    ticketNumber: "ICT-1",
  });
  if (
    !html.includes('src="https://example.supabase.co/storage/v1/object/public/tenant-branding/tenant/x/logo.png"') ||
    !html.includes("Ticketbenachrichtigung über SONNENBERG") ||
    html.includes("nextDesk")
  ) {
    throw new Error("Logo oder Mandantenname fehlen in der E-Mail.");
  }
});

Deno.test("Erinnerungsmail zeigt nur sichere Ein-Klick-Aktionen", () => {
  const html = renderCustomerTicketEmail({
    actions: [
      {
        label: "Problem ist gelöst",
        url: "https://app.nextdesk.ch/#ticket-aktion=v1.a.b",
        primary: true,
      },
      { label: "Ich brauche noch Hilfe", url: "javascript:alert(1)" },
      {
        label: "<b>Hilfe</b>",
        url: "https://app.nextdesk.ch/#ticket-aktion=v1.c.d",
      },
    ],
    attachmentNotice: false,
    branding,
    kind: "agent_reply",
    subject: "VPN einrichten",
    text: "Wir warten noch auf Ihre Rückmeldung.",
    ticketNumber: "ICT-2026-000011",
  });
  if (
    !html.includes("Problem ist gelöst") ||
    !html.includes("#ticket-aktion=v1.a.b") ||
    !html.includes("&lt;b&gt;Hilfe&lt;/b&gt;") ||
    html.includes("javascript:") ||
    !html.includes("einmal verwendbar")
  ) {
    throw new Error("Ein-Klick-Aktionen werden nicht sicher dargestellt.");
  }
});

const links = [1, 2, 3, 4, 5].map((score) => ({
  score,
  url: `https://app.nextdesk.ch/#bewertung=${score}`,
}));
const notice = {
  title: "Neu im Shop: <Teams>",
  body: "Ein Team bestellen Sie jetzt & ohne Ticket.",
  buttonLabel: "Zum Shop",
  url: "https://app.nextdesk.ch/shop?a=1&b=2",
  symbol: "<3",
  color: "info" as const,
};

function renderWith(
  extra: Record<string, unknown>,
  kind: CustomerTicketEmailKind = "resolution",
) {
  return renderCustomerTicketEmail({
    attachmentNotice: false,
    branding,
    kind,
    subject: "VPN einrichten",
    text: "Hallo",
    ticketNumber: "ICT-1",
    ...extra,
  });
}

Deno.test("Hinweisblock der ICT wird gerendert und escaped", () => {
  const html = renderWith({ notice, footerContact: "support@x.ch <ICT>" });
  for (const required of [
    "NEU BEI DER ICT",
    "Neu im Shop: &lt;Teams&gt;",
    "Ein Team bestellen Sie jetzt &amp; ohne Ticket.",
    "Zum Shop",
    'href="https://app.nextdesk.ch/shop?a=1&amp;b=2"',
    "&lt;3",
    "#075985",
    "Hinweise der ICT erscheinen nur gelegentlich und nie in Sicherheitsmeldungen.",
    "support@x.ch &lt;ICT&gt;",
  ]) {
    if (!html.includes(required)) throw new Error(`Fehlt: ${required}`);
  }
  if (html.includes("<Teams>") || html.includes("<ICT>")) {
    throw new Error("Hinweis nicht escaped.");
  }
});

Deno.test("Hinweisblock erscheint nur mit https-URL und ausserhalb von Sicherheitsmeldungen", () => {
  const insecure = renderWith({ notice: { ...notice, url: "http://x.ch" } });
  const script = renderWith({ notice: { ...notice, url: "javascript:1" } });
  const security = renderWith({ notice }, "security_notice");
  const none = renderWith({});
  for (const html of [insecure, script, security, none]) {
    if (html.includes("NEU BEI DER ICT") || html.includes("einmal pro Woche")) {
      throw new Error("Hinweisblock darf nicht erscheinen.");
    }
  }
});

Deno.test("Hinweisblock kappt Längen und mappt Farben", () => {
  const long = renderWith({
    notice: {
      ...notice,
      title: "T".repeat(100),
      body: "B".repeat(300),
      buttonLabel: "L".repeat(60),
      symbol: "ABCDEFG",
    },
  });
  if (
    long.includes("T".repeat(81)) ||
    !long.includes("T".repeat(80)) ||
    long.includes("B".repeat(261)) ||
    !long.includes("B".repeat(260)) ||
    long.includes("L".repeat(41)) ||
    !long.includes("L".repeat(40)) ||
    !long.includes("ABCD<") ||
    long.includes("ABCDE")
  ) {
    throw new Error("Längen nicht gekappt.");
  }
  const expected: Array<[string, string]> = [
    ["brand", "#1B67C9"],
    ["info", "#075985"],
    ["success", "#1F7A45"],
    ["warning", "#B45309"],
  ];
  for (const [color, hex] of expected) {
    const html = renderWith({ notice: { ...notice, color, symbol: null } });
    const block = html.slice(html.indexOf("NEU BEI DER ICT") - 900);
    if (!block.includes(`background-color:${hex}`)) {
      throw new Error(`Farbe ${color} falsch.`);
    }
  }
});

Deno.test("Sterne erscheinen nur bei fünf https-Links", () => {
  const five = renderWith({ ratingLinks: links });
  if (
    !five.includes("Wie zufrieden waren Sie?") ||
    (five.match(/&#9733;/g) ?? []).length !== 5 ||
    !five.includes("width:44px;height:44px")
  ) {
    throw new Error("Sterne fehlen.");
  }
  const four = renderWith({ ratingLinks: links.slice(0, 4) });
  const mixed = renderWith({
    ratingLinks: [...links.slice(0, 4), { score: 5, url: "http://x.ch" }],
  });
  for (const html of [four, mixed]) {
    if (html.includes("&#9733;")) throw new Error("Sterne ohne 5 https-Links.");
  }
});

Deno.test("Hauptbutton: oben ohne Sterne, ausgelagert mit Sternen, nur https", () => {
  const primaryAction = { label: "Ticket öffnen", url: "https://app.nextdesk.ch/t/1" };
  const plain = renderWith({ primaryAction }, "agent_reply");
  if (!plain.includes("Ticket öffnen") || !plain.includes("https://app.nextdesk.ch/t/1")) {
    throw new Error("Hauptbutton fehlt.");
  }
  if (plain.indexOf("Ticket öffnen") > plain.indexOf("Hallo")) {
    throw new Error("Hauptbutton muss über der Nachricht stehen.");
  }
  const withStars = renderWith({ primaryAction, ratingLinks: links });
  if (withStars.indexOf("Ticket öffnen") < withStars.indexOf("Hallo")) {
    throw new Error("Zweiter Button muss unter der Nachricht stehen.");
  }
  const bad = renderWith({ primaryAction: { label: "X", url: "http://x.ch" } }, "agent_reply");
  if (bad.includes("http://x.ch")) throw new Error("http-Button gerendert.");
});

Deno.test("Overrides für Titel, Einleitung und Hinweis wirken", () => {
  const html = renderWith(
    { eyebrow: "Eigener Titel", intro: "Eigene Einleitung", replyHint: "Eigener Hinweis" },
    "agent_reply",
  );
  for (const required of ["Eigener Titel", "Eigene Einleitung", "Eigener Hinweis"]) {
    if (!html.includes(required)) throw new Error(`Override fehlt: ${required}`);
  }
});
