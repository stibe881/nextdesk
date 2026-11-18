// Demo data for the handbook screenshots: one Swiss tenant ("Muster AG") with
// three departments, a handful of agents and employees, and coherent tickets,
// comments and knowledge articles. All timestamps are relative to "now" so the
// screenshots always look fresh (SLA countdowns, "vor 2 h" etc.).

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const ago = (ms) => iso(-ms);
const inFuture = (ms) => iso(ms);
const dateOnly = (offsetMs) => iso(offsetMs).slice(0, 10);

// UUIDs must satisfy the app's strict v1-5 pattern.
const uid = (group, n) =>
  `${group}-${group.slice(0, 4)}-4${group.slice(0, 3)}-8${group.slice(0, 3)}-${String(n).padStart(12, "0")}`;

const TENANT = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Muster AG",
  slug: "muster-ag",
};

const DEPARTMENTS = [
  {
    id: uid("33333333", 1),
    key: "ict",
    name: "ICT",
    description: "Informatik, Arbeitsplätze und Applikationen",
  },
  {
    id: uid("33333333", 2),
    key: "facility",
    name: "Facility",
    description: "Gebäude, Räume und Infrastruktur",
  },
  {
    id: uid("33333333", 3),
    key: "hr",
    name: "HR",
    description: "Personal, Eintritte und Austritte",
  },
];
const DEP = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d]));

const TEAMS = [
  { id: uid("44444444", 1), name: "ICT Servicedesk", departmentId: DEP.ict.id },
  {
    id: uid("44444444", 2),
    name: "ICT Infrastruktur",
    departmentId: DEP.ict.id,
  },
  {
    id: uid("44444444", 3),
    name: "Haustechnik",
    departmentId: DEP.facility.id,
  },
  { id: uid("44444444", 4), name: "HR Services", departmentId: DEP.hr.id },
];

// role: employee | agent | admin. "persona" marks the three login personas.
const USERS = [
  {
    id: "11111111-1111-4111-8111-000000000001",
    name: "Lena Brunner",
    email: "lena.brunner@muster.ch",
    role: "employee",
    persona: "employee",
    jobTitle: "Sachbearbeiterin Finanzen",
    departmentKey: null,
  },
  {
    id: "11111111-1111-4111-8111-000000000002",
    name: "Mara Keller",
    email: "mara.keller@muster.ch",
    role: "agent",
    persona: "agent",
    jobTitle: "ICT Supporterin",
    departmentKey: "ict",
    teamId: TEAMS[0].id,
  },
  {
    id: "11111111-1111-4111-8111-000000000003",
    name: "Daniel Frei",
    email: "daniel.frei@muster.ch",
    role: "admin",
    persona: "admin",
    jobTitle: "Leiter ICT",
    departmentKey: "ict",
    teamId: TEAMS[1].id,
  },
  {
    id: "11111111-1111-4111-8111-000000000004",
    name: "Jonas Meier",
    email: "jonas.meier@muster.ch",
    role: "agent",
    jobTitle: "Systemtechniker",
    departmentKey: "ict",
    teamId: TEAMS[1].id,
  },
  {
    id: "11111111-1111-4111-8111-000000000005",
    name: "Sandra Huber",
    email: "sandra.huber@muster.ch",
    role: "agent",
    jobTitle: "Leiterin Haustechnik",
    departmentKey: "facility",
    teamId: TEAMS[2].id,
  },
  {
    id: "11111111-1111-4111-8111-000000000006",
    name: "Patrick Steiner",
    email: "patrick.steiner@muster.ch",
    role: "agent",
    jobTitle: "HR Fachmann",
    departmentKey: "hr",
    teamId: TEAMS[3].id,
  },
  {
    id: "11111111-1111-4111-8111-000000000007",
    name: "Thomas Graf",
    email: "thomas.graf@muster.ch",
    role: "employee",
    jobTitle: "Projektleiter Bau",
    departmentKey: null,
  },
  {
    id: "11111111-1111-4111-8111-000000000008",
    name: "Nina Schmid",
    email: "nina.schmid@muster.ch",
    role: "employee",
    jobTitle: "Marketing",
    departmentKey: null,
  },
  {
    id: "11111111-1111-4111-8111-000000000009",
    name: "Reto Baumann",
    email: "reto.baumann@muster.ch",
    role: "employee",
    jobTitle: "Verkauf Aussendienst",
    departmentKey: null,
  },
  {
    id: "11111111-1111-4111-8111-000000000010",
    name: "Claudia Widmer",
    email: "claudia.widmer@muster.ch",
    role: "employee",
    jobTitle: "Empfang",
    departmentKey: null,
  },
];
const U = Object.fromEntries(
  USERS.map((u) => [u.name.split(" ")[0].toLowerCase(), u]),
);
const userById = (id) => USERS.find((u) => u.id === id) ?? null;
const AGENTS = USERS.filter((u) => u.role !== "employee");

