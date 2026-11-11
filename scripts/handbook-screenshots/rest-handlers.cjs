// PostgREST fake: a tiny query engine over in-memory tables plus RPCs.
// Supports the filter operators the web app uses (eq, neq, in, is, gt, gte,
// lt, lte, ilike, or=(...)), order/limit/offset, HEAD/count requests with a
// content-range header and single-object responses (vnd.pgrst.object+json).

const D = require("./demo-data.cjs");

function visibleTickets(persona) {
  if (!persona) return [];
  if (persona.canWorkTickets) return D.TICKETS;
  return D.TICKETS.filter((ticket) => ticket.requester_id === persona.id);
}

function tables(persona) {
  const tenant_id = D.TENANT.id;
  return {
    tenant_memberships: [
      { tenant_id, user_id: persona?.id, status: "active", tenants: D.TENANT },
    ],
    tenants: [D.TENANT],
    user_profiles: D.USERS.map((user) => ({
      id: user.id,
      display_name: user.name,
      email: user.email,
      job_title: user.jobTitle,
    })).sort((a, b) =>
      a.id === persona?.id ? -1 : b.id === persona?.id ? 1 : 0,
    ),
    tenant_settings: [
      {
        tenant_id,
        portal_name: "Muster AG Servicedesk",
        support_email: "servicedesk@muster.ch",
        locale: "de-CH",
        timezone: "Europe/Zurich",
      },
    ],
    tenant_branding: [
      {
        tenant_id,
        logo_path: null,
        primary_color: "#0F4C81",
        secondary_color: "#1E3A5F",
        accent_color: "#E4572E",
      },
    ],
    ticket_statuses: D.STATUSES.map((status) => ({ ...status, tenant_id })),
    ticket_priorities: D.PRIORITIES.map((priority) => ({
      ...priority,
      tenant_id,
    })),
    departments: D.DEPARTMENTS.map((department) => ({
      ...department,
      tenant_id,
      active: true,
    })),
    tickets: visibleTickets(persona),
    ticket_events: visibleTickets(persona)
      .slice(0, 6)
      .map((ticket, index) => ({
        event_type: index % 2 ? "comment.external_added" : "ticket.updated",
        created_at: ticket.updated_at,
        ticket_id: ticket.id,
        tickets: {
          tenant_id,
          ticket_number: ticket.ticket_number,
          subject: ticket.subject,
        },
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    agent_delegations: [],
    ticket_form_answers: [],
    ticket_email_signatures: [],
    ticket_services: [],
    ticket_assets: [
      {
        tenant_id,
        ticket_id: D.TICKETS[0].id,
        asset_id: D.ASSETS[0].id,
        assets: D.ASSETS[0],
      },
    ],
    problem_tickets: [],
    services: [],
    ticket_categories: D.CATEGORIES.map((category) => ({
      id: category.id,
      tenant_id,
      department_id: D.DEP[category.departmentKey].id,
      label: category.label,
      name: category.label,
      is_active: true,
    })),
  };
}

function parseValue(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matches(row, column, expression) {
  const dot = expression.indexOf(".");
  let operator = expression.slice(0, dot);
  let operand = expression.slice(dot + 1);
  let negate = false;
  if (operator === "not") {
    negate = true;
    const next = operand.indexOf(".");
    operator = operand.slice(0, next);
    operand = operand.slice(next + 1);
  }
  const value = column.includes(".") ? undefined : row[column];
  if (value === undefined && column.includes(".")) return true; // embedded filters are ignored
  let result;
  switch (operator) {
    case "eq":
      result =
        String(value) === String(parseValue(operand)) ||
        value === parseValue(operand) ||
        // Flags missing in the demo data count as false (e.g. is_security_case).
        (value === undefined && operand === "false");
      break;
    case "neq":
      result = String(value) !== operand;
      break;
    case "is":
      result =
        operand === "null" ? value == null : value === parseValue(operand);
      break;
    case "in": {
      const list = operand
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((item) => item.replace(/^"|"$/g, ""));
      result = list.includes(String(value));
      break;
    }
    case "gt":
      result = value != null && String(value) > operand;
      break;
    case "gte":
      result = value != null && String(value) >= operand;
      break;
    case "lt":
      result = value != null && String(value) < operand;
      break;
    case "lte":
      result = value != null && String(value) <= operand;
      break;
    case "ilike":
    case "like": {
      const pattern = new RegExp(
        `^${operand.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`,
        "i",
      );
      result = pattern.test(String(value ?? ""));
      break;
    }
    case "cs":
    case "ov":
    case "fts":
    case "wfts":
    case "plfts":
      result = true;
      break;
    default:
      result = true;
  }
  return negate ? !result : result;
}

function matchesOr(row, group) {
  return splitTopLevel(group.replace(/^\(|\)$/g, "")).some((condition) => {
    const [column, ...rest] = condition.split(".");
    if (column === "and") return true;
    return matches(row, column, rest.join("."));
  });
}

const RESERVED = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "columns",
]);

function query(rows, url) {
  let result = rows.filter((row) => {
    for (const [key, expression] of url.searchParams) {
      if (RESERVED.has(key)) continue;
      if (key === "or") {
        if (!matchesOr(row, expression)) return false;
      } else if (key === "and") {
        continue;
      } else if (!matches(row, key, expression)) return false;
    }
    return true;
  });
  const order = url.searchParams.get("order");
  if (order) {
    const [column, direction] = order.split(",")[0].split(".");
    result = [...result].sort((a, b) => {
      const left = a[column];
      const right = b[column];
      const compare =
        left == null
          ? 1
          : right == null
            ? -1
            : left < right
              ? -1
              : left > right
                ? 1
                : 0;
      return direction === "desc" ? -compare : compare;
    });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  const total = result.length;
  result = result.slice(offset, limit ? offset + Number(limit) : undefined);
  return { rows: result, total, offset };
}

/** Applies the PostgREST select list (columns, aliases and embeds). */
function project(rows, select) {
  if (!select || select.trim() === "*") return rows;
  const fields = splitTopLevel(select.replace(/\s+/g, "")).map((field) => {
    const embed = field.match(/^(?:(\w+):)?(\w+)(?:!\w+)*\((.*)\)$/);
    if (embed)
      return { key: embed[1] ?? embed[2], source: embed[2], embed: embed[3] };
    const [alias, column] = field.includes(":")
      ? field.split(":")
      : [field, field];
    return { key: alias, source: column.split("::")[0] };
  });
  if (fields.some((field) => field.source === "*")) return rows;
  return rows.map((row) => {
    const out = {};
    for (const field of fields) {
      if (!(field.source in row)) continue;
      const value = row[field.source];
      if (field.embed && value && typeof value === "object") {
        out[field.key] = Array.isArray(value)
          ? project(value, field.embed)
          : project([value], field.embed)[0];
      } else out[field.key] = value;
    }
    return out;
  });
}

function tableResponse(allRows, ctx) {
  const rows = allRows;
  // Dashboard trends compare with tickets created in the previous period;
  // answer with slightly fewer than today so the trend arrows look plausible.
  if (
    ctx.method === "HEAD" &&
    ctx.url.searchParams.getAll("created_at").some((v) => v.startsWith("lt."))
  ) {
    const withoutRange = new URL(ctx.url);
    withoutRange.searchParams.delete("created_at");
    const current = query(rows, withoutRange).total;
    const previous =
      !ctx.persona?.canWorkTickets || current === 0
        ? 0
        : Math.max(1, current - 1);
    return {
      status: 200,
      headers: { "content-range": `*/${previous}` },
      body: "",
    };
  }
  const { rows: matched, total, offset } = query(rows, ctx.url);
  const page = project(matched, ctx.url.searchParams.get("select"));
  const accept = ctx.headers.accept ?? "";
  const range = `${page.length ? `${offset}-${offset + page.length - 1}` : "*"}/${total}`;
  if (ctx.method === "HEAD") {
    return { status: 200, headers: { "content-range": range }, body: "" };
  }
  if (ctx.method !== "GET") {
    // Writes: echo the payload so optimistic UI updates succeed.
    const echo = Array.isArray(ctx.body)
      ? ctx.body
      : ctx.body
        ? [ctx.body]
        : [];
    if (accept.includes("vnd.pgrst.object"))
      return { status: 200, json: echo[0] ?? {} };
    return { status: 201, json: echo };
  }
  if (accept.includes("vnd.pgrst.object")) {
    if (page.length === 1) return { json: page[0] };
    return {
      status: 406,
      json: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: `The result contains ${page.length} rows`,
        hint: null,
      },
    };
  }
  return { headers: { "content-range": range }, json: page };
}

function ticketListRow(ticket, total) {
  return {
    assigned_agent_id: ticket.assigned_agent_id,
    created_at: ticket.created_at,
    department_id: ticket.department_id,
    department_key: ticket.department_key,
    department_name: ticket.department_name,
    id: ticket.id,
    priority_id: ticket.priority_id,
    priority_label: ticket.priority_label,
    priority_sort_order: ticket.priority_sort_order,
    requester_id: ticket.requester_id,
    resolution_due_at: ticket.status_is_closed
      ? null
      : ticket.resolution_due_at,
    status_id: ticket.status_id,
    status_is_closed: ticket.status_is_closed,
    status_label: ticket.status_label,
    status_sort_order: ticket.status_sort_order,
    subject: ticket.subject,
    ticket_number: ticket.ticket_number,
    updated_at: ticket.updated_at,
    matching_ticket_count: total,
  };
}

function listTickets(args, persona) {
  let rows = visibleTickets(persona);
  const scope = args.p_scope ?? "all";
  if (scope === "mine")
    rows = rows.filter(
      (t) =>
        t.assigned_agent_id === persona.id || t.requester_id === persona.id,
    );
  if (scope === "unassigned") rows = rows.filter((t) => !t.assigned_agent_id);
  if (scope === "open") rows = rows.filter((t) => !t.status_is_closed);
  if (scope === "closed") rows = rows.filter((t) => t.status_is_closed);
  if (args.p_only_unassigned) rows = rows.filter((t) => !t.assigned_agent_id);
  if (args.p_assigned_agent_id)
    rows = rows.filter((t) => t.assigned_agent_id === args.p_assigned_agent_id);
  if (args.p_queue_key)
    rows = rows.filter((t) => t.department_key === args.p_queue_key);
  if (args.p_status_ids)
    rows = rows.filter((t) => args.p_status_ids.includes(t.status_id));
  if (args.p_priority_ids)
    rows = rows.filter((t) => args.p_priority_ids.includes(t.priority_id));
  if (args.p_department_ids)
    rows = rows.filter((t) => args.p_department_ids.includes(t.department_id));
  if (args.p_team_ids)
    rows = rows.filter((t) =>
      t.assigned_team_id
        ? args.p_team_ids.includes(t.assigned_team_id)
        : args.p_team_ids.includes("00000000-0000-0000-0000-000000000000"),
    );
  if (args.p_metric_ticket_ids)
    rows = rows.filter((t) => args.p_metric_ticket_ids.includes(t.id));
  for (const term of args.p_search_free_text ?? []) {
    const needle = term.toLowerCase();
    rows = rows.filter((t) =>
      `${t.subject} ${t.ticket_number}`.toLowerCase().includes(needle),
    );
  }
  const sortBy = args.p_sort_by ?? "updated";
  const direction = args.p_sort_direction === "asc" ? 1 : -1;
  const key =
    {
      updated: "updated_at",
      status: "status_sort_order",
      priority: "priority_sort_order",
      department: "department_name",
      agent: "assigned_agent_id",
    }[sortBy] ?? "updated_at";
  rows = [...rows].sort(
    (a, b) =>
      (String(a[key] ?? "") < String(b[key] ?? "") ? -1 : 1) * direction,
  );
  const total = rows.length;
  const offset = args.p_offset ?? 0;
  return rows
    .slice(offset, offset + (args.p_limit ?? 51))
    .map((ticket) => ticketListRow(ticket, total));
}

const RPCS = {
  list_authorized_ticket_list_page_v2: (args, ctx) =>
    listTickets(args, ctx.persona),
  list_authorized_ticket_list_page: (args, ctx) =>
    listTickets(args, ctx.persona),
  ticket_requester_names: (args) =>
    (args.p_ticket_ids ?? []).flatMap((id) => {
      const ticket = D.ticketById(id);
      const requester = ticket ? D.userById(ticket.requester_id) : null;
      return requester
        ? [{ ticket_id: id, requester_name: requester.name }]
        : [];
    }),
  list_active_delegations: () => [],
  // Menu counters and team modules («Störungen», «Sicherheitsfälle»).
  navigation_ticket_attention: (args, ctx) => ({
    unassignedTickets: 3,
    securityTriage: 1,
    incidentsUnacknowledged: 1,
    canWorkSecurityCases: ctx.persona?.role !== "employee",
    canWorkIncidents: ctx.persona?.role !== "employee",
  }),
  list_ticket_rule_statuses: () =>
    D.STATUSES.map((s) => ({ key: s.key, label: s.label })),
  get_ticket_lifecycle_settings: () => ({
    waitingReminderEnabled: true,
    waitingReminderDays: 3,
    waitingReminderMaxCount: 2,
    waitingReminderActionsEnabled: true,
    waitingResolveEnabled: true,
    waitingResolveDays: 10,
    resolvedCloseEnabled: true,
    resolvedCloseDays: 5,
  }),
  list_ticket_rules: () => ({
    departments: D.DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
    categories: D.CATEGORIES.map((c) => ({
      id: c.id,
      name: c.label,
      departmentId: D.DEP[c.departmentKey].id,
    })),
    priorities: D.PRIORITIES.map((p) => ({ id: p.id, name: p.label })),
    teams: D.TEAMS.map((t) => ({
      id: t.id,
      name: t.name,
      departmentId: t.departmentId,
    })),
    people: D.AGENTS.map((a) => ({ id: a.id, name: a.name })),
    rules: [
      {
        id: D.uid("23232323", 1),
        name: "Netzwerk & VPN an ICT Infrastruktur",
        active: true,
        position: 1,
        conditions: {
          trigger: "created",
          departmentIds: [D.DEP.ict.id],
          categoryIds: [D.CATEGORIES[3].id],
        },
        actions: { teamId: D.TEAMS[1].id, notify: ["assignee"] },
        appliedCount: 37,
        lastAppliedAt: D.ago(5 * D.HOUR),
      },
      {
        id: D.uid("23232323", 2),
        name: "Monitoring-Alarme sofort kritisch",
        active: true,
        position: 2,
        conditions: {
          trigger: "created",
          sources: ["api"],
          keywords: ["Alarm", "Störung"],
        },
        actions: {
          priorityId: D.PR.critical.id,
          watcherIds: [D.U.daniel.id],
          notify: ["supervisors"],
        },
        appliedCount: 6,
        lastAppliedAt: D.ago(2 * D.HOUR),
      },
      {
        id: D.uid("23232323", 3),
        name: "Nicht zugewiesen nach 2 Stunden",
        active: true,
        position: 3,
        conditions: { trigger: "time", time: { kind: "unassigned", hours: 2 } },
        actions: { notify: ["supervisors"] },
        appliedCount: 12,
        lastAppliedAt: D.ago(1 * D.DAY),
      },
      {
        id: D.uid("23232323", 4),
        name: "Eintritte an HR Services",
        active: false,
        position: 4,
        conditions: {
          trigger: "created",
          departmentIds: [D.DEP.hr.id],
          categoryIds: [D.CATEGORIES[6].id],
        },
        actions: { teamId: D.TEAMS[3].id },
        appliedCount: 0,
        lastAppliedAt: null,
      },
    ],
  }),
  my_supervised_department_ids: (args, ctx) =>
    ctx.persona?.isTenantAdmin ? [D.DEP.ict.id] : [],
};

function restResponse(path, ctx) {
  if (path.startsWith("rpc/")) {
    const name = path.slice(4);
    const handler = RPCS[name];
    if (!handler) return null;
    return { json: handler(ctx.body ?? {}, ctx) };
  }
  const name = path.split("?")[0];
  const all = tables(ctx.persona);
  if (!(name in all)) return null;
  let rows = all[name];
  // Without an explicit id filter, RLS only exposes the own profile.
  if (
    name === "user_profiles" &&
    !ctx.url.searchParams.has("id") &&
    !ctx.url.searchParams.has("user_id")
  ) {
    rows = rows.filter((row) => row.id === ctx.persona?.id);
  }
  return tableResponse(rows, ctx);
}

module.exports = { restResponse, visibleTickets };
