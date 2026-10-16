import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const expectedFiles = [
  "0001_extensions_and_enums.sql",
  "0002_platform_and_tenants.sql",
  "0003_identity_and_authorization.sql",
  "0004_ticketing.sql",
  "0005_rls_core.sql",
  "0006_harden_tenant_integrity_and_rbac.sql",
  "0007_tenant_provisioning_and_invitations.sql",
  "0008_tenant_administration.sql",
  "0009_ticket_dashboard_reference_reads.sql",
  "0010_platform_owner_provisioning.sql",
  "0011_tenant_user_invitations.sql",
  "0012_owner_sso_provisioning.sql",
  "0013_ticket_reference_defaults.sql",
  "0014_ticket_operations_core.sql",
  "0015_tenant_admin_email_invitation.sql",
  "0016_tenant_admin_settings_and_features.sql",
  "0017_ticket_sla_lifecycle.sql",
  "0018_private_ticket_attachments_storage.sql",
  "0019_services_assets_and_problem_management.sql",
  "0020_ticket_handover_notes.sql",
  "0021_ticket_knowledge_articles.sql",
  "0022_ticket_subcategories.sql",
  "0023_ticket_requesters.sql",
  "0024_email_requester_fallback.sql",
  "0025_tenant_administrator_operations_permissions.sql",
  "0026_remove_ambiguous_role_assignment_fk.sql",
  "0027_ticket_requester_profiles.sql",
];

const availableFiles = await readdir(migrationDirectory);
for (const migration of expectedFiles) {
  if (!availableFiles.includes(migration)) {
    throw new Error(`Missing required migration: ${migration}`);
  }
}

const contents = new Map();
for (const migration of expectedFiles) {
  const content = await readFile(
    join(migrationDirectory.pathname, migration),
    "utf8",
  );
  if (!content.trimStart().startsWith("begin;")) {
    throw new Error(`${migration} must start with an explicit transaction.`);
  }
  if (!content.trimEnd().endsWith("commit;")) {
    throw new Error(`${migration} must end with an explicit transaction.`);
  }
  contents.set(migration, content);
}

