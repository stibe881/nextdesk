// Screens captured for the handbooks. Each shot names the persona whose
// session is injected (null = signed out) and drives the UI the way a person
// would: clicking navigation entries, buttons and tabs.

export const SHOTS = [
  {
    name: "login",
    persona: null,
    async run(h) {
      await h.open();
      await h.waitText("Anmelden");
    },
  },
  {
    name: "ma-start",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.waitText("Laptop startet");
    },
  },
  {
    name: "ma-ticket-erfassen",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.click("Neue Erfassung öffnen");
      await h.click("Ticket erfassen", { role: "menuitem" });
      await h.waitText("Ticket einordnen");
      const form = h.page
        .locator("form")
        .filter({ hasText: "Ticket einordnen" })
        .first();
      await form
        .getByLabel("Betreff")
        .fill("VPN-Verbindung im Homeoffice nicht möglich");
      await form
        .getByLabel("Kategorie")
        .selectOption({ label: "Netzwerk & VPN" });
      await h.settle(300);
      await form.getByLabel("Unterkategorie").selectOption({ label: "VPN" });
      await form.getByLabel("Priorität").selectOption({ label: "Mittel" });
      await form
        .getByLabel("Beschreibung")
        .fill(
          "Seit gestern Abend kann ich mich von zu Hause nicht mehr mit dem VPN verbinden. Es erscheint die Meldung «Gateway nicht erreichbar». Das Internet funktioniert.",
        );
      await h.page
        .locator("body")
        .click({ position: { x: 5, y: 5 } })
        .catch(() => undefined);
      await h.settle(800);
      await h.scrollModalToTop();
    },
  },
  {
    name: "ma-meine-tickets",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.nav("Tickets");
      await h.waitText("Laptop startet");
      await h.scrollTo(
        h.page
          .getByRole("tablist")
          .filter({ hasText: "Alle Queues" })
          .or(h.page.locator("text=Alle Queues")),
        24,
      );
    },
  },
  {
    name: "ma-ticket-verlauf",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.clickText("Laptop startet nach Windows-Update nicht mehr");
    },
  },
  {
    name: "ma-bewertung",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.clickText("Neuer Bildschirm für Homeoffice");
      const card = h.page.locator(".ticket-satisfaction");
      await card.waitFor();
      await card.getByRole("radio", { name: "4 von 5 Sternen" }).click();
      await card
        .getByRole("textbox")
        .fill("Schnelle Lieferung, vielen Dank!");
      await card.scrollIntoViewIfNeeded();
    },
  },
  {
    name: "ma-wissen",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
      await h.page
        .locator("article, li, div")
        .filter({ hasText: /^.*VPN im Homeoffice einrichten/ })
        .getByRole("button", { name: /Artikel lesen/ })
        .first()
        .click();
      await h.settle();
      await h.scrollToText("Bibliothek");
    },
  },
  {
    name: "ma-profil",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.openPersonalSettings();
    },
  },
  {
    name: "ag-uebersicht",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.waitText("Meine Prioritäten");
    },
  },
  {
    name: "ag-arbeitsplatz",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Arbeitsplatz");
    },
  },
  {
    name: "ag-kanban",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Tickets");
      await h.clickText("Offene Tickets", { exact: true });
      await h.click("Kanban");
      await h.scrollToText(
        "Ziehen Sie eine Karte in eine andere Spalte, um den Status zu ändern.",
        90,
      );
    },
  },
  {
    name: "ag-ticket-detail",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Tickets");
      await h.clickText("Laptop startet nach Windows-Update nicht mehr");
    },
  },
  {
    name: "ag-personensuche",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.page.getByLabel("Global suchen").fill("brunner");
      await h.waitText("Personen aus Microsoft Entra");
      await h.settle(300);
    },
  },
  {
    name: "ag-person",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.page.getByLabel("Global suchen").fill("lena");
      await h.waitText("Personen aus Microsoft Entra");
      await h.page
        .locator(".global-search__person")
        .filter({ hasText: "Lena Brunner" })
        .click();
      await h.waitText("Ticket für Lena erfassen");
      await h.settle(300);
    },
  },
  {
    name: "ag-antworten",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Tickets");
      await h.clickText("VPN-Verbindung bricht im Homeoffice ständig ab");
      await h.waitText("Antwort an anfragende Person");
      await h.page
        .getByRole("button", { name: /Antwort an anfragende Person/ })
        .first()
        .click();
      const textarea = h.page
        .locator("label.ticket-comment-body textarea")
        .filter({ visible: true })
        .first();
      await textarea.fill(
        "Guten Tag Herr Baumann\n\nIch habe Ihnen die neue VPN-Version 5.2 über das Unternehmensportal zugewiesen. Bitte starten Sie Ihren Laptop heute Abend neu und melden Sie sich morgen kurz, ob die Verbindung stabil bleibt.\n\nFreundliche Grüsse\nMara Keller",
      );
      await h.settle(400);
      await h.scrollTo(
        h.page
          .locator("label.ticket-comment-body")
          .filter({ visible: true })
          .first(),
        230,
      );
      await textarea.evaluate((element) => {
        element.scrollTop = 0;
      });
    },
  },
  {
    name: "ag-profil",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.openPersonalSettings();
      await h.waitText("Handbuch für Agenten");
      await h.scrollToText("Handbücher", 140);
    },
  },
  {
    name: "ag-neues-ticket",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.click("Neue Erfassung öffnen");
      await h.click("Ticket erfassen", { role: "menuitem" });
      await h.waitText("Ticket einordnen");
      const form = h.page
        .locator("form")
        .filter({ hasText: "Ticket einordnen" })
        .first();
      await form.getByRole("combobox").first().fill("Claudia");
      await h.page.getByRole("option", { name: "Claudia Widmer" }).click();
      await form
        .getByLabel("Betreff")
        .fill("Telefon am Empfang ohne Freizeichen");
      await form.getByLabel("Kategorie").selectOption({ label: "Hardware" });
      await h.settle(300);
      await form.getByLabel("Priorität").selectOption({ label: "Hoch" });
      await form
        .getByLabel("Beschreibung")
        .fill(
          "Frau Widmer meldet telefonisch, dass das Tischtelefon am Empfang seit 8 Uhr kein Freizeichen mehr hat. Eingehende Anrufe werden auf das Mobiltelefon umgeleitet.",
        );
      await h.page
        .locator("body")
        .click({ position: { x: 5, y: 5 } })
        .catch(() => undefined);
      await h.settle(800);
      await h.scrollModalToTop();
    },
  },
  {
    name: "ag-wissen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
    },
  },
];