const STATUSES = [
  {
    id: uid("55555555", 1),
    key: "new",
    label: "Neu",
    is_closed: false,
    sort_order: 10,
  },
  {
    id: uid("55555555", 2),
    key: "in_progress",
    label: "In Bearbeitung",
    is_closed: false,
    sort_order: 20,
  },
  {
    id: uid("55555555", 3),
    key: "waiting",
    label: "Wartet auf Rückmeldung",
    is_closed: false,
    sort_order: 30,
  },
  {
    id: uid("55555555", 4),
    key: "resolved",
    label: "Gelöst",
    is_closed: true,
    sort_order: 40,
  },
  {
    id: uid("55555555", 5),
    key: "closed",
    label: "Geschlossen",
    is_closed: true,
    sort_order: 50,
  },
];
const ST = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

const PRIORITIES = [
  {
    id: uid("66666666", 1),
    key: "critical",
    label: "Kritisch",
    sort_order: 10,
  },
  { id: uid("66666666", 2), key: "high", label: "Hoch", sort_order: 20 },
  { id: uid("66666666", 3), key: "medium", label: "Mittel", sort_order: 30 },
  { id: uid("66666666", 4), key: "low", label: "Niedrig", sort_order: 40 },
];
const PR = Object.fromEntries(PRIORITIES.map((p) => [p.key, p]));

const CATEGORIES = [
  { id: uid("77777777", 1), departmentKey: "ict", label: "Hardware" },
  {
    id: uid("77777777", 2),
    departmentKey: "ict",
    label: "Software & Lizenzen",
  },
  {
    id: uid("77777777", 3),
    departmentKey: "ict",
    label: "Zugriff & Berechtigungen",
  },
  { id: uid("77777777", 4), departmentKey: "ict", label: "Netzwerk & VPN" },
  {
    id: uid("77777777", 5),
    departmentKey: "facility",
    label: "Gebäude & Räume",
  },
  { id: uid("77777777", 6), departmentKey: "facility", label: "Reinigung" },
  { id: uid("77777777", 7), departmentKey: "hr", label: "Eintritt & Austritt" },
  { id: uid("77777777", 8), departmentKey: "hr", label: "Lohn & Spesen" },
];

const SUBCATEGORIES = [
  { id: uid("77777777", 21), parentId: uid("77777777", 1), label: "Laptop" },
  { id: uid("77777777", 22), parentId: uid("77777777", 1), label: "Drucker" },
  {
    id: uid("77777777", 23),
    parentId: uid("77777777", 1),
    label: "Bildschirm & Zubehör",
  },
  {
    id: uid("77777777", 24),
    parentId: uid("77777777", 3),
    label: "Dateiablage",
  },
  { id: uid("77777777", 25), parentId: uid("77777777", 4), label: "VPN" },
];

