import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type Ctx, dispatch } from "./index.ts";

/**
 * Runs the function against a small in-memory stand-in for the database.
 * It checks the flows and the access rules; PostgREST itself and the SQL
 * constraints are covered by the migration tests.
 */

type Row = Record<string, unknown>;

const TENANT = "10000000-0000-4000-8000-000000000001";
const LEAD = "20000000-0000-4000-8000-000000000001";
const MEMBER = "20000000-0000-4000-8000-000000000002";
const GUEST = "20000000-0000-4000-8000-000000000003";
const READER = "20000000-0000-4000-8000-000000000004";
const OUTSIDER = "20000000-0000-4000-8000-000000000005";
const TICKET = "30000000-0000-4000-8000-000000000001";

const JOIN_COLUMN: Record<string, string> = {
  project_task_checklist_items: "task_id",
  ticket_time_entries: "project_task_id",
  record_attachments: "project_task_id",
};
const DEFAULTS: Record<string, Row> = {
  projects: {
    status: "planning",
    health: "green",
    schedule_mode: "auto",
    currency: "CHF",
    archived_at: null,
  },
  project_tasks: {
    kind: "task",
    status: "todo",
    priority: "normal",
    progress_percent: 0,
    position: 0,
    parent_task_id: null,
    starts_on: null,
    due_on: null,
    estimated_minutes: null,
    assignee_id: null,
  },
  project_task_dependencies: {
    dependency_type: "finish_to_start",
    lag_days: 0,
  },
  project_comments: { visibility: "internal" },
  project_documents: { visibility: "internal", body: "" },
};
const UNIQUE: Record<string, string[][]> = {
  project_task_dependencies: [["predecessor_id", "successor_id"]],
  project_members: [["project_id", "user_id"]],
  project_templates: [["tenant_id", "name"]],
};

class Database {
  tables = new Map<string, Row[]>();
  permissions = new Map<string, Set<string>>();
  counter = 0;
  clock = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    return new Query(this, table);
  }

  rpc(name: string, args: Row) {
    const data = (() => {
      switch (name) {
        case "shop_has_permission":
          return (
            this.permissions
              .get(args.p_user_id as string)
              ?.has(args.p_permission_code as string) ?? false
          );
        case "project_next_number":
          return `P-2026-${String(++this.counter).padStart(4, "0")}`;
        case "project_stats":
          return this.rows("projects")
            .filter(
              (project) =>
                !args.p_project_ids ||
                (args.p_project_ids as string[]).includes(project.id as string),
            )
            .map((project) => {
              const ids = new Set(
                this.rows("project_tasks")
                  .filter((task) => task.project_id === project.id)
                  .map((task) => task.id),
              );
              return {
                project_id: project.id,
                task_count: ids.size,
                done_count: 0,
                progress_percent: 0,
                estimated_minutes: 0,
                booked_minutes: this.rows("ticket_time_entries")
                  .filter((entry) => ids.has(entry.project_task_id))
                  .reduce((sum, entry) => sum + Number(entry.minutes), 0),
                overdue_tasks: 0,
                overdue_milestones: 0,
                next_milestone_title: null,
                next_milestone_on: null,
                latest_due_on: null,
              };
            });
        case "project_link_details":
          return this.rows("project_links")
            .filter((link) => link.project_id === args.p_project_id)
            .map((link) => ({
              link_id: link.id,
              task_id: link.task_id ?? null,
              target_kind: link.target_kind,
              target_id: link.ticket_id ?? link.asset_id,
              label: "T-00001",
              detail: "Ticket",
              state: "Offen",
              is_closed: false,
              assignee_id: null,
              booked_minutes: 0,
              note: null,
            }));
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    })();
    return Promise.resolve({ data, error: null });
  }

  storage = {
    from: () => ({
      remove: () => Promise.resolve({ error: null }),
    }),
  };
}

type Result = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number;
};

