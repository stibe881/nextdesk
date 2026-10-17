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
  "0028_sla_automation_idempotency.sql",
  "0029_apply_sla_breach_atomically.sql",
  "0030_saved_ticket_views.sql",
  "0031_bulk_ticket_status_actions.sql",
  "0032_ticket_presence_indicators.sql",
  "0033_sync_comment_author_names.sql",
  "0034_ticket_tags.sql",
  "0035_comment_author_email_name_fallback.sql",
  "0036_tenant_sso_domain_routing.sql",
  "0037_tenant_people_directory.sql",
  "0038_entra_directory_people_sync.sql",
  "0039_ticket_requester_profile_offer.sql",
  "0040_retire_ticket_tags_and_assign_categories.sql",
  "0041_ticket_custom_fields.sql",
  "0042_ticket_comment_permissions.sql",
  "0043_requester_own_ticket_comments.sql",
  "0044_asset_intune_inventory_foundation.sql",
  "0045_ticket_templates_and_approval_foundation.sql",
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
  [
    "0028_sla_automation_idempotency.sql",
    "create unique index if not exists ticket_sla_events_breach_once_idx",
  ],
  [
    "0028_sla_automation_idempotency.sql",
    "create index if not exists tickets_response_sla_automation_idx",
  ],
  [
    "0029_apply_sla_breach_atomically.sql",
    "create or replace function public.apply_sla_breach",
  ],
  [
    "0029_apply_sla_breach_atomically.sql",
    "grant execute on function public.apply_sla_breach(uuid, text, uuid) to service_role",
  ],
  ["0030_saved_ticket_views.sql", "create table public.saved_ticket_views"],
  [
    "0030_saved_ticket_views.sql",
    "create policy saved_ticket_views_select_visible",
  ],
  [
    "0030_saved_ticket_views.sql",
    "public.has_tenant_permission(tenant_id, 'ticket.manage')",
  ],
  [
    "0031_bulk_ticket_status_actions.sql",
    "create or replace function public.bulk_update_ticket_statuses",
  ],
  [
    "0031_bulk_ticket_status_actions.sql",
    "Ticket update permission required for every selected ticket",
  ],
  [
    "0031_bulk_ticket_status_actions.sql",
    "grant execute on function public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text)",
  ],
  [
    "0032_ticket_presence_indicators.sql",
    "create table public.ticket_presence_sessions",
  ],
  [
    "0032_ticket_presence_indicators.sql",
    "alter table public.ticket_presence_sessions enable row level security",
  ],
  [
    "0032_ticket_presence_indicators.sql",
    "revoke all on table public.ticket_presence_sessions from public, anon, authenticated",
  ],
  [
    "0033_sync_comment_author_names.sql",
    "create or replace function public.ticket_comments_sync_author_name",
  ],
  ["0034_ticket_tags.sql", "create table public.ticket_tags"],
  ["0034_ticket_tags.sql", "create table public.ticket_tag_assignments"],
  [
    "0034_ticket_tags.sql",
    "create policy ticket_tag_assignments_select_readable_ticket",
  ],
  ["0034_ticket_tags.sql", "foreign key (ticket_id, tenant_id)"],
  [
    "0035_comment_author_email_name_fallback.sql",
    "create or replace function public.auth_profile_display_name",
  ],
  [
    "0036_tenant_sso_domain_routing.sql",
    "create table public.tenant_sso_allowed_domains",
  ],
  [
    "0036_tenant_sso_domain_routing.sql",
    "constraint tenant_sso_allowed_domains_domain_unique unique (domain)",
  ],
  [
    "0036_tenant_sso_domain_routing.sql",
    "create trigger tenant_sso_configurations_sync_domains",
  ],
  [
    "0037_tenant_people_directory.sql",
    "create table if not exists public.tenant_member_directory",
  ],
  [
    "0037_tenant_people_directory.sql",
    "foreign key (department_id, tenant_id)",
  ],
  [
    "0037_tenant_people_directory.sql",
    "revoke all on table public.tenant_member_directory from anon, authenticated",
  ],
  [
    "0038_entra_directory_people_sync.sql",
    "create table public.tenant_entra_directory_people",
  ],
  [
    "0038_entra_directory_people_sync.sql",
    "check (not agent_requested or agent_department_id is not null)",
  ],
  [
    "0038_entra_directory_people_sync.sql",
    "revoke all on table public.tenant_entra_directory_people from public, anon, authenticated",
  ],
  ["0039_ticket_requester_profile_offer.sql", "add column offer text"],
  [
    "0039_ticket_requester_profile_offer.sql",
    "ticket_requester_profiles_offer_valid",
  ],
  [
    "0040_retire_ticket_tags_and_assign_categories.sql",
    "revoke all on table public.ticket_tags, public.ticket_tag_assignments from public, anon, authenticated",
  ],
  [
    "0040_retire_ticket_tags_and_assign_categories.sql",
    "create or replace function public.apply_ticket_category_selection",
  ],
  [
    "0040_retire_ticket_tags_and_assign_categories.sql",
    "and category.parent_id is null",
  ],
  [
    "0040_retire_ticket_tags_and_assign_categories.sql",
    "and subcategory.parent_id = p_category_id",
  ],
  [
    "0040_retire_ticket_tags_and_assign_categories.sql",
    "ticket.category_changed",
  ],
  [
    "0041_ticket_custom_fields.sql",
    "create table public.ticket_custom_field_definitions",
  ],
  [
    "0041_ticket_custom_fields.sql",
    "create table public.ticket_custom_field_values",
  ],
  ["0041_ticket_custom_fields.sql", "foreign key (ticket_id, tenant_id)"],
  ["0041_ticket_custom_fields.sql", "foreign key (definition_id, tenant_id)"],
  [
    "0041_ticket_custom_fields.sql",
    "create or replace function public.apply_ticket_custom_field_values",
  ],
  [
    "0041_ticket_custom_fields.sql",
    "revoke all on table public.ticket_custom_field_definitions, public.ticket_custom_field_values from anon, authenticated",
  ],
  ["0042_ticket_comment_permissions.sql", "'ticket.comment.external'"],
  ["0043_requester_own_ticket_comments.sql", "'ticket.comment.external.own'"],
  [
    "0044_asset_intune_inventory_foundation.sql",
    "create table public.asset_locations",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "create or replace function public.ticket_template_placeholders_valid",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "foreign key (template_id, tenant_id)",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "create table public.ticket_approval_requests",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "create table public.ticket_approval_decisions",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "alter table public.ticket_approval_requests enable row level security",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "create or replace function public.create_ticket_approval_request",
  ],
  [
    "0045_ticket_templates_and_approval_foundation.sql",
    "grant execute on function public.decide_ticket_approval(uuid, uuid, uuid, text, text) to service_role",
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