const ASSETS = [
  {
    id: uid("12121212", 1),
    name: "Lenovo ThinkPad T14 Gen 3",
    asset_tag: "LT-0142",
    kind: "laptop",
    status: "in_use",
    intune_primary_person_name: "Lena Brunner",
  },
  {
    id: uid("12121212", 2),
    name: "Lenovo ThinkPad T14 Gen 3 (Pool)",
    asset_tag: "LT-0217",
    kind: "laptop",
    status: "in_stock",
    intune_primary_person_name: null,
  },
  {
    id: uid("12121212", 3),
    name: "HP Color LaserJet M480 – 3. OG",
    asset_tag: "PR-0031",
    kind: "printer",
    status: "in_use",
    intune_primary_person_name: null,
  },
  {
    id: uid("12121212", 4),
    name: "Dell P2723D",
    asset_tag: "MO-0388",
    kind: "monitor",
    status: "in_use",
    intune_primary_person_name: "Lena Brunner",
  },
];

// Ticket factory. created/updated are offsets in ms before now; due is the
// resolution due offset from now (negative = overdue, null = no SLA).
function t(n, d) {
  const status = ST[d.status];
  const priority = PR[d.priority];
  const department = DEP[d.dep];
  return {
    id: uid("88888888", n),
    ticket_number: `T-${String(1040 + n).padStart(5, "0")}`,
    tenant_id: TENANT.id,
    subject: d.subject,
    description: d.description,
    department_id: department.id,
    department_key: department.key,
    department_name: department.name,
    status_id: status.id,
    status_key: status.key,
    status_label: status.label,
    status_is_closed: status.is_closed,
    status_sort_order: status.sort_order,
    priority_id: priority.id,
    priority_key: priority.key,
    priority_label: priority.label,
    priority_sort_order: priority.sort_order,
    requester_id: d.requester.id,
    assigned_agent_id: d.agent ? d.agent.id : null,
    assigned_team_id: d.team ?? null,
    category_id: d.category ?? null,
    subcategory_id: d.subcategory ?? null,
    created_at: ago(d.created),
    updated_at: ago(d.updated),
    first_response_due_at:
      d.due == null
        ? null
        : iso(
            -d.created +
              { critical: 15, high: 60, medium: 240, low: 480 }[d.priority] *
                MIN,
          ),
    resolution_due_at: d.due == null ? null : inFuture(d.due),
    resolved_at: status.is_closed ? ago(d.updated) : null,
    channel: d.channel ?? "portal",
    tags: d.tags ?? [],
  };
}

