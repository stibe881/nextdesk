// Demo data and fake of the edge function "projects" for the handbook
// screenshots: four projects of Muster AG, one of them ("Netzwerk-Erneuerung
// Standort Bern") with a full plan, dependencies, time, documents and links.
// Dates are relative to today so the timeline always looks current.

const D = require("./demo-data.cjs");

const ok = (data) => ({ json: { data } });
const pid = (n) => D.uid("71717171", n);
const tid = (n) => D.uid("72727272", n);
const day = (offset) => D.dateOnly(offset * D.DAY);

// Monday of the current week, so that bars start on workdays.
const weekday = new Date(D.NOW).getUTCDay();
const MONDAY = weekday === 0 ? -6 : 1 - weekday;
const wd = (offset) => day(MONDAY + offset);

const agent = (index) => D.AGENTS[index % D.AGENTS.length];
const LEAD = agent(0);

const stats = (fields) => ({
  taskCount: 0,
  doneCount: 0,
  progressPercent: 0,
  estimatedMinutes: 0,
  bookedMinutes: 0,
  overdueTasks: 0,
  overdueMilestones: 0,
  nextMilestone: null,
  latestDueOn: null,
  actualAmountCents: null,
  ...fields,
});

const project = (n, fields) => ({
  id: pid(n),
  number: `P-${new Date(D.NOW).getUTCFullYear()}-${String(n).padStart(4, "0")}`,
  description: null,
  status: "active",
  health: "green",
  healthNote: null,
  managerId: LEAD.id,
  managerName: LEAD.name,
  departmentId: null,
  customerOrganizationId: null,
  customerName: null,
  locationId: null,
  locationName: null,
  startsOn: wd(-14),
  endsOn: wd(46),
  budgetMinutes: null,
  budgetAmountCents: null,
  hourlyRateCents: 15000,
  currency: "CHF",
  scheduleMode: "auto",
  sourceTicketId: null,
  sourceShopOrderId: null,
  completedAt: null,
  archivedAt: null,
  createdAt: D.ago(20 * D.DAY),
  updatedAt: D.ago(2 * D.HOUR),
  role: "manager",
  ...fields,
});

const ms = (n, title, offset, done = false) => ({
  id: D.uid("7f7f7f7f", n),
  title,
  dueOn: wd(offset),
  done,
});

const PROJECTS = [
  project(1, {
    title: "Netzwerk-Erneuerung Standort Bern",
    milestones: [
      ms(1, "Konzept freigegeben", -3, true),
      ms(2, "Hardware geliefert", 9),
      ms(3, "Abnahme durch den Kunden", 31),
    ],
    description:
      "Ablösung der Access-Switches und des WLAN am Standort Bern.\n\n- 6 Switches, 14 Access Points\n- neues Gäste-VLAN\n- Umstellung an zwei Wochenenden",
    customerName: "Muster Immobilien AG",
    locationName: "Bern, Bundesgasse",
    budgetMinutes: 180 * 60,
    budgetAmountCents: 2700000,
    stats: stats({
      taskCount: 9,
      doneCount: 3,
      progressPercent: 41,
      estimatedMinutes: 152 * 60,
      bookedMinutes: 71 * 60,
      nextMilestone: { title: "Hardware geliefert", on: wd(9) },
      latestDueOn: wd(39),
      actualAmountCents: 1065000,
    }),
  }),
  project(2, {
    title: "Microsoft 365 Migration Verkauf",
    milestones: [
      ms(4, "Pilot abgeschlossen", -14, true),
      ms(5, "Postfächer umgezogen", 4),
    ],
    health: "yellow",
    managerId: agent(1).id,
    managerName: agent(1).name,
    startsOn: wd(-35),
    endsOn: wd(18),
    budgetMinutes: 120 * 60,
    role: "member",
    stats: stats({
      taskCount: 14,
      doneCount: 9,
      progressPercent: 68,
      estimatedMinutes: 118 * 60,
      bookedMinutes: 104 * 60,
      overdueTasks: 2,
      nextMilestone: { title: "Postfächer umgezogen", on: wd(4) },
      latestDueOn: wd(18),
      actualAmountCents: 1560000,
    }),
  }),
  project(3, {
    title: "Umzug Serverraum Zürich",
    milestones: [ms(6, "Racks montiert", -3), ms(7, "Umzug abgeschlossen", 10)],
    health: "red",
    status: "active",
    customerName: "Muster Logistik GmbH",
    locationName: "Zürich, Hardturm",
    startsOn: wd(-49),
    endsOn: wd(11),
    budgetMinutes: 90 * 60,
    role: "viewer",
    stats: stats({
      taskCount: 11,
      doneCount: 5,
      progressPercent: 47,
      estimatedMinutes: 96 * 60,
      bookedMinutes: 97 * 60,
      overdueTasks: 3,
      overdueMilestones: 1,
      nextMilestone: { title: "Racks montiert", on: wd(-3) },
      latestDueOn: wd(24),
      actualAmountCents: 1455000,
    }),
  }),
  project(4, {
    title: "Einführung Passwortmanager",
    milestones: [
      ms(8, "Pilotgruppe gestartet", 28),
      ms(9, "Rollout abgeschlossen", 63),
    ],
    status: "planning",
    managerId: agent(2).id,
    managerName: agent(2).name,
    startsOn: wd(14),
    endsOn: wd(70),
    budgetMinutes: 60 * 60,
    role: "viewer",
    stats: stats({
      taskCount: 6,
      estimatedMinutes: 52 * 60,
      nextMilestone: { title: "Pilotgruppe gestartet", on: wd(28) },
      latestDueOn: wd(70),
      actualAmountCents: 0,
    }),
  }),
];

