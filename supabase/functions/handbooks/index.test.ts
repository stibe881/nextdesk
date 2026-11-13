import {
  allowedHandbookIds,
  handbookAccessFromAssignments,
  type HandbookRoleAssignment,
} from "../_shared/handbook-access.ts";
import {
  inlineHandbookImages,
  markdownOf,
  parseHandbookAction,
  referencedHandbookImages,
  summaryOf,
} from "./index.ts";

type Bundle = {
  handbooks: Array<{
    id: string;
    markdown: string;
    sie: { title: string; description: string; audienceLabel: string; markdown: string };
  }>;
  images: Record<string, { mime: string; data: string }>;
};

async function readBundle(): Promise<Bundle> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL("../../../docs/handbooks/handbooks.bundle.json", import.meta.url),
    ),
  );
}

function assertEquals(actual: unknown, expected: unknown, message = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

const NOW = "2026-11-08T10:00:00.000Z";
const TENANT = "22222222-2222-4222-8222-222222222222";

function assignment(
  name: string,
  permissions: string[],
  overrides: Partial<HandbookRoleAssignment> = {},
): HandbookRoleAssignment {
  return {
    starts_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    roles: {
      name,
      scope: "tenant",
      active: true,
      role_permissions: permissions.map((permission_code) => ({
        permission_code,
      })),
    },
    ...overrides,
  };
}

Deno.test("employees only receive the employee handbook", () => {
  const access = handbookAccessFromAssignments(
    [assignment("Requester", ["ticket.create", "ticket.read.own"])],
    NOW,
  );
  assertEquals(allowedHandbookIds(access), ["mitarbeitende"]);
  assertEquals(
    allowedHandbookIds(handbookAccessFromAssignments([], NOW)),
    ["mitarbeitende"],
    "member without role",
  );
});

Deno.test("agents receive employee and agent handbooks", () => {
  const access = handbookAccessFromAssignments(
    [assignment("Support agent", ["ticket.read.department", "ticket.update"])],
    NOW,
  );
  assertEquals(allowedHandbookIds(access), ["mitarbeitende", "agenten"]);
});

Deno.test("tenant administrators receive every handbook", () => {
  const access = handbookAccessFromAssignments(
    [assignment("Tenant administrator", ["tenant.manage"])],
    NOW,
  );
  assertEquals(allowedHandbookIds(access), [
    "mitarbeitende",
    "agenten",
    "administratoren",
    "installation",
  ]);
});

Deno.test(
  "inactive, expired or department-scoped admin roles grant nothing extra",
  () => {
    const inactive = assignment("Tenant administrator", ["ticket.update"]);
    (inactive.roles as { active: boolean }).active = false;
    const expired = assignment("Support agent", ["ticket.update"], {
      expires_at: "2026-11-01T00:00:00.000Z",
    });
    const departmentAdmin = assignment("Tenant administrator", []);
    (departmentAdmin.roles as { scope: string }).scope = "department";
    assertEquals(
      allowedHandbookIds(
        handbookAccessFromAssignments(
          [inactive, expired, departmentAdmin],
          NOW,
        ),
      ),
      ["mitarbeitende"],
    );
  },
);

Deno.test("requests are validated strictly", () => {
  assertEquals(parseHandbookAction({ type: "list", tenantId: TENANT }), {
    type: "list",
    tenantId: TENANT,
  });
  assertEquals(
    parseHandbookAction({
      type: "get",
      tenantId: TENANT,
      handbookId: "administratoren",
    }),
    { type: "get", tenantId: TENANT, handbookId: "administratoren" },
  );
  assertEquals(
    parseHandbookAction({ type: "get", tenantId: TENANT, handbookId: "../x" }),
    null,
  );
  assertEquals(parseHandbookAction({ type: "list", tenantId: "x" }), null);
});

Deno.test(
  "the published bundle covers all handbooks with resolvable images",
  async () => {
    const { handbooks, images } = await readBundle();
    assertEquals(
      handbooks.map((handbook) => handbook.id),
      ["mitarbeitende", "agenten", "administratoren", "installation"],
    );
    for (const handbook of handbooks) {
      const names = referencedHandbookImages(handbook.markdown);
      if (!names.length) throw new Error(`${handbook.id}: no screenshots`);
      const inlined = inlineHandbookImages(handbook.markdown, images);
      if (/\]\(images\//.test(inlined)) {
        throw new Error(`${handbook.id}: unresolved image reference`);
      }
    }
  },
);

Deno.test(
  "every handbook has a «Sie» wording with the same screenshots",
  async () => {
    const { handbooks } = await readBundle();
    for (const handbook of handbooks) {
      if (!handbook.sie?.markdown) throw new Error(`${handbook.id}: no Sie text`);
      assertEquals(
        referencedHandbookImages(handbook.sie.markdown),
        referencedHandbookImages(handbook.markdown),
        `${handbook.id} images`,
      );
      if (handbook.sie.markdown === handbook.markdown) {
        throw new Error(`${handbook.id}: Sie text equals the du text`);
      }
    }
  },
);

Deno.test("the wording follows the form of address of the tenant", () => {
  const row = {
    id: "agenten" as const,
    title: "Handbuch",
    description: "Du bearbeitest Tickets.",
    audience_label: "Agenten",
    updated_on: "2026-11-13",
    title_sie: "Handbuch (Sie)",
    description_sie: "Sie bearbeiten Tickets.",
    audience_label_sie: null,
    markdown: "Du kannst.",
    markdown_sie: "Sie können.",
  };
  assertEquals(summaryOf(row, "du").description, "Du bearbeitest Tickets.");
  assertEquals(summaryOf(row, "sie").description, "Sie bearbeiten Tickets.");
  assertEquals(summaryOf(row, "sie").title, "Handbuch (Sie)");
  // No Sie text stored yet (before the next sync): fall back to du.
  assertEquals(summaryOf(row, "sie").audienceLabel, "Agenten");
  assertEquals(markdownOf(row, "du"), "Du kannst.");
  assertEquals(markdownOf(row, "sie"), "Sie können.");
  assertEquals(markdownOf({ markdown: "Du kannst." }, "sie"), "Du kannst.");
  assertEquals(summaryOf(row).description, "Du bearbeitest Tickets.");
});

Deno.test("the Sie columns are added without breaking existing rows", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../migrations/0328_handbook_formality.sql", import.meta.url),
  );
  for (const required of [
    "add column if not exists markdown_sie text",
    "add column if not exists title_sie text",
    "create or replace function public.apply_handbook_sync(",
    "item -> 'sie' ->> 'markdown'",
    "revoke all on function public.apply_handbook_sync(bigint, text)",
  ]) {
    if (!migration.includes(required)) throw new Error(`missing: ${required}`);
  }
});

Deno.test("the handbook tables are closed to clients", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../migrations/0246_handbooks.sql", import.meta.url),
  );
  for (const required of [
    "alter table public.handbook_documents enable row level security",
    "alter table public.handbook_images enable row level security",
    "revoke all on public.handbook_documents from anon, authenticated",
    "revoke all on public.handbook_images from anon, authenticated",
    "revoke all on function public.request_handbook_sync(text)",
    "revoke all on function public.apply_handbook_sync(bigint, text)",
  ]) {
    if (!migration.includes(required)) throw new Error(`missing: ${required}`);
  }
});

Deno.test("the Function is registered with JWT verification", async () => {
  const config = await Deno.readTextFile(
    new URL("../../config.toml", import.meta.url),
  );
  if (!/\[functions\.handbooks\]\nverify_jwt = true/.test(config)) {
    throw new Error(
      "config.toml must declare [functions.handbooks] verify_jwt = true",
    );
  }
});