class Query implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" =
    "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: ((row: Row) => boolean)[] = [];
  private sorts: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private window: [number, number] | null = null;
  private returning = false;
  private mode: "one" | "maybe" | null = null;
  private head = false;
  private conflict: string[] = [];

  constructor(
    private db: Database,
    private table: string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.action !== "select") this.returning = true;
    this.head = options?.head === true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.action = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], options: { onConflict: string }) {
    this.action = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = options.onConflict.split(",");
    return this;
  }
  update(patch: Row) {
    this.action = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  private value(row: Row, column: string): unknown {
    if (!column.includes(".")) return row[column] ?? null;
    const [table, field] = column.split(".");
    const parent = this.db
      .rows(table)
      .find((other) => other.id === row[JOIN_COLUMN[this.table]]);
    return parent ? parent[field] : undefined;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => this.value(row, column) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(this.value(row, column)));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => this.value(row, column) === value);
    return this;
  }
  not(column: string, _operator: string, value: null) {
    this.filters.push((row) => this.value(row, column) !== value);
    return this;
  }
  or(_expression: string) {
    return this;
  }
  // Date bounds of role assignments; the test tenant has none.
  lte(_column: string, _value: unknown) {
    return this;
  }
  gt(_column: string, _value: unknown) {
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.sorts.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "one";
    return this;
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    const matches = () =>
      rows.filter((row) => this.filters.every((test) => test(row)));
    let result: Row[];
    if (this.action === "insert" || this.action === "upsert") {
      result = [];
      for (const input of this.payload) {
        const keys =
          this.action === "upsert"
            ? [this.conflict]
            : (UNIQUE[this.table] ?? []);
        const existing = keys
          .map((key) =>
            rows.find((row) =>
              key.every((column) => row[column] === input[column]),
            ),
          )
          .find(Boolean);
        if (existing && this.action === "insert") {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        if (existing) {
          Object.assign(existing, input);
          result.push(existing);
          continue;
        }
        if (this.table === "project_links" && input.ticket_id) {
          if (rows.some((row) => row.ticket_id === input.ticket_id)) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate" },
            };
          }
        }
        const row = {
          id: crypto.randomUUID(),
          created_at: new Date(
            Date.UTC(2026, 0, 1, 0, 0, this.db.clock++),
          ).toISOString(),
          ...(DEFAULTS[this.table] ?? {}),
          ...input,
        };
        rows.push(row);
        result.push(row);
      }
    } else if (this.action === "update") {
      result = matches();
      for (const row of result) Object.assign(row, this.patch);
    } else if (this.action === "delete") {
      result = matches();
      const gone = new Set(result);
      this.db.tables.set(
        this.table,
        rows.filter((row) => !gone.has(row)),
      );
      if (this.table === "project_tasks") {
        // on delete cascade
        const ids = new Set(result.map((row) => row.id));
        for (const [table, column] of [
          ["project_tasks", "parent_task_id"],
          ["ticket_time_entries", "project_task_id"],
          ["project_task_dependencies", "predecessor_id"],
          ["project_task_dependencies", "successor_id"],
        ]) {
          this.db.tables.set(
            table,
            this.db.rows(table).filter((row) => !ids.has(row[column])),
          );
        }
      }
    } else {
      result = matches();
      for (const sort of [...this.sorts].reverse()) {
        result.sort((a, b) => {
          const left = a[sort.column] as string | number;
          const right = b[sort.column] as string | number;
          const order = left < right ? -1 : left > right ? 1 : 0;
          return sort.ascending ? order : -order;
        });
      }
      const count = result.length;
      if (this.window)
        result = result.slice(this.window[0], this.window[1] + 1);
      if (this.max !== null) result = result.slice(0, this.max);
      if (this.head) return { data: null, error: null, count };
    }
    if (this.action !== "select" && !this.returning)
      return { data: null, error: null };
    const copies = result.map((row) => ({ ...row }));
    if (this.mode) return { data: copies[0] ?? null, error: null };
    return { data: copies, error: null };
  }

  then<A = Result, B = never>(
    resolve?: ((value: Result) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }
}