/** Opens Einstellungen and the given settings tab as an administrator. */
async function openSettingsTab(h, tab) {
  await h.open();
  await h.nav("Einstellungen");
  await h.waitText("Mandantenüberblick");
  if (tab) {
    await h.click(tab, { role: "tab", exact: true });
    // Keep the tab bar visible but use the screen for the content below it.
    await h.scrollTo(h.page.locator("nav.section-tabs"), 8);
  }
}

/** Opens the configuration of a module card in Einstellungen → Funktionen. */
async function openFeatureConfiguration(h, featureName) {
  await openSettingsTab(h, "Funktionen");
  const card = h.page
    .locator("li.tenant-admin-settings__feature")
    .filter({
      has: h.page.locator("strong", {
        hasText: new RegExp(
          `^${featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      }),
    })
    .first();
  await card.getByRole("button", { name: "Konfigurieren" }).click();
  await h.settle(600);
  await h.scrollToText(`${featureName} konfigurieren`, 12);
}

SHOTS.push(
  {
    name: "ad-einstellungen",
    persona: "admin",
    run: (h) => openSettingsTab(h, null),
  },
  {
    name: "ad-benutzer",
    persona: "admin",
    async run(h) {
      await openSettingsTab(h, "Personen");
      await h.scrollTo(
        h.page.getByRole("button", { name: "Einladung versenden" }),
        12,
      );
    },
  },
  {
    name: "ad-rollen",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Rollen"),
  },
  {
    name: "ad-sla",
    persona: "admin",
    run: (h) => openSettingsTab(h, "SLA"),
  },
  {
    name: "ad-module",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Funktionen"),
  },
  {
    name: "ad-branding",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Design"),
  },
  {
    name: "ad-automation",
    persona: "admin",
    async run(h) {
      await openFeatureConfiguration(h, "SLA & Automatisierung");
      await h.scrollToText("REGEL-BAUKASTEN", 12);
    },
  },
  {
    name: "ad-profil",
    persona: "admin",
    async run(h) {
      await h.open();
      await h.openPersonalSettings();
      await h.waitText("Installationsanleitung");
      await h.scrollToText("Handbücher", 140);
    },
  },
  {
    name: "in-sso",
    persona: "admin",
    async run(h) {
      await openSettingsTab(h, "Funktionen");
      const card = h.page
        .locator("li.tenant-admin-settings__feature--operational")
        .filter({ hasText: "Single Sign-On" });
      await card.getByRole("button", { name: "Konfigurieren" }).click();
      await h.settle(600);
      await h.scrollTo(card, 12);
    },
  },
  {
    name: "in-exchange",
    persona: "admin",
    run: (h) => openFeatureConfiguration(h, "E-Mail-Kanal (Exchange Online)"),
  },
  {
    name: "in-intune",
    persona: "admin",
    run: (h) => openFeatureConfiguration(h, "Assets & Dienste"),
  },
  {
    name: "in-verzeichnis",
    persona: "admin",
    async run(h) {
      await openSettingsTab(h, "Personen");
    },
  },
  {
    name: "in-monitoring",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Monitoring"),
  },
);
