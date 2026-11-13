// Edge function fakes. Each handler receives the JSON body and a context with
// the signed-in persona and returns { json, status }. Shapes follow the
// parsers in apps/web/src and the functions in supabase/functions/<name>.

const fs = require("node:fs");
const path = require("node:path");
const D = require("./demo-data.cjs");
const { visibleTickets } = require("./rest-handlers.cjs");
const A = require("./admin-data.cjs");

const REPO_ROOT = path.resolve(__dirname, "../..");
const HANDBOOK_DIR = path.join(REPO_ROOT, "docs/handbooks");

const ok = (data) => ({ json: { data } });

// People that exist only in the Entra directory (people search).
const PERSON_DIRECTORY_EXTRA = [
  {
    id: "11111111-1111-4111-8111-0000000000a1",
    name: "Peter Brunner",
    email: "peter.brunner@muster.ch",
    jobTitle: "Sachbearbeiter Logistik",
    departmentLabel: "Logistik",
  },
  {
    id: "11111111-1111-4111-8111-0000000000a2",
    name: "Rita Brunner-Kunz",
    email: "rita.brunner@muster.ch",
    jobTitle: "Empfang",
    departmentLabel: "Empfang",
    accountEnabled: false,
  },
];
const fail = (code, status = 400) => ({ status, json: { error: { code } } });

const ENABLED_FEATURES = new Set([
  "ticketing.detail",
  "ticketing.checklists",
  "ticketing.time-tracking",
  "ticketing.templates",
  "knowledge.base",
  "automation.sla",
  "reporting.service",
  "integrations.email",
  "assets.management",
  "portal.self-service",
  "requester.portal",
  "agent.workbench",
  "ai.assist",
  "notifications.push",
  "self_service.shop",
  "teams.provisioning",
]);
const ALL_FEATURES = [
  "ticketing.detail",
  "ticketing.checklists",
  "ticketing.time-tracking",
  "ticketing.templates",
  "knowledge.base",
  "automation.sla",
  "reporting.service",
  "integrations.email",
  "assets.management",
  "inventory.management",
  "contracts.management",
  "self_service.shop",
  "service.tasks",
  "event.spaces",
  "onboarding.entries",
  "experience.workspace",
  "portal.self-service",
  "ai.assist",
  "agent.workbench",
  "requester.portal",
  "requester.department-view",
  "notifications.push",
  "teams.provisioning",
  "portal.notices",
];

const HANDBOOKS = [
  {
    id: "mitarbeitende",
    title: "Handbuch für Mitarbeitende",
    description:
      "Tickets erfassen, Anfragen verfolgen und Antworten in der Wissensdatenbank finden.",
    audienceLabel: "Mitarbeitende",
    minRole: "employee",
  },
  {
    id: "agenten",
    title: "Handbuch für Agenten",
    description:
      "Tickets bearbeiten, mit Antragstellenden kommunizieren und Wissen teilen.",
    audienceLabel: "Agenten",
    minRole: "agent",
  },
  {
    id: "administratoren",
    title: "Handbuch für Administratoren",
    description:
      "Personen, Rollen, SLA, Funktionen und Erscheinungsbild des Mandanten verwalten.",
    audienceLabel: "Administratoren",
    minRole: "admin",
  },
  {
    id: "installation",
    title: "Installationsanleitung",
    description:
      "Microsoft Entra ID, Exchange Online, Intune und Monitoring anbinden.",
    audienceLabel: "Administratoren",
    minRole: "admin",
  },
];
const ROLE_RANK = { employee: 0, agent: 1, admin: 2 };

// Shop catalogue for the handbook screenshots (Self-Service-Shop).
const SHOP_CATEGORIES = [
  { id: "66666666-6666-4666-8666-000000000001", name: "Bildschirme" },
  { id: "66666666-6666-4666-8666-000000000002", name: "Zubehör" },
  { id: "66666666-6666-4666-8666-000000000003", name: "Leihgeräte" },
];
function shopItem(index, fields) {
  const category = SHOP_CATEGORIES.find((c) => c.name === fields.category);
  return {
    id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
    description: null,
    categoryId: category.id,
    categoryIds: [category.id],
    categoryNames: [category.name],
    articleNumber: `ART-${1000 + index}`,
    supplierUrl: null,
    kind: "order",
    requiresApproval: false,
    maxQuantity: 2,
    maxLoanDays: null,
    loanQuantity: null,
    active: true,
    sortOrder: index,
    inventoryItemId: null,
    departmentId: null,
    canEdit: false,
    specifications: {},
    optionItemIds: [],
    imageUrl: null,
    imageUrls: [],
    images: [],
    stockLevel: "in_stock",
    availableQuantity: 8,
    ...fields,
  };
}
const SHOP_ITEMS = [
  shopItem(1, {
    name: "Monitor 27 Zoll (Dell P2723D)",
    description: "QHD-Monitor mit USB-C, höhenverstellbar.",
    category: "Bildschirme",
    requiresApproval: true,
    maxQuantity: 1,
    stockLevel: "low",
    availableQuantity: 2,
  }),
  shopItem(2, {
    name: "Headset Jabra Evolve2 65",
    description: "Kabelloses Headset für Teams-Anrufe.",
    category: "Zubehör",
  }),
  shopItem(3, {
    name: "Maus Logitech MX Master 3S",
    description: "Ergonomische Maus mit USB-Empfänger.",
    category: "Zubehör",
  }),
  shopItem(4, {
    name: "USB-C-Dockingstation",
    description: "Für Laptop, zwei Bildschirme und Netzwerk.",
    category: "Zubehör",
    stockLevel: "on_request",
    availableQuantity: null,
  }),
  shopItem(5, {
    name: "Beamer (Leihgerät)",
    description: "Mobiler Beamer für Präsentationen, mit HDMI-Kabel.",
    category: "Leihgeräte",
    kind: "loan",
    maxQuantity: 1,
    maxLoanDays: 14,
    loanQuantity: 2,
    availableQuantity: 2,
  }),
];
function shopOrders(persona) {
  const now = Date.now();
  return [
    {
      id: "88888888-8888-4888-8888-000000000001",
      orderNumber: "B-2026-0042",
      status: "in_progress",
      overdue: false,
      requesterId: persona.id,
      requesterName: persona.name,
      placedByName: persona.name,
      approverName: "Daniel Frei",
      handledByName: "Mara Keller",
      deliveryMethod: "desk",
      deliveryLocation: "2. OG, Büro 2.14",
      neededBy: null,
      loanFrom: null,
      loanUntil: null,
      comment: null,
      decisionReason: null,
      reason: "Zweiter Bildschirm für Homeoffice",
      lineCount: 1,
      itemsLabel: "Monitor 27 Zoll (Dell P2723D)",
      createdAt: new Date(now - 3 * 86400000).toISOString(),
      updatedAt: new Date(now - 86400000).toISOString(),
    },
  ];
}

// Prefer the real front matter so the screenshots match the shipped texts.
function handbookFrontMatter(id) {
  const file = path.join(HANDBOOK_DIR, `${id}.md`);
  if (!fs.existsSync(file)) return {};
  const match = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, "utf8"));
  const meta = {};
  for (const line of match ? match[1].split("\n") : []) {
    const pair = /^([a-zA-Z]+):\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1]] = pair[2];
  }
  return meta;
}

function handbookSummary(handbook) {
  const meta = handbookFrontMatter(handbook.id);
  return {
    id: handbook.id,
    title: meta.title ?? handbook.title,
    description: meta.description ?? handbook.description,
    audienceLabel: meta.audienceLabel ?? handbook.audienceLabel,
    updatedAt: meta.updated ?? "2026-11-08",
  };
}

function handbookMarkdown(id) {
  const file = path.join(HANDBOOK_DIR, `${id}.md`);
  if (!fs.existsSync(file)) {
    return `# ${HANDBOOKS.find((h) => h.id === id).title}\n\nDieses Handbuch wird zurzeit überarbeitet.`;
  }
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "");
  return text.replace(
    /\]\(images\/([\w.-]+\.(?:jpg|jpeg|png))\)/g,
    (match, name) => {
      const image = path.join(HANDBOOK_DIR, "images", name);
      if (!fs.existsSync(image)) return match;
      const mime = name.endsWith(".png") ? "image/png" : "image/jpeg";
      return `](data:${mime};base64,${fs.readFileSync(image).toString("base64")})`;
    },
  );
}

const personaRole = (persona) =>
  persona.isTenantAdmin
    ? "admin"
    : persona.canWorkTickets
      ? "agent"
      : "employee";
const agentDirectory = () =>
  D.AGENTS.map((agent) => ({ id: agent.id, displayName: agent.name }));
const departmentOptions = () =>
  D.DEPARTMENTS.map((d) => ({ id: d.id, key: d.key, label: d.name }));

function ticketComments(ticket) {
  const number = Number(ticket.id.slice(-4));
  return (D.COMMENTS[number] ?? []).map(
    ([authorKey, visibility, offset, body], index) => {
      const author = D.U[authorKey];
      const isAgent = author.role !== "employee";
      return {
        id: D.uid("eeeeeeee", number * 100 + index),
        authorName: author.name,
        authorKind: isAgent ? "agent" : "requester",
        body,
        created_at: D.ago(offset),
        visibility: visibility === "internal" ? "internal" : "external",
        channel: ticket.channel === "email" && !isAgent ? "email" : "portal",
        ...(isAgent && visibility !== "internal"
          ? { emailDelivery: "sent" }
          : {}),
      };
    },
  );
}

function ticketEvents(ticket) {
  const created = Date.parse(ticket.created_at);
  const at = (minutes) => new Date(created + minutes * D.MIN).toISOString();
  const events = [
    {
      id: D.uid("ffffffff", 1),
      event_type: "ticket.created",
      created_at: ticket.created_at,
      payload: { channel: ticket.channel },
    },
  ];
  if (ticket.assigned_agent_id) {
    events.push({
      id: D.uid("ffffffff", 2),
      event_type: "ticket.updated",
      created_at: at(8),
      payload: {
        changedFields: ["assignedAgent", "status"],
        statusTransition: { toStatusKey: "in_progress", isClosed: false },
      },
    });
  }
  if (ticket.status_key !== "new" && ticket.status_key !== "in_progress") {
    events.push({
      id: D.uid("ffffffff", 3),
      event_type: ticket.status_is_closed ? "ticket.closed" : "ticket.updated",
      created_at: ticket.updated_at,
      payload: {
        changedFields: ["status"],
        statusTransition: {
          toStatusKey: ticket.status_key,
          isClosed: ticket.status_is_closed,
        },
      },
    });
  }
  return events;
}