function world() {
  const db = new Database();
  for (const [id, name] of [
    [LEAD, "Lea Leitung"],
    [MEMBER, "Mia Mitarbeit"],
    [GUEST, "Gian Gast"],
    [READER, "Rolf Leser"],
    [OUTSIDER, "Otto Ohne"],
  ]) {
    db.rows("user_profiles").push({ id, display_name: name });
    db.rows("tenant_memberships").push({
      tenant_id: TENANT,
      user_id: id,
      status: "active",
    });
  }
  db.permissions.set(
    LEAD,
    new Set(["project.read", "project.create", "project.manage"]),
  );
  db.permissions.set(READER, new Set(["project.read"]));
  db.rows("tickets").push({
    id: TICKET,
    tenant_id: TENANT,
    ticket_number: "T-00001",
    subject: "Standort Bern neu verkabeln",
    description: "Alles neu.",
    department_id: null,
    customer_organization_id: null,
    deleted_at: null,
  });
  db.rows("ticket_checklist_items").push(
    {
      ticket_id: TICKET,
      description: "Begehung",
      position: 0,
      completed_at: "2026-01-01T00:00:00Z",
    },
    {
      ticket_id: TICKET,
      description: "Offerte",
      position: 1,
      completed_at: null,
    },
  );
  const as = (userId: string) => {
    const granted = db.permissions.get(userId) ?? new Set<string>();
    const ctx: Ctx = {
      admin: db,
      userClient: { rpc: () => Promise.resolve({ data: true, error: null }) },
      actorId: userId,
      tenantId: TENANT,
      permissions: {
        read: granted.has("project.read") || granted.has("project.manage"),
        create: granted.has("project.create") || granted.has("project.manage"),
        manage: granted.has("project.manage"),
      },
    };
    return (body: Row) =>
      dispatch(ctx, { tenantId: TENANT, ...body }) as Promise<Row>;
  };
  return { db, as };
}

async function plan(lead: (body: Row) => Promise<Row>) {
  const { projectId } = await lead({
    type: "createProject",
    title: "Netz Bern",
    startsOn: "2026-12-01",
    budgetMinutes: 600,
  });
  const add = async (fields: Row) =>
    (await lead({ type: "createTask", projectId, ...fields })).taskId as string;
  const phase = await add({ kind: "phase", title: "Umsetzung" });
  const first = await add({
    title: "Konfigurieren",
    parentId: phase,
    startsOn: "2026-12-01",
    dueOn: "2026-12-02",
    estimatedMinutes: 240,
  });
  const second = await add({
    title: "Einbauen",
    parentId: phase,
    startsOn: "2026-12-03",
    dueOn: "2026-12-04",
  });
  const milestone = await add({
    kind: "milestone",
    title: "Abnahme",
    dueOn: "2026-12-07",
  });
  return { projectId: projectId as string, phase, first, second, milestone };
}

const taskOf = (detail: Row, id: string) =>
  (detail.tasks as Row[]).find((task) => task.id === id)!;

Deno.test(
  "a delay moves the successors and the phase follows its tasks",
  async () => {
    const { as } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({
      type: "addDependency",
      projectId: ids.projectId,
      predecessorId: ids.first,
      successorId: ids.second,
    });
    await lead({
      type: "addDependency",
      projectId: ids.projectId,
      predecessorId: ids.second,
      successorId: ids.milestone,
    });

    const outcome = await lead({
      type: "updateTask",
      taskId: ids.first,
      dueOn: "2026-12-04",
    });
    assertEquals(outcome.shifted, 3);

    const detail = await lead({ type: "getProject", projectId: ids.projectId });
    assertEquals(
      [taskOf(detail, ids.second).startsOn, taskOf(detail, ids.second).dueOn],
      ["2026-12-07", "2026-12-08"],
    );
    assertEquals(taskOf(detail, ids.milestone).dueOn, "2026-12-09");
    assertEquals(
      [taskOf(detail, ids.phase).startsOn, taskOf(detail, ids.phase).dueOn],
      ["2026-12-01", "2026-12-08"],
    );
  },
);

Deno.test(
  "in manual mode the shift is only proposed until it is applied",
  async () => {
    const { as } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({
      type: "updateProject",
      projectId: ids.projectId,
      scheduleMode: "manual",
    });
    await lead({
      type: "addDependency",
      projectId: ids.projectId,
      predecessorId: ids.first,
      successorId: ids.second,
    });
    const outcome = await lead({
      type: "updateTask",
      taskId: ids.first,
      dueOn: "2026-12-04",
    });
    assertEquals([outcome.shifted, outcome.pending], [0, 2]);
    const preview = await lead({
      type: "previewReschedule",
      projectId: ids.projectId,
    });
    assertEquals(
      (preview.changes as Row[]).map((change) => change.title).sort(),
      ["Einbauen", "Umsetzung"],
    );
    await lead({ type: "applyReschedule", projectId: ids.projectId });
    const detail = await lead({ type: "getProject", projectId: ids.projectId });
    assertEquals(taskOf(detail, ids.second).startsOn, "2026-12-07");
  },
);

