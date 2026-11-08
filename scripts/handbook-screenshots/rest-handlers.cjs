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
    tenant_memberships: [{ tenant_id, user_id: persona?.id, status: "active", tenants: D.TENANT }],
    tenants: [D.TENANT],
    user_profiles: D.USERS.map((user) => ({ id: user.id, display_name: user.name, email: user.email, job_title: user.jobTitle })).sort((a, b) =>
      a.id === persona?.id ? -1 : b.id === persona?.id ? 1 : 0,
    ),
    tenant_settings: [{ tenant_id, portal_name: "Muster AG Servicedesk", support_email: "servicedesk@muster.ch", locale: "de-CH", timezone: "Europe/Zurich" }],
    tenant_branding: [{ tenant_id, logo_path: null, primary_color: "#0F4C81", secondary_color: "#1E3A5F", accent_color: "#E4572E" }],
    ticket_statuses: D.STATUSES.map((status) => ({ ...status, tenant_id })),
    ticket_priorities: D.PRIORITIES.map((priority) => ({ ...priority, tenant_id })),
    departments: D.DEPARTMENTS.map((department) => ({ ...department, tenant_id })),
    tickets: visibleTickets(persona),
    ticket_events: visibleTickets(persona)
      .slice(0, 6)
      .map((ticket, index) => ({
        event_type: index % 2 ? "comment.external_added" : "ticket.updated",
        created_at: ticket.updated_at,
        ticket_id: ticket.id,
        tickets: { tenant_id, ticket_number: ticket.ticket_number, subject: ticket.subject },
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    agent_delegations: [],
    ticket_categories: D.CATEGORIES.map((category) => ({ id: category.id, tenant_id, department_id: D.DEP[category.departmentKey].id, label: category.label, name: category.label, is_active: true })),
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
      result = String(value) === String(parseValue(operand)) || value === parseValue(operand);
      break;
    case "neq":
      result = String(value) !== operand;
      break;
    case "is":
      result = operand === "null" ? value == null : value === parseValue(operand);
      break;
    case "in": {
      const list = operand.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, ""));
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
      const pattern = new RegExp(`^${operand.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`, "i");
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

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

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
      const compare = left == null ? 1 : right == null ? -1 : left < right ? -1 : left > right ? 1 : 0;
      return direction === "desc" ? -compare : compare;
    });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  const total = result.length;
  result = result.slice(offset, limit ? offset + Number(limit) : undefined);
  return { rows: result, total, offset };
}

function tableResponse(rows, ctx) {
  // Dashboard trends compare with tickets created in the previous period;
  // answer with slightly fewer than today so the trend arrows look plausible.
  if (ctx.method === "HEAD" && ctx.url.searchParams.getAll("created_at").some((v) => v.startsWith("lt."))) {
    const withoutRange = new URL(ctx.url);
    withoutRange.searchParams.delete("created_at");
    const current = query(rows, withoutRange).total;
    const previous = current === 0 ? 0 : Math.max(1, current - 1);
    return { status: 200, headers: { "content-range": `*/${previous}` }, body: "" };
  }
  const { rows: page, total, offset } = query(rows, ctx.url);
  const accept = ctx.headers.accept ?? "";
  const range = `${page.length ? `${offset}-${offset + page.length - 1}` : "*"}/${total}`;
  if (ctx.method === "HEAD") {
    return { status: 200, headers: { "content-range": range }, body: "" };
  }
  if (ctx.method !== "GET") {
    // Writes: echo the payload so optimistic UI updates succeed.
    const echo = Array.isArray(ctx.body) ? ctx.body : ctx.body ? [ctx.body] : [];
    if (accept.includes("vnd.pgrst.object")) return { status: 200, json: echo[0] ?? {} };
    return { status: 201, json: echo };
  }
  if (accept.includes("vnd.pgrst.object")) {
    if (page.length === 1) return { json: page[0] };
    return { status: 406, json: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${page.length} rows`, hint: null } };
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
    resolution_due_at: ticket.status_is_closed ? null : ticket.resolution_due_at,
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
  if (scope === "mine") rows = rows.filter((t) => t.assigned_agent_id === persona.id || t.requester_id === persona.id);
  if (scope === "unassigned") rows = rows.filter((t) => !t.assigned_agent_id);
  if (scope === "open") rows = rows.filter((t) => !t.status_is_closed);
  if (scope === "closed") rows = rows.filter((t) => t.status_is_closed);
  if (args.p_only_unassigned) rows = rows.filter((t) => !t.assigned_agent_id);
  if (args.p_assigned_agent_id) rows = rows.filter((t) => t.assigned_agent_id === args.p_assigned_agent_id);
  if (args.p_queue_key) rows = rows.filter((t) => t.department_key === args.p_queue_key);
  if (args.p_status_ids) rows = rows.filter((t) => args.p_status_ids.includes(t.status_id));
  if (args.p_priority_ids) rows = rows.filter((t) => args.p_priority_ids.includes(t.priority_id));
  if (args.p_department_ids) rows = rows.filter((t) => args.p_department_ids.includes(t.department_id));
  if (args.p_metric_ticket_ids) rows = rows.filter((t) => args.p_metric_ticket_ids.includes(t.id));
  for (const term of args.p_search_free_text ?? []) {
    const needle = term.toLowerCase();
    rows = rows.filter((t) => `${t.subject} ${t.ticket_number}`.toLowerCase().includes(needle));
  }
  const sortBy = args.p_sort_by ?? "updated";
  const direction = args.p_sort_direction === "asc" ? 1 : -1;
  const key = { updated: "updated_at", status: "status_sort_order", priority: "priority_sort_order", department: "department_name", agent: "assigned_agent_id" }[sortBy] ?? "updated_at";
  rows = [...rows].sort((a, b) => (String(a[key] ?? "") < String(b[key] ?? "") ? -1 : 1) * direction);
  const total = rows.length;
  const offset = args.p_offset ?? 0;
  return rows.slice(offset, offset + (args.p_limit ?? 51)).map((ticket) => ticketListRow(ticket, total));
}

const RPCS = {
  list_authorized_ticket_list_page_v2: (args, ctx) => listTickets(args, ctx.persona),
  list_authorized_ticket_list_page: (args, ctx) => listTickets(args, ctx.persona),
  my_supervised_department_ids: (args, ctx) => (ctx.persona?.isTenantAdmin ? [D.DEP.ict.id] : []),
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
  if (name === "user_profiles" && !ctx.url.searchParams.has("id") && !ctx.url.searchParams.has("user_id")) {
    rows = rows.filter((row) => row.id === ctx.persona?.id);
  }
  return tableResponse(rows, ctx);
}

module.exports = { restResponse, visibleTickets };
