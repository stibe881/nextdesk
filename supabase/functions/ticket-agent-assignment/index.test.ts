import { readableTicketDepartments } from "../_shared/readable-ticket-departments.ts";
import { listAssignableAgentsForDepartments } from "../_shared/assignable-agents.ts";

Deno.test(
  "agent directory exposes only departments with positive ticket.read.department access",
  () => {
    const departments = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        key: "ict",
        name: "ICT",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        key: "infrastruktur",
        name: "Infrastruktur",
      },
    ];
    const access = new Map<string, boolean>([
      [departments[0].id, true],
      [departments[1].id, false],
    ]);

    const visible = readableTicketDepartments(departments, access);

    if (
      JSON.stringify(visible) !==
      JSON.stringify([
        {
          id: departments[0].id,
          key: "ict",
          label: "ICT",
        },
      ])
    ) {
      throw new Error(
        "Eine verweigerte Abteilung darf nicht in den Queue-Katalog gelangen.",
      );
    }
  },
);

Deno.test(
  "agent directory fails closed for a missing department decision",
  () => {
    const visible = readableTicketDepartments(
      [
        {
          id: "10000000-0000-4000-8000-000000000001",
          key: "ict",
          name: "ICT",
        },
      ],
      new Map(),
    );

    if (visible.length !== 0) {
      throw new Error(
        "Ohne positive serverseitige Abteilungsentscheidung darf keine Queue erscheinen.",
      );
    }
  },
);

Deno.test(
  "batched agent directory preserves tenant and department role boundaries",
  async () => {
    const departmentA = "10000000-0000-4000-8000-000000000001";
    const departmentB = "10000000-0000-4000-8000-000000000002";
    const tenantAgent = "20000000-0000-4000-8000-000000000001";
    const departmentAgent = "20000000-0000-4000-8000-000000000002";
    const otherDepartmentAgent = "20000000-0000-4000-8000-000000000003";
    const queryResult = (table: string) => {
      const data =
        {
          tenant_memberships: [
            { user_id: tenantAgent },
            { user_id: departmentAgent },
            { user_id: otherDepartmentAgent },
          ],
          department_memberships: [
            { department_id: departmentA, user_id: tenantAgent },
            { department_id: departmentB, user_id: tenantAgent },
            { department_id: departmentA, user_id: departmentAgent },
            { department_id: departmentB, user_id: otherDepartmentAgent },
          ],
          user_role_assignments: [
            {
              user_id: tenantAgent,
              department_id: null,
              roles: {
                active: true,
                role_permissions: [{ permission_code: "ticket.update" }],
                scope: "tenant",
                tenant_id: "30000000-0000-4000-8000-000000000001",
              },
            },
            {
              user_id: departmentAgent,
              department_id: departmentA,
              roles: {
                active: true,
                role_permissions: [{ permission_code: "ticket.read.assigned" }],
                scope: "department",
                tenant_id: "30000000-0000-4000-8000-000000000001",
              },
            },
            {
              user_id: otherDepartmentAgent,
              department_id: departmentA,
              roles: {
                active: true,
                role_permissions: [{ permission_code: "ticket.update" }],
                scope: "department",
                tenant_id: "30000000-0000-4000-8000-000000000001",
              },
            },
          ],
          user_profiles: [
            { id: tenantAgent, display_name: "Tenant Agent" },
            { id: departmentAgent, display_name: "Abteilung A" },
            { id: otherDepartmentAgent, display_name: "Andere Abteilung" },
          ],
        }[table] ?? [];
      let builder: any;
      builder = new Proxy(
        {},
        {
          get: (_target, property) => {
            if (property === "then") {
              return (resolve: (value: unknown) => unknown) =>
                resolve({ data, error: null });
            }
            return () => builder;
          },
        },
      );
      return builder;
    };
    const result = await listAssignableAgentsForDepartments(
      { from: queryResult },
      "30000000-0000-4000-8000-000000000001",
      [departmentA, departmentB],
    );

    if (result.error) throw new Error("Batch lookup unexpectedly failed.");
    const idsFor = (departmentId: string) =>
      (result.agentsByDepartmentId.get(departmentId) ?? [])
        .map((agent) => agent.id)
        .sort();
    if (
      JSON.stringify(idsFor(departmentA)) !==
      JSON.stringify([departmentAgent, tenantAgent].sort())
    ) {
      throw new Error("Department A did not retain its permitted agents.");
    }
    if (JSON.stringify(idsFor(departmentB)) !== JSON.stringify([tenantAgent])) {
      throw new Error(
        "A department-scoped role must never leak into a different department.",
      );
    }
  },
);
