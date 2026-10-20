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
  "0046_tenant_branding_logo_storage.sql",
  "0047_ticket_custom_field_layout_editor.sql",
  "0048_ticket_requester_entra_source.sql",
  "0049_knowledge_governance.sql",
  "0050_ticket_approval_cancellation.sql",
  "0051_ticket_automation_policies.sql",
  "0052_tenant_data_retention_policies.sql",
  "0053_tenant_feature_pilot_windows.sql",
  "0054_manual_automation_runs.sql",
  "0055_security_hardening_sso_roles_and_knowledge.sql",
  "0056_confirmed_bulk_ticket_closures.sql",
  "0057_experience_value_and_ai_foundation.sql",
  "0058_agent_workbench_and_requester_portal.sql",
  "0059_requester_collaboration_and_ops_foundation.sql",
  "0060_push_notifications.sql",
  "0061_exchange_online_mail.sql",
  "0062_push_work_checkins.sql",
  "0063_follow_up_reminders.sql",
  "0064_department_questions.sql",
  "0065_department_question_delivery_authorization.sql",
  "0066_entra_requester_department_profiles.sql",
  "0067_exchange_mail_channel_configuration_revision.sql",
  "0068_delegated_exchange_mail_connections.sql",
  "0069_optional_portal_name.sql",
  "0071_exchange_mail_private_storage_rpc.sql",
  "0072_delegated_mailbox_address_drafts.sql",
  "0073_exchange_mail_worker_dispatch_body.sql",
  "0074_ticket_requester_email_upsert_constraint.sql",
  "0075_confirmed_bulk_ticket_deletion.sql",
  "0076_authorized_ticket_list_sorting.sql",
  "0077_entra_agent_assignment_provenance.sql",
  "0078_fix_entra_agent_directory_assignment.sql",
  "0079_list_pending_sla_breaches.sql",
  "0080_harden_sla_breach_feature_gate.sql",
  "0081_entra_directory_configuration_management.sql",
  "0082_tenant_administrator_ticket_delete_permission.sql",
  "0083_asset_intune_local_preflight_control.sql",
  "0084_harden_asset_feature_gate_membership.sql",
  "0085_harden_sso_provisioning_offboarding.sql",
  "0086_controlled_ticket_automation_execution.sql",
  "0087_cascade_ticket_followups_and_confirmations.sql",
  "0088_knowledge_collection_hierarchy.sql",
  "0089_event_space_requests.sql",
  "0090_employee_onboarding.sql",
  "0091_knowledge_fulltext_search.sql",
  "0092_global_workspace_fulltext_search.sql",
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
  ["0046_tenant_branding_logo_storage.sql", "'tenant-branding'"],
  [
    "0047_ticket_custom_field_layout_editor.sql",
    "ticket_custom_field_sections",
  ],
  [
    "0048_ticket_requester_entra_source.sql",
    "source in ('portal', 'manual', 'email', 'entra')",
  ],
  ["0049_knowledge_governance.sql", "knowledge_collections"],
  ["0050_ticket_approval_cancellation.sql", "cancel_ticket_approval("],
  ["0051_ticket_automation_policies.sql", "tenant_automation_policies"],
  ["0052_tenant_data_retention_policies.sql", "tenant_data_retention_policies"],
  [
    "0053_tenant_feature_pilot_windows.sql",
    "tenant_feature_flags_pilot_ends_at_check",
  ],
  ["0054_manual_automation_runs.sql", "tenant_automation_runs"],
  [
    "0055_security_hardening_sso_roles_and_knowledge.sql",
    "Knowledge publication denied",
  ],
  [
    "0055_security_hardening_sso_roles_and_knowledge.sql",
    "prevent_last_tenant_administrator_revocation",
  ],
  [
    "0056_confirmed_bulk_ticket_closures.sql",
    "Bulk ticket close confirmation required",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "('experience.workspace', 'Arbeitsbereich'",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "('portal.self-service', 'Self-Service'",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "('ai.assist', 'KI-Assistenz'",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "create table public.experience_follow_ups",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "create table public.ticket_resolution_confirmations",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "create table public.tenant_ai_provider_approvals",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "create or replace function public.queue_ai_draft_request",
  ],
  [
    "0057_experience_value_and_ai_foundation.sql",
    "alter table public.ai_draft_requests force row level security",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "('agent.workbench', 'Agentenwerkbank'",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "('requester.portal', 'Anfragendenportal'",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "create table public.tenant_macros",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "create table public.ticket_mentions",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "create table public.agent_delegations",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "create table public.service_incident_notices",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "create table public.ticket_reopen_requests",
  ],
  [
    "0058_agent_workbench_and_requester_portal.sql",
    "alter table public.ticket_reopen_requests force row level security",
  ],
  [
    "0059_requester_collaboration_and_ops_foundation.sql",
    "'requester.department-view',",
  ],
  ["0059_requester_collaboration_and_ops_foundation.sql", "'portal',\n  false"],
  [
    "0059_requester_collaboration_and_ops_foundation.sql",
    "create table public.outbound_events",
  ],
  [
    "0059_requester_collaboration_and_ops_foundation.sql",
    "alter table public.outbound_events force row level security",
  ],
  [
    "0059_requester_collaboration_and_ops_foundation.sql",
    "revoke all on table public.outbound_events from public, anon, authenticated",
  ],
  [
    "0059_requester_collaboration_and_ops_foundation.sql",
    "grant select, insert, update, delete on table public.outbound_events to service_role",
  ],
  ["0060_push_notifications.sql", "create table public.push_devices"],
  ["0060_push_notifications.sql", "create table public.push_preferences"],
  ["0060_push_notifications.sql", "create table public.push_outbox"],
  ["0060_push_notifications.sql", "create schema if not exists push_private"],
  [
    "0060_push_notifications.sql",
    "create trigger push_enqueue_ticket_notification",
  ],
  [
    "0060_push_notifications.sql",
    "grant execute on function public.push_claim_outbox(integer) to service_role",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create table if not exists public.exchange_mail_channels",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create table if not exists public.exchange_mail_subscriptions",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create table if not exists public.mail_messages",
  ],
  [
    "0061_exchange_online_mail.sql",
    "alter table public.exchange_mail_channels force row level security",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create or replace function public.exchange_mail_verify_dispatch_secret",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create trigger exchange_mail_enqueue_agent_reply",
  ],
  [
    "0061_exchange_online_mail.sql",
    "create or replace function public.exchange_mail_kick_maintenance()",
  ],
  ["0062_push_work_checkins.sql", "create table public.push_work_checkins"],
  [
    "0062_push_work_checkins.sql",
    "alter table public.push_work_checkins force row level security",
  ],
  [
    "0062_push_work_checkins.sql",
    "create or replace function public.push_work_state",
  ],
  ["0062_push_work_checkins.sql", "last_error = 'off_shift'"],
  [
    "0063_follow_up_reminders.sql",
    "add column if not exists reminder_sent_at timestamptz",
  ],
  [
    "0063_follow_up_reminders.sql",
    "create or replace function public.follow_up_send_due_reminders()",
  ],
  ["0063_follow_up_reminders.sql", "'nextdesk-follow-up-reminders'"],
  [
    "0064_department_questions.sql",
    "create table public.ticket_department_questions",
  ],
  [
    "0065_department_question_delivery_authorization.sql",
    "create or replace function public.department_question_delivery_authorized",
  ],
  [
    "0066_entra_requester_department_profiles.sql",
    "create or replace function public.sync_entra_directory_requesters",
  ],
  [
    "0067_exchange_mail_channel_configuration_revision.sql",
    "add column if not exists configuration_version bigint not null default 1",
  ],
  [
    "0068_delegated_exchange_mail_connections.sql",
    "create table if not exists public.exchange_mail_connections",
  ],
  ["0069_optional_portal_name.sql", "alter column portal_name drop not null"],
  [
    "0071_exchange_mail_private_storage_rpc.sql",
    "create or replace function public.exchange_mail_create_oauth_state",
  ],
  [
    "0076_authorized_ticket_list_sorting.sql",
    "create or replace function public.list_authorized_ticket_list_page",
  ],
  [
    "0076_authorized_ticket_list_sorting.sql",
    "revoke all on function public.list_authorized_ticket_list_page",
  ],
  [
    "0077_entra_agent_assignment_provenance.sql",
    "create or replace function public.set_entra_agent_request",
  ],
  [
    "0077_entra_agent_assignment_provenance.sql",
    "create or replace function public.apply_entra_agent_request",
  ],
  [
    "0077_entra_agent_assignment_provenance.sql",
    "grant execute on function public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid) to service_role",
  ],
  [
    "0077_entra_agent_assignment_provenance.sql",
    "create trigger user_role_assignments_protect_entra_agent_assignment",
  ],
  [
    "0077_entra_agent_assignment_provenance.sql",
    "entra_agent_assignment_managed_separately",
  ],
  [
    "0078_fix_entra_agent_directory_assignment.sql",
    "values (p_tenant_id, v_person.local_user_id, p_department_id)",
  ],
  [
    "0079_list_pending_sla_breaches.sql",
    "create or replace function public.list_pending_sla_breaches",
  ],
  [
    "0079_list_pending_sla_breaches.sql",
    "revoke all on function public.list_pending_sla_breaches(text, integer)",
  ],
  [
    "0079_list_pending_sla_breaches.sql",
    "grant execute on function public.list_pending_sla_breaches(text, integer)\n  to service_role",
  ],
  ["0080_harden_sla_breach_feature_gate.sql", "for share"],
  [
    "0080_harden_sla_breach_feature_gate.sql",
    "feature.feature_key = 'automation.sla'",
  ],
  [
    "0080_harden_sla_breach_feature_gate.sql",
    "revoke all on function public.apply_sla_breach(uuid, text, uuid) from public, anon, authenticated",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.trusted_entra_tenant_id_for_tenant",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.configure_entra_directory_sync",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.record_entra_directory_connection_test",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "grant execute on function public.record_entra_directory_connection_test(uuid, uuid, uuid, bigint, boolean) to service_role",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.claim_entra_directory_sync_run",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "revoke all on function public.claim_entra_directory_sync_run(uuid, uuid, uuid) from public, anon, authenticated",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.assert_fenced_entra_directory_sync_run",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.upsert_fenced_entra_directory_people_batch",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "create or replace function public.finalize_fenced_entra_directory_sync_run",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "revoke all on function public.upsert_fenced_entra_directory_people_batch(uuid, uuid, uuid, bigint, uuid, timestamptz, jsonb) from public, anon, authenticated",
  ],
  [
    "0081_entra_directory_configuration_management.sql",
    "grant execute on function public.finalize_fenced_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid, timestamptz, integer) to service_role",
  ],
  [
    "0082_tenant_administrator_ticket_delete_permission.sql",
    "create trigger roles_grant_ticket_delete_to_tenant_administrator",
  ],
  ["0082_tenant_administrator_ticket_delete_permission.sql", "'ticket.delete'"],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create or replace function public.configure_asset_intune_preflight",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create or replace function public.run_asset_intune_local_preflight",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "and provider_contacted = false",
  ],
  ["0083_asset_intune_local_preflight_control.sql", "set sync_enabled = false"],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "feature.pilot_ends_at > timezone('utc', now())",
  ],
  ["0083_asset_intune_local_preflight_control.sql", "':preflight-retry:'"],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create trigger problems_validate_active_owner",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create or replace function public.is_asset_management_client_enabled",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "and public.is_asset_management_client_enabled(tenant_id)",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create table if not exists public.asset_intune_asset_links",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "revoke all on table public.asset_intune_asset_links, public.asset_identifiers,",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "set metadata = public.strip_private_asset_provider_metadata(metadata)",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create trigger assets_reject_private_provider_metadata",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create or replace function public.strip_private_asset_provider_metadata",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "create index if not exists asset_intune_asset_links_tenant_external_device_idx",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "alter table public.assets drop column if exists intune_device_id",
  ],
  [
    "0083_asset_intune_local_preflight_control.sql",
    "grant execute on function public.run_asset_intune_local_preflight(uuid, uuid, uuid, uuid)\n  to service_role",
  ],
  [
    "0084_harden_asset_feature_gate_membership.sql",
    "select public.is_active_tenant_member(p_tenant_id)",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "add column if not exists accepted_by uuid references auth.users(id)",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "create or replace function public.claim_verified_tenant_sso_membership",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "create or replace function public.claim_current_tenant_user_invitation",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "and invitation.email = lower(trim(p_email::text))::citext",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "create trigger tenant_memberships_prevent_removed_reactivation",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "create or replace function public.revoke_tenant_user_invitation",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "and user_id = v_invitation.accepted_by",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "if v_invitation.status not in ('pending', 'sent', 'failed', 'accepted') then",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "and status in ('sent', 'accepted');",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "revoke all on function public.claim_verified_tenant_sso_membership(uuid, uuid, citext)",
  ],
  [
    "0085_harden_sso_provisioning_offboarding.sql",
    "grant execute on function public.claim_current_tenant_user_invitation(uuid, citext, uuid)\n  to service_role",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "create table if not exists public.tenant_automation_confirmation_requests",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "cardinality(ticket_ids) between 1 and 8",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "create or replace function public.prepare_ticket_automation_auto_close",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "create or replace function public.execute_ticket_automation_auto_close",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "nullif(current_setting('request.jwt.claim.role', true), '')",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "v_policy.updated_at is distinct from v_request.policy_updated_at",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "revoke all on table public.tenant_automation_confirmation_requests from public, anon, authenticated",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "tenant_automation_confirmation_one_pending_idx",
  ],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "'tenant_automation_confirmation_request',\n    null,",
  ],
  ["0086_controlled_ticket_automation_execution.sql", "else 'invalidated'"],
  [
    "0086_controlled_ticket_automation_execution.sql",
    "grant execute on function public.execute_ticket_automation_auto_close(uuid, uuid)\n  to service_role",
  ],
  [
    "0087_cascade_ticket_followups_and_confirmations.sql",
    "foreign key (ticket_id, tenant_id)\n  references public.tickets (id, tenant_id)\n  on delete cascade",
  ],
  [
    "0087_cascade_ticket_followups_and_confirmations.sql",
    "drop constraint if exists ticket_resolution_confirmations_ticket_tenant_fk",
  ],
  [
    "0089_event_space_requests.sql",
    "create table if not exists public.event_spaces",
  ],
  [
    "0089_event_space_requests.sql",
    "create table if not exists public.event_space_requests",
  ],
  [
    "0089_event_space_requests.sql",
    "foreign key (space_id, tenant_id)\n    references public.event_spaces (id, tenant_id)",
  ],
  ["0089_event_space_requests.sql", "event_space_requests_singleton_valid"],
  [
    "0089_event_space_requests.sql",
    "create trigger event_space_task_templates_seed",
  ],
  [
    "0089_event_space_requests.sql",
    "revoke all on table public.event_spaces, public.event_space_task_templates,",
  ],
  [
    "0089_event_space_requests.sql",
    "create or replace function public.has_event_space_permission",
  ],
  [
    "0089_event_space_requests.sql",
    "create or replace function public.create_event_space_request_series",
  ],
  ["0089_event_space_requests.sql", "pg_advisory_xact_lock"],
  ["0089_event_space_requests.sql", "responsible_user_id uuid not null"],
  ["0089_event_space_requests.sql", "p_conflict_snapshot text"],
  ["0089_event_space_requests.sql", "Europe/Zurich"],
  [
    "0090_employee_onboarding.sql",
    "create table if not exists public.onboarding_entries",
  ],
  [
    "0090_employee_onboarding.sql",
    "create table if not exists public.onboarding_tasks",
  ],
  [
    "0090_employee_onboarding.sql",
    "create table if not exists public.onboarding_exception_tickets",
  ],
  [
    "0090_employee_onboarding.sql",
    "create or replace function public.create_onboarding_entry",
  ],
  [
    "0090_employee_onboarding.sql",
    "revoke all on table public.onboarding_templates",
  ],
  [
    "0091_knowledge_fulltext_search.sql",
    "knowledge_article_revisions_title_search_document_idx",
  ],
  [
    "0091_knowledge_fulltext_search.sql",
    "knowledge_article_revisions_apply_title_snapshot",
  ],
  [
    "0091_knowledge_fulltext_search.sql",
    "create or replace function public.search_knowledge_article_ids",
  ],
  ["0091_knowledge_fulltext_search.sql", "revision.title_snapshot"],
  [
    "0091_knowledge_fulltext_search.sql",
    "grant execute on function public.search_knowledge_article_ids(uuid, text, boolean, uuid[]) to service_role",
  ],
  [
    "0092_global_workspace_fulltext_search.sql",
    "create or replace function public.search_global_workspace",
  ],
  [
    "0092_global_workspace_fulltext_search.sql",
    "public.can_read_ticket(ticket.id)",
  ],
  [
    "0092_global_workspace_fulltext_search.sql",
    "follow_up.owner_id = auth.uid()",
  ],
  ["0092_global_workspace_fulltext_search.sql", "v_knowledge_feature_enabled"],
  ["0092_global_workspace_fulltext_search.sql", "v_experience_feature_enabled"],
  ["0092_global_workspace_fulltext_search.sql", "v_can_manage_onboarding"],
  [
    "0092_global_workspace_fulltext_search.sql",
    "entry.manager_user_id = auth.uid()",
  ],
  [
    "0092_global_workspace_fulltext_search.sql",
    "entry.ict_responsible_user_id = auth.uid()",
  ],
  [
    "0092_global_workspace_fulltext_search.sql",
    "grant execute on function public.search_global_workspace(uuid, text, integer)\n  to authenticated, service_role",
  ],
];

