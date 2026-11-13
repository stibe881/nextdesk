// Tenant administration data: settings, feature catalog, people, roles and
// permissions for the "Einstellungen" area (tenant-admin-settings,
// tenant-users listUsers, tenant-role-management).

const D = require("./demo-data.cjs");

const FEATURE_CATALOG = {
  "ticketing.detail": [
    "Ticketdetails",
    "Vollständige Ticketansicht mit Verlauf, Kommentaren und Zuständigkeiten.",
    "ticketing",
  ],
  "ticketing.checklists": [
    "Checklisten",
    "Arbeitsschritte direkt im Ticket abhaken.",
    "ticketing",
  ],
  "ticketing.time-tracking": [
    "Zeiterfassung",
    "Arbeitszeit pro Ticket erfassen und auswerten.",
    "ticketing",
  ],
  "ticketing.templates": [
    "Ticketvorlagen",
    "Vorlagen mit Formularfeldern für wiederkehrende Anliegen.",
    "ticketing",
  ],
  "knowledge.base": [
    "Wissensdatenbank",
    "Interne und öffentliche Wissensartikel mit Freigabeprozess.",
    "knowledge",
  ],
  "automation.sla": [
    "SLA & Automatisierung",
    "Reaktions- und Lösungsfristen, Eskalationen und Ticketregeln.",
    "automation",
  ],
  "reporting.service": [
    "Berichte",
    "Auswertungen zu Volumen, SLA-Einhaltung und Zufriedenheit.",
    "reporting",
  ],
  "integrations.email": [
    "E-Mail-Integration",
    "Tickets aus Exchange-Online-Postfächern erstellen und beantworten.",
    "integrations",
  ],
  "assets.management": [
    "Assets & Dienste",
    "Geräte, Dienste und Systemstatus verwalten, inklusive Intune-Abgleich.",
    "assets",
  ],
  "inventory.management": [
    "Lager",
    "Lagerorte, Bestände und Inventuren führen.",
    "assets",
  ],
  "contracts.management": [
    "Verträge & Lizenzen",
    "Verträge, Fristen und Softwarelizenzen überwachen.",
    "assets",
  ],
  "self_service.shop": [
    "Shop",
    "Geräte und Zubehör im Self-Service bestellen.",
    "portal",
  ],
  "teams.provisioning": [
    "Microsoft Teams im Shop",
    "Teams im Shop bestellen, Laufzeit und Erinnerungen, Menü «Teams».",
    "integrations",
  ],
  "portal.notices": [
    "Hinweise für Anfragende",
    "Eigene Hinweise der ICT in Ticket-Mails, Portal und App.",
    "integrations",
  ],
  "service.tasks": [
    "Serviceaufgaben",
    "Wiederkehrende Wartungs- und Kontrollaufgaben planen.",
    "ticketing",
  ],
  "event.spaces": [
    "Raumplanung",
    "Veranstaltungsräume und Raumaufträge verwalten.",
    "ticketing",
  ],
  "onboarding.entries": [
    "Eintritte",
    "Eintritte und Onboarding-Aufgaben abteilungsübergreifend koordinieren.",
    "ticketing",
  ],
  "experience.workspace": [
    "Arbeitsbereich",
    "Persönliche Arbeitsbereichseinstellungen und Wiedervorlagen.",
    "ticketing",
  ],
  "portal.self-service": [
    "Self-Service",
    "Servicekatalog bei der Erfassung und Lösungsbestätigung.",
    "portal",
  ],
  "ai.assist": [
    "KI-Assistenz",
    "Zusammenfassungen, Antwortvorschläge und Einordnung mit KI.",
    "ai",
  ],
  "agent.workbench": [
    "Agentenwerkbank",
    "Makros, Erwähnungen und Stellvertretungen für Agenten.",
    "ticketing",
  ],
  "requester.portal": [
    "Anfragendenportal",
    "Fortschritt, Störungsmeldungen und Bestätigungen für Anfragende.",
    "portal",
  ],
  "requester.department-view": [
    "Abteilungsansicht für Anfragende",
    "Tickets der eigenen Abteilung ohne Inhalte anzeigen.",
    "portal",
  ],
  "notifications.push": [
    "Push-Mitteilungen",
    "Mitteilungen an die nextDesk-iOS-App.",
    "communication",
  ],
};

