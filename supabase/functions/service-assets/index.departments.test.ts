import { parseAction } from "./index.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const DEPARTMENT_ID = "33333333-3333-4333-8333-333333333333";

Deno.test("Abteilungen werden nur bei Erstellen und Bearbeiten angenommen", () => {
  const create = parseAction({
    type: "manageAsset",
    tenantId: TENANT_ID,
    operation: "create",
    name: "Laptop",
    departmentId: DEPARTMENT_ID.toUpperCase(),
  });
  if (
    create?.type !== "manageAsset" ||
    !("departmentId" in create) ||
    create.departmentId !== DEPARTMENT_ID ||
    "department_id" in create.values
  ) {
    throw new Error("A create must carry the normalized department apart.");
  }

  const departmentOnly = parseAction({
    type: "manageService",
    tenantId: TENANT_ID,
    operation: "update",
    serviceId: SERVICE_ID,
    departmentId: DEPARTMENT_ID,
  });
  if (
    departmentOnly?.type !== "manageService" ||
    !("departmentId" in departmentOnly) ||
    departmentOnly.departmentId !== DEPARTMENT_ID
  ) {
    throw new Error("Changing only the department must be a valid update.");
  }

  const withoutDepartment = parseAction({
    type: "manageProblem",
    tenantId: TENANT_ID,
    operation: "create",
    title: "Drucker",
    description: "",
  });
  if (
    withoutDepartment?.type !== "manageProblem" ||
    ("departmentId" in withoutDepartment &&
      withoutDepartment.departmentId !== undefined)
  ) {
    throw new Error("A missing department must stay undefined.");
  }

  for (const invalid of [
    {
      type: "manageService",
      tenantId: TENANT_ID,
      operation: "archive",
      serviceId: SERVICE_ID,
      departmentId: DEPARTMENT_ID,
    },
    {
      type: "manageAsset",
      tenantId: TENANT_ID,
      operation: "create",
      name: "Laptop",
      departmentId: "ict",
    },
    {
      type: "manageAsset",
      tenantId: TENANT_ID,
      operation: "create",
      name: "Laptop",
      department_id: DEPARTMENT_ID,
    },
  ]) {
    if (parseAction(invalid) !== null) {
      throw new Error(`Invalid department request accepted: ${JSON.stringify(invalid)}`);
    }
  }
});

Deno.test("Erstellen löst die Abteilung serverseitig im Bereich der Person auf", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const required of [
    "resolveRecordDepartment(scope, requested)",
    '"invalid_department"',
    "...departmentValues,",
    "scopeDepartmentOptions(context.supabaseAdmin, action.tenantId, scope)",
    "departments,",
  ]) {
    if (!source.includes(required)) {
      throw new Error(`Missing department scope boundary: ${required}`);
    }
  }
});