const task = (n, fields) => {
  const assignee =
    fields.assignee === undefined ? null : agent(fields.assignee);
  const { assignee: _assignee, ...rest } = fields;
  return {
    id: tid(n),
    parentId: null,
    kind: "task",
    description: null,
    status: "todo",
    priority: "normal",
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name ?? null,
    teamId: null,
    startsOn: null,
    dueOn: null,
    estimatedMinutes: null,
    progressPercent: 0,
    position: n,
    completedAt: null,
    bookedMinutes: 0,
    checklist: [],
    ...rest,
  };
};

const check = (n, description, done) => ({
  id: D.uid("73737373", n),
  description,
  done,
});

const TASKS = [
  task(1, { kind: "phase", title: "Planung" }),
  task(2, {
    parentId: tid(1),
    title: "Bestandsaufnahme Netzwerk",
    status: "done",
    progressPercent: 100,
    assignee: 0,
    startsOn: wd(-14),
    dueOn: wd(-10),
    estimatedMinutes: 16 * 60,
    bookedMinutes: 18 * 60,
    completedAt: D.ago(9 * D.DAY),
  }),
  task(3, {
    parentId: tid(1),
    title: "Zielkonzept und VLAN-Plan",
    status: "done",
    progressPercent: 100,
    assignee: 1,
    startsOn: wd(-9),
    dueOn: wd(-4),
    estimatedMinutes: 24 * 60,
    bookedMinutes: 22 * 60,
    completedAt: D.ago(4 * D.DAY),
  }),
  task(4, {
    parentId: tid(1),
    kind: "milestone",
    title: "Konzept freigegeben",
    status: "done",
    progressPercent: 100,
    startsOn: wd(-3),
    dueOn: wd(-3),
  }),
  task(5, { kind: "phase", title: "Beschaffung" }),
  task(6, {
    parentId: tid(5),
    title: "Offerten einholen und bestellen",
    status: "done",
    progressPercent: 100,
    assignee: 2,
    startsOn: wd(-2),
    dueOn: wd(1),
    estimatedMinutes: 8 * 60,
    bookedMinutes: 9 * 60,
    completedAt: D.ago(1 * D.DAY),
  }),
  task(7, {
    parentId: tid(5),
    kind: "milestone",
    title: "Hardware geliefert",
    startsOn: wd(9),
    dueOn: wd(9),
  }),
  task(8, { kind: "phase", title: "Umsetzung" }),
  task(9, {
    parentId: tid(8),
    title: "Switches vorkonfigurieren",
    status: "in_progress",
    progressPercent: 40,
    priority: "high",
    assignee: 0,
    startsOn: wd(2),
    dueOn: wd(8),
    estimatedMinutes: 24 * 60,
    bookedMinutes: 14 * 60,
    description:
      "Grundkonfiguration nach VLAN-Plan, Firmware auf den freigegebenen Stand bringen.",
    checklist: [
      check(1, "Firmware 17.9 einspielen", true),
      check(2, "VLANs 10, 20, 30 und 99 anlegen", true),
      check(3, "Uplinks als LACP bündeln", false),
      check(4, "Konfiguration im Repository ablegen", false),
    ],
  }),
  task(10, {
    parentId: tid(8),
    title: "Switches im Rack tauschen",
    assignee: 1,
    startsOn: wd(10),
    dueOn: wd(15),
    estimatedMinutes: 32 * 60,
  }),
  task(11, {
    parentId: tid(10),
    title: "Etage 1 und 2",
    assignee: 1,
    startsOn: wd(10),
    dueOn: wd(11),
    estimatedMinutes: 16 * 60,
  }),
  task(12, {
    parentId: tid(10),
    title: "Etage 3 und Serverraum",
    assignee: 2,
    startsOn: wd(14),
    dueOn: wd(15),
    estimatedMinutes: 16 * 60,
  }),
  task(13, {
    parentId: tid(8),
    title: "WLAN Access Points montieren",
    status: "blocked",
    assignee: 2,
    startsOn: wd(16),
    dueOn: wd(22),
    estimatedMinutes: 28 * 60,
    bookedMinutes: 2 * 60,
  }),
  task(14, {
    parentId: tid(8),
    title: "Gäste-VLAN und Firewall-Regeln",
    assignee: 0,
    startsOn: wd(16),
    dueOn: wd(18),
    estimatedMinutes: 12 * 60,
  }),
  task(15, { kind: "phase", title: "Abschluss" }),
  task(16, {
    parentId: tid(15),
    title: "Abnahmetests und Dokumentation",
    assignee: 1,
    startsOn: wd(23),
    dueOn: wd(30),
    estimatedMinutes: 12 * 60,
  }),
  task(17, {
    parentId: tid(15),
    kind: "milestone",
    title: "Abnahme durch den Kunden",
    startsOn: wd(31),
    dueOn: wd(31),
  }),
];