function settings(enabledFeatures) {
  return {
    tenant_settings: {
      portal_name: "Muster AG Servicedesk",
      support_email: "servicedesk@muster.ch",
      ticket_access_enabled: true,
      allow_external_ticket_access: false,
      updated_at: D.ago(12 * D.DAY),
    },
    support_contact: {
      email: "servicedesk@muster.ch",
      source: "exchange_mailbox",
      has_multiple_active_exchange_mailboxes: false,
    },
    tenant_branding: {
      logo_path: null,
      logo_url: null,
      primary_color: "#0F4C81",
      secondary_color: "#1E3A5F",
      accent_color: "#E4572E",
      updated_at: D.ago(40 * D.DAY),
    },
    tenant_sso_configurations: [
      {
        provider: "azure_ad",
        enabled: true,
        issuer_url:
          "https://login.microsoftonline.com/7d3c1f52-4a8e-4c51-9a0e-2f6b1d9c8e41/v2.0",
        discovery_url: null,
        client_id: null,
        allowed_email_domains: ["muster.ch"],
        enforce_sso: false,
        updated_at: D.ago(60 * D.DAY),
      },
    ],
    tenant_feature_flags: Object.entries(FEATURE_CATALOG).map(
      ([key, [name, description, category]]) => ({
        feature_key: key,
        enabled: enabledFeatures.has(key),
        pilot_ends_at: null,
        updated_at: D.ago(20 * D.DAY),
        feature_catalog: {
          key,
          name,
          description,
          category,
          default_enabled: false,
        },
      }),
    ),
    roles: roles(),
    entra_directory: {
      trusted_entra_tenant_id: "7d3c1f52-4a8e-4c51-9a0e-2f6b1d9c8e41",
      configured_entra_tenant_id: "7d3c1f52-4a8e-4c51-9a0e-2f6b1d9c8e41",
      enabled: true,
      last_connection_tested_at: D.ago(3 * D.DAY),
      last_connection_test_status: "success",
      last_sync_started_at: D.ago(2 * D.HOUR + 3 * D.MIN),
      last_sync_completed_at: D.ago(2 * D.HOUR),
      last_sync_status: "success",
    },
  };
}

const PERMISSIONS = [
  ["ticket.create", "Tickets erfassen", false],
  ["ticket.read.own", "Eigene Tickets lesen", false],
  ["ticket.read.assigned", "Zugewiesene Tickets lesen", false],
  ["ticket.read.department", "Tickets der Abteilung lesen", false],
  ["ticket.update", "Tickets bearbeiten", false],
  ["ticket.assign", "Tickets zuweisen", false],
  ["ticket.close", "Tickets schliessen", false],
  ["ticket.comment.external", "Kundenantworten verfassen", false],
  ["ticket.internal_notes.read", "Interne Notizen lesen", false],
  ["ticket.internal_notes.write", "Interne Notizen schreiben", false],
  ["ticket.escalate", "Tickets eskalieren", false],
  ["ticket.merge", "Tickets zusammenführen und aufteilen", true],
  ["ticket.delete", "Tickets löschen", true],
  ["ticket.export", "Ticketdaten exportieren", true],
  ["ticket.time.track", "Arbeitszeit erfassen", false],
  ["ticket.template.manage", "Ticketvorlagen verwalten", false],
  ["ticket.sla.manage", "SLA-Profile verwalten", true],
  ["ticket.approval.decide", "Ticketfreigaben entscheiden", true],
  ["ticket.quality.review", "Ticketqualität bewerten", false],
  ["knowledge.read", "Wissensartikel lesen", false],
  ["knowledge.manage", "Wissensartikel verwalten", true],
  ["knowledge.publish", "Wissensartikel veröffentlichen", false],
  ["asset.manage", "Assets verwalten", true],
  ["asset.integration.manage", "Asset-Integrationen konfigurieren", true],
  ["asset.intune.actions", "Intune-Geräteaktionen auslösen", true],
  ["team.supervise", "Team einer Abteilung führen", true],
  ["report.read", "Berichte lesen", false],
  ["automation.manage", "Automatisierungen verwalten", true],
  ["department.manage", "Abteilungen verwalten", true],
  ["user.manage", "Personen verwalten", true],
  ["role.manage", "Rollen verwalten", true],
  ["tenant.settings.manage", "Mandanteneinstellungen verwalten", true],
].map(([code, description, is_sensitive]) => ({
  code,
  description,
  is_sensitive,
}));

const ALL_CODES = PERMISSIONS.map((p) => p.code);
const ROLE_DEFS = [
  { n: 1, name: "Tenant administrator", isSystem: true, codes: ALL_CODES },
  {
    n: 2,
    name: "Support agent",
    isSystem: true,
    codes: ALL_CODES.filter(
      (c) =>
        c.startsWith("ticket.") &&
        !["ticket.delete", "ticket.sla.manage"].includes(c),
    ),
  },
  {
    n: 3,
    name: "Requester",
    isSystem: true,
    codes: ["ticket.create", "ticket.read.own", "knowledge.read"],
  },
  {
    n: 4,
    name: "Vorgesetzter Agent",
    isSystem: false,
    codes: [
      "team.supervise",
      "report.read",
      "ticket.quality.review",
      "ticket.read.department",
      "ticket.assign",
    ],
  },
  {
    n: 5,
    name: "Wissensredaktion",
    isSystem: false,
    codes: ["knowledge.read", "knowledge.manage", "knowledge.publish"],
  },
  {
    n: 6,
    name: "SLA-Verantwortliche",
    isSystem: false,
    codes: ["ticket.sla.manage", "automation.manage", "report.read"],
  },
  {
    n: 7,
    name: "Asset-Verwaltung",
    isSystem: false,
    codes: ["asset.manage", "asset.integration.manage", "asset.intune.actions"],
  },
];