Deno.test("a dependency a phase can never satisfy is taken back", async () => {
  const { as, db } = world();
  const lead = as(LEAD);
  const ids = await plan(lead);
  await assertRejects(
    () =>
      lead({
        type: "addDependency",
        projectId: ids.projectId,
        predecessorId: ids.first,
        successorId: ids.phase,
      }),
    Error,
    "Kreis",
  );
  assertEquals(db.rows("project_task_dependencies").length, 0);
});

Deno.test(
  "done sets progress, booked time adds up and only its author or the lead deletes it",
  async () => {
    const { as, db } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({
      type: "setMember",
      projectId: ids.projectId,
      userId: MEMBER,
      role: "member",
    });
    const member = as(MEMBER);

    await member({ type: "updateTask", taskId: ids.first, status: "done" });
    const { entryId } = await member({
      type: "addTimeEntry",
      taskId: ids.first,
      minutes: 90,
      note: "Switch 1",
    });
    await lead({ type: "addTimeEntry", taskId: ids.first, minutes: 30 });
    const detail = await member({
      type: "getProject",
      projectId: ids.projectId,
    });
    assertEquals(taskOf(detail, ids.first).progressPercent, 100);
    assertEquals(taskOf(detail, ids.first).bookedMinutes, 120);
    assertEquals((detail.project as { stats: Row }).stats.bookedMinutes, 120);

    const leadEntry = db
      .rows("ticket_time_entries")
      .find((entry) => entry.author_id === LEAD)!;
    await assertRejects(
      () => member({ type: "deleteTimeEntry", entryId: leadEntry.id }),
      Error,
      "Berechtigung",
    );
    await member({ type: "deleteTimeEntry", entryId });
    assertEquals(db.rows("ticket_time_entries").length, 1);
    // Members work on the plan but do not run the project.
    await assertRejects(
      () =>
        member({
          type: "updateProject",
          projectId: ids.projectId,
          status: "active",
        }),
      Error,
    );
    // Someone who works in a project may use the selection lists.
    const options = await member({ type: "options" });
    assert(Array.isArray(options.people));
    // The directory search marks people who have no account yet.
    db.rows("tenant_entra_directory_people").push(
      {
        tenant_id: TENANT,
        entra_object_id: "40000000-0000-4000-8000-000000000001",
        display_name: "Nora Neu",
        email: "nora.neu@example.org",
        job_title: "Hauswartin",
        local_user_id: null,
        account_enabled: true,
        inactive_at: null,
      },
      {
        tenant_id: TENANT,
        entra_object_id: "40000000-0000-4000-8000-000000000002",
        display_name: "Mia Mitarbeit",
        email: "mia@example.org",
        job_title: null,
        local_user_id: MEMBER,
        account_enabled: true,
        inactive_at: null,
      },
    );
    assertEquals(
      (await lead({ type: "searchPeople", query: "m" })).results,
      [],
    );
    assertEquals((await lead({ type: "searchPeople", query: "mi" })).results, [
      {
        id: MEMBER,
        name: "Mia Mitarbeit",
        detail: "mia@example.org",
        hasAccount: true,
      },
      {
        id: "entra:40000000-0000-4000-8000-000000000001",
        name: "Nora Neu",
        detail: "Hauswartin",
        hasAccount: false,
      },
    ]);
    // Nobody in this tenant works on tickets, so nobody can be made lead.
    assertEquals(options.agents, []);
    await assertRejects(
      () =>
        lead({
          type: "updateProject",
          projectId: ids.projectId,
          managerId: MEMBER,
        }),
      Error,
      "Agent",
    );
    // The current lead and the person saving stay allowed.
    await lead({
      type: "updateProject",
      projectId: ids.projectId,
      managerId: LEAD,
    });
  },
);