const dep = (n, from, to, type = "finish_to_start", lagDays = 0) => ({
  id: D.uid("74747474", n),
  predecessorId: tid(from),
  successorId: tid(to),
  type,
  lagDays,
});

const DEPENDENCIES = [
  dep(1, 2, 3),
  dep(2, 3, 4),
  dep(3, 4, 6),
  dep(4, 6, 7, "finish_to_start", 5),
  dep(5, 7, 10),
  dep(6, 9, 10),
  dep(7, 10, 13),
  dep(8, 10, 14),
  dep(9, 13, 16),
  dep(10, 16, 17),
];

const ticket = D.TICKETS[1] ?? D.TICKETS[0];
const LINKS = [
  {
    id: D.uid("75757575", 1),
    taskId: null,
    targetKind: "ticket",
    targetId: ticket.id,
    label: ticket.ticket_number,
    detail: ticket.subject,
    state: "In Bearbeitung",
    isClosed: false,
    assigneeName: agent(0).name,
    bookedMinutes: 6 * 60,
    note: null,
  },
  {
    id: D.uid("75757575", 2),
    taskId: null,
    targetKind: "ipam_prefix",
    targetId: D.uid("76767676", 1),
    label: "10.20.0.0/22",
    detail: "Bern Clients",
    state: "active",
    isClosed: false,
    assigneeName: null,
    bookedMinutes: 0,
    note: null,
  },
  {
    id: D.uid("75757575", 3),
    taskId: tid(14),
    targetKind: "ipam_vlan",
    targetId: D.uid("76767676", 2),
    label: "VLAN 99",
    detail: "Gäste Bern",
    state: null,
    isClosed: false,
    assigneeName: null,
    bookedMinutes: 0,
    note: null,
  },
  {
    id: D.uid("75757575", 4),
    taskId: tid(9),
    targetKind: "asset",
    targetId: D.uid("76767676", 3),
    label: "SW-BE-CORE-01",
    detail: "A-004711",
    state: "active",
    isClosed: false,
    assigneeName: null,
    bookedMinutes: 0,
    note: null,
  },
  {
    id: D.uid("75757575", 5),
    taskId: null,
    targetKind: "monitoring_sensor",
    targetId: D.uid("76767676", 4),
    label: "Ping Uplink Bern",
    detail: "FW-BE-01",
    state: "ping",
    isClosed: false,
    assigneeName: null,
    bookedMinutes: 0,
    note: null,
  },
];