const TICKETS = [
  t(1, {
    subject: "Laptop startet nach Windows-Update nicht mehr",
    description:
      "Seit dem Update heute Morgen bleibt mein Laptop beim Start mit dem Herstellerlogo hängen. Ich habe ihn bereits zweimal neu gestartet. Ich brauche ihn dringend für die Monatsabschluss-Arbeiten.",
    status: "in_progress",
    priority: "high",
    dep: "ict",
    requester: U.lena,
    agent: U.mara,
    team: TEAMS[0].id,
    category: CATEGORIES[0].id,
    subcategory: SUBCATEGORIES[0].id,
    created: 3 * HOUR + 20 * MIN,
    updated: 25 * MIN,
    due: 2 * HOUR + 40 * MIN,
    tags: ["Hardware", "Windows"],
  }),
  t(2, {
    subject: "Zugriff auf Laufwerk «Finanzen» für neue Mitarbeiterin",
    description:
      "Bitte für Frau Sarah Koch (Eintritt 1. Dezember) Lesezugriff auf das Laufwerk F:\\Finanzen einrichten.",
    status: "waiting",
    priority: "medium",
    dep: "ict",
    requester: U.lena,
    agent: U.jonas,
    team: TEAMS[0].id,
    category: CATEGORIES[2].id,
    created: 2 * DAY + 3 * HOUR,
    updated: 5 * HOUR,
    due: 1 * DAY + 4 * HOUR,
  }),
  t(3, {
    subject: "Neuer Bildschirm für Homeoffice",
    description:
      "Mein privater Bildschirm ist defekt. Ist es möglich, einen 27-Zoll-Monitor für das Homeoffice zu beziehen?",
    status: "resolved",
    priority: "low",
    dep: "ict",
    requester: U.lena,
    agent: U.mara,
    team: TEAMS[0].id,
    category: CATEGORIES[0].id,
    created: 9 * DAY,
    updated: 6 * DAY,
    due: null,
  }),
  t(4, {
    subject: "Heizung im Sitzungszimmer Säntis zu kalt",
    description:
      "Im Sitzungszimmer Säntis (2. OG) ist es seit Montag sehr kalt, die Heizkörper bleiben kühl.",
    status: "new",
    priority: "medium",
    dep: "facility",
    requester: U.lena,
    agent: null,
    team: TEAMS[2].id,
    category: CATEGORIES[4].id,
    created: 50 * MIN,
    updated: 50 * MIN,
    due: 7 * HOUR,
  }),
  t(5, {
    subject: "VPN-Verbindung bricht im Homeoffice ständig ab",
    description:
      "Seit gestern bricht die VPN-Verbindung alle 10–15 Minuten ab. Internet funktioniert sonst stabil.",
    status: "in_progress",
    priority: "high",
    dep: "ict",
    requester: U.reto,
    agent: U.mara,
    team: TEAMS[0].id,
    category: CATEGORIES[3].id,
    created: 5 * HOUR,
    updated: 1 * HOUR + 10 * MIN,
    due: 45 * MIN,
    channel: "email",
  }),
  t(6, {
    subject: "Drucker 3. OG zeigt Papierstau, obwohl leer",
    description:
      "Der Multifunktionsdrucker im 3. OG meldet dauernd Papierstau in Fach 2.",
    status: "new",
    priority: "medium",
    dep: "ict",
    requester: U.claudia,
    agent: null,
    team: null, // shows «Ohne Teamzuordnung» in the team queues
    category: CATEGORIES[0].id,
    created: 1 * HOUR + 35 * MIN,
    updated: 1 * HOUR + 35 * MIN,
    due: 6 * HOUR,
  }),
  t(7, {
    subject: "Outlook-Postfach voll – Archivierung einrichten",
    description: "Mein Postfach ist bei 98 %. Bitte Online-Archiv aktivieren.",
    status: "waiting",
    priority: "low",
    dep: "ict",
    requester: U.nina,
    agent: U.mara,
    team: TEAMS[0].id,
    category: CATEGORIES[1].id,
    created: 1 * DAY + 2 * HOUR,
    updated: 3 * HOUR,
    due: 2 * DAY,
  }),
  t(8, {
    subject: "Adobe Acrobat Pro Lizenz für Marketing",
    description:
      "Für die Bearbeitung der neuen Broschüre benötige ich eine Acrobat-Pro-Lizenz.",
    status: "new",
    priority: "low",
    dep: "ict",
    requester: U.nina,
    agent: null,
    team: TEAMS[0].id,
    category: CATEGORIES[1].id,
    created: 4 * HOUR,
    updated: 4 * HOUR,
    due: 1 * DAY + 20 * HOUR,
  }),
  t(9, {
    subject: "Serverraum: Klimaanlage meldet Störung",
    description: "Monitoring meldet Temperaturalarm im Serverraum UG (28 °C).",
    status: "in_progress",
    priority: "critical",
    dep: "facility",
    requester: U.daniel,
    agent: U.sandra,
    team: TEAMS[2].id,
    category: CATEGORIES[4].id,
    created: 2 * HOUR + 10 * MIN,
    updated: 15 * MIN,
    due: -20 * MIN,
    channel: "monitoring",
  }),
  t(10, {
    subject: "Eintritt Sarah Koch – Arbeitsplatz vorbereiten",
    description:
      "Neue Mitarbeiterin Finanzen per 1. Dezember: Laptop, Telefon, Badge und Zugänge vorbereiten.",
    status: "in_progress",
    priority: "medium",
    dep: "hr",
    requester: U.lena,
    agent: U.patrick,
    team: TEAMS[3].id,
    category: CATEGORIES[6].id,
    created: 3 * DAY,
    updated: 1 * DAY,
    due: 5 * DAY,
  }),
  t(11, {
    subject: "Passwort-Reset für SAP",
    description:
      "Ich habe mich nach den Ferien mehrmals falsch angemeldet und bin gesperrt.",
    status: "resolved",
    priority: "high",
    dep: "ict",
    requester: U.thomas,
    agent: U.jonas,
    team: TEAMS[0].id,
    category: CATEGORIES[2].id,
    created: 1 * DAY + 6 * HOUR,
    updated: 1 * DAY + 5 * HOUR,
    due: null,
  }),
  t(12, {
    subject: "Spesenabrechnung Oktober wird nicht angezeigt",
    description:
      "Meine im Spesentool erfasste Abrechnung für Oktober erscheint nicht in der Freigabeliste.",
    status: "closed",
    priority: "medium",
    dep: "hr",
    requester: U.reto,
    agent: U.patrick,
    team: TEAMS[3].id,
    category: CATEGORIES[7].id,
    created: 12 * DAY,
    updated: 10 * DAY,
    due: null,
  }),
];
const ticketById = (id) => TICKETS.find((x) => x.id === id) ?? null;

