import { parseAction } from "./index.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";

Deno.test("Servicekategorien akzeptieren nur die explizite Create- und Update-Allowlist", () => {
  const create = parseAction({
    type: "manageServiceCategory",
    tenantId: TENANT_ID,
    operation: "create",
    name: "Fachanwendungen",
    parentId: null,
  });
  if (
    create?.type !== "manageServiceCategory" ||
    create.operation !== "create" ||
    create.name !== "Fachanwendungen" ||
    create.parentId !== null
  ) {
    throw new Error("A minimal root category must be accepted unchanged.");
  }

  const update = parseAction({
    type: "manageServiceCategory",
    tenantId: TENANT_ID,
    operation: "update",
    categoryId: CATEGORY_ID,
    name: "Finanzsysteme",
    parentId: PARENT_ID,
  });
  if (
    update?.type !== "manageServiceCategory" ||
    update.operation !== "update" ||
    update.categoryId !== CATEGORY_ID ||
    update.parentId !== PARENT_ID
  ) {
    throw new Error("A bounded category move must retain its validated IDs.");
  }

  for (
    const invalid of [
      {
        type: "manageServiceCategory",
        tenantId: TENANT_ID,
        operation: "create",
        name: "Fachanwendungen",
        parentId: null,
        active: true,
      },
      {
        type: "manageServiceCategory",
        tenantId: TENANT_ID,
        operation: "update",
        categoryId: CATEGORY_ID,
        name: "Fachanwendungen",
        parentId: "not-a-uuid",
      },
      {
        type: "manageServiceCategory",
        tenantId: TENANT_ID,
        operation: "archive",
        categoryId: CATEGORY_ID,
      },
    ]
  ) {
    if (parseAction(invalid) !== null) {
      throw new Error(
        "Unexpected category fields or operations must be rejected.",
      );
    }
  }
});

Deno.test("Servicekategorien bleiben serverseitig mandantenisoliert und dreistufig", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/0144_service_category_hierarchy.sql",
      import.meta.url,
    ),
  );

  for (
    const required of [
      'type: "manageServiceCategory"',
      'column: "service_category_id"',
      "ensureActiveServiceCategory",
      "serviceCategories",
      'p_permission_code: "asset.manage"',
    ]
  ) {
    if (!source.includes(required)) {
      throw new Error(`Missing service category server boundary: ${required}`);
    }
  }
  for (
    const required of [
      "service_categories_parent_tenant_fk",
      "services_service_category_tenant_fk",
      "validate_service_category_hierarchy",
      "validate_service_category_assignment",
      "Service categories support at most three levels",
      "pg_advisory_xact_lock",
      ":service-category-tree",
      "service_categories_manage_authorized",
      "public.is_asset_management_client_enabled(tenant_id)",
      "audit_service_category_changes",
    ]
  ) {
    if (!migration.includes(required)) {
      throw new Error(
        `Missing service category database boundary: ${required}`,
      );
    }
  }
});