const DOCUMENTS = [
  {
    id: D.uid("77777777", 1),
    title: "Netzwerkkonzept",
    body: "# Netzwerkkonzept Bern\n\n## Ziel\n\nEin einheitliches, segmentiertes Netz mit getrenntem Gäste-WLAN.\n\n## VLAN-Plan\n\n| VLAN | Name | Netz |\n| --- | --- | --- |\n| 10 | Clients | 10.20.0.0/22 |\n| 20 | Drucker | 10.20.4.0/24 |\n| 30 | Telefonie | 10.20.5.0/24 |\n| 99 | Gäste | 10.20.99.0/24 |\n\n## Umstellung\n\n1. Switches vorkonfigurieren\n2. Tausch etagenweise am Wochenende\n3. Abnahmetests gemäss Protokoll",
    visibility: "internal",
    position: 0,
    updatedByName: agent(1).name,
    updatedAt: D.ago(3 * D.DAY),
  },
  {
    id: D.uid("77777777", 2),
    title: "Protokoll Kick-off",
    body: "Teilnehmende, Entscheide und offene Punkte des Kick-offs.",
    visibility: "external",
    position: 1,
    updatedByName: LEAD.name,
    updatedAt: D.ago(13 * D.DAY),
  },
];

const COMMENTS = [
  {
    id: D.uid("78787878", 1),
    taskId: null,
    authorId: agent(1).id,
    authorName: agent(1).name,
    visibility: "internal",
    body: "Lieferant bestätigt die Lieferung der Switches für nächste Woche.",
    createdAt: D.ago(26 * D.HOUR),
    mine: false,
  },
  {
    id: D.uid("78787878", 2),
    taskId: null,
    authorId: LEAD.id,
    authorName: LEAD.name,
    visibility: "external",
    body: "Die Umstellung der Etagen 1 und 2 findet am Samstag statt; der Zugang ist mit dem Hausdienst abgesprochen.",
    createdAt: D.ago(5 * D.HOUR),
    mine: true,
  },
  {
    id: D.uid("78787878", 3),
    taskId: tid(9),
    authorId: agent(0).id,
    authorName: agent(0).name,
    visibility: "internal",
    body: "Zwei der sechs Switches sind fertig vorkonfiguriert.",
    createdAt: D.ago(20 * D.HOUR),
    mine: true,
  },
];

const entry = (n, taskN, minutes, who, hoursAgo, note) => ({
  id: D.uid("79797979", n),
  taskId: tid(taskN),
  authorId: agent(who).id,
  authorName: agent(who).name,
  minutes,
  billingKind: "billable",
  note,
  startedAt: null,
  createdAt: D.ago(hoursAgo * D.HOUR),
  mine: who === 0,
});

const TIME_ENTRIES = [
  entry(1, 9, 240, 0, 20, "Switches 1 und 2 vorkonfiguriert"),
  entry(2, 9, 300, 0, 44, "Firmware und VLANs"),
  entry(3, 9, 300, 0, 68, "Vorlage der Grundkonfiguration"),
  entry(4, 13, 120, 2, 50, "Begehung mit dem Elektriker"),
  entry(5, 6, 540, 2, 90, "Offerten verglichen und bestellt"),
];

const EVENTS = [
  [
    "time_entry.added",
    { minutes: 240, title: "Switches vorkonfigurieren" },
    20,
  ],
  [
    "task.updated",
    { title: "WLAN Access Points montieren", status: "blocked" },
    30,
  ],
  ["schedule.shifted", { count: 3 }, 31],
  ["link.added", {}, 52],
  ["document.created", { title: "Netzwerkkonzept" }, 80],
  ["project.created", {}, 480],
].map(([type, payload, hoursAgo], index) => ({
  id: D.uid("70707070", index + 1),
  taskId: null,
  actorName: agent(index).name,
  type,
  payload,
  createdAt: D.ago(hoursAgo * D.HOUR),
}));

const MEMBERS = [
  { userId: LEAD.id, name: LEAD.name, role: "manager", lead: true },
  { userId: agent(1).id, name: agent(1).name, role: "member", lead: false },
  { userId: agent(2).id, name: agent(2).name, role: "member", lead: false },
  {
    userId: D.uid("11111111", 91),
    name: "Beat Keller (Elektro Keller AG)",
    role: "guest_comment",
    lead: false,
  },
];