Deno.test(
  "guests see the plan and what is marked external, nothing else",
  async () => {
    const { as } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({
      type: "setMember",
      projectId: ids.projectId,
      userId: GUEST,
      role: "guest_comment",
    });
    await lead({ type: "addTimeEntry", taskId: ids.first, minutes: 60 });
    await lead({
      type: "addComment",
      projectId: ids.projectId,
      body: "Intern",
    });
    await lead({
      type: "addComment",
      projectId: ids.projectId,
      body: "Für alle",
      visibility: "external",
    });
    await lead({
      type: "saveDocument",
      projectId: ids.projectId,
      title: "Kalkulation",
      body: "geheim",
    });
    await lead({
      type: "saveDocument",
      projectId: ids.projectId,
      title: "Terminplan",
      body: "offen",
      visibility: "external",
    });
    await lead({
      type: "linkRecord",
      projectId: ids.projectId,
      targetKind: "ticket",
      targetId: TICKET,
    });

    const guest = as(GUEST);
    const detail = await guest({
      type: "getProject",
      projectId: ids.projectId,
    });
    assertEquals((detail.access as Row).isGuest, true);
    assertEquals(
      (detail.comments as Row[]).map((comment) => comment.body),
      ["Für alle"],
    );
    assertEquals(
      (detail.documents as Row[]).map((document) => document.title),
      ["Terminplan"],
    );
    assertEquals(
      [detail.timeEntries, detail.links, detail.events, detail.attachments],
      [[], [], [], []],
    );
    const project = detail.project as Row & { stats: Row };
    assertEquals(
      [project.budgetMinutes, project.stats.bookedMinutes],
      [null, 0],
    );
    assertEquals(taskOf(detail, ids.first).estimatedMinutes, null);

    // A guest comment is always visible to guests; everything else is refused.
    await guest({
      type: "addComment",
      projectId: ids.projectId,
      body: "Danke",
      visibility: "internal",
    });
    const after = await lead({ type: "getProject", projectId: ids.projectId });
    assertEquals((after.comments as Row[]).at(-1)?.visibility, "external");
    for (const body of [
      { type: "updateTask", taskId: ids.first, status: "done" },
      { type: "addTimeEntry", taskId: ids.first, minutes: 5 },
      { type: "saveDocument", projectId: ids.projectId, title: "x" },
      {
        type: "inviteGuest",
        projectId: ids.projectId,
        email: "a@b.ch",
        role: "guest_read",
      },
      { type: "workload" },
      { type: "options" },
      { type: "searchPeople", query: "mia" },
      { type: "searchLinkable", targetKind: "ticket", query: "" },
      { type: "projectsForRecord", targetKind: "ticket", targetId: TICKET },
      { type: "createProject", title: "Eigenes" },
    ]) {
      await assertRejects(() => guest(body), Error);
    }
    const overview = await guest({ type: "overview" });
    assertEquals(
      (overview.projects as Row[]).map((entry) => entry.role),
      ["guest_comment"],
    );
    // The timeline across projects needs the dated milestones.
    assertEquals(
      ((overview.projects as Row[])[0].milestones as Row[]).map((entry) => [
        entry.title,
        entry.dueOn,
        entry.done,
      ]),
      [["Abnahme", "2026-12-07", false]],
    );
  },
);

Deno.test(
  "without a right or membership a project cannot be found",
  async () => {
    const { as } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    const outsider = as(OUTSIDER);
    await assertRejects(
      () => outsider({ type: "getProject", projectId: ids.projectId }),
      Error,
      "nicht gefunden",
    );
    assertEquals((await outsider({ type: "overview" })).projects, []);
    // project.read shows every project but changes nothing.
    const reader = as(READER);
    const detail = await reader({
      type: "getProject",
      projectId: ids.projectId,
    });
    assertEquals((detail.access as Row).role, "viewer");
    await assertRejects(
      () =>
        reader({ type: "createTask", projectId: ids.projectId, title: "x" }),
      Error,
    );
  },
);

