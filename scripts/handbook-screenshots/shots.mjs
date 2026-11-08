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
    name: "ma-ticket-verlauf",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.clickText("Laptop startet nach Windows-Update nicht mehr");
    },
  },
  {
    name: "ma-wissen",
    persona: "employee",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
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
      await h.click("Kanban");
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
    name: "ag-wissen",
    persona: "agent",
    async run(h) {
      await h.open();
      await h.nav("Wissensdatenbank");
    },
  },
];