function roles() {
  return ROLE_DEFS.map((role) => ({
    id: D.uid("18181818", role.n),
    name: role.name,
    scope: "tenant",
    isSystem: role.isSystem,
    active: true,
    createdAt: D.ago(200 * D.DAY),
    updatedAt: D.ago(30 * D.DAY),
    permissionCodes: role.codes,
  }));
}

const ASSIGNMENTS = [
  ["daniel", 1],
  ["daniel", 4],
  ["mara", 5],
  ["jonas", 7],
  ["sandra", 4],
  ["patrick", 5],
  ["jonas", 6],
];

function roleAssignments() {
  return ASSIGNMENTS.map(([userKey, roleN], index) => {
    const user = D.U[userKey];
    const role = ROLE_DEFS.find((r) => r.n === roleN);
    return {
      id: D.uid("19191919", index + 1),
      user_id: user.id,
      role_id: D.uid("18181818", roleN),
      department_id: null,
      team_id: null,
      starts_at: D.ago((90 - index * 7) * D.DAY),
      expires_at: null,
      roleName: role.name,
      user: { id: user.id, displayName: user.name, email: user.email },
    };
  });
}

function userDirectory() {
  const departmentOf = (user) =>
    user.departmentKey ? D.DEP[user.departmentKey] : null;
  const members = D.USERS.map((user, index) => ({
    id: user.id,
    email: user.email,
    displayName: user.name,
    status: "active",
    joinedAt: D.ago((300 - index * 20) * D.DAY),
    departmentId: departmentOf(user)?.id ?? null,
    departmentName: departmentOf(user)?.name ?? null,
    jobTitle: user.jobTitle,
    jobTitleSource: "entra",
    offer:
      user.role === "employee"
        ? ({
            lena: "Finanzen",
            thomas: "Bau",
            nina: "Marketing",
            reto: "Verkauf",
            claudia: "Empfang",
          }[user.name.split(" ")[0].toLowerCase()] ?? null)
        : (departmentOf(user)?.name ?? null),
    offerSource: "entra",
    isAgent: user.role !== "employee",
    isTenantAdmin: user.role === "admin",
    managerUserId:
      user.role === "agent" && user.departmentKey === "ict"
        ? D.U.daniel.id
        : null,
    managerName:
      user.role === "agent" && user.departmentKey === "ict"
        ? D.U.daniel.name
        : null,
    managerSource: "entra",
    teamIds: user.teamId ? [user.teamId] : [],
  }));
  return {
    members,
    invitations: [
      {
        id: D.uid("20202020", 1),
        email: "sarah.koch@muster.ch",
        status: "sent",
        expires_at: D.inFuture(6 * D.DAY),
        created_at: D.ago(1 * D.DAY),
        displayName: "Sarah Koch",
        jobTitle: "Sachbearbeiterin Finanzen",
        offer: "Finanzen",
        departmentId: null,
        departmentName: null,
        isAgent: false,
      },
      {
        id: D.uid("20202020", 2),
        email: "luca.ammann@muster.ch",
        status: "sent",
        expires_at: D.inFuture(3 * D.DAY),
        created_at: D.ago(4 * D.DAY),
        displayName: "Luca Ammann",
        jobTitle: "ICT Lernender",
        offer: "ICT",
        departmentId: D.DEP.ict.id,
        departmentName: "ICT",
        isAgent: true,
      },
    ],
    departments: D.DEPARTMENTS.map((d) => ({
      id: d.id,
      name: d.name,
      active: true,
    })),
    directoryPeople: [
      [
        "Sarah Koch",
        "sarah.koch@muster.ch",
        "Sachbearbeiterin Finanzen",
        "Finanzen",
      ],
      ["Luca Ammann", "luca.ammann@muster.ch", "ICT Lernender", "ICT"],
      [
        "Petra Zürcher",
        "petra.zuercher@muster.ch",
        "Leiterin Finanzen",
        "Finanzen",
      ],
    ].map(([displayName, email, jobTitle, sourceDepartmentName], index) => ({
      id: D.uid("34343434", index + 1),
      email,
      displayName,
      jobTitle,
      sourceDepartmentName,
      accountEnabled: true,
      linkedToNextDesk: false,
      activeNextDeskMember: false,
      agentRequested: index === 1,
      entraAgentAccessEffective: false,
      hasIndependentAgentAccess: false,
      agentDepartmentId: index === 1 ? D.DEP.ict.id : null,
      agentDepartmentName: index === 1 ? "ICT" : null,
      isAgent: false,
      lastSyncedAt: D.ago(2 * D.HOUR),
      agentDisplayName: null,
      agentManagerUserId: null,
      agentTeamIds: [],
      entraManagerName: index === 1 ? "Daniel Frei" : null,
    })),
    teams: D.TEAMS.map((team) => ({
      id: team.id,
      name: team.name,
      departmentId: team.departmentId,
    })),
  };
}

module.exports = {
  settings,
  roles,
  roleAssignments,
  userDirectory,
  PERMISSIONS,
};