Deno.test(
  "a project saved as template comes back with fresh dates",
  async () => {
    const { as } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    const { itemId } = await lead({
      type: "addChecklistItem",
      taskId: ids.first,
      description: "Firmwar",
    });
    // An item can be renamed and ticked independently.
    await lead({ type: "setChecklistItem", itemId, description: "Firmware" });
    await lead({ type: "setChecklistItem", itemId, done: true });
    const checked = await lead({
      type: "getProject",
      projectId: ids.projectId,
    });
    assertEquals(taskOf(checked, ids.first).checklist, [
      { id: itemId, description: "Firmware", done: true },
    ]);
    await assertRejects(
      () => lead({ type: "setChecklistItem", itemId }),
      Error,
    );
    await lead({
      type: "addDependency",
      projectId: ids.projectId,
      predecessorId: ids.first,
      successorId: ids.second,
    });
    const { templateId } = await lead({
      type: "saveAsTemplate",
      projectId: ids.projectId,
      name: "Standort",
    });
    const options = await lead({ type: "options" });
    assertEquals((options.templates as Row[])[0].itemCount, 4);

    const { projectId } = await lead({
      type: "createProject",
      title: "Netz Zürich",
      startsOn: "2027-03-01",
      templateId,
    });
    const detail = await lead({ type: "getProject", projectId });
    const tasks = detail.tasks as Row[];
    const copy = tasks.find((task) => task.title === "Konfigurieren")!;
    assertEquals([copy.startsOn, copy.dueOn], ["2027-03-01", "2027-03-02"]);
    assertEquals(
      (copy.checklist as Row[]).map((item) => item.description),
      ["Firmware"],
    );
    assertEquals(
      tasks.find((task) => task.id === copy.parentId)?.title,
      "Umsetzung",
    );
    assertEquals((detail.dependencies as Row[]).length, 1);
    assert(!tasks.some((task) => task.id === ids.first));
  },
);

Deno.test("a ticket becomes a project once and keeps its link", async () => {
  const { as, db } = world();
  const lead = as(LEAD);
  const { projectId } = await lead({ type: "convertTicket", ticketId: TICKET });
  const detail = await lead({ type: "getProject", projectId });
  assertEquals((detail.project as Row).title, "Standort Bern neu verkabeln");
  assertEquals(
    (detail.tasks as Row[]).map((task) => [task.title, task.status]),
    [
      ["Begehung", "done"],
      ["Offerte", "todo"],
    ],
  );
  assertEquals(
    (detail.links as Row[]).map((link) => link.targetKind),
    ["ticket"],
  );
  assertEquals(
    db.rows("ticket_events").map((event) => event.event_type),
    ["project.converted"],
  );
  await assertRejects(
    () => lead({ type: "convertTicket", ticketId: TICKET }),
    Error,
    "bereits",
  );
  const linked = await lead({
    type: "projectsForRecord",
    targetKind: "ticket",
    targetId: TICKET,
  });
  assertEquals(
    (linked.projects as Row[]).map((entry) => entry.projectId),
    [projectId],
  );
});

Deno.test(
  "bulk changes and deleting a parent take the children along",
  async () => {
    const { as, db } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({
      type: "bulkUpdateTasks",
      projectId: ids.projectId,
      taskIds: [ids.first, ids.second],
      patch: { status: "in_progress", assigneeId: MEMBER, shiftDays: 7 },
    });
    const detail = await lead({ type: "getProject", projectId: ids.projectId });
    assertEquals(
      [
        taskOf(detail, ids.first).status,
        taskOf(detail, ids.first).assigneeName,
        taskOf(detail, ids.first).startsOn,
      ],
      ["in_progress", "Mia Mitarbeit", "2026-12-08"],
    );
    await lead({ type: "deleteTask", taskId: ids.phase });
    assertEquals(
      db.rows("project_tasks").map((task) => task.title),
      ["Abnahme"],
    );
  },
);