const ATTACHMENTS = [
  {
    id: D.uid("7a7a7a7a", 1),
    taskId: null,
    filename: "Netzwerkplan-Bern.pdf",
    contentType: "application/pdf",
    byteSize: 842_000,
    uploadedByName: agent(1).name,
    createdAt: D.ago(3 * D.DAY),
  },
  {
    id: D.uid("7a7a7a7a", 2),
    taskId: null,
    filename: "Rack-Foto-Serverraum.jpg",
    contentType: "image/jpeg",
    byteSize: 1_920_000,
    uploadedByName: agent(2).name,
    createdAt: D.ago(6 * D.DAY),
  },
];

const OPTIONS = () => ({
  agents: D.AGENTS.map((user) => ({ id: user.id, name: user.name })),
  people: D.USERS.map((user) => ({ id: user.id, name: user.name })).sort(
    (a, b) => a.name.localeCompare(b.name, "de"),
  ),
  teams: D.TEAMS.map((team) => ({ id: team.id, name: team.name })),
  customers: [
    { id: D.uid("7b7b7b7b", 1), name: "Muster Immobilien AG" },
    { id: D.uid("7b7b7b7b", 2), name: "Muster Logistik GmbH" },
  ],
  locations: [
    { id: D.uid("7c7c7c7c", 1), name: "Bern, Bundesgasse" },
    { id: D.uid("7c7c7c7c", 2), name: "Zürich, Hardturm" },
  ],
  departments: D.DEPARTMENTS.map((department) => ({
    id: department.id,
    name: department.name,
  })),
  templates: [
    {
      id: D.uid("7d7d7d7d", 1),
      name: "Standort-Netzwerk erneuern",
      description: "Planung, Beschaffung, Umsetzung, Abschluss",
      itemCount: 17,
      durationDays: 45,
      updatedAt: D.ago(30 * D.DAY),
    },
    {
      id: D.uid("7d7d7d7d", 2),
      name: "Software-Einführung",
      description: null,
      itemCount: 12,
      durationDays: 60,
      updatedAt: D.ago(90 * D.DAY),
    },
  ],
  settings: { ticketWorkloadMinutes: 30, dailyCapacityMinutes: 480 },
});

function workdays(count) {
  const days = [];
  for (let offset = 0; days.length < count; offset += 1) {
    const date = wd(offset);
    const weekdayOf = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekdayOf !== 0 && weekdayOf !== 6) days.push(date);
  }
  return days;
}

function workload() {
  const days = workdays(20);
  // Hours per day and person: a full first week for one, a calm month for another.
  const patterns = [
    [9.5, 8.5, 8, 7.5, 6, 6, 6.5, 7, 5, 4, 3, 3, 4, 4, 2, 2, 1, 1, 1, 0],
    [4, 4.5, 5, 5, 4, 6, 7.5, 8, 8.5, 9, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1],
    [2, 2, 3, 3, 2.5, 2, 2, 3, 4, 4, 5.5, 6, 6, 5, 5, 4, 2, 1, 1, 1],
  ];
  const people = patterns.map((pattern, index) => {
    const person = agent(index);
    const personDays = days.map((date, dayIndex) => {
      const minutes = Math.round(pattern[dayIndex] * 60);
      const ticketMinutes = Math.min(minutes, 90);
      const serviceTaskMinutes =
        dayIndex % 5 === 0 ? Math.min(60, minutes - ticketMinutes) : 0;
      return {
        date,
        minutes,
        ticketMinutes,
        serviceTaskMinutes,
        projectMinutes: minutes - ticketMinutes - serviceTaskMinutes,
      };
    });
    const totalMinutes = personDays.reduce(
      (sum, entryDay) => sum + entryDay.minutes,
      0,
    );
    return {
      userId: person.id,
      name: person.name,
      totalMinutes,
      capacityMinutes: days.length * 480,
      utilizationPercent: Math.round(
        (totalMinutes / (days.length * 480)) * 100,
      ),
      overloadedDays: personDays.filter((entryDay) => entryDay.minutes > 480)
        .length,
      days: personDays,
      counts: {
        project_task: 4 - index,
        ticket: 6 + index * 2,
        service_task: 2,
      },
      unestimated: index === 1 ? 2 : 0,
      items: TASKS.filter(
        (item) => item.assigneeId === person.id && item.status !== "done",
      )
        .map((item) => ({
          kind: "project_task",
          id: item.id,
          projectId: pid(1),
          projectName: `${PROJECTS[0].number} ${PROJECTS[0].title}`,
          title: item.title,
          dueOn: item.dueOn,
          minutes: Math.round(
            ((item.estimatedMinutes ?? 0) * (100 - item.progressPercent)) / 100,
          ),
          overdue: false,
        }))
        .concat(
          D.TICKETS.slice(0, 3).map((item) => ({
            kind: "ticket",
            id: item.id,
            projectId: null,
            projectName: null,
            title: `${item.ticket_number} ${item.subject}`,
            dueOn: day(index + 1),
            minutes: 30,
            overdue: false,
          })),
        ),
    };
  });
  return {
    from: days[0],
    to: days.at(-1),
    today: day(0),
    settings: { ticketWorkloadMinutes: 30, dailyCapacityMinutes: 480 },
    days,
    people: people.sort((a, b) => b.utilizationPercent - a.utilizationPercent),
  };
}

