// Edge function fakes. Each handler receives the JSON body and a context with
// the signed-in persona and returns { json, status }. Shapes follow the
// parsers in apps/web/src and the functions in supabase/functions/<name>.

const fs = require("node:fs");
const path = require("node:path");
const D = require("./demo-data.cjs");
const { visibleTickets } = require("./rest-handlers.cjs");

const REPO_ROOT = path.resolve(__dirname, "../..");
const HANDBOOK_DIR = path.join(REPO_ROOT, "docs/handbooks");

const ok = (data) => ({ json: { data } });
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
];

const HANDBOOKS = [
  { id: "mitarbeitende", title: "Handbuch für Mitarbeitende", description: "Tickets erfassen, Anfragen verfolgen und Antworten in der Wissensdatenbank finden.", audienceLabel: "Mitarbeitende", minRole: "employee" },
  { id: "agenten", title: "Handbuch für Agenten", description: "Tickets bearbeiten, mit Antragstellenden kommunizieren und Wissen teilen.", audienceLabel: "Agenten", minRole: "agent" },
  { id: "administratoren", title: "Handbuch für Administratoren", description: "Personen, Rollen, SLA, Funktionen und Erscheinungsbild des Mandanten verwalten.", audienceLabel: "Administratoren", minRole: "admin" },
  { id: "installation", title: "Installationsanleitung", description: "Microsoft Entra ID, Exchange Online, Intune und Monitoring anbinden.", audienceLabel: "Administratoren", minRole: "admin" },
];
const ROLE_RANK = { employee: 0, agent: 1, admin: 2 };

function handbookSummary(handbook) {
  return { id: handbook.id, title: handbook.title, description: handbook.description, audienceLabel: handbook.audienceLabel, updatedAt: "2026-11-08" };
}

function handbookMarkdown(id) {
  const file = path.join(HANDBOOK_DIR, `${id}.md`);
  if (!fs.existsSync(file)) {
    return `# ${HANDBOOKS.find((h) => h.id === id).title}\n\nDieses Handbuch wird zurzeit überarbeitet.`;
  }
  const text = fs.readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  return text.replace(/\]\(images\/([\w.-]+\.(?:jpg|jpeg|png))\)/g, (match, name) => {
    const image = path.join(HANDBOOK_DIR, "images", name);
    if (!fs.existsSync(image)) return match;
    const mime = name.endsWith(".png") ? "image/png" : "image/jpeg";
    return `](data:${mime};base64,${fs.readFileSync(image).toString("base64")})`;
  });
}

const personaRole = (persona) => (persona.isTenantAdmin ? "admin" : persona.canWorkTickets ? "agent" : "employee");
const agentDirectory = () => D.AGENTS.map((agent) => ({ id: agent.id, displayName: agent.name }));
const departmentOptions = () => D.DEPARTMENTS.map((d) => ({ id: d.id, key: d.key, label: d.name }));

const HANDLERS = {
  "owner-access": () => fail("platform_operator_required", 403),
  "tenant-sso-access": () => ok({ scope: "tenant", tenantId: D.TENANT.id, ssoEnforced: false, tenant: D.TENANT }),
  "tenant-users": (body, { persona }) => {
    if (body.type === "acceptMyInvitations") return ok({ accepted: 0 });
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
  "tenant-feature-flags": () =>
    ok({
      features: ALL_FEATURES.map((key) => ({ key, enabled: ENABLED_FEATURES.has(key), tenantEnabled: ENABLED_FEATURES.has(key), defaultEnabled: false, pilotEndsAt: null })),
    }),
  "ticket-agent-assignment": (body) => {
    if (body.type === "listForTenant") {
      const names = Object.fromEntries(D.AGENTS.map((agent) => [agent.id, agent.name]));
      return ok({ agents: body.includeAgents ? agentDirectory() : [], departments: departmentOptions(), assignedAgentNames: names });
    }
    if (body.type === "listTeams") return ok({ teams: D.TEAMS });
    return null;
  },
  "notification-center": (body, { persona }) => {
    if (body.type !== "list") return ok({});
    const mine = visibleTickets(persona).filter((t) => t.requester_id === persona.id || t.assigned_agent_id === persona.id);
    const notifications = mine.slice(0, 3).map((ticket, index) => ({
      id: D.uid("cccccccc", index + 1),
      kind: persona.canWorkTickets ? (index === 0 ? "ticket.assigned" : "ticket.comment_added") : "ticket.comment_added",
      createdAt: ticket.updated_at,
      readAt: index === 0 ? null : ticket.updated_at,
      payload: { ticketNumber: ticket.ticket_number },
      ticket: { id: ticket.id, ticketNumber: ticket.ticket_number, subject: ticket.subject },
    }));
    return ok({ notifications, unreadCount: 1 });
  },
  "ticket-saved-views": (body) => (body.type === "listSavedViews" ? ok({ savedViews: [] }) : null),
  "ticket-bulk-status": (body) =>
    body.type === "listStatusOptions" ? ok({ statuses: D.STATUSES.map((s) => ({ key: s.key, label: s.label, isClosed: s.is_closed })) }) : null,
  "ticket-support-levels": (body) => (body.type === "queueLevels" ? ok({ levels: [] }) : null),
  "ticket-operations": (body) => (body.type === "incidentOverview" ? ok({ windowHours: 24, incidents: [] }) : null),
  "my-priorities": (body, { persona }) => {
    const tickets = visibleTickets(persona)
      .filter((t) => t.assigned_agent_id === persona.id && !t.status_is_closed)
      .sort((a, b) => a.priority_sort_order - b.priority_sort_order || String(a.resolution_due_at).localeCompare(String(b.resolution_due_at)));
    const reasons = ["SLA läuft in Kürze ab, hohe Priorität", "Antragstellende arbeitet ohne Gerät", "Wartet auf Rückmeldung, Frist morgen"];
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
  shop: (body) => (body.type === "getContext" ? ok({ canFulfill: false, newOrders: 0 }) : null),
  onboarding: (body) => (body.type === "navigationSummary" ? ok({ attentionCount: 0 }) : null),
  "event-spaces": (body) => (body.type === "navigationSummary" ? fail("feature_disabled", 403) : null),
  "service-assets": (body) => (body.type === "ownPhoto" ? ok({ photoUrl: null }) : null),
  "service-status": (body) => {
    if (body.type !== "getStatusOverview") return null;
    const services = ["Microsoft 365", "VPN-Zugang", "SAP ERP", "Drucker & Scanner", "Telefonie"].map((name, index) => ({
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
      page: { publicEnabled: false, publicId: null, title: "Systemstatus Muster AG", updatedAt: D.ago(3 * D.DAY) },
      services,
      events: [],
      maintenances: [],
    });
  },
  "requester-portal": (body) => (body.type === "activeIncidentNotices" ? ok({ notices: [] }) : null),
  "ticket-approvals": (body) => (body.type === "listInbox" ? ok({ approvals: [] }) : null),
  "agent-workbench": (body, { persona }) => {
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
    const allowed = HANDBOOKS.filter((handbook) => ROLE_RANK[handbook.minRole] <= rank);
    if (body.type === "list") return ok({ handbooks: allowed.map(handbookSummary) });
    if (body.type === "get") {
      const handbook = allowed.find((h) => h.id === body.id || h.id === body.handbookId);
      if (!handbook) return fail("handbook_not_found", 404);
      return ok({ handbook: { ...handbookSummary(handbook), markdown: handbookMarkdown(handbook.id) } });
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