const requiredFragments = [
  ["0002_platform_and_tenants.sql", "create table public.platform_audit_logs"],
  ["0002_platform_and_tenants.sql", "create table public.tenant_domains"],
  [
    "0003_identity_and_authorization.sql",
    "create table public.customer_organizations",
  ],
  [
    "0004_ticketing.sql",
    "create or replace function public.reserve_ticket_number",
  ],
  [
    "0004_ticketing.sql",
    "visibility public.comment_visibility not null default 'internal'",
  ],
  ["0005_rls_core.sql", "alter table public.tickets enable row level security"],
  ["0005_rls_core.sql", "create policy tickets_select_authorized"],
  ["0005_rls_core.sql", "create policy ticket_comments_select_authorized"],
  [
    "0006_harden_tenant_integrity_and_rbac.sql",
    "foreign key (department_id, tenant_id)",
  ],
  [
    "0006_harden_tenant_integrity_and_rbac.sql",
    "alter table public.roles enable row level security",
  ],
  [
    "0006_harden_tenant_integrity_and_rbac.sql",
    "revoke execute on function public.reserve_ticket_number",
  ],
  [
    "0006_harden_tenant_integrity_and_rbac.sql",
    "create or replace function public.has_tenant_permission",
  ],
  [
    "0007_tenant_provisioning_and_invitations.sql",
    "create table public.tenant_invitations",
  ],
  [
    "0007_tenant_provisioning_and_invitations.sql",
    "create or replace function public.provision_tenant",
  ],
  [
    "0007_tenant_provisioning_and_invitations.sql",
    "create or replace function public.accept_current_tenant_invitation",
  ],
  [
    "0007_tenant_provisioning_and_invitations.sql",
    "create or replace function public.cancel_tenant_invitation",
  ],
  [
    "0007_tenant_provisioning_and_invitations.sql",
    "revoke all on table public.tenant_invitations",
  ],
  [
    "0008_tenant_administration.sql",
    "create or replace function public.update_tenant_settings",
  ],
  [
    "0008_tenant_administration.sql",
    "create or replace function public.create_tenant_team",
  ],
  [
    "0008_tenant_administration.sql",
    "create or replace function public.set_department_membership",
  ],
  [
    "0009_ticket_dashboard_reference_reads.sql",
    "create policy ticket_statuses_select_member",
  ],
  [
    "0009_ticket_dashboard_reference_reads.sql",
    "create policy ticket_priorities_select_member",
  ],
  [
    "0009_ticket_dashboard_reference_reads.sql",
    "create policy ticket_categories_select_member",
  ],
  [
    "0014_ticket_operations_core.sql",
    "create table public.ticket_checklist_items",
  ],
  [
    "0014_ticket_operations_core.sql",
    "create table public.ticket_sla_profiles",
  ],
  ["0014_ticket_operations_core.sql", "create table public.knowledge_articles"],
  [
    "0014_ticket_operations_core.sql",
    "create or replace function public.customer_can_read_ticket",
  ],
  [
    "0015_tenant_admin_email_invitation.sql",
    "add column if not exists role_name",
  ],
  [
    "0016_tenant_admin_settings_and_features.sql",
    "create table public.tenant_feature_flags",
  ],
  [
    "0016_tenant_admin_settings_and_features.sql",
    "create table public.tenant_sso_configurations",
  ],
  [
    "0017_ticket_sla_lifecycle.sql",
    "create or replace function public.apply_ticket_sla_on_insert",
  ],
  [
    "0017_ticket_sla_lifecycle.sql",
    "create trigger tickets_apply_sla_on_insert",
  ],
  [
    "0018_private_ticket_attachments_storage.sql",
    "insert into storage.buckets",
  ],
  [
    "0019_services_assets_and_problem_management.sql",
    "create table if not exists public.services",
  ],
  [
    "0019_services_assets_and_problem_management.sql",
    "create table if not exists public.assets",
  ],
  [
    "0019_services_assets_and_problem_management.sql",
    "create table if not exists public.problems",
  ],
  [
    "0020_ticket_handover_notes.sql",
    "create table if not exists public.ticket_handover_notes",
  ],
  [
    "0021_ticket_knowledge_articles.sql",
    "create table if not exists public.ticket_knowledge_articles",
  ],
  [
    "0021_ticket_knowledge_articles.sql",
    "create policy ticket_knowledge_articles_select_readable",
  ],
  [
    "0022_ticket_subcategories.sql",
    "add column if not exists subcategory_id uuid",
  ],
  [
    "0022_ticket_subcategories.sql",
    "create trigger tickets_validate_category_selection",
  ],
  ["0023_ticket_requesters.sql", "create table public.ticket_requesters"],
  ["0023_ticket_requesters.sql", "add column requester_contact_id uuid"],
  [
    "0023_ticket_requesters.sql",
    "create trigger tickets_validate_requester_contact",
  ],
  [
    "0024_email_requester_fallback.sql",
    "create or replace function public.validate_ticket_requester_contact()",
  ],
  [
    "0025_tenant_administrator_operations_permissions.sql",
    "'ticket.sla.manage'::text",
  ],
  [
    "0026_remove_ambiguous_role_assignment_fk.sql",
    "drop constraint if exists user_role_assignments_role_id_fkey",
  ],
  [
    "0027_ticket_requester_profiles.sql",
    "create table public.ticket_requester_profiles",
  ],
  [
    "0027_ticket_requester_profiles.sql",
    "foreign key (requester_id, tenant_id)",
  ],
];

for (const [migration, fragment] of requiredFragments) {
  if (!contents.get(migration)?.includes(fragment)) {
    throw new Error(
      `${migration} is missing required schema fragment: ${fragment}`,
    );
  }
}

console.log(
  `Validated ${expectedFiles.length} versioned migrations and ${requiredFragments.length} mandatory security/schema markers.`,
);