function ticketDetail(ticket, persona) {
  const agent = ticket.assigned_agent_id
    ? D.userById(ticket.assigned_agent_id)
    : null;
  const requester = D.userById(ticket.requester_id);
  const isAgent = persona.canWorkTickets;
  return {
    ticket: {
      id: ticket.id,
      ticket_number: ticket.ticket_number,
      subject: ticket.subject,
      description: ticket.description,
      status_id: ticket.status_id,
      priority_id: ticket.priority_id,
      department_id: ticket.department_id,
      category_id: ticket.category_id,
      subcategory_id: ticket.subcategory_id,
      assigned_agent_id: ticket.assigned_agent_id,
      assigned_team_id: ticket.assigned_team_id,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      requester_id: ticket.requester_id,
      affected_user_id: null,
      resolved_at: ticket.resolved_at,
      first_response_due_at: ticket.first_response_due_at,
      resolution_due_at: ticket.resolution_due_at,
    },
    assignedAgent: agent ? { id: agent.id, displayName: agent.name } : null,
    requesterContact: requester
      ? {
          id: requester.id,
          displayName: requester.name,
          email: requester.email,
        }
      : null,
    department: { id: ticket.department_id, name: ticket.department_name },
    serviceOffers: [],
    departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
    comments: ticketComments(ticket).filter(
      (comment) => isAgent || comment.visibility === "external",
    ),
    events: ticketEvents(ticket),
    escalations: [],
    statuses: D.STATUSES.map((s) => ({
      id: s.id,
      key: s.key,
      label: s.label,
      is_closed: s.is_closed,
      sort_order: s.sort_order,
    })),
    priorities: D.PRIORITIES.map((p) => ({
      id: p.id,
      key: p.key,
      label: p.label,
      sort_order: p.sort_order,
    })),
    teams: D.TEAMS.map((team) => ({
      id: team.id,
      name: team.name,
      department_id: team.departmentId,
    })),
    ...(isAgent ? { agents: agentDirectory() } : {}),
    checklistItems:
      isAgent && ticket.id === D.TICKETS[0].id
        ? [
            {
              id: D.uid("abababab", 1),
              description: "Rollback des Updates via WinRE versuchen",
              position: 1,
              completed_at: D.ago(60 * D.MIN),
            },
            {
              id: D.uid("abababab", 2),
              description: "Ersatzgerät LT-0217 vorbereiten",
              position: 2,
              completed_at: D.ago(30 * D.MIN),
            },
            {
              id: D.uid("abababab", 3),
              description: "Gerät zur Reparatur an Lenovo senden",
              position: 3,
              completed_at: null,
            },
          ]
        : [],
    timeEntries:
      isAgent && ticket.id === D.TICKETS[0].id
        ? [
            {
              id: D.uid("acacacac", 1),
              author_id: D.U.mara.id,
              minutes: 35,
              billing_kind: "internal",
              note: "Analyse und Ersatzgerät",
              started_at: null,
              created_at: D.ago(30 * D.MIN),
            },
          ]
        : [],
    drafts: [],
    relations: [],
    similarTickets: [],
    ticketModules: { checklists: isAgent, timeTracking: isAgent },
    watching: isAgent,
    canUpdate: isAgent,
    canAssign: isAgent,
    canMerge: isAgent,
    canExport: isAgent,
    canClose: isAgent,
    canEscalate: isAgent,
    canUseInternalNotes: isAgent,
    canWriteInternalNotes: isAgent,
    canCommentExternal: true,
    canTrackTime: isAgent,
  };
}

function knowledgeArticle(article, persona) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    visibility: article.n === 6 ? "internal" : "external",
    status: "published",
    department_id: article.departmentId,
    current_revision: 3,
    published_revision: 3,
    review_requested_at: null,
    published_at: article.updatedAt,
    created_at: article.createdAt,
    updated_at: article.updatedAt,
    collection_ids: [article.collectionId],
    outcomes: persona.canWorkTickets
      ? {
          windowDays: 90,
          resolvedRecent: Math.round(article.helpful / 3),
          deflectedRecent: Math.round(article.views / 12),
          notHelpfulRecent: 1,
          resolvedTotal: article.helpful,
          deflectedTotal: Math.round(article.views / 6),
          notHelpfulTotal: 2,
          needsRevision: false,
        }
      : undefined,
  };
}

function knowledgeRevision(article) {
  return {
    id: D.uid("15151515", article.n),
    article_id: article.id,
    revision: 3,
    body: article.body,
    summary: article.summary,
    created_at: article.updatedAt,
  };
}

const visibleArticles = (persona) =>
  D.KNOWLEDGE_ARTICLES.filter((a) => persona.canWorkTickets || a.n !== 6);

function monitoringOptions() {
  return {
    departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
    teams: D.TEAMS.map((t) => ({
      id: t.id,
      name: t.name,
      departmentId: t.departmentId,
    })),
    priorities: D.PRIORITIES.map((p) => ({ key: p.key, label: p.label })),
    services: [
      { id: D.uid("14141414", 1), name: "Arbeitsplatz Windows" },
      { id: D.uid("14141414", 2), name: "VPN-Zugang" },
    ],
    assets: D.ASSETS.map((a) => ({ id: a.id, name: a.name })),
  };
}

// Optional panels hide themselves when the server answers 403.
const hidden = () => fail("feature_disabled", 403);

function coordinationOverview(ticket) {
  const comments = ticketComments(ticket);
  return {
    ticket: {
      createdAt: ticket.created_at,
      firstRespondedAt:
        comments.find(
          (c) => c.authorKind === "agent" && c.visibility === "external",
        )?.created_at ?? null,
      responseDueAt: ticket.first_response_due_at,
      resolutionDueAt: ticket.resolution_due_at,
      resolvedAt: ticket.resolved_at,
      closedAt: null,
      isClosed: ticket.status_is_closed,
    },
    parent: null,
    children: [],
    vendorCases: [],
    vendors: [
      {
        id: D.uid("13131313", 1),
        name: "Lenovo Premier Support",
        reminderAfterHours: 48,
      },
    ],
    events: ticketEvents(ticket).map((event) => ({
      id: event.id,
      type: event.event_type,
      createdAt: event.created_at,
      payload: event.payload,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      visibility: c.visibility,
      createdAt: c.created_at,
      fromRequester: c.authorKind === "requester",
    })),
    statuses: D.STATUSES.map((s) => ({
      key: s.key,
      label: s.label,
      isClosed: s.is_closed,
    })),
    permissions: {
      canSplit: true,
      canManageVendorCases: true,
      canManageVendors: false,
    },
  };
}