for (const [migration, fragment] of requiredFragments) {
  if (!contents.get(migration)?.includes(fragment)) {
    throw new Error(
      `${migration} is missing required schema fragment: ${fragment}`,
    );
  }
}

if (
  contents
    .get("0083_asset_intune_local_preflight_control.sql")
    ?.includes("execute format(")
) {
  throw new Error(
    "0083_asset_intune_local_preflight_control.sql must keep explicit audited RLS policies instead of dynamic SQL.",
  );
}

const functionConfiguration = await readFile(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
if (
  !functionConfiguration.includes(
    "[functions.entra-directory-sync]\nverify_jwt = true",
  )
) {
  throw new Error(
    "entra-directory-sync must explicitly require verified user JWTs.",
  );
}
if (
  !functionConfiguration.includes(
    "[functions.asset-registry]\nverify_jwt = true",
  )
) {
  throw new Error("asset-registry must explicitly require verified user JWTs.");
}
if (
  !functionConfiguration.includes(
    "[functions.intune-asset-sync]\nverify_jwt = true",
  )
) {
  throw new Error(
    "intune-asset-sync must explicitly require verified user JWTs while provider sync is disabled.",
  );
}
if (
  !functionConfiguration.includes(
    "[functions.tenant-sso-access]\nverify_jwt = true",
  )
) {
  throw new Error(
    "tenant-sso-access must explicitly require verified user JWTs.",
  );
}
if (
  !functionConfiguration.includes("[functions.tenant-users]\nverify_jwt = true")
) {
  throw new Error("tenant-users must explicitly require verified user JWTs.");
}
if (
  !functionConfiguration.includes(
    "[functions.ticket-automation]\nverify_jwt = true",
  )
) {
  throw new Error(
    "ticket-automation must explicitly require verified user JWTs.",
  );
}
if (
  !functionConfiguration.includes("[functions.event-spaces]\nverify_jwt = true")
) {
  throw new Error("event-spaces must explicitly require verified user JWTs.");
}
if (
  !functionConfiguration.includes("[functions.onboarding]\nverify_jwt = true")
) {
  throw new Error("onboarding must explicitly require verified user JWTs.");
}
if (
  !functionConfiguration.includes(
    "[functions.global-search]\nverify_jwt = true",
  )
) {
  throw new Error("global-search must explicitly require verified user JWTs.");
}

console.log(
  `Validated ${expectedFiles.length} versioned migrations and ${requiredFragments.length} mandatory security/schema markers.`,
);