// Conversation per ticket: [authorKey, visibility, offset, body]
const COMMENTS = {
  1: [
    [
      "mara",
      "public",
      2 * HOUR + 50 * MIN,
      "Hallo Lena\n\nDanke für deine Meldung. Ich schaue mir das sofort an. Kannst du mir sagen, ob beim Start eine Fehlermeldung oder ein Code angezeigt wird?\n\nFreundliche Grüsse\nMara Keller",
    ],
    [
      "lena",
      "public",
      2 * HOUR + 30 * MIN,
      "Es erscheint kurz «Automatische Reparatur wird vorbereitet», danach bleibt der Bildschirm schwarz.",
    ],
    [
      "mara",
      "internal",
      1 * HOUR + 5 * MIN,
      "Bekanntes Problem mit Update KB5041585 auf Lenovo T14 Gen 3. Rollback via WinRE testen, sonst Ersatzgerät aus Pool (LT-0217) vorbereiten.",
    ],
    [
      "mara",
      "public",
      25 * MIN,
      "Ich habe für dich ein Ersatzgerät vorbereitet. Du kannst es ab 14 Uhr am ICT-Schalter (EG) abholen. Deine Daten sind über OneDrive synchronisiert.",
    ],
  ],
  2: [
    [
      "jonas",
      "public",
      1 * DAY + 20 * HOUR,
      "Hallo Lena\n\nGerne richte ich den Zugriff ein. Bitte bestätige noch, ob Frau Koch nur Lese- oder auch Schreibrechte benötigt.",
    ],
    [
      "jonas",
      "internal",
      5 * HOUR,
      "Freigabe durch Linienvorgesetzte ausstehend.",
    ],
  ],
  3: [
    [
      "mara",
      "public",
      8 * DAY,
      "Der Monitor (Dell P2723D) ist bestellt und wird dir direkt nach Hause geliefert.",
    ],
    [
      "lena",
      "public",
      6 * DAY + 2 * HOUR,
      "Monitor ist angekommen und funktioniert. Herzlichen Dank!",
    ],
  ],
  5: [
    [
      "mara",
      "public",
      4 * HOUR,
      "Hallo Reto\n\nKannst du mir bitte die Version des VPN-Clients senden (Rechtsklick auf das Symbol → Info)?",
    ],
    ["reto", "public", 3 * HOUR + 20 * MIN, "Version 5.1.3.62, Windows 11."],
    [
      "mara",
      "internal",
      1 * HOUR + 10 * MIN,
      "Client-Version veraltet. Update auf 5.2 über Intune zugewiesen, Neustart erforderlich.",
    ],
  ],
  7: [
    [
      "mara",
      "public",
      3 * HOUR,
      "Das Online-Archiv ist aktiviert. Bitte melde dich, ob die automatische Archivierung nach 24 Stunden greift.",
    ],
  ],
  9: [
    [
      "sandra",
      "public",
      1 * HOUR + 50 * MIN,
      "Techniker der Firma Klimatec AG ist aufgeboten, Ankunft ca. 30 Minuten.",
    ],
    [
      "sandra",
      "internal",
      15 * MIN,
      "Mobile Klimageräte im Serverraum aufgestellt, Temperatur sinkt (25 °C).",
    ],
  ],
  10: [
    [
      "patrick",
      "public",
      1 * DAY,
      "Laptop und Badge sind bestellt. Die ICT erhält die Zugangsanträge separat.",
    ],
  ],
  11: [
    [
      "jonas",
      "public",
      1 * DAY + 5 * HOUR,
      "Dein SAP-Konto ist entsperrt. Das neue Initialpasswort erhältst du per SMS.",
    ],
  ],
  12: [
    [
      "patrick",
      "public",
      10 * DAY,
      "Die Abrechnung war einer falschen Kostenstelle zugeordnet. Ist korrigiert und freigegeben.",
    ],
  ],
};

