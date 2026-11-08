import { parseAction } from "./actions.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const LICENSE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parseAction accepts the reclaim actions", () => {
  assert(
    parseAction({ type: "overview", tenantId: TENANT })?.type === "overview",
    "overview",
  );
  const assign = parseAction({
    type: "assign",
    tenantId: TENANT,
    licenseId: LICENSE,
    userId: USER.toUpperCase(),
    note: "  Projekt  X ",
  });
  assert(assign?.type === "assign" && assign.userId === USER, "assign by user");
  assert(
    assign?.type === "assign" && assign.note === "Projekt X",
    "note cleaned",
  );
  const release = parseAction({
    type: "release",
    tenantId: TENANT,
    assignmentId: LICENSE,
    removeM365: true,
  });
  assert(
    release?.type === "release" && release.removeM365,
    "release with M365",
  );
  const settings = parseAction({
    type: "saveSettings",
    tenantId: TENANT,
    inactivityDays: 60,
    useEntraSignIn: true,
    allowM365Removal: false,
  });
  assert(
    settings?.type === "saveSettings" && settings.inactivityDays === 60,
    "settings",
  );
});

Deno.test("parseAction rejects invalid input", () => {
  assert(parseAction({ type: "overview", tenantId: "x" }) === null, "tenant");
  assert(parseAction({ type: "delete", tenantId: TENANT }) === null, "unknown");
  assert(
    parseAction({ type: "assign", tenantId: TENANT, licenseId: LICENSE }) ===
      null,
    "assignee required",
  );
  assert(
    parseAction({
      type: "assign",
      tenantId: TENANT,
      licenseId: LICENSE,
      userId: "nope",
    }) === null,
    "bad user",
  );
  assert(
    parseAction({
      type: "release",
      tenantId: TENANT,
      assignmentId: LICENSE,
      removeM365: "yes",
    }) === null,
    "boolean flag",
  );
  for (const days of [6, 366, 30.5]) {
    assert(
      parseAction({
        type: "saveSettings",
        tenantId: TENANT,
        inactivityDays: days,
        useEntraSignIn: true,
        allowM365Removal: false,
      }) === null,
      `days ${days}`,
    );
  }
});