Deno.test(
  "people are told when they join a project or get a task",
  async () => {
    const { as, db } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    const sent = () =>
      db.rows("ticket_notifications").map((row) => {
        const payload = row.payload as Row;
        return [
          row.user_id,
          row.kind,
          payload.taskTitle ?? payload.taskCount ?? payload.role,
        ];
      });

    // New in the project: one message; a change of role: none.
    await lead({
      type: "setMember",
      projectId: ids.projectId,
      userId: MEMBER,
      role: "member",
    });
    await lead({
      type: "setMember",
      projectId: ids.projectId,
      userId: MEMBER,
      role: "manager",
    });
    assertEquals(sent(), [[MEMBER, "project.member_added", "member"]]);
    const first = db.rows("ticket_notifications")[0];
    assertEquals(first.ticket_id, null);
    assertEquals((first.payload as Row).projectTitle, "Netz Bern");
    assertEquals((first.payload as Row).actorName, "Lea Leitung");

    // Assigned to someone else: a message; to oneself or unchanged: none.
    await lead({ type: "updateTask", taskId: ids.first, assigneeId: MEMBER });
    await lead({
      type: "updateTask",
      taskId: ids.first,
      assigneeId: MEMBER,
      status: "in_progress",
    });
    await lead({ type: "updateTask", taskId: ids.second, assigneeId: LEAD });
    await lead({
      type: "createTask",
      projectId: ids.projectId,
      title: "Abnehmen",
      assigneeId: READER,
    });
    assertEquals(sent().slice(1), [
      [MEMBER, "project.task_assigned", "Konfigurieren"],
      [READER, "project.task_assigned", "Abnehmen"],
    ]);

    // Several at once: a single message with the number of tasks.
    db.tables.set("ticket_notifications", []);
    await lead({
      type: "bulkUpdateTasks",
      projectId: ids.projectId,
      taskIds: [ids.first, ids.second, ids.milestone],
      patch: { assigneeId: MEMBER },
    });
    assertEquals(sent(), [[MEMBER, "project.task_assigned", 2]]);
  },
);

Deno.test("rows move to a new place and into or out of a phase", async () => {
  const { as } = world();
  const lead = as(LEAD);
  const ids = await plan(lead);
  const titles = async (parentId: string | null) =>
    (
      (await lead({ type: "getProject", projectId: ids.projectId }))
        .tasks as Row[]
    )
      .filter((task) => task.parentId === parentId)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((task) => task.title);
  const move = (
    taskId: string,
    parentId: string | null,
    beforeId: string | null,
  ) => lead({ type: "moveTask", taskId, parentId, beforeId });

  // Within the phase: «Einbauen» in front of «Konfigurieren».
  await move(ids.second, ids.phase, ids.first);
  assertEquals(await titles(ids.phase), ["Einbauen", "Konfigurieren"]);

  // Out of the phase, to the very top.
  await move(ids.first, null, ids.phase);
  assertEquals(await titles(null), ["Konfigurieren", "Umsetzung", "Abnahme"]);
  assertEquals(await titles(ids.phase), ["Einbauen"]);

  // Back into the phase at the end; the phase to the end of the top level.
  await move(ids.first, ids.phase, null);
  assertEquals(await titles(ids.phase), ["Einbauen", "Konfigurieren"]);
  await move(ids.phase, null, null);
  assertEquals(await titles(null), ["Abnahme", "Umsetzung"]);

  await assertRejects(() => move(ids.first, ids.first, null), Error);
});

Deno.test(
  "the workload counts project work of everyone with something to do",
  async () => {
    const { as, db } = world();
    const lead = as(LEAD);
    const ids = await plan(lead);
    await lead({ type: "updateTask", taskId: ids.first, assigneeId: MEMBER });
    const tasks = db.rows("project_tasks");
    db.tables.set(
      "work_items",
      tasks.map((task) => ({
        tenant_id: TENANT,
        kind: "project_task",
        id: task.id,
        project_id: task.project_id,
        title: task.title,
        assignee_id: task.assignee_id,
        starts_on: "2030-01-07",
        due_on: "2030-01-08",
        estimated_minutes: task.estimated_minutes,
        progress_percent: task.progress_percent,
        is_open: true,
      })),
    );
    const result = await lead({
      type: "workload",
      from: "2030-01-07",
      to: "2030-01-11",
    });
    const people = result.people as Row[];
    assertEquals(
      people.map((person) => [person.name, person.totalMinutes]),
      [["Mia Mitarbeit", 240]],
    );
    assertEquals(
      (people[0].items as Row[])[0].projectName,
      "P-2026-0001 Netz Bern",
    );
  },
);