const KNOWLEDGE_COLLECTIONS = [
  {
    id: uid("99999999", 1),
    name: "Arbeitsplatz & Geräte",
    description: "Laptop, Drucker, Bildschirme und Peripherie",
    departmentKey: "ict",
  },
  {
    id: uid("99999999", 2),
    name: "Zugang & Sicherheit",
    description: "Passwörter, MFA, VPN und Berechtigungen",
    departmentKey: "ict",
  },
  {
    id: uid("99999999", 3),
    name: "Gebäude & Räume",
    description: "Sitzungszimmer, Parkplätze, Haustechnik",
    departmentKey: "facility",
  },
  {
    id: uid("99999999", 4),
    name: "Personal",
    description: "Ferien, Spesen, Eintritt und Austritt",
    departmentKey: "hr",
  },
];

const KNOWLEDGE_ARTICLES = [
  {
    n: 1,
    title: "VPN im Homeoffice einrichten",
    collection: 2,
    dep: "ict",
    summary:
      "Schritt-für-Schritt-Anleitung für den GlobalProtect-Client unter Windows und macOS.",
    views: 412,
    helpful: 38,
    updated: 6 * DAY,
    body: "Mit dem VPN greifst du von zu Hause sicher auf Laufwerke und interne Anwendungen zu.\n\n## Voraussetzungen\n\n- Firmenlaptop mit aktuellem Windows 11 oder macOS\n- Microsoft Authenticator auf dem Smartphone\n\n## Verbindung herstellen\n\n1. Klicke in der Taskleiste auf das VPN-Symbol.\n2. Gib als Portal **vpn.muster.ch** ein.\n3. Melde dich mit deinem Firmenkonto an und bestätige die MFA-Anfrage.\n\n## Häufige Probleme\n\nBricht die Verbindung regelmässig ab, prüfe bitte die Client-Version (mindestens 5.2).",
  },
  {
    n: 2,
    title: "Passwort vergessen oder Konto gesperrt",
    collection: 2,
    dep: "ict",
    summary:
      "So setzt du dein Passwort selbst zurück – ohne Anruf beim Servicedesk.",
    views: 958,
    helpful: 102,
    updated: 14 * DAY,
    body: "Ein gesperrtes Konto oder ein vergessenes Passwort kannst du in wenigen Minuten selbst zurücksetzen.\n\n## Passwort selbst zurücksetzen\n\n1. Öffne **passwort.muster.ch**.\n2. Bestätige deine Identität mit dem Authenticator.\n3. Wähle ein neues Passwort (mindestens 14 Zeichen).\n\nBei gesperrten SAP-Konten erfasse bitte ein Ticket in der Kategorie «Zugriff & Berechtigungen».",
  },
  {
    n: 3,
    title: "Drucker einrichten und Papierstau beheben",
    collection: 1,
    dep: "ict",
    summary:
      "Follow-Me-Printing nutzen und typische Druckerstörungen selbst lösen.",
    views: 233,
    helpful: 17,
    updated: 21 * DAY,
    body: "Alle Multifunktionsgeräte sind für Follow-Me-Printing eingerichtet.\n\n## Follow-Me-Printing\n\nDrucke auf **Muster-FollowMe** und hole den Ausdruck mit deinem Badge an jedem Gerät ab.\n\n## Papierstau\n\nÖffne Klappe A und B und entferne Papierreste. Meldet das Gerät weiterhin Stau, erfasse ein Ticket.",
  },
  {
    n: 4,
    title: "Sitzungszimmer reservieren",
    collection: 3,
    dep: "facility",
    summary: "Räume über Outlook buchen, Ausstattung und Catering bestellen.",
    views: 187,
    helpful: 12,
    updated: 30 * DAY,
    body: "Sitzungszimmer buchst du direkt in Outlook, inklusive Ausstattung.\n\n## Raum buchen\n\nÖffne in Outlook einen neuen Termin und füge über **Raumsuche** das gewünschte Zimmer hinzu.\n\n| Raum | Plätze | Ausstattung |\n|---|---|---|\n| Säntis | 12 | Teams-Raum, Whiteboard |\n| Pilatus | 6 | Bildschirm |\n| Rigi | 4 | Bildschirm |",
  },
  {
    n: 5,
    title: "Spesen erfassen und einreichen",
    collection: 4,
    dep: "hr",
    summary: "Belege fotografieren, Spesen erfassen und zur Freigabe senden.",
    views: 341,
    helpful: 29,
    updated: 9 * DAY,
    body: "Spesen werden digital erfasst und von der vorgesetzten Person freigegeben.\n\n## Spesen erfassen\n\n1. Öffne das Spesentool im Intranet.\n2. Fotografiere den Beleg mit der App.\n3. Wähle Kostenstelle und Projekt.\n\nAbrechnungen bis zum 5. des Folgemonats einreichen.",
  },
  {
    n: 6,
    title: "Neues Smartphone einrichten (Intune)",
    collection: 2,
    dep: "ict",
    summary:
      "Firmen-Apps über das Unternehmensportal installieren und MFA übertragen.",
    views: 276,
    helpful: 21,
    updated: 4 * DAY,
    body: "Firmen-Smartphones werden mit Microsoft Intune verwaltet.\n\n## Unternehmensportal\n\nInstalliere die App **Intune-Unternehmensportal** und melde dich mit deinem Firmenkonto an. Die Firmen-Apps werden danach automatisch installiert.",
  },
].map((a) => ({
  ...a,
  id: uid("aaaaaaaa", a.n),
  slug: a.title
    .toLowerCase()
    .replace(/[^a-z0-9äöü]+/g, "-")
    .replace(/^-|-$/g, ""),
  collectionId: KNOWLEDGE_COLLECTIONS[a.collection - 1].id,
  departmentId: DEP[a.dep].id,
  updatedAt: ago(a.updated),
  createdAt: ago(a.updated + 40 * DAY),
  authorId:
    a.dep === "ict" ? U.mara.id : a.dep === "hr" ? U.patrick.id : U.sandra.id,
}));