const GUEST_ACCESS = {
  role: "guest_comment",
  canAdmin: false,
  canEdit: false,
  canComment: true,
  isGuest: true,
};
const MANAGER_ACCESS = {
  role: "manager",
  canAdmin: true,
  canEdit: true,
  canComment: true,
  isGuest: false,
};

function detail(persona) {
  const guest = persona.canWorkTickets !== true;
  return {
    project: PROJECTS[0],
    access: guest ? GUEST_ACCESS : MANAGER_ACCESS,
    tasks: TASKS,
    dependencies: DEPENDENCIES,
    comments: guest
      ? COMMENTS.filter((item) => item.visibility === "external")
      : COMMENTS,
    documents: guest
      ? DOCUMENTS.filter((item) => item.visibility === "external")
      : DOCUMENTS,
    members: guest ? MEMBERS.filter((member) => member.lead) : MEMBERS,
    invitations: guest
      ? []
      : [
          {
            id: D.uid("7e7e7e7e", 1),
            email: "planung@architektur-frei.ch",
            role: "guest_read",
            expiresAt: D.inFuture(11 * D.DAY),
          },
        ],
    timeEntries: guest ? [] : TIME_ENTRIES,
    links: guest ? [] : LINKS,
    events: guest ? [] : EVENTS,
    attachments: guest ? [] : ATTACHMENTS,
  };
}

/** Fake of supabase/functions/projects. */
function handler(body, { persona }) {
  const admin = persona.isTenantAdmin === true;
  const staff = persona.canWorkTickets === true;
  const permissions = { read: staff, create: staff, manage: admin };
  const guest = persona.projectGuest === true;
  switch (body.type) {
    case "acceptMyInvitations":
      return ok({ accepted: 0 });
    case "access":
      return ok({
        enabled: true,
        ...permissions,
        hasProjects: staff || guest,
        visible: staff || guest,
        guestOnly: guest,
      });
    case "overview":
      return ok({
        permissions,
        projects: staff
          ? PROJECTS
          : guest
            ? [{ ...PROJECTS[0], role: "guest_comment", budgetMinutes: null }]
            : [],
      });
    case "options":
      return ok(OPTIONS());
    case "getProject":
      return ok(detail(persona));
    case "workload":
      return ok(workload());
    case "previewReschedule":
      return ok({ changes: [], applied: false });
    case "projectsForRecord":
      return ok({
        canCreate: staff,
        projects:
          body.targetKind === "ticket" && body.targetId === ticket.id
            ? [
                {
                  linkId: LINKS[0].id,
                  projectId: PROJECTS[0].id,
                  number: PROJECTS[0].number,
                  title: PROJECTS[0].title,
                  status: PROJECTS[0].status,
                  health: PROJECTS[0].health,
                },
              ]
            : [],
      });
    case "searchLinkable":
      return ok({
        results: D.TICKETS.slice(0, 5).map((item) => ({
          id: item.id,
          label: item.ticket_number,
          detail: item.subject,
        })),
      });
    default:
      // Changes are accepted without effect; the screens only read.
      return ok({ updated: true, shifted: 0, pending: 0 });
  }
}

module.exports = { handler, PROJECTS };
