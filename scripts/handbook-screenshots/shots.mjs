// Screens captured for the handbooks. Each shot names the persona whose
// session is injected (null = signed out) and drives the UI the way a person
// would: clicking navigation entries, buttons and tabs.

const openDemoProject = async (h, tab) => {
  await h.open();
  await h.nav("Projekte");
  await h.clickText("Netzwerk-Erneuerung Standort Bern");
  await h.waitText("Alle Projekte");
  if (tab) await h.click(tab, { role: "tab" });
};

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
      await h.waitText("Einordnung");
      const form = h.page
        .locator("form")
        .filter({ hasText: "Einordnung" })
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
      await card.getByRole("textbox").fill("Schnelle Lieferung, vielen Dank!");
      await card.scrollIntoViewIfNeeded();
    },
  },
  {
    name: "ma-shop",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.nav("Shop");
      await h.waitText("Headset Jabra Evolve2 65");
    },
  },
  {
    name: "ma-wissen",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
      await h.page
        .getByRole("searchbox", { name: "Wissensdatenbank durchsuchen" })
        .fill("VPN");
      await h.settle(1200);
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
        "Ziehe eine Karte in eine andere Spalte, um den Status zu ändern.",
        90,
      );
    },
  },
  {
    name: "ag-projekte",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Projekte");
      await h.waitText("Netzwerk-Erneuerung Standort Bern");
    },
  },
  {
    name: "ag-projekte-zeitplan",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Projekte");
      await h.click("Zeitplan", { role: "tab" });
      await h.waitText("Meilenstein");
    },
  },
  {
    name: "ag-projekt-ueberblick",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, null);
      await h.waitText("Meilensteine");
    },
  },
  {
    name: "ag-projekt-zeitplan",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Zeitplan");
      await h.waitText("Switches vorkonfigurieren");
    },
  },
  {
    name: "ag-projekt-board",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Board");
      await h.waitText("WLAN Access Points montieren");
    },
  },
  {
    name: "ag-projekt-liste",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Liste");
      await h.page.getByLabel("Switches vorkonfigurieren auswählen").check();
      await h.page.getByLabel("Etage 1 und 2 auswählen").check();
      await h.scrollToText("2 ausgewählt", 150);
    },
  },
  {
    name: "ag-projekt-aufgabe",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Liste");
      await h.clickText("Switches vorkonfigurieren", { exact: true });
      await h.waitText("Checkliste (2/4)");
    },
  },
  {
    name: "ag-projekt-budget",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Zeiten & Budget");
      await h.waitText("Projekt gesamt");
    },
  },
  {
    name: "ag-projekt-doku",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, "Dokumentation");
      await h.waitText("VLAN-Plan");
    },
  },
  {
    name: "ag-projekt-verknuepfungen",
    persona: "agent",
    async run(h) {
      await openDemoProject(h, /Verknüpfungen/);
      await h.waitText("Mit dem Projekt verknüpfen");
    },
  },
  {
    name: "ag-projekt-team",
    persona: "admin",
    async run(h) {
      await openDemoProject(h, "Team & Gäste");
      await h.waitText("Externen Gast einladen");
      await h.page.getByLabel("Person suchen").fill("ke");
      await h.waitText("Sabine Keller");
    },
  },
  {
    name: "ag-projekt-auslastung",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Projekte");
      await h.click("Auslastung", { role: "tab" });
      await h.waitText("überlastet");
    },
  },
  {
    name: "ma-projekt-gast",
    persona: "guest",
    async run(h) {
      await h.open();
      await h.waitText("Netzwerk-Erneuerung Standort Bern");
      await h.clickText("Netzwerk-Erneuerung Standort Bern");
      await h.waitText("Alle Projekte");
      await h.click("Zeitplan", { role: "tab" });
      await h.waitText("Switches vorkonfigurieren");
    },
  },
  {
    name: "ad-projekt-neu",
    persona: "admin",
    async run(h) {
      await h.open();
      await h.nav("Projekte");
      await h.click("Neues Projekt");
      await h.waitText("Zeitraum und Budget");
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
    name: "ag-ticket-weiterleiten",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Tickets");
      await h.clickText("Laptop startet nach Windows-Update nicht mehr");
      await h.click("Ursprüngliche Mail weiterleiten");
      await h.waitText("An (Mailadressen, durch Komma getrennt)");
      await h.settle(300);
    },
  },
  {
    name: "ag-sicherheitsfaelle",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Phishing / Junk");
      await h.waitText("Voicemail (24 Sekunden)");
      await h.settle(300);
    },
  },
  {
    name: "ag-sicherheitsfall",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Phishing / Junk");
      await h.clickText("Voicemail (24 Sekunden)");
      await h.waitText("Befunde der Analyse");
      await h.settle(300);
    },
  },
  {
    name: "ag-stoerungen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Störungen");
      await h.waitText("SW-CORE-01 – Ping");
      await h.settle(300);
    },
  },
  {
    name: "ag-stoerung",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Störungen");
      await h.clickText("SW-CORE-01 – Ping");
      await h.waitText("Letzte 24 Stunden");
      await h.settle(300);
    },
  },
  {
    name: "ag-ueberwachung",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Überwachung");
      await h.waitText("Aktive Alarme");
      await h.waitText("Ereignisse anzeigen");
      await h.click("Ereignisse anzeigen");
      await h.settle(300);
    },
  },
  {
    name: "ag-ueberwachung-hinzufuegen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Überwachung");
      await h.click("Geräte hinzufügen");
      await h.page.getByLabel("Gerät suchen").fill("srv");
      await h.waitText("noch kein Gerät");
      await h.click("angezeigten auswählen");
      await h.waitText("Geräte überwachen");
      await h.settle(300);
    },
  },
  {
    name: "ag-ueberwachung-geraet",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Überwachung");
      await h.clickText("SRV-SQL-01");
      await h.waitText("Verknüpft in nextDesk");
      await h.settle(500);
    },
  },
  {
    name: "ag-ueberwachung-verbindungen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Überwachung");
      await h.clickText("SRV-SQL-01");
      await h.waitText("Verbunden mit");
      await h.page
        .getByRole("heading", { name: "Verbindungen" })
        .scrollIntoViewIfNeeded();
      await h.settle(500);
    },
  },
  {
    name: "ag-ueberwachung-matrix",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Überwachung");
      await h.clickText("SRV-SQL-01");
      await h.waitText("Verbunden mit");
      await h.click("Matrix");
      await h.page.getByRole("button", { name: /^Port 1\/1\/25:/ }).click();
      await h.page
        .getByRole("heading", { name: "Verbindungen", exact: true })
        .scrollIntoViewIfNeeded();
      await h.settle(500);
    },
  },
  {
    name: "ag-teams",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Teams");
      await h.waitText("Projekt Neubau Schulhaus");
      await h.page
        .getByRole("button", { name: "Projekt Neubau Schulhaus" })
        .click();
      await h.waitText("Laufzeit verlängern");
      await h.page.evaluate(() => {
        window.scrollTo(0, 0);
        document
          .querySelectorAll("main, .workspace, .app-shell")
          .forEach((el) => el.scrollTo?.(0, 0));
      });
      await h.settle(300);
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
        "Hallo Reto\n\nIch habe dir die neue VPN-Version 5.2 über das Unternehmensportal zugewiesen. Bitte starte deinen Laptop heute Abend neu und melde dich morgen kurz, ob die Verbindung stabil bleibt.\n\nFreundliche Grüsse\nMara Keller",
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
    name: "ma-benachrichtigungen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.openPersonalSettings();
      await h.waitText("Benachrichtigungszeit");
      await h.scrollToText("Benachrichtigungszeit", 20);
    },
  },
  {
    name: "ag-neues-ticket",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.click("Neue Erfassung öffnen");
      await h.click("Ticket erfassen", { role: "menuitem" });
      await h.waitText("Einordnung");
      const form = h.page
        .locator("form")
        .filter({ hasText: "Einordnung" })
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
    name: "ag-artikel",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
      await h.page
        .getByRole("button", { name: /VPN im Homeoffice einrichten/ })
        .first()
        .click();
      await h.settle(900);
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
    name: "ag-eintritte",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Eintritte");
      await h.settle(1200);
      // Karten sind eingeklappt; die erste aufklappen, damit Aufgaben sichtbar sind.
      await h.page.locator(".onboarding__entry-toggle").first().click();
      await h.settle(400);
      await h.scrollToText("Meine sichtbaren Eintritte", 90);
    },
  },
  {
    name: "ag-vertrag-lizenzen",
    // Contracts need the «Verträge» role; the demo admin has it.
    persona: "admin",
    async run(h) {
      await h.open();
      await h.nav("Verträge");
      await h.waitText("Microsoft Enterprise Agreement");
      const card = h.page
        .locator("article")
        .filter({ hasText: "Microsoft Enterprise Agreement" })
        .first();
      await card.getByRole("button", { name: "Bearbeiten" }).click();
      await h.settle(500);
      await h.scrollToText("Verknüpfte Lizenzen", 24);
      await h.page.locator("#contract-licenses").click();
      await h.settle(400);
    },
  },
  {
    name: "ad-module",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Funktionen"),
  },
  {
    name: "ad-ueberwachung",
    persona: "admin",
    async run(h) {
      await openSettingsTab(h, "Monitoring");
      await h.waitText("Installationspaket");
      await h.settle(300);
    },
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
    name: "ag-lagerorte",
    persona: "admin",
    async run(h) {
      await h.open();
      await h.nav("Lager");
      await h.page.getByRole("tab", { name: "Lagerorte", exact: true }).click();
      await h.waitText("Wandschrank ICT");
      await h.scrollToText("Lager und Lagerplätze", 90);
    },
  },
  {
    name: "in-verzeichnis",
    persona: "admin",
    async run(h) {
      await openSettingsTab(h, "Funktionen");
      await h.waitText("Abgleichshistorie");
      await h.scrollToText("Microsoft Entra-Verzeichnis", 12);
    },
  },
  {
    name: "in-monitoring",
    persona: "admin",
    run: (h) => openSettingsTab(h, "Monitoring"),
  },
);