const SLA_POLICIES = [
  {
    id: uid("bbbbbbbb", 1),
    name: "Standard",
    priority: "medium",
    firstResponseMinutes: 240,
    resolutionMinutes: 1440,
  },
  {
    id: uid("bbbbbbbb", 2),
    name: "Hoch",
    priority: "high",
    firstResponseMinutes: 60,
    resolutionMinutes: 480,
  },
  {
    id: uid("bbbbbbbb", 3),
    name: "Kritisch",
    priority: "critical",
    firstResponseMinutes: 15,
    resolutionMinutes: 240,
  },
  {
    id: uid("bbbbbbbb", 4),
    name: "Niedrig",
    priority: "low",
    firstResponseMinutes: 480,
    resolutionMinutes: 4320,
  },
];

module.exports = {
  NOW,
  MIN,
  HOUR,
  DAY,
  iso,
  ago,
  inFuture,
  dateOnly,
  uid,
  TENANT,
  DEPARTMENTS,
  DEP,
  TEAMS,
  USERS,
  U,
  AGENTS,
  userById,
  STATUSES,
  ST,
  PRIORITIES,
  PR,
  CATEGORIES,
  SUBCATEGORIES,
  ASSETS,
  TICKETS,
  ticketById,
  COMMENTS,
  KNOWLEDGE_COLLECTIONS,
  KNOWLEDGE_ARTICLES,
  SLA_POLICIES,
};