const HANDLERS = {
  "owner-access": () => fail("platform_operator_required", 403),
  "tenant-sso-access": () =>
    ok({
      scope: "tenant",
      tenantId: D.TENANT.id,
      ssoEnforced: false,
      tenant: D.TENANT,
    }),
  "tenant-users": (body, { persona }) => {
    if (body.type === "acceptMyInvitations") return ok({ accepted: 0 });
    if (body.type === "listUsers")
      return persona.isTenantAdmin
        ? ok(A.userDirectory())
        : fail("forbidden", 403);
    if (body.type === "getMyTicketAccess") {
      return ok({
        canWorkTickets: persona.canWorkTickets,
        canManageContracts: persona.isTenantAdmin,
        canManageServiceStatus: persona.isTenantAdmin,
        canReadReports: persona.canWorkTickets,
        isTenantAdmin: persona.isTenantAdmin,
      });
    }
    return null;
  },
  "tenant-admin-settings": (body, { persona }) => {
    if (!persona.isTenantAdmin) return fail("forbidden", 403);
    if (body.type === "getSettings") return ok(A.settings(ENABLED_FEATURES));
    if (body.type === "listUsers")
      return ok({
        users: A.userDirectory().members.map((m) => ({
          id: m.id,
          email: m.email,
          displayName: m.displayName,
          status: "active",
        })),
      });
    if (body.type === "listDepartments") {
      return ok({
        departments: D.DEPARTMENTS.map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          kind:
            d.key === "ict"
              ? "ict"
              : d.key === "facility"
                ? "infrastructure"
                : "custom",
          active: true,
          created_at: D.ago(400 * D.DAY),
        })),
      });
    }
    return null;
  },
  "tenant-role-management": (body, { persona }) => {
    if (!persona.isTenantAdmin) return fail("forbidden", 403);
    if (body.type === "listRoles")
      return ok({ roles: A.roles(), roleAssignments: A.roleAssignments() });
    if (body.type === "listPermissions")
      return ok({ permissions: A.PERMISSIONS });
    return null;
  },
  "sla-management": (body) => {
    if (body.type === "listRules") {
      return ok({
        truncated: false,
        statuses: D.STATUSES.map((status) => ({
          id: status.id,
          key: status.key,
          label: status.label,
          isClosed: status.is_closed,
          pausesSla: status.key.startsWith("waiting") && !status.is_closed,
        })),
        rules: [
          ...D.SLA_POLICIES.map((policy, index) => ({
            id: policy.id,
            name: `${policy.name} – alle Abteilungen`,
            description:
              index === 2
                ? "Kritische Störungen werden rund um die Uhr bearbeitet."
                : "Gilt während der Bürozeiten.",
            serviceHours:
              policy.priority === "critical"
                ? {
                    mode: "always",
                    weekdays: [1, 2, 3, 4, 5, 6, 7],
                    start: "00:00",
                    end: "23:59",
                  }
                : {
                    mode: "business",
                    weekdays: [1, 2, 3, 4, 5],
                    start: "07:30",
                    end: "17:30",
                  },
            priorityKey: policy.priority,
            departmentId: null,
            responseMinutes: policy.firstResponseMinutes,
            resolutionMinutes: policy.resolutionMinutes,
            active: true,
            createdAt: D.ago(180 * D.DAY),
            updatedAt: D.ago((10 + index) * D.DAY),
          })),
          {
            id: D.uid("bbbbbbbb", 9),
            name: "Facility Hoch – erweiterte Zeiten",
            description: "Haustechnik mit Pikettdienst am Samstag.",
            serviceHours: {
              mode: "extended",
              weekdays: [1, 2, 3, 4, 5, 6],
              start: "06:00",
              end: "20:00",
            },
            priorityKey: "high",
            departmentId: D.DEP.facility.id,
            responseMinutes: 30,
            resolutionMinutes: 240,
            active: true,
            createdAt: D.ago(90 * D.DAY),
            updatedAt: D.ago(5 * D.DAY),
          },
        ],
      });
    }
    if (body.type === "listEscalations") {
      const t9 = D.TICKETS[8];
      const t5 = D.TICKETS[4];
      return ok({
        truncated: false,
        escalations: [
          {
            id: D.uid("21212121", 1),
            ticketId: t9.id,
            level: 2,
            kind: "sla",
            reason: "Lösungsfrist überschritten",
            openedBy: null,
            resolvedBy: null,
            openedAt: D.ago(20 * D.MIN),
            resolvedAt: null,
            ticket: {
              id: t9.id,
              departmentId: t9.department_id,
              ticketNumber: t9.ticket_number,
              subject: t9.subject,
            },
            slaEvents: [
              {
                id: D.uid("22222223", 1),
                eventType: "resolution_breached",
                occurredAt: D.ago(20 * D.MIN),
                metadata: {},
              },
            ],
          },
          {
            id: D.uid("21212121", 2),
            ticketId: t5.id,
            level: 1,
            kind: "sla",
            reason: "Lösungsfrist läuft in weniger als 60 Minuten ab",
            openedBy: null,
            resolvedBy: null,
            openedAt: D.ago(15 * D.MIN),
            resolvedAt: null,
            ticket: {
              id: t5.id,
              departmentId: t5.department_id,
              ticketNumber: t5.ticket_number,
              subject: t5.subject,
            },
            slaEvents: [
              {
                id: D.uid("22222223", 2),
                eventType: "resolution_warning",
                occurredAt: D.ago(15 * D.MIN),
                metadata: {},
              },
            ],
          },
        ],
      });
    }
    return null;
  },
  "external-status": () => {
    const source = (key, label, description, extra = {}) => ({
      key,
      label,
      description,
      statusUrl: "https://example.com",
      requiresEntra: false,
      enabled: true,
      lastCheckedAt: D.ago(3 * D.MIN),
      lastError: null,
      activeIncidents: 0,
      ...extra,
    });
    return ok({
      sources: [
        source(
          "microsoft365",
          "Microsoft 365",
          "Alle Dienste Ihres Mandanten: Teams, Outlook/Exchange, OneDrive, SharePoint und weitere.",
          { requiresEntra: true, activeIncidents: 1 },
        ),
        source("github", "GitHub", "Offizielle Statusseite von GitHub."),
        source(
          "claude",
          "Claude",
          "Offizielle Statusseite von Claude.ai und der Claude-API.",
        ),
        source(
          "gemini",
          "Google Gemini",
          "Gemini in Google Workspace und die Gemini-API.",
        ),
        source(
          "apple_app_store",
          "Apple App Store",
          "App Store und Mac App Store (Apple Systemstatus).",
        ),
        source(
          "google_play",
          "Google Play Store",
          "Offizielles Status-Dashboard von Google Play.",
          { enabled: false, lastCheckedAt: null },
        ),
        source(
          "init7",
          "Init7",
          "Aktuelle Störungen im Netz von Init7 (ohne geplante Wartungen).",
        ),
      ],
    });
  },
  "monitoring-integrations": (body) => {
    if (body.type !== "get") return null;
    return ok({
      config: {
        configured: true,
        enabled: true,
        departmentId: D.DEP.ict.id,
        teamId: D.TEAMS[1].id,
        createOn: "down",
        autoResolve: true,
        setServiceStatus: true,
        priorityKey: "high",
        realertMinutes: 15,
        groupDependencies: true,
        suppressInMaintenance: true,
        hasToken: true,
        tokenRotatedAt: D.ago(45 * D.DAY),
        lastReceivedAt: D.ago(2 * D.HOUR + 10 * D.MIN),
      },
      ...monitoringOptions(),
      alerts: [
        {
          id: D.uid("27272727", 1),
          deviceName: "SRV-FS01",
          sensorName: "Freier Speicher C:",
          ticketNumber: "T-01039",
          state: "resolved",
          lastStatus: "Up",
          lastMessage: "OK",
          eventCount: 3,
          openedAt: D.ago(2 * D.DAY),
          resolvedAt: D.ago(2 * D.DAY - 2 * D.HOUR),
        },
        {
          id: D.uid("27272727", 2),
          deviceName: "USV Serverraum",
          sensorName: "Temperatur",
          ticketNumber: D.TICKETS[8].ticket_number,
          state: "open",
          lastStatus: "Down",
          lastMessage: "28 °C (Grenzwert 26 °C)",
          eventCount: 5,
          openedAt: D.ago(2 * D.HOUR + 10 * D.MIN),
          resolvedAt: null,
        },
      ],
    });
  },
  "expiry-monitoring": (body) => {
    if (body.type !== "get") return null;
    const target = (n, kind, host, label, status, days, issuer) => ({
      id: D.uid("28282828", n),
      kind,
      host,
      port: kind === "certificate" ? 443 : null,
      label,
      departmentId: D.DEP.ict.id,
      assetId: null,
      assetName: null,
      serviceId: null,
      serviceName: null,
      warnDays: 30,
      active: true,
      status,
      expiresAt: D.inFuture(days * D.DAY),
      issuer,
      san: kind === "certificate" ? [host] : [],
      registrar: kind === "domain" ? "SWITCH" : null,
      checkMethod: kind === "certificate" ? "tls" : "rdap",
      lastError: null,
      lastCheckedAt: D.ago(5 * D.HOUR),
    });
    return ok({
      settings: {
        configured: true,
        enabled: true,
        departmentId: D.DEP.ict.id,
        priorityKey: "medium",
        reminderPriorityKey: "high",
        warnDays: 30,
        reminderDays: 7,
        autoResolve: true,
        lastRunAt: D.ago(5 * D.HOUR),
      },
      targets: [
        target(
          1,
          "certificate",
          "vpn.muster.ch",
          "VPN-Portal",
          "valid",
          142,
          "DigiCert Global G2",
        ),
        target(
          2,
          "certificate",
          "intranet.muster.ch",
          "Intranet",
          "expiring",
          18,
          "Let's Encrypt R11",
        ),
        target(3, "domain", "muster.ch", "Hauptdomain", "valid", 290, null),
      ],
      ...monitoringOptions(),
    });
  },
  "backup-monitoring": (body) => {
    if (body.type !== "get") return null;
    const job = (n, name, result, hoursAgo, message) => ({
      id: D.uid("29292929", n),
      name,
      lastSource: "email",
      expectedIntervalHours: 24,
      graceHours: 4,
      departmentId: D.DEP.ict.id,
      assetId: null,
      serviceId: null,
      active: true,
      lastResult: result,
      lastReportAt: D.ago(hoursAgo * D.HOUR),
      lastSuccessAt:
        result === "success"
          ? D.ago(hoursAgo * D.HOUR)
          : D.ago((hoursAgo + 24) * D.HOUR),
      lastMessage: message,
      reportCount: 120 + n,
      missingAlertedAt: null,
      ticketNumber: result === "warning" ? "T-01038" : null,
      ticketReason: result === "warning" ? "warning" : null,
    });
    return ok({
      settings: {
        configured: true,
        enabled: true,
        departmentId: D.DEP.ict.id,
        priorityKey: "high",
        warningAction: "ticket",
        autoResolve: true,
        defaultIntervalHours: 24,
        defaultGraceHours: 4,
        senderPatterns: ["backup@muster.ch"],
        subjectPatterns: ["[Veeam]"],
        hasToken: true,
        tokenRotatedAt: D.ago(60 * D.DAY),
        lastReceivedAt: D.ago(6 * D.HOUR),
      },
      jobs: [
        job(
          1,
          "Veeam – Fileserver täglich",
          "success",
          6,
          "Erfolgreich, 412 GB",
        ),
        job(2, "Veeam – SQL-Server", "warning", 7, "1 VM mit Warnung"),
        job(3, "Microsoft 365 Backup", "success", 5, "Erfolgreich"),
      ],
      ...monitoringOptions(),
    });
  },
  "exchange-mail-admin": (body) => {
    if (body.action !== "getStatus") return null;
    const entraTenantId = "7d3c1f52-4a8e-4c51-9a0e-2f6b1d9c8e41";
    const connectionId = D.uid("30303030", 1);
    const channel = (n, mailbox, dep, status, inboundAgo) => ({
      id: D.uid("31313131", n),
      connectionId,
      accessMode: "delegated",
      entraTenantId,
      mailboxAddress: mailbox,
      mailboxObjectId: D.uid("32323232", n),
      defaultDepartmentId: dep,
      sendAcknowledgement: true,
      sendAgentReplies: true,
      sendResolution: n === 1,
      status,
      lastVerifiedAt: D.ago(10 * D.DAY),
      lastErrorCode: null,
      lastErrorMessage: null,
      lastInboundAt: inboundAgo ? D.ago(inboundAgo) : null,
      lastOutboundAt: inboundAgo ? D.ago(inboundAgo / 2) : null,
      activatedAt: status === "active" ? D.ago(60 * D.DAY) : null,
    });
    return ok({
      platformConfigured: true,
      featureEnabled: true,
      callbackUrl:
        "https://demo.supabase.test/functions/v1/exchange-mail-webhook",
      connections: [
        {
          id: connectionId,
          entraTenantId,
          connectorPrincipal: "nextdesk-mail@muster.ch",
          status: "connected",
          lastConnectedAt: D.ago(60 * D.DAY),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      ],
      channels: [
        channel(1, "servicedesk@muster.ch", D.DEP.ict.id, "active", 25 * D.MIN),
        channel(
          2,
          "facility@muster.ch",
          D.DEP.facility.id,
          "active",
          3 * D.HOUR,
        ),
        channel(3, "hr-support@muster.ch", D.DEP.hr.id, "verified", null),
      ],
      departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
      stats: { inbound24h: 23, outbound24h: 41, failed24h: 0 },
    });
  },
  incidents: (body) => {
    const agent = D.AGENTS[1] ?? D.AGENTS[0];
    const services = [
      {
        id: D.uid("29292929", 90),
        name: "Dateiablage",
        status: "partial_outage",
      },
    ];
    const summary = (n, extra) => ({
      id: D.uid("29292929", n),
      number: `STO-2026-00${40 + n}`,
      assetId: null,
      parentId: null,
      maintenance: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
      assignedAgentId: null,
      assignedAgentName: null,
      resolvedAt: null,
      closedAt: null,
      cause: null,
      durationMinutes: 0,
      services: [],
      location: "Serverraum UG · Rack A",
      realertCount: 0,
      children: [],
      ...extra,
    });
    const root = summary(1, {
      title: "SW-CORE-01 – Ping",
      deviceName: "SW-CORE-01",
      severity: "down",
      state: "active",
      openedAt: D.ago(14 * D.MIN),
      services,
      children: [
        summary(2, {
          title: "SRV-FS01 – Ping",
          deviceName: "SRV-FS01",
          severity: "down",
          state: "active",
          parentId: D.uid("29292929", 1),
          openedAt: D.ago(13 * D.MIN),
        }),
        summary(3, {
          title: "AP-OG1-02 – Ping",
          deviceName: "AP-OG1-02",
          severity: "down",
          state: "active",
          parentId: D.uid("29292929", 1),
          openedAt: D.ago(13 * D.MIN),
        }),
      ],
    });
    const warning = summary(4, {
      title: "USV Serverraum – Temperatur",
      deviceName: "USV Serverraum",
      severity: "warning",
      state: "active",
      acknowledgedAt: D.ago(40 * D.MIN),
      acknowledgedBy: agent.name,
      assignedAgentId: agent.id,
      assignedAgentName: agent.name,
      openedAt: D.ago(2 * D.HOUR + 10 * D.MIN),
    });
    const resolved = summary(5, {
      title: "FW-01 – HTTPS",
      deviceName: "FW-01",
      severity: "down",
      state: "resolved",
      acknowledgedAt: D.ago(26 * D.HOUR),
      acknowledgedBy: agent.name,
      assignedAgentId: agent.id,
      assignedAgentName: agent.name,
      openedAt: D.ago(26 * D.HOUR),
      resolvedAt: D.ago(25 * D.HOUR + 20 * D.MIN),
      durationMinutes: 40,
    });
    const stats = {
      active: 2,
      activeDown: 1,
      activeWarning: 1,
      unacknowledged: 1,
      oldestUnacknowledgedAt: D.ago(14 * D.MIN),
      affectedServices: ["Dateiablage"],
      medianResolveMinutes: 38,
      availability: 0.9981,
      monitoredDevices: 42,
    };
    if (body.type === "list") {
      const incidents =
        body.filter === "closed" ||
        body.filter === "recent" ||
        body.filter === "resolved"
          ? [resolved]
          : body.filter === "unacknowledged" || body.filter === "services"
            ? [root]
            : body.filter === "all"
              ? [root, warning, resolved]
              : [root, warning];
      return ok({ incidents, stats, nextCursor: null });
    }
    if (body.type === "report") {
      return ok({
        days: body.days ?? 30,
        total: 17,
        medianResolveMinutes: 38,
        availability: 0.9981,
        causes: [
          { cause: "network", label: "Netzwerk", count: 6 },
          { cause: "power", label: "Strom", count: 4 },
          { cause: "hardware", label: "Hardware", count: 3 },
          {
            cause: "external",
            label: "Extern (Provider, Lieferant)",
            count: 2,
          },
          { cause: "unknown", label: "Unbekannt", count: 2 },
        ],
        devices: [
          { name: "SW-CORE-01", count: 4, minutes: 95 },
          { name: "USV Serverraum", count: 3, minutes: 410 },
          { name: "FW-01", count: 2, minutes: 52 },
        ],
      });
    }
    if (body.type !== "get") return null;
    const at = (minutes) => D.ago(minutes * D.MIN);
    return ok({
      ...root,
      closedBy: null,
      closingNote: null,
      parent: null,
      sensors: [
        {
          name: "Ping",
          status: "Fehler",
          state: "open",
          lastEventAt: at(14),
          message: "Zeitüberschreitung (100 % Paketverlust)",
        },
        {
          name: "SNMP Uptime",
          status: "Fehler",
          state: "open",
          lastEventAt: at(12),
          message: "Keine Antwort",
        },
        {
          name: "Port 24 (Uplink)",
          status: "OK",
          state: "resolved",
          lastEventAt: at(30),
          message: "1 Gbit/s",
        },
      ],
      events: [
        {
          id: "e1",
          kind: "prtg",
          status: "Fehler",
          sensor: "Ping",
          message: "Zeitüberschreitung (100 % Paketverlust)",
          actor: null,
          at: at(14),
        },
        {
          id: "e2",
          kind: "opened",
          status: null,
          sensor: null,
          message:
            "Störung geöffnet, Team ICT Infrastruktur alarmiert (Push und Mail).",
          actor: null,
          at: at(14),
        },
        {
          id: "e3",
          kind: "child",
          status: null,
          sensor: null,
          message: "SRV-FS01 und AP-OG1-02 als Folgestörungen angehängt.",
          actor: null,
          at: at(13),
        },
        {
          id: "e4",
          kind: "prtg",
          status: "Fehler",
          sensor: "SNMP Uptime",
          message: "Keine Antwort",
          actor: null,
          at: at(12),
        },
        {
          id: "e5",
          kind: "realert",
          status: null,
          sensor: null,
          message: "Noch unbestätigt: erneut alarmiert.",
          actor: null,
          at: at(0),
        },
      ],
      device: {
        name: "SW-CORE-01",
        category: "Switch",
        manufacturer: "HPE Aruba",
        model: "6300M",
        hostname: "sw-core-01.muster.local",
        ipAddress: "10.10.0.2",
        prtgObjectId: "2041",
        location: "Serverraum UG · Rack A · HE 40",
      },
      dependencies: {
        upstream: [{ assetId: "fw", name: "FW-01", failing: false }],
      },
      history: {
        segments: [
          { start: at(9 * 60), end: at(9 * 60 - 6), severity: "down" },
          { start: at(14), end: at(0), severity: "down" },
        ],
        weekCount: 3,
      },
      tickets: [
        {
          id: D.uid("29292929", 61),
          number: "ICT-2026-000318",
          subject: "Kein Zugriff auf Laufwerk S:",
          status: "Offen",
          closed: false,
          source: "service",
          linkedAt: at(10),
          notifiedAt: null,
        },
        {
          id: D.uid("29292929", 62),
          number: "ICT-2026-000319",
          subject: "WLAN im 1. OG weg (AP-OG1-02)",
          status: "Offen",
          closed: false,
          source: "text",
          linkedAt: at(8),
          notifiedAt: null,
        },
      ],
      hiddenTickets: 0,
      problems: [],
      recurrence: { sameDevice30d: 4, sameCause30d: 0, suggestCase: true },
      permissions: { openCase: true, draftArticle: true },
      network: {
        addresses: [
          {
            address: "10.10.0.2",
            hostname: "sw-core-01",
            prefix: "10.10.0.0/24",
            gateway: "10.10.0.1",
            vlanNumber: 10,
            vlanName: "Management",
            site: "Hauptgebäude",
            switchName: "FW-01",
            switchPort: "port3",
            portSource: "lldp",
          },
        ],
        subnetNeighbours: [
          {
            assetId: D.uid("29292929", 71),
            name: "SRV-FS01",
            address: "10.10.0.21",
            state: "down",
            incidentId: D.uid("29292929", 2),
          },
          {
            assetId: D.uid("29292929", 72),
            name: "USV Serverraum",
            address: "10.10.0.30",
            state: "warning",
            incidentId: D.uid("29292929", 4),
          },
          {
            assetId: D.uid("29292929", 73),
            name: "SRV-APP01",
            address: "10.10.0.22",
            state: "ok",
            incidentId: null,
          },
        ],
        switchNeighbours: [],
      },
      agents: D.AGENTS.map((entry) => ({ id: entry.id, name: entry.name })),
    });
  },
  "security-cases": (body) => {
    const cases = [
      {
        ticketId: "sec-41",
        ticketNumber: "ICT-2026-000041",
        subject: "Voicemail (24 Sekunden)",
        from: "noreply@vm-telefon-service.com",
        state: "triage",
        verdict: null,
        riskScore: 82,
        riskLevel: "high",
        reports: 7,
        reporters: 7,
        firstReportedAt: D.ago(26 * 60 * 1000),
        decisionDueAt: D.ago(-4 * 60 * 1000),
        overdue: false,
        teamName: "System Engineering",
      },
      {
        ticketId: "sec-40",
        ticketNumber: "ICT-2026-000040",
        subject: "Ihre Lieferung konnte nicht zugestellt werden",
        from: "info@paket-zustellung24.net",
        state: "triage",
        verdict: null,
        riskScore: 54,
        riskLevel: "medium",
        reports: 1,
        reporters: 1,
        firstReportedAt: D.ago(65 * 60 * 1000),
        decisionDueAt: D.ago(-175 * 60 * 1000),
        overdue: false,
        teamName: "System Engineering",
      },
      {
        ticketId: "sec-39",
        ticketNumber: "ICT-2026-000039",
        subject: "HIN Domain encryption: Neue Nachricht",
        from: "noreply@hin.ch",
        state: "triage",
        verdict: null,
        riskScore: 12,
        riskLevel: "low",
        reports: 1,
        reporters: 1,
        firstReportedAt: D.ago(3 * 60 * 60 * 1000),
        decisionDueAt: D.ago(-21 * 60 * 60 * 1000),
        overdue: false,
        teamName: "System Engineering",
      },
    ];
    if (body.type === "list") {
      return ok({
        cases: body.state === "triage" || body.state === "all" ? cases : [],
        stats: {
          triage: 3,
          triageHigh: 1,
          overdue: 0,
          actions: 2,
          reportsToday: 14,
          reportersToday: 11,
          medianVerdictMinutes: 18,
          clickAnswers: 21,
          clickYes: 1,
        },
      });
    }
    if (body.type === "getTemplates") {
      return ok({
        custom: false,
        templates: {
          harmless: [],
          spam: ["Absender in Microsoft Defender als Spam sperren"],
          phishing: [
            "Absender und Domain in Microsoft Defender sperren",
            "Link-Domains blockieren",
            "Mail aus allen Postfächern entfernen (Defender → Bedrohungs-Explorer)",
            "Melder fragen: geklickt oder Daten eingegeben?",
            "Falls ja: Passwort zurücksetzen und Anmeldungen prüfen",
          ],
          targeted: [
            "Absender und Domain in Microsoft Defender sperren",
            "Link-Domains blockieren",
            "Mail aus allen Postfächern entfernen (Defender → Bedrohungs-Explorer)",
            "Melder fragen: geklickt oder Daten eingegeben?",
            "Geschäftsleitung informieren",
          ],
        },
      });
    }
    if (body.type === "get") {
      return ok({
        ticketId: "sec-41",
        ticketNumber: "ICT-2026-000041",
        subject: "Phishing-Meldung: Voicemail (24 Sekunden)",
        description:
          "Verdächtige E-Mail gemeldet von Lena Brunner.\n\nInhalt der gemeldeten E-Mail (Links entschärft):\n\nSie haben eine neue Sprachnachricht (24 Sekunden).\n\nNachricht anhören: hxxps://microsoftonline-login[.]co/voicemail?id=8812\n\nIhr Telefonie-Service",
        teamName: "System Engineering",
        assignedAgentId: null,
        assignedAgentName: null,
        createdAt: D.ago(26 * 60 * 1000),
        state: "triage",
        verdict: null,
        verdictBy: null,
        verdictAt: null,
        decisionDueAt: D.ago(-4 * 60 * 1000),
        reportersNotifiedAt: null,
        closedAt: null,
        analysis: {
          score: 82,
          level: "high",
          from: "noreply@vm-telefon-service.com",
          fromName: "Voicemail Service",
          replyTo: "support@vm-telefon-service.top",
          returnPath: "bounce@mail-relay-77.net",
          subject: "Voicemail (24 Sekunden)",
          date: "Mo, 9 Nov 2026 14:05:12 +0100",
          sendingIp: "185.220.101.44",
          auth: { spf: "softfail", dkim: "none", dmarc: "fail" },
          findings: [
            {
              severity: "high",
              message:
                "Link-Text nennt Microsoft, das Ziel ist microsoftonline-login.co (nachgeahmte Domain).",
            },
            {
              severity: "high",
              message:
                "Anhang ist eine HTML-Datei, typisch für gefälschte Anmeldeseiten.",
            },
            {
              severity: "medium",
              message:
                "DMARC fehlgeschlagen, Antwort-Adresse weicht vom Absender ab.",
            },
            {
              severity: "low",
              message: "Keine Makros und keine ausführbaren Dateien.",
            },
          ],
          links: [
            {
              href: "hxxps://microsoftonline-login[.]co/voicemail?id=8812",
              text: "Nachricht anhören",
              host: "microsoftonline-login[.]co",
            },
          ],
          attachments: [
            {
              filename: "Voicemail_0924.htm",
              contentType: "text/html",
              size: 3174,
            },
          ],
        },
        reporters: [
          {
            name: "Lena Brunner",
            email: "lena.brunner@muster.ch",
            channel: "email",
            reportedAt: D.ago(26 * 60 * 1000),
            asked: false,
            answer: null,
          },
          {
            name: "Jonas Meier",
            email: "jonas.meier@muster.ch",
            channel: "email",
            reportedAt: D.ago(24 * 60 * 1000),
            asked: false,
            answer: null,
          },
          {
            name: "Sara Keller",
            email: "sara.keller@muster.ch",
            channel: "mobile",
            reportedAt: D.ago(21 * 60 * 1000),
            asked: false,
            answer: null,
          },
          {
            name: "Marco Rossi",
            email: "marco.rossi@muster.ch",
            channel: "portal",
            reportedAt: D.ago(18 * 60 * 1000),
            asked: false,
            answer: null,
          },
        ],
        actions: [],
      });
    }
    return null;
  },
  "phishing-reports": (body) => {
    if (body.type !== "getSettings") return null;
    return ok({
      settings: {
        enabled: true,
        reportAddress: "phishing@muster.ch",
        departmentId: D.DEP.ict.id,
        categoryId: D.CATEGORIES[2].id,
        priorityKey: "high",
        notifyTeamId: D.TEAMS[1].id,
      },
      options: {
        departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
        categories: D.CATEGORIES.map((c) => ({
          id: c.id,
          name: c.label,
          departmentId: D.DEP[c.departmentKey].id,
        })),
        teams: D.TEAMS.map((t) => ({ id: t.id, name: t.name })),
      },
    });
  },
  // Teams und Hinweise sind in den Demo-Daten ausgeschaltet.
  "teams-admin": (body, { persona }) => {
    if (body.type === "getContext") {
      return ok({
        canManage: persona.canWorkTickets,
        configured: true,
        today: "2026-11-12",
        syncedAt: "2026-11-12T09:15:00.000Z",
      });
    }
    if (body.type === "list") {
      const team = (n, name, extra = {}) => ({
        teamId: `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
        name,
        description: null,
        visibility: "private",
        archived: false,
        webUrl: "https://teams.microsoft.com/",
        owners: ["Daniel Frei"],
        ownerCount: 1,
        source: "existing",
        requestId: null,
        requestStatus: null,
        startDate: null,
        endDate: null,
        daysLeft: null,
        createdAt: "2025-09-03T08:00:00Z",
        memberCount: 12,
        guestCount: 0,
        ...extra,
      });
      return ok({
        syncedAt: "2026-11-12T09:15:00.000Z",
        teams: [
          team(1, "Projekt Neubau Schulhaus", {
            description: "Planung, Bauleitung und Bauherrschaft",
            source: "order",
            requestStatus: "ready",
            startDate: "2026-11-12",
            endDate: "2027-11-30",
            daysLeft: 383,
            createdAt: "2026-11-12T08:00:00Z",
            memberCount: 9,
            guestCount: 1,
            owners: ["Daniel Frei", "Mara Keller"],
            ownerCount: 2,
          }),
          team(2, "Marketing Kampagne Q1", {
            source: "order",
            requestStatus: "ready",
            startDate: "2026-02-02",
            endDate: "2026-11-19",
            daysLeft: 7,
            owners: ["Lena Brunner"],
            memberCount: 12,
          }),
          team(3, "Klasse Kuhles", {
            description: "Schulklasse, Schuljahr 26/27",
            memberCount: 24,
          }),
          team(4, "Pilot Lernplattform", {
            visibility: "public",
            owners: [],
            ownerCount: 0,
            memberCount: 4,
          }),
          team(5, "Projekt Altbau 2025", {
            archived: true,
            source: "order",
            requestStatus: "archived",
            memberCount: 7,
          }),
        ],
      });
    }
    if (body.type === "members") {
      return ok({
        members: [
          {
            membershipId: "m1",
            userId: null,
            displayName: "Daniel Frei",
            email: "daniel.frei@muster.ch",
            isOwner: true,
            isGuest: false,
          },
          {
            membershipId: "m2",
            userId: null,
            displayName: "Mara Keller",
            email: "mara.keller@muster.ch",
            isOwner: true,
            isGuest: false,
          },
          {
            membershipId: "m3",
            userId: null,
            displayName: "Lena Brunner",
            email: "lena.brunner@muster.ch",
            isOwner: false,
            isGuest: false,
          },
        ],
      });
    }
    if (body.type === "history") return ok({ events: [] });
    return null;
  },
  "teams-provisioning": () => fail("feature_disabled", 403),
  "teams-settings": () => fail("feature_disabled", 403),
  "requester-notices": (body) =>
    body.type === "active"
      ? ok({ notices: [] })
      : fail("feature_disabled", 403),
  "tenant-feature-flags": () =>
    ok({
      features: ALL_FEATURES.map((key) => ({
        key,
        enabled: ENABLED_FEATURES.has(key),
        tenantEnabled: ENABLED_FEATURES.has(key),
        defaultEnabled: false,
        pilotEndsAt: null,
      })),
    }),
  "ticket-agent-assignment": (body, { persona }) => {
    if (body.type === "listForTenant") {
      const names = Object.fromEntries(
        D.AGENTS.map((agent) => [agent.id, agent.name]),
      );
      return ok({
        agents: body.includeAgents ? agentDirectory() : [],
        departments: departmentOptions(),
        assignedAgentNames: names,
      });
    }
    if (body.type === "listTeams") return ok({ teams: D.TEAMS });
    if (body.type === "listForDepartment") {
      if (!persona.canWorkTickets) return fail("forbidden", 403);
      const department = D.DEPARTMENTS.find((d) => d.id === body.departmentId);
      return ok({
        agents: D.AGENTS.filter(
          (a) => !department || a.departmentKey === department.key,
        ).map((a) => ({ id: a.id, displayName: a.name })),
      });
    }
    if (body.type === "list") {
      return ok({
        agents: D.AGENTS.filter((a) => a.departmentKey === "ict").map((a) => ({
          id: a.id,
          displayName: a.name,
        })),
      });
    }
    return null;
  },
  "notification-center": (body, { persona }) => {
    if (body.type !== "list") return ok({});
    const mine = visibleTickets(persona).filter(
      (t) =>
        t.requester_id === persona.id || t.assigned_agent_id === persona.id,
    );
    const notifications = mine.slice(0, 3).map((ticket, index) => ({
      id: D.uid("cccccccc", index + 1),
      kind: persona.canWorkTickets
        ? index === 0
          ? "ticket.assigned"
          : "ticket.comment_added"
        : "ticket.comment_added",
      createdAt: ticket.updated_at,
      readAt: index === 0 ? null : ticket.updated_at,
      payload: { ticketNumber: ticket.ticket_number },
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
      },
    }));
    return ok({ notifications, unreadCount: 1 });
  },
  "ticket-saved-views": (body) =>
    body.type === "listSavedViews" ? ok({ savedViews: [] }) : null,
  "ticket-bulk-status": (body) =>
    body.type === "listStatusOptions"
      ? ok({
          statuses: D.STATUSES.map((s) => ({
            key: s.key,
            label: s.label,
            isClosed: s.is_closed,
          })),
        })
      : null,
  "ticket-support-levels": (body) => {
    if (body.type === "queueLevels") return ok({ levels: [] });
    if (body.type === "getTicket")
      return ok({
        levelsConfigured: true,
        currentLevel: 1,
        currentTeam: { id: "team-servicedesk", name: "ICT Servicedesk" },
        ticketClosed: false,
        canHandover: true,
        targets: {
          next: {
            level: 2,
            teams: [{ id: "team-system", name: "System Engineering" }],
          },
          back: [],
        },
        currentHandover: null,
        history: [
          {
            id: "level-1",
            kind: "initial",
            fromLevel: null,
            toLevel: 1,
            teamName: "ICT Servicedesk",
            note: null,
            actorName: "Mara Keller",
            createdAt: "2026-11-09T07:50:00Z",
          },
        ],
      });
    return null;
  },
  "ticket-operations": (body, { persona }) => {
    if (body.type === "incidentOverview")
      return ok({ windowHours: 24, incidents: [] });
    if (body.type === "detectIncident") return hidden();
    if (body.type === "getTicket") {
      const ticket = visibleTickets(persona).find(
        (t) => t.id === body.ticketId,
      );
      return ok(ticket ? ticketDetail(ticket, persona) : { ticket: null });
    }
    return null;
  },
  "my-priorities": (body, { persona }) => {
    const tickets = visibleTickets(persona)
      .filter((t) => t.assigned_agent_id === persona.id && !t.status_is_closed)
      .sort(
        (a, b) =>
          a.priority_sort_order - b.priority_sort_order ||
          String(a.resolution_due_at).localeCompare(
            String(b.resolution_due_at),
          ),
      );
    const reasons = [
      "SLA läuft in Kürze ab, hohe Priorität",
      "Antragstellende arbeitet ohne Gerät",
      "Wartet auf Rückmeldung, Frist morgen",
    ];
    return ok({
      rankedAt: D.ago(20 * D.MIN),
      source: "ai",
      hasManualOrder: false,
      tickets: tickets.map((ticket, index) => ({
        position: index + 1,
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        statusLabel: ticket.status_label,
        priorityLabel: ticket.priority_label,
        resolutionDueAt: ticket.resolution_due_at,
        reason: reasons[index] ?? null,
        aiRank: index + 1,
        manual: false,
      })),
    });
  },
  // Satisfaction rating: the requester may rate resolved or closed tickets.
  "ticket-feedback": (body, { persona }) => {
    const ticket = D.TICKETS.find((entry) => entry.id === body.ticketId);
    if (!ticket) return fail("ticket_access_denied", 403);
    const isRatable =
      ticket.status_is_closed || ticket.status_key === "resolved";
    if (body.type === "submit") {
      return ok({
        satisfaction: { score: body.score, comment: body.comment ?? null },
      });
    }
    return ok({
      satisfaction: null,
      canRate: isRatable && ticket.requester_id === persona.id,
      ticket: {
        status: {
          key: ticket.status_key,
          label: ticket.status_key,
          isClosed: ticket.status_is_closed,
          isRatable,
        },
      },
    });
  },
  "ticket-actions": (body, { persona }) => {
    if (body.type === "getFormOptions") {
      const self = { id: persona.id, displayName: persona.name };
      return ok({
        departments: D.DEPARTMENTS.map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          kind: "internal",
        })),
        priorities: D.PRIORITIES.map((p) => ({
          key: p.key,
          label: p.label,
          sort_order: p.sort_order,
        })),
        currentRequester: self,
        requesterContext: {
          isInternal: true,
          departmentId: D.DEP.ict.id,
          departmentName: "ICT",
        },
      });
    }
    if (body.type === "listAvailableTemplates") return ok({ templates: [] });
    if (body.type === "getCategories") {
      const department = D.DEPARTMENTS.find((d) => d.id === body.departmentId);
      const top = D.CATEGORIES.filter(
        (c) => !department || c.departmentKey === department.key,
      );
      const subs = D.SUBCATEGORIES.filter((sub) =>
        top.some((c) => c.id === sub.parentId),
      );
      return ok({
        categories: [
          ...top.map((c) => ({ id: c.id, name: c.label, parentId: null })),
          ...subs.map((c) => ({
            id: c.id,
            name: c.label,
            parentId: c.parentId,
          })),
        ],
      });
    }
    return null;
  },
  "ticket-requester-context": (body) => {
    if (body.type !== "getProfile") return null;
    const user = D.userById(body.requesterContactId);
    return ok({
      profile: {
        requesterContactId: body.requesterContactId,
        location: "Zürich, Hauptsitz 2. OG",
        department: user?.role === "employee" ? "Finanzen" : "ICT",
        offer: null,
        language: "Deutsch",
        preferredContactChannel: "E-Mail",
        importantNote: null,
      },
    });
  },
  "ticket-coordination": (body, { persona }) => {
    if (body.type === "listVendors") {
      return ok({
        vendors: [
          {
            id: D.uid("13131313", 1),
            name: "Lenovo Premier Support",
            contactEmail: "support@lenovo.example",
            contactPhone: "+41 44 000 00 00",
            reminderAfterHours: 48,
            active: true,
          },
          {
            id: D.uid("13131313", 2),
            name: "Klimatec AG",
            contactEmail: "service@klimatec.example",
            contactPhone: "+41 61 000 00 00",
            reminderAfterHours: 24,
            active: true,
          },
        ],
      });
    }
    if (body.type !== "overview") return null;
    const ticket = visibleTickets(persona).find((t) => t.id === body.ticketId);
    return ticket ? ok(coordinationOverview(ticket)) : hidden();
  },
  "experience-hub": (body) => (body.type === "listFollowUps" ? hidden() : null),
  "asset-registry": (body) => {
    if (body.type === "ticketPersonDevices") return hidden();
    if (body.type === "getIntuneConfiguration") {
      return ok({
        configuration: {
          enabled: true,
          sso_binding_available: true,
          sync_enabled: true,
          last_success_at: D.ago(3 * D.HOUR),
          last_attempt_at: D.ago(3 * D.HOUR),
          last_status: "succeeded",
          last_preflight_at: D.ago(3 * D.DAY),
          last_preflight_result_code: "preflight_ready",
          configuration_generation: 3,
          updated_at: D.ago(20 * D.DAY),
        },
      });
    }
    if (body.type === "getIntuneManualSyncConfiguration") {
      return ok({
        configuration: {
          enabled: true,
          sso_binding_available: true,
          manual_sync_enabled: true,
          configuration_generation: 3,
          manual_sync_generation: 2,
          last_manual_sync_at: D.ago(3 * D.HOUR),
          last_manual_sync_status: "succeeded",
          last_manual_sync_result_code: "provider_sync_succeeded",
        },
      });
    }
    if (body.type === "listIntuneRuns") {
      return ok({
        runs: [
          {
            id: D.uid("25252525", 1),
            trigger_kind: "manual_preflight",
            execution_scope: "local_preflight",
            status: "succeeded",
            result_code: "preflight_ready",
            started_at: D.ago(3 * D.DAY),
            finished_at: D.ago(3 * D.DAY - 2000),
            retry_of_run_id: null,
            root_run_id: D.uid("25252525", 1),
            attempt_no: 1,
            provider_contacted: false,
            devices_seen: 0,
            assets_created: 0,
            assets_updated: 0,
          },
        ],
      });
    }
    if (body.type === "listIntuneManualSyncRuns") {
      const run = (n, mode, offset, created, updated) => ({
        id: D.uid("26262626", n),
        mode,
        status: "succeeded",
        result_code:
          mode === "dry_run"
            ? "provider_dry_run_succeeded"
            : "provider_sync_succeeded",
        started_at: D.ago(offset),
        finished_at: D.ago(offset - 40_000),
        provider_contacted: true,
        devices_seen: 214,
        assets_created: created,
        assets_updated: updated,
        assets_skipped: 3,
        ambiguous_devices: 1,
        retry_of_run_id: null,
        root_run_id: null,
        attempt_no: 1,
      });
      return ok({
        runs: [
          run(1, "synchronize", 3 * D.HOUR, 2, 41),
          run(2, "dry_run", 3 * D.HOUR + 10 * D.MIN, 0, 0),
          run(3, "synchronize", 2 * D.DAY, 5, 18),
        ],
      });
    }
    return null;
  },
  "intune-actions": (body) =>
    body.type === "listTicketDevices" ? hidden() : null,
  "recent-items": (body) =>
    body.type === "record"
      ? ok({})
      : body.type === "list"
        ? ok({ items: [] })
        : null,
  "ticket-custom-fields": (body) =>
    body.type === "listDefinitions" || body.type === "listValues"
      ? { json: { data: [] } }
      : null,
  "ticket-triage": (body) => {
    if (body.type === "get") return ok({ triage: null });
    if (body.type === "getSettings")
      return ok({
        enabled: true,
        applyThreshold: 0.85,
        sentimentEnabled: true,
        autoMergeDuplicates: false,
      });
    return null;
  },
  "ticket-automation": (body) => {
    if (body.type !== "get") return null;
    const policies = [
      ["follow_up", true, 3, false],
      ["auto_close", true, 7, true],
      ["duplicate_warning", true, 2, false],
      ["data_hygiene", false, 5, false],
      ["quality_check", false, 14, false],
      ["compliance_warning", false, 7, false],
      ["operations_report", true, 7, false],
    ].map(([key, enabled, afterDays, requirePreview]) => ({
      key,
      enabled,
      afterDays,
      requirePreview,
      updatedAt: D.ago(8 * D.DAY),
    }));
    return ok({
      policies,
      history: [
        {
          id: D.uid("24242424", 1),
          policyKey: "follow_up",
          mode: "scheduled",
          createdAt: D.ago(6 * D.HOUR),
          requested: 3,
          updated: 3,
        },
        {
          id: D.uid("24242424", 2),
          policyKey: "auto_close",
          mode: "manual",
          createdAt: D.ago(1 * D.DAY),
          requested: 2,
          updated: 2,
        },
      ],
    });
  },
  "sla-breach-reasons": (body) =>
    body.type === "list" ? ok({ breaches: [], canRecord: true }) : null,
  "ticket-presence": (body) => {
    if (body.type === "heartbeat") return ok({});
    if (body.type === "list") return ok({ people: [] });
    return null;
  },
  "knowledge-base": (body, { persona }) => {
    if (body.type === "listArticles") {
      return ok({
        articles: visibleArticles(persona).map((a) => ({
          ...knowledgeArticle(a, persona),
          revision: knowledgeRevision(a),
        })),
        departments: persona.canWorkTickets
          ? D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name }))
          : [],
        imageUrls: {},
      });
    }
    if (body.type === "listCollections") {
      return ok({
        collections: D.KNOWLEDGE_COLLECTIONS.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.name.toLowerCase().replace(/[^a-z]+/g, "-"),
          parent_id: null,
          active: true,
          description: c.description,
        })),
      });
    }
    if (body.type === "getArticle") {
      const article = visibleArticles(persona).find(
        (a) => a.id === body.articleId || a.id === body.id,
      );
      if (!article) return fail("article_not_found", 404);
      return ok({
        article: knowledgeArticle(article, persona),
        revision: knowledgeRevision(article),
        imageUrls: {},
      });
    }
    return null;
  },
  "push-notifications": (body, { persona }) => {
    if (body.type === "getStatus") {
      const categories = persona.canWorkTickets
        ? [
            "assigned",
            "requester_reply",
            "mention",
            "sla",
            "escalation",
            "follow_up",
            "approval",
          ]
        : ["support_reply", "resolved", "approval"];
      return ok({
        applicableCategories: categories,
        apnsConfigured: true,
        contentLevel: "subject",
        devices: [
          {
            id: D.uid("16161616", 1),
            deviceName: `iPhone von ${persona.name.split(" ")[0]}`,
            appVersion: "2.4.0",
            appBuild: "241",
            enabled: true,
            disabledReason: null,
            lastRegisteredAt: D.ago(2 * D.DAY),
            lastSentAt: D.ago(3 * D.HOUR),
          },
        ],
        emailAvailable: true,
        featureEnabled: true,
        preferences: {
          enabledCategories: categories,
          // Some categories also by e-mail.
          emailCategories: categories.filter((category) =>
            ["assigned", "escalation", "approval", "resolved"].includes(
              category,
            ),
          ),
          // Notification time Mo–Fr 06:00–17:00 (quiet 17–06).
          deliveryDays: [1, 2, 3, 4, 5],
          quietHoursEnabled: true,
          quietStart: 17,
          quietEnd: 6,
          timezone: "Europe/Zurich",
        },
        workHours: {
          required: false,
          startHour: 0,
          endHour: 24,
          timezone: "Europe/Zurich",
          localDate: D.dateOnly(0),
          withinWindow: true,
          checkedIn: false,
          checkedInAt: null,
          checkedOutAt: null,
          declinedAt: null,
          active: false,
          promptDue: false,
        },
      });
    }
    if (body.type === "getTenantSettings") {
      return ok({
        apnsConfigured: true,
        contentLevel: "subject",
        featureEnabled: true,
        registeredDevices: 14,
        workHours: {
          checkInRequired: false,
          workStartHour: 7,
          workEndHour: 18,
        },
      });
    }
    return null;
  },
  "global-search": (body, { persona }) => {
    const query = String(body.query ?? "").toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const matches = (text) =>
      tokens.every((token) => text.toLowerCase().includes(token));
    const results = visibleTickets(persona)
      .filter((ticket) =>
        matches(
          `${ticket.ticket_number} ${ticket.subject} ${ticket.description}`,
        ),
      )
      .slice(0, 6)
      .map((ticket) => ({
        resultType: "ticket",
        entityId: ticket.id,
        title: ticket.subject,
        detail: `${ticket.ticket_number} · ${ticket.status_label}`,
        section: "Tickets",
        ticketId: ticket.id,
      }));
    const isAgent = persona.role !== "employee";
    const people = isAgent
      ? [...D.USERS, ...PERSON_DIRECTORY_EXTRA]
          .filter((user) =>
            matches(`${user.name} ${user.email} ${user.jobTitle ?? ""}`),
          )
          .slice(0, 8)
          .map((user) => ({
            kind: "entra",
            id: user.id,
            displayName: user.name,
            email: user.email,
            jobTitle: user.jobTitle ?? null,
            department: user.departmentLabel ?? "Finanzen",
            accountEnabled: user.accountEnabled ?? true,
            openTicketCount: D.TICKETS.filter(
              (ticket) =>
                ticket.requester_id === user.id && !ticket.status_is_closed,
            ).length,
          }))
      : [];
    return ok({ results, people });
  },
  "person-overview": (body) => {
    const id = body.entraObjectId ?? body.requesterContactId ?? body.userId;
    const user =
      D.userById(id) ?? PERSON_DIRECTORY_EXTRA.find((item) => item.id === id);
    if (!user) return fail("person_not_found", 404);
    const own = D.TICKETS.filter((ticket) => ticket.requester_id === user.id);
    const closedHistory = [
      ["Drucker im 2. OG druckt doppelt", "resolved", "Gelöst", 12, "Drucker"],
      [
        "Teams-Kalender nicht synchron",
        "closed",
        "Geschlossen",
        27,
        "Software & Lizenzen",
      ],
      [
        "Neuer Monitor für den Arbeitsplatz",
        "closed",
        "Geschlossen",
        36,
        "Hardware",
      ],
      [
        "Passwort für Abacus zurücksetzen",
        "closed",
        "Geschlossen",
        58,
        "Zugriff & Berechtigungen",
      ],
    ].map(([subject, statusKey, statusLabel, days, categoryName], index) => ({
      id: D.uid("99990000", index + 1),
      ticketNumber: `T-${String(1001 + index).padStart(5, "0")}`,
      subject,
      statusKey,
      statusLabel,
      isClosed: true,
      priorityKey: "medium",
      priorityLabel: "Mittel",
      categoryName,
      assignedAgentName: index % 2 ? "Jonas Weber" : "Mara Keller",
      createdAt: D.ago(days * D.DAY + 3 * D.HOUR),
      updatedAt: D.ago(days * D.DAY),
      closedAt: D.ago(days * D.DAY),
    }));
    const tickets = [
      ...own.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        statusKey: ticket.status_key,
        statusLabel: ticket.status_label,
        isClosed: ticket.status_is_closed,
        priorityKey: ticket.priority_key,
        priorityLabel: ticket.priority_label,
        categoryName:
          D.CATEGORIES.find((category) => category.id === ticket.category_id)
            ?.label ?? null,
        assignedAgentName: D.userById(ticket.assigned_agent_id)?.name ?? null,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        closedAt: ticket.resolved_at,
      })),
      ...closedHistory,
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const openTickets = tickets.filter((ticket) => !ticket.isClosed).length;
    return ok({
      person: {
        entraObjectId: user.id,
        userId: user.id,
        requesterContactId: user.id,
        displayName: user.name,
        email: user.email,
        jobTitle: user.jobTitle ?? null,
        department: user.departmentLabel ?? "Finanzen",
        source: "entra",
        accountEnabled: true,
        removedFromDirectory: false,
        managerName: "Thomas Keller",
        lastSignInAt: D.ago(2 * D.HOUR),
        isMember: true,
      },
      stats: {
        openTickets,
        waitingOnPerson: tickets.filter(
          (ticket) =>
            !ticket.isClosed && ticket.statusKey.startsWith("waiting"),
        ).length,
        ticketsLast12Months: 14,
        ticketsPrevious12Months: 11,
        totalTickets: tickets.length + 12,
        avgResolutionHours: 6.4,
        tenantAvgResolutionHours: 9.1,
      },
      satisfaction: {
        ratingCount: 9,
        minimumRatings: 3,
        average: 4.3,
        positiveShare: 89,
        tenantAverage: 4.1,
        trend: "up",
      },
      topics: [
        { name: "Hardware", count: 5 },
        { name: "Software & Lizenzen", count: 4 },
        { name: "Zugriff & Berechtigungen", count: 3 },
      ],
      tickets,
      devices: [
        {
          id: D.ASSETS[0].id,
          name: "NB-FIN-014",
          assetTag: D.ASSETS[0].asset_tag,
          kind: "laptop",
          manufacturer: "Lenovo",
          model: "ThinkPad T14 Gen 3",
          operatingSystem: "Windows",
          complianceState: "compliant",
          lastSyncAt: D.ago(3 * D.HOUR),
          assignedAt: D.ago(120 * D.DAY),
          source: "intune",
        },
        {
          id: D.uid("12121299", 1),
          name: "iPhone 15",
          assetTag: null,
          kind: "phone",
          manufacturer: "Apple",
          model: "iPhone 15",
          operatingSystem: "iOS",
          complianceState: "compliant",
          lastSyncAt: D.ago(5 * D.HOUR),
          assignedAt: D.ago(200 * D.DAY),
          source: "intune",
        },
      ],
      licenses: [
        {
          id: D.uid("13131313", 1),
          licenseId: D.uid("13131314", 1),
          title: "Microsoft 365 E3",
          vendorName: "Microsoft",
          assignedAt: D.ago(400 * D.DAY),
        },
        {
          id: D.uid("13131313", 2),
          licenseId: D.uid("13131314", 2),
          title: "Abacus Finanzbuchhaltung",
          vendorName: "Abacus",
          assignedAt: D.ago(380 * D.DAY),
        },
      ],
      orders: [],
    });
  },
  "ticket-requesters": (body, { persona }) => {
    if (body.type === "getOwn")
      return ok({ requester: { id: persona.id, displayName: persona.name } });
    if (body.type === "search") {
      const query = String(body.query ?? "").toLowerCase();
      return ok({
        requesters: D.USERS.filter((u) => u.name.toLowerCase().includes(query))
          .slice(0, 8)
          .map((u) => ({ id: u.id, displayName: u.name })),
      });
    }
    return null;
  },
  "knowledge-suggestions": (body) => {
    if (body.type !== "list") return null;
    return ok({
      windowDays: 120,
      refreshedAt: D.ago(5 * D.HOUR),
      ai: { available: true, code: null },
      suggestions: [
        {
          id: D.uid("17171717", 1),
          departmentId: D.DEP.ict.id,
          titleHint: "SAP-Konto nach Fehlanmeldungen entsperren",
          ticketCount: 4,
          status: "open",
          articleId: null,
          sampleTickets: [
            {
              id: D.TICKETS[10].id,
              ticketNumber: D.TICKETS[10].ticket_number,
              subject: D.TICKETS[10].subject,
              solvedAt: D.TICKETS[10].resolved_at,
            },
          ],
        },
      ],
    });
  },
  "ticket-suggestions": (body, { persona }) => {
    if (body.type !== "suggest") return null;
    const stop = new Set([
      "nicht",
      "mehr",
      "seit",
      "ohne",
      "werden",
      "wird",
      "habe",
      "kann",
      "einen",
      "einer",
      "meine",
      "mein",
      "heute",
      "bitte",
      "gestern",
      "abend",
      "morgen",
    ]);
    const words = `${body.subject} ${body.description}`
      .toLowerCase()
      .split(/[^a-zäöü0-9]+/)
      .filter((w) => w.length > 4 && !stop.has(w));
    const score = (text) =>
      words.filter((w) => text.toLowerCase().includes(w)).length;
    const articles = visibleArticles(persona)
      .map((a) => ({ a, s: score(`${a.title} ${a.summary} ${a.body}`) }))
      .filter((x) => x.s >= 2)
      .sort((x, y) => y.s - x.s)
      .slice(0, 2)
      .map(({ a }) => ({
        id: a.id,
        title: a.title,
        excerpt: a.summary,
        visibility: a.n === 6 ? "internal" : "external",
      }));
    const similar = persona.canWorkTickets
      ? D.TICKETS.filter((t) => score(t.subject) >= 2)
          .slice(0, 2)
          .map((t) => ({
            id: t.id,
            ticketNumber: t.ticket_number,
            subject: t.subject,
            statusLabel: t.status_label,
          }))
      : [];
    return ok({
      mode: persona.canWorkTickets ? "agent" : "requester",
      articles,
      duplicates: similar.filter((t) => !D.ticketById(t.id).status_is_closed),
      classification: null,
      solvedTickets: similar.filter((t) => D.ticketById(t.id).status_is_closed),
    });
  },
  "portal-assistant": (body) =>
    body.type === "getSettings" ? ok({ enabled: false }) : null,
  "ticket-attachments": (body) =>
    body.type === "list" ? ok({ attachments: [] }) : null,
  shop: (body, { persona }) => {
    if (body.type === "getContext") {
      return ok({
        canOrder: true,
        canFulfill: persona.canWorkTickets,
        canManage: persona.isTenantAdmin,
        pendingApprovals: 0,
        openOrders: 1,
        newOrders: 0,
        managerName: "Daniel Frei",
        departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
      });
    }
    if (body.type === "listCategories") {
      return ok({
        categories: SHOP_CATEGORIES.map((category) => ({
          ...category,
          itemCount: SHOP_ITEMS.filter(
            (item) => item.category === category.name,
          ).length,
        })),
      });
    }
    if (body.type === "listCatalog") return ok({ items: SHOP_ITEMS });
    if (body.type === "listOrders") {
      return ok({ orders: body.scope === "mine" ? shopOrders(persona) : [] });
    }
    if (body.type === "listRequesters") return ok({ people: [] });
    return null;
  },
  onboarding: (body) =>
    body.type === "navigationSummary" ? ok({ attentionCount: 0 }) : null,
  "event-spaces": (body) =>
    body.type === "navigationSummary" ? fail("feature_disabled", 403) : null,
  "service-assets": (body) => {
    if (body.type === "ownPhoto") return ok({ photoUrl: null });
    if (body.type === "listCatalog") {
      return ok({
        services: [
          {
            id: D.uid("14141414", 1),
            name: "Arbeitsplatz Windows",
            description: "Standard-Arbeitsplatz mit Microsoft 365",
            criticality: "high",
          },
          {
            id: D.uid("14141414", 2),
            name: "VPN-Zugang",
            description: "Remote-Zugriff für Homeoffice",
            criticality: "high",
          },
        ],
        assets: D.ASSETS,
        problems: [],
      });
    }
    return null;
  },
  "service-status": (body) => {
    if (body.type !== "getStatusOverview") return null;
    const services = [
      "Microsoft 365",
      "VPN-Zugang",
      "SAP ERP",
      "Drucker & Scanner",
      "Telefonie",
    ].map((name, index) => ({
      id: D.uid("dddddddd", index + 1),
      name,
      status: "operational",
      statusPublic: true,
      updatedAt: D.ago((index + 1) * D.HOUR),
      categoryPath: [index < 3 ? "Applikationen" : "Arbeitsplatz"],
    }));
    return ok({
      canManage: false,
      canManagePublication: false,
      page: {
        publicEnabled: false,
        publicId: null,
        title: "Systemstatus Muster AG",
        updatedAt: D.ago(3 * D.DAY),
      },
      services,
      events: [],
      maintenances: [],
    });
  },
  "requester-portal": (body, { persona }) => {
    if (body.type === "activeIncidentNotices") return ok({ notices: [] });
    if (body.type === "ticketProgress") {
      const ticket = visibleTickets(persona).find(
        (t) => t.id === body.ticketId,
      );
      if (!ticket) return hidden();
      const order = [
        "received",
        "in_progress",
        "waiting_for_requester",
        "resolved",
      ];
      const current = {
        new: "received",
        in_progress: "in_progress",
        waiting: "waiting_for_requester",
        resolved: "resolved",
        closed: "resolved",
      }[ticket.status_key];
      const currentIndex = order.indexOf(current);
      const steps = order
        .filter(
          (key) =>
            key !== "waiting_for_requester" ||
            current === "waiting_for_requester",
        )
        .map((key) => {
          const index = order.indexOf(key);
          const state =
            index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "upcoming";
          const reachedAt =
            state === "upcoming"
              ? null
              : key === "received"
                ? ticket.created_at
                : key === current
                  ? ticket.updated_at
                  : D.iso(Date.parse(ticket.created_at) - D.NOW + 8 * D.MIN);
          return { key, state, reachedAt };
        });
      return ok({
        progress: {
          currentStep: current,
          steps,
          expected:
            ticket.resolution_due_at && !ticket.status_is_closed
              ? { at: ticket.resolution_due_at, basis: "sla" }
              : null,
          waitingForRequester: current === "waiting_for_requester",
        },
      });
    }
    return null;
  },
  "ticket-approvals": (body) =>
    body.type === "listInbox" ? ok({ approvals: [] }) : null,
  "agent-workbench": (body, { persona }) => {
    if (body.type === "teamQueues") {
      const open = D.TICKETS.filter((t) => !t.status_is_closed);
      const queueOf = (department, team, tickets) => ({
        departmentId: department.id,
        departmentName: department.name,
        teamId: team ? team.id : null,
        teamName: team ? team.name : null,
        openTickets: tickets.length,
        unassignedTickets: tickets.filter((t) => !t.assigned_agent_id).length,
        isMyTeam: Boolean(team && persona.teamId === team.id),
      });
      const teamQueues = D.TEAMS.map((team) =>
        queueOf(
          D.DEPARTMENTS.find((d) => d.id === team.departmentId),
          team,
          open.filter((t) => t.assigned_team_id === team.id),
        ),
      );
      const withoutTeam = D.DEPARTMENTS.map((department) =>
        queueOf(
          department,
          null,
          open.filter(
            (t) => !t.assigned_team_id && t.department_id === department.id,
          ),
        ),
      );
      return ok({
        queues: [...teamQueues, ...withoutTeam].filter(
          (queue) => queue.openTickets > 0,
        ),
      });
    }
    if (body.type === "myMetrics") {
      const mine = D.TICKETS.filter((t) => t.assigned_agent_id === persona.id);
      return ok({
        metrics: {
          open: mine.filter((t) => !t.status_is_closed).length,
          solvedToday: 2,
          dueFollowUps: 1,
          slaDue: 1,
          medianFirstResponseMinutes: 38,
          medianResolutionMinutes: 410,
        },
      });
    }
    return null;
  },
  handbooks: (body, { persona }) => {
    const rank = ROLE_RANK[personaRole(persona)];
    const allowed = HANDBOOKS.filter(
      (handbook) => ROLE_RANK[handbook.minRole] <= rank,
    );
    if (body.type === "list")
      return ok({ handbooks: allowed.map(handbookSummary) });
    if (body.type === "get") {
      const handbook = allowed.find(
        (h) => h.id === body.id || h.id === body.handbookId,
      );
      if (!handbook) return fail("handbook_not_found", 404);
      return ok({
        handbook: {
          ...handbookSummary(handbook),
          markdown: handbookMarkdown(handbook.id),
        },
      });
    }
    return null;
  },
};

function functionResponse(name, body, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return null;
  return handler(body, ctx);
}

module.exports = { functionResponse, ENABLED_FEATURES, HANDBOOKS };
