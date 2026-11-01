import { readFile } from "node:fs/promises";

const catalogPath = new URL(
  "../packages/permissions/src/catalog.ts",
  import.meta.url,
);
const baseMigrationPath = new URL(
  "../supabase/migrations/0006_harden_tenant_integrity_and_rbac.sql",
  import.meta.url,
);
const operationsMigrationPath = new URL(
  "../supabase/migrations/0014_ticket_operations_core.sql",
  import.meta.url,
);
const savedViewsMigrationPath = new URL(
  "../supabase/migrations/0030_saved_ticket_views.sql",
  import.meta.url,
);
const requesterCommentMigrationPath = new URL(
  "../supabase/migrations/0043_requester_own_ticket_comments.sql",
  import.meta.url,
);
const assetIntegrationMigrationPath = new URL(
  "../supabase/migrations/0044_asset_intune_inventory_foundation.sql",
  import.meta.url,
);
const ticketApprovalMigrationPath = new URL(
  "../supabase/migrations/0045_ticket_templates_and_approval_foundation.sql",
  import.meta.url,
);
const eventSpacesMigrationPath = new URL(
  "../supabase/migrations/0089_event_space_requests.sql",
  import.meta.url,
);
const onboardingMigrationPath = new URL(
  "../supabase/migrations/0090_employee_onboarding.sql",
  import.meta.url,
);
const contractsMigrationPath = new URL(
  "../supabase/migrations/0100_contracts_module_foundation.sql",
  import.meta.url,
);
const inventoryMigrationPath = new URL(
  "../supabase/migrations/0115_inventory_foundation_part_01.sql",
  import.meta.url,
);
const shopMigrationPath = new URL(
  "../supabase/migrations/0154_self_service_shop.sql",
  import.meta.url,
);
const catalog = await readFile(catalogPath, "utf8");
const migrations = await Promise.all([
  readFile(baseMigrationPath, "utf8"),
  readFile(operationsMigrationPath, "utf8"),
  readFile(savedViewsMigrationPath, "utf8"),
  readFile(requesterCommentMigrationPath, "utf8"),
  readFile(assetIntegrationMigrationPath, "utf8"),
  readFile(ticketApprovalMigrationPath, "utf8"),
  readFile(eventSpacesMigrationPath, "utf8"),
  readFile(onboardingMigrationPath, "utf8"),
  readFile(contractsMigrationPath, "utf8"),
  readFile(inventoryMigrationPath, "utf8"),
  readFile(shopMigrationPath, "utf8"),
]);
const migration = migrations.join("\n");

const catalogSection = catalog.match(
  /export const permissionCodes = \[(?<items>[\s\S]*?)\] as const;/,
)?.groups?.items;
if (!catalogSection) {
  throw new Error("Cannot find the TypeScript permission catalogue.");
}

const sourceCodes = [...catalogSection.matchAll(/"(?<code>[^"]+)"/g)].map(
  (match) => match.groups.code,
);
const seededCodes = [
  ...migration.matchAll(/\('(?<code>[^']+)', '[^']+', (?:true|false)\)/g),
].map((match) => match.groups.code);

const missingInSeed = sourceCodes.filter((code) => !seededCodes.includes(code));
const staleSeed = seededCodes.filter((code) => !sourceCodes.includes(code));
if (missingInSeed.length || staleSeed.length) {
  throw new Error(
    `Permission catalogue mismatch. Missing in SQL: ${missingInSeed.join(", ") || "none"}; stale in SQL: ${staleSeed.join(", ") || "none"}.`,
  );
}

console.log(
  `Validated ${sourceCodes.length} permission codes against the database seed migration.`,
);
