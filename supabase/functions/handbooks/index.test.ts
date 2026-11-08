import {
  allowedHandbookIds,
  handbookAccessFromAssignments,
  type HandbookRoleAssignment,
} from "../_shared/handbook-access.ts";
import { HANDBOOK_IMAGES, HANDBOOKS } from "./content.generated.ts";
import { inlineHandbookImages, parseHandbookAction } from "./index.ts";

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
  "generated content covers all handbooks with resolvable images",
  () => {
    assertEquals(
      HANDBOOKS.map((handbook) => handbook.id),
      ["mitarbeitende", "agenten", "administratoren", "installation"],
    );
    for (const handbook of HANDBOOKS) {
      const inlined = inlineHandbookImages(handbook.markdown, HANDBOOK_IMAGES);
      if (/\]\(images\//.test(inlined)) {
        throw new Error(`${handbook.id}: unresolved image reference`);
      }
    }
  },
);

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
