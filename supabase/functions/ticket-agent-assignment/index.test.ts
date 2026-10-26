import { readableTicketDepartments } from "../_shared/readable-ticket-departments.ts";

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
