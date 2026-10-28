#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="$(pg_config --bindir)"
TEST_DIR="$(mktemp -d /tmp/nextdesk-pg.XXXXXX)"
PG_DATA="$TEST_DIR/data"
PG_SOCKET="$TEST_DIR/socket"
PG_PORT="$((54000 + RANDOM % 1000))"
PG_USER="nextdesk_test"

cleanup() {
  if [[ -f "$PG_DATA/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --auth=trust --username="$PG_USER" --no-instructions >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-k $PG_SOCKET -p $PG_PORT" -w start >/dev/null

export PGHOST="$PG_SOCKET"
export PGPORT="$PG_PORT"
export PGUSER="$PG_USER"
export PGDATABASE="postgres"

psql -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create publication supabase_realtime;
SQL

for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == "0083_asset_intune_local_preflight_control.sql" ]]; then
    # Seed the historical representation immediately before 0083. The old
    # worker stored external device IDs in browser-readable JSON metadata and
    # allowed case-different duplicate IDs. The upgrade must stay available,
    # preserve both private lookup links and remove every public JSON copy.
    psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.tenants (id, slug, name) values
  ('f0000000-0000-4000-8000-000000000001', 'legacy-intune-upgrade', 'Legacy Intune Upgrade');
insert into public.assets (
  id, tenant_id, name, kind, status, metadata
) values
  (
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'Legacy Intune Asset A',
    'computer',
    'active',
    jsonb_build_object(
      'source', 'intune',
      'external_device_id', 'Legacy-Meta-Device',
      'keep', 'A',
      'provider', jsonb_build_object(
        'external_device_id', 'nested-legacy-device',
        'user_display_name', 'Private Legacy Person',
        'keep', 'nested-A'
      ),
      'array', jsonb_build_array(
        jsonb_build_object('managed_device_id', 'nested-array-device', 'keep', 'array-A')
      )
    )
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001',
    'Legacy Intune Asset B',
    'computer',
    'active',
    jsonb_build_object('source', 'intune', 'external_device_id', 'legacy-meta-device', 'keep', 'B')
  );
SQL
  fi
  if [[ "$(basename "$migration")" == "0088_knowledge_collection_hierarchy.sql" ]]; then
    # Reproduce the completed import's category and assignment shape immediately
    # before the hierarchy migration. The versioned fixture contains no article
    # contents or personal data.
    psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.tenants (id, slug, name) values
  ('f9010000-0000-4000-8000-000000000001', 'legacy-knowledge-import', 'Legacy Knowledge Import');
SQL
    psql -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/tests/fixtures/knowledge-legacy-import-sanitised.sql"
  fi
  if [[ "$(basename "$migration")" == "0109_personal_saved_ticket_views.sql" ]]; then
    # Reproduce a legacy shared view immediately before the owner-only upgrade.
    psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.tenants (id, slug, name) values
  ('f9090000-0000-4000-8000-000000000001', 'legacy-saved-view-upgrade', 'Legacy Saved View Upgrade');
insert into auth.users (id) values
  ('f9090000-0000-4000-8000-000000000001');
insert into public.user_profiles (id, display_name) values
  ('f9090000-0000-4000-8000-000000000001', 'Legacy Saved View Owner');
insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters) values
  (
    'f9090000-0000-4000-8000-000000000001',
    'f9090000-0000-4000-8000-000000000001',
    'Frühere Mandantenansicht',
    'tenant',
    '{"query":"legacy","queue":"alle","ticketScope":"open"}'
  );
SQL
  fi
  psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

realtime_ticket_tables="$(psql -At -c "
  select string_agg(tablename, ',' order by tablename)
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename in ('tickets', 'ticket_comments')
" | tr -d '\n')"
[[ "$realtime_ticket_tables" == "ticket_comments,tickets" ]]

legacy_saved_view_visibility="$(psql -At -c "
  select visibility
  from public.saved_ticket_views
  where tenant_id = 'f9090000-0000-4000-8000-000000000001'
    and owner_id = 'f9090000-0000-4000-8000-000000000001'
    and name = 'Frühere Mandantenansicht'
" | tr -d '\n')"
[[ "$legacy_saved_view_visibility" == "private" ]]

# A completed hierarchy migration must not touch legacy category timestamps or
# create a second migration audit record if it is accidentally replayed.
legacy_hierarchy_before="$(psql -At -c "
  select string_agg(id::text || ':' || updated_at::text, ',' order by id)
  from public.knowledge_collections
  where tenant_id = 'f9010000-0000-4000-8000-000000000001'
" | tr -d '\n')"
legacy_hierarchy_audits_before="$(psql -At -c "
  select count(*)
  from public.audit_logs
  where tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and action = 'knowledge.legacy_import.category_hierarchy'
" | tr -d '\n')"
psql -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/migrations/0088_knowledge_collection_hierarchy.sql" >/dev/null
legacy_hierarchy_after="$(psql -At -c "
  select string_agg(id::text || ':' || updated_at::text, ',' order by id)
  from public.knowledge_collections
  where tenant_id = 'f9010000-0000-4000-8000-000000000001'
" | tr -d '\n')"
legacy_hierarchy_audits_after="$(psql -At -c "
  select count(*)
  from public.audit_logs
  where tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and action = 'knowledge.legacy_import.category_hierarchy'
" | tr -d '\n')"
[[ "$legacy_hierarchy_before" == "$legacy_hierarchy_after" ]]
[[ "$legacy_hierarchy_audits_before" == "$legacy_hierarchy_audits_after" ]]

psql -v ON_ERROR_STOP=1 <<'SQL'
-- The test grants only emulate Supabase API read privileges; the migrations still provide RLS.
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.tickets, public.ticket_comments, public.ticket_statuses, public.ticket_priorities, public.ticket_categories to authenticated;

-- Migration 0088 must transform the full synthetic legacy import without
-- changing article-to-category links.
do $$
declare
  v_root_count integer;
  v_subcategory_count integer;
  v_linked_article_count integer;
  v_article_assignment_count integer;
begin
  select count(*) into v_root_count
  from public.knowledge_collections
  where tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
    and parent_id is null;
  select count(*) into v_subcategory_count
  from public.knowledge_collections as collection
  where collection.tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and collection.slug like 'legacy-folder-%'
    and collection.parent_id is not null;
  select count(distinct assignment.article_id) into v_linked_article_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  where assignment.tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and collection.slug like 'legacy-folder-%';
  select count(*) into v_article_assignment_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  where assignment.tenant_id = 'f9010000-0000-4000-8000-000000000001'
    and collection.slug like 'legacy-folder-%';
  if v_root_count <> 2
    or v_subcategory_count <> 27
    or v_linked_article_count <> 64
    or v_article_assignment_count <> 64 then
    raise exception 'Legacy knowledge hierarchy migration did not preserve the expected import shape';
  end if;
end;
$$;

-- Knowledge collections support exactly one tenant-local subcategory level.
insert into public.tenants (id, slug, name) values
  ('f9000000-0000-4000-8000-000000000001', 'knowledge-hierarchy-test', 'Knowledge hierarchy test'),
  ('f9000000-0000-4000-8000-000000000002', 'knowledge-hierarchy-foreign', 'Knowledge hierarchy foreign');
insert into public.knowledge_collections (id, tenant_id, name, slug) values
  ('f9000000-0000-4000-8000-000000000010', 'f9000000-0000-4000-8000-000000000001', 'Hauptkategorie', 'main-category'),
  ('f9000000-0000-4000-8000-000000000011', 'f9000000-0000-4000-8000-000000000001', 'Unterkategorie', 'sub-category'),
  ('f9000000-0000-4000-8000-000000000012', 'f9000000-0000-4000-8000-000000000002', 'Fremde Hauptkategorie', 'foreign-main-category');
update public.knowledge_collections
   set parent_id = 'f9000000-0000-4000-8000-000000000010'
 where id = 'f9000000-0000-4000-8000-000000000011';
do $$
begin
  begin
    insert into public.knowledge_collections (tenant_id, name, slug, parent_id)
    values (
      'f9000000-0000-4000-8000-000000000001',
      'Dritte Ebene',
      'third-level',
      'f9000000-0000-4000-8000-000000000011'
    );
    raise exception 'A third knowledge category level was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.knowledge_collections
       set parent_id = 'f9000000-0000-4000-8000-000000000011'
     where id = 'f9000000-0000-4000-8000-000000000010';
    raise exception 'A root category with a child was allowed to become a subcategory';
  exception when check_violation then
    null;
  end;

  begin
    update public.knowledge_collections
       set parent_id = 'f9000000-0000-4000-8000-000000000012'
     where id = 'f9000000-0000-4000-8000-000000000011';
    raise exception 'A category accepted a parent from another tenant';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

-- Migration 0083 must safely migrate old browser-visible metadata identifiers.
-- A case-different collision represents an ambiguous scan, never a migration
-- failure and never an arbitrary device-to-asset association.
do $$
begin
  if exists (
    select 1
    from public.assets asset
    where asset.tenant_id = 'f0000000-0000-4000-8000-000000000001'
      and (
        asset.metadata ? 'external_device_id'
        or asset.metadata #> '{provider,external_device_id}' is not null
        or asset.metadata #> '{provider,user_display_name}' is not null
        or asset.metadata #> '{array,0,managed_device_id}' is not null
      )
  ) then
    raise exception 'Legacy Intune external device ID remained in public asset metadata';
  end if;
  if (
    select count(*)
    from public.asset_intune_asset_links link
    where link.tenant_id = 'f0000000-0000-4000-8000-000000000001'
      and link.canonical_external_device_id = 'legacy-meta-device'
  ) <> 2 then
    raise exception 'Legacy case-different Intune device IDs were not preserved as ambiguous private links';
  end if;
  if not exists (
    select 1
    from public.assets asset
    where asset.id = 'f1000000-0000-4000-8000-000000000001'
      and asset.metadata->>'source' = 'intune'
      and asset.metadata->>'keep' = 'A'
      and asset.metadata #>> '{provider,keep}' = 'nested-A'
      and asset.metadata #>> '{array,0,keep}' = 'array-A'
  ) then
    raise exception 'Unrelated legacy asset metadata was not retained during provider metadata cleanup';
  end if;
end;
$$;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-000000000006');

insert into public.user_profiles (id, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'Requester A'),
  ('00000000-0000-4000-8000-000000000002', 'ICT Agent A'),
  ('00000000-0000-4000-8000-000000000003', 'Requester B'),
  ('00000000-0000-4000-8000-000000000004', 'Member B');

insert into public.tenants (id, slug, name) values
  ('10000000-0000-4000-8000-000000000001', 'tenant-a', 'Tenant A'),
  ('20000000-0000-4000-8000-000000000002', 'tenant-b', 'Tenant B');

insert into public.departments (id, tenant_id, key, name, kind) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ict', 'ICT', 'ict'),
  ('12000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'infrastructure', 'Infrastructure', 'infrastructure'),
  ('21000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'ict', 'ICT B', 'ict');

insert into public.tenant_memberships (tenant_id, user_id, status, joined_at) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'active', now()),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'active', now()),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'active', now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'active', now());

-- An enabled SSO company domain is a single-tenant routing key. It must be
-- normalized, materialized privately and never be claimable by tenant B.
update public.tenant_sso_configurations
set provider = 'azure_ad',
    enabled = true,
    issuer_url = 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0',
    allowed_email_domains = array['  Tenant-A.Example  ']
where tenant_id = '10000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.tenant_sso_allowed_domains
    where tenant_id = '10000000-0000-4000-8000-000000000001'
      and domain = 'tenant-a.example'
  ) then
    raise exception 'Enabled tenant SSO domain was not materialized';
  end if;

  begin
    update public.tenant_sso_configurations
    set provider = 'azure_ad',
        enabled = true,
        issuer_url = 'https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0',
        allowed_email_domains = array['tenant-a.example']
    where tenant_id = '20000000-0000-4000-8000-000000000002';
    raise exception 'Duplicate tenant SSO domain was accepted';
  exception when unique_violation then
    null;
  end;
end;
$$;

update public.tenant_sso_configurations
set enabled = false
where tenant_id = '10000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1 from public.tenant_sso_allowed_domains
    where tenant_id = '10000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Disabled tenant SSO still retained a routing domain';
  end if;
end;
$$;

insert into public.department_memberships (department_id, tenant_id, user_id, status) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'active');

insert into public.ticket_statuses (id, tenant_id, key, label, sort_order) values
  ('13000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'open', 'Open', 1),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'open', 'Open', 1);
insert into public.ticket_priorities (id, tenant_id, key, label, sort_order) values
  ('14000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'test_normal', 'Test Normal', 90),
  ('24000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'test_normal', 'Test Normal', 90);
insert into public.ticket_categories (id, tenant_id, department_id, name) values
  ('13500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Hardware'),
  ('23500000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003', 'Hardware B');
insert into public.ticket_categories (id, tenant_id, department_id, parent_id, name) values
  ('13600000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '13500000-0000-4000-8000-000000000001', 'Drucker');

insert into public.roles (id, tenant_id, name, scope) values
  ('15000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Requester', 'tenant'),
  ('16000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ICT agent', 'department'),
  ('16500000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Tenant admin', 'tenant');
insert into public.role_permissions (role_id, permission_code) values
  ('15000000-0000-4000-8000-000000000001', 'ticket.read.own'),
  ('15000000-0000-4000-8000-000000000001', 'ticket.manage'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.read.department'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.internal_notes.read'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.update'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.close'),
  ('16500000-0000-4000-8000-000000000002', 'tenant.settings.manage');
insert into public.user_role_assignments (tenant_id, user_id, role_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001');
insert into public.user_role_assignments (tenant_id, user_id, role_id, department_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001');
insert into public.user_role_assignments (tenant_id, user_id, role_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '16500000-0000-4000-8000-000000000002');

insert into public.tickets (id, tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id) values
  ('17000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-000001', 'ICT test', 'Visible for ICT', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'INF-2026-000001', 'Infrastructure test', 'Hidden from ICT', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
insert into public.ticket_tags (id, tenant_id, name, created_by) values
  ('17500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Dringend', '00000000-0000-4000-8000-000000000002'),
  ('27500000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Extern', '00000000-0000-4000-8000-000000000004');
insert into public.ticket_tag_assignments (ticket_id, tag_id, tenant_id, added_by) values
  ('17000000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

-- The category procedure only permits a matching root category and direct child
-- from the ticket's own tenant and department. It also supports clearing the
-- category selection atomically.
begin;
set local role service_role;
do $$
declare
  selection jsonb;
begin
  select public.apply_ticket_category_selection(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '17000000-0000-4000-8000-000000000001',
    '13500000-0000-4000-8000-000000000001',
    '13600000-0000-4000-8000-000000000001'
  ) into selection;
  if selection->>'categoryId' <> '13500000-0000-4000-8000-000000000001'
    or selection->>'subcategoryId' <> '13600000-0000-4000-8000-000000000001'
    or not coalesce((selection->>'changed')::boolean, false) then
    raise exception 'Category selection procedure did not assign the selected hierarchy';
  end if;
  begin
    perform public.apply_ticket_category_selection(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '17000000-0000-4000-8000-000000000001',
      '23500000-0000-4000-8000-000000000002',
      null
    );
    raise exception 'Cross-tenant category selection was accepted';
  exception when invalid_parameter_value then
    null;
  end;
  perform public.apply_ticket_category_selection(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '17000000-0000-4000-8000-000000000001',
    null,
    null
  );
end;
$$;
reset role;
do $$
begin
  if exists (
    select 1 from public.tickets
    where id = '17000000-0000-4000-8000-000000000001'
      and (category_id is not null or subcategory_id is not null)
  ) then
    raise exception 'Category selection procedure did not clear the hierarchy';
  end if;
end;
$$;
rollback;
insert into public.ticket_comments (ticket_id, author_id, body) values
  ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Internal ICT note');

-- Custom field definitions and values are only changeable by privileged service
-- commands. The command binds both definition and ticket to Tenant A and the
-- ticket's own department before accepting a typed value.
begin;
set local role service_role;
do $$
declare
  v_definition jsonb;
  v_changed integer;
  v_version bigint;
begin
  select (public.list_ticket_custom_field_layout(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001'
  )->>'version')::bigint into v_version;
  select public.upsert_ticket_custom_field_definition(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    null,
    'asset_location',
    'Gerätestandort',
    'select',
    false,
    '["Büro", "Homeoffice"]'::jsonb,
    v_version
  ) into v_definition;
  if v_definition->>'fieldKey' <> 'asset_location' then
    raise exception 'Custom field definition was not created';
  end if;

  select public.apply_ticket_custom_field_values(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '17000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('definitionId', v_definition->>'id', 'value', 'Homeoffice'))
  ) into v_changed;
  if v_changed <> 1 then
    raise exception 'Custom field value was not applied';
  end if;

  begin
    perform public.apply_ticket_custom_field_values(
      '00000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',
      '17000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object('definitionId', v_definition->>'id', 'value', 'Büro'))
    );
    raise exception 'Cross-tenant custom field update was accepted';
  exception when no_data_found then
    null;
  end;
end;
$$;
reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.ticket_custom_field_definitions', 'select')
    or has_table_privilege('authenticated', 'public.ticket_custom_field_values', 'insert') then
    raise exception 'Authenticated users must not directly access custom field tables';
  end if;
end;
$$;
rollback;

-- Every visible canvas mutation is versioned. Active positions remain
-- contiguous, retired fields follow them, and palette creation is atomic.
begin;
set local role service_role;
do $$
declare
  v_actor_id uuid := '00000000-0000-4000-8000-000000000002';
  v_tenant_id uuid := '10000000-0000-4000-8000-000000000001';
  v_source_section uuid;
  v_target_section uuid;
  v_alpha uuid;
  v_beta uuid;
  v_gamma uuid;
  v_version bigint;
  v_stale_version bigint;
  v_result jsonb;
  v_keys text[];
  v_active_positions integer[];
  v_retired_position integer;
begin
  select (public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->>'version')::bigint
  into v_version;
  select public.save_ticket_custom_field_section(
    v_actor_id, v_tenant_id, null, 'Positionsquelle', v_version
  ) into v_result;
  v_source_section := (v_result->>'id')::uuid;
  v_version := (v_result->>'version')::bigint;

  select public.save_ticket_custom_field_section(
    v_actor_id, v_tenant_id, null, 'Positionsziel', v_version
  ) into v_result;
  v_target_section := (v_result->>'id')::uuid;
  v_version := (v_result->>'version')::bigint;

  select public.create_ticket_custom_field_definition_at_position(
    v_actor_id, v_tenant_id, 'dnd_alpha', 'Alpha', 'text', false,
    '[]'::jsonb, v_source_section, 0, v_version
  ) into v_result;
  v_alpha := (v_result->>'id')::uuid;
  v_version := (v_result->>'layoutVersion')::bigint;

  select public.create_ticket_custom_field_definition_at_position(
    v_actor_id, v_tenant_id, 'dnd_beta', 'Beta', 'text', false,
    '[]'::jsonb, v_source_section, 1, v_version
  ) into v_result;
  v_beta := (v_result->>'id')::uuid;
  v_version := (v_result->>'layoutVersion')::bigint;

  select public.create_ticket_custom_field_definition_at_position(
    v_actor_id, v_tenant_id, 'dnd_gamma', 'Gamma', 'text', false,
    '[]'::jsonb, v_source_section, 2, v_version
  ) into v_result;
  v_gamma := (v_result->>'id')::uuid;
  v_version := (v_result->>'layoutVersion')::bigint;

  v_stale_version := v_version;
  select public.retire_ticket_custom_field_definition(
    v_actor_id, v_tenant_id, v_beta, v_version
  ) into v_result;
  v_version := (v_result->>'version')::bigint;

  begin
    perform public.move_ticket_custom_field_definition(
      v_actor_id, v_tenant_id, v_gamma, v_source_section, 0, v_stale_version
    );
    raise exception 'Retiring a field did not invalidate the stale layout version';
  exception when raise_exception then
    if sqlerrm <> 'layout_version_conflict' then raise; end if;
  end;

  select array_agg(definition->>'fieldKey' order by (definition->>'position')::integer),
         array_agg((definition->>'position')::integer order by (definition->>'position')::integer)
  into v_keys, v_active_positions
  from jsonb_array_elements(
    public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
  ) as definition
  where definition->>'sectionId' = v_source_section::text
    and (definition->>'active')::boolean;
  if v_keys is distinct from array['dnd_alpha', 'dnd_gamma']
    or v_active_positions is distinct from array[0, 1] then
    raise exception 'Retiring a middle field did not repack the active canvas: %, %',
      v_keys, v_active_positions;
  end if;

  select (definition->>'position')::integer into v_retired_position
  from jsonb_array_elements(
    public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
  ) as definition
  where definition->>'id' = v_beta::text;
  if v_retired_position <> 2 then
    raise exception 'Retired definition did not follow active definitions: %', v_retired_position;
  end if;

  select public.move_ticket_custom_field_definition(
    v_actor_id, v_tenant_id, v_gamma, v_source_section, 0, v_version
  ) into v_version;
  select array_agg(definition->>'fieldKey' order by (definition->>'position')::integer)
  into v_keys
  from jsonb_array_elements(
    public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
  ) as definition
  where definition->>'sectionId' = v_source_section::text
    and (definition->>'active')::boolean;
  if v_keys is distinct from array['dnd_gamma', 'dnd_alpha'] then
    raise exception 'Active same-section move did not honour the requested position: %', v_keys;
  end if;

  select public.move_ticket_custom_field_definition(
    v_actor_id, v_tenant_id, v_alpha, v_target_section, 0, v_version
  ) into v_version;
  select public.move_ticket_custom_field_definition(
    v_actor_id, v_tenant_id, v_gamma, v_target_section, 1, v_version
  ) into v_version;
  select array_agg(definition->>'fieldKey' order by (definition->>'position')::integer)
  into v_keys
  from jsonb_array_elements(
    public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
  ) as definition
  where definition->>'sectionId' = v_target_section::text
    and (definition->>'active')::boolean;
  if v_keys is distinct from array['dnd_alpha', 'dnd_gamma'] then
    raise exception 'Cross-section move did not honour active positions: %', v_keys;
  end if;

  v_stale_version := v_version;
  select public.update_ticket_custom_field_definition_at_position(
    v_actor_id, v_tenant_id, v_alpha, 'dnd_alpha', 'Alpha aktualisiert',
    'text', true, '[]'::jsonb, v_source_section, 0, v_version
  ) into v_result;
  v_version := (v_result->>'layoutVersion')::bigint;
  if (v_result->>'id')::uuid <> v_alpha then
    raise exception 'Atomic field update did not return the edited definition';
  end if;

  select array_agg(definition->>'fieldKey' order by (definition->>'position')::integer)
  into v_keys
  from jsonb_array_elements(
    public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
  ) as definition
  where definition->>'sectionId' = v_source_section::text
    and (definition->>'active')::boolean;
  if v_keys is distinct from array['dnd_alpha'] then
    raise exception 'Atomic field update did not move the field into the selected section: %', v_keys;
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(
      public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
    ) as definition
    where definition->>'id' = v_alpha::text
      and definition->>'label' = 'Alpha aktualisiert'
      and (definition->>'required')::boolean
      and definition->>'sectionId' = v_source_section::text
  ) then
    raise exception 'Atomic field update did not persist the definition and placement together';
  end if;

  begin
    perform public.update_ticket_custom_field_definition_at_position(
      v_actor_id, v_tenant_id, v_gamma, 'dnd_gamma', 'Gamma veraltet',
      'text', false, '[]'::jsonb, v_source_section, 1, v_stale_version
    );
    raise exception 'Atomic field update accepted a stale layout version';
  exception when raise_exception then
    if sqlerrm <> 'layout_version_conflict' then raise; end if;
  end;
  if not exists (
    select 1
    from jsonb_array_elements(
      public.list_ticket_custom_field_layout(v_actor_id, v_tenant_id)->'definitions'
    ) as definition
    where definition->>'id' = v_gamma::text
      and definition->>'label' = 'Gamma'
      and definition->>'sectionId' = v_target_section::text
  ) then
    raise exception 'Stale atomic field update left a partial mutation behind';
  end if;

  begin
    perform public.move_ticket_custom_field_definition(
      v_actor_id, v_tenant_id, v_beta, v_target_section, 0, v_version
    );
    raise exception 'Retired definition remained movable';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  select public.upsert_ticket_custom_field_definition(
    v_actor_id, v_tenant_id, v_beta, 'dnd_beta', 'Beta', 'text', false,
    '[]'::jsonb, v_version
  ) into v_result;
  v_version := (v_result->>'layoutVersion')::bigint;
  if not (v_result->>'active')::boolean then
    raise exception 'Reactivated definition did not become active';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_ticket_custom_field_definition(uuid, uuid, uuid, text, text, text, boolean, jsonb)',
    'execute'
  ) or has_function_privilege(
    'service_role',
    'public.retire_ticket_custom_field_definition(uuid, uuid, uuid)',
    'execute'
  ) then
    raise exception 'Legacy unversioned custom field mutations remain executable';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.create_ticket_custom_field_definition_at_position(uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint)',
    'execute'
  ) then
    raise exception 'Versioned atomic custom field creation is not executable';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.update_ticket_custom_field_definition_at_position(uuid, uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint)',
    'execute'
  ) then
    raise exception 'Versioned atomic custom field editing is not executable';
  end if;
end;
$$;
reset role;
rollback;

insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Privat A', 'private', '{"query":"intern","queue":"alle","ticketScope":"all"}'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Privat Agent A', 'private', '{"query":"","queue":"alle","ticketScope":"open"}'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'Privat B', 'private', '{"query":"","queue":"alle","ticketScope":"closed"}');

insert into public.tenant_member_directory (tenant_id, user_id, department_id, job_title, offer) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'Support Engineer', 'Arbeitsplatz');

insert into public.tenant_entra_directory_sync_configurations (tenant_id, entra_tenant_id, enabled) values
  ('10000000-0000-4000-8000-000000000001', 'b47990ca-e841-4d86-9517-82f60623ed26', true);
insert into public.tenant_entra_directory_people (
  tenant_id, entra_object_id, email, display_name, job_title, source_department_name,
  local_user_id
) values (
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'neue.person@beispiel-a.ch',
  'Neue Person',
  'Mitarbeiterin',
  'ICT',
  '00000000-0000-4000-8000-000000000001'
);

do $$
begin
  if has_table_privilege('authenticated', 'public.tenant_member_directory', 'select')
    or has_table_privilege('authenticated', 'public.tenant_member_directory', 'insert') then
    raise exception 'Authenticated users must not access tenant_member_directory directly';
  end if;

  begin
    insert into public.tenant_member_directory (tenant_id, user_id, department_id)
    values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000003'
    );
    raise exception 'Cross-tenant department assignment was accepted';
  exception when foreign_key_violation then
    null;
  end;

  if has_table_privilege('authenticated', 'public.tenant_entra_directory_people', 'select')
    or has_table_privilege('authenticated', 'public.tenant_entra_directory_people', 'insert') then
    raise exception 'Authenticated users must not access tenant_entra_directory_people directly';
  end if;

  begin
    insert into public.tenant_entra_directory_people (
      tenant_id, entra_object_id, email, display_name, agent_requested, agent_department_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'cross-tenant.agent@beispiel-a.ch',
      'Cross Tenant Agent',
      true,
      '21000000-0000-4000-8000-000000000003'
    );
    raise exception 'Cross-tenant Entra agent department assignment was accepted';
  exception when foreign_key_violation or check_violation then
    null;
  end;
end;
$$;

-- The batch operation is executable only by the Edge Function service role. It
-- is atomic and retains department isolation for the actor supplied by that
-- function.
do $$
declare
  result jsonb;
begin
  if to_regprocedure('public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text)') is not null then
    raise exception 'The obsolete unconfirmed bulk status signature still exists';
  end if;
  if has_function_privilege('authenticated', 'public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text, boolean)', 'execute') then
    raise exception 'authenticated may execute bulk_update_ticket_statuses';
  end if;
  if not has_function_privilege('service_role', 'public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text, boolean)', 'execute') then
    raise exception 'service_role may not execute bulk_update_ticket_statuses';
  end if;

  begin
    perform public.bulk_update_ticket_statuses(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array['17000000-0000-4000-8000-000000000001']::uuid[],
      'closed',
      false
    );
    raise exception 'Unconfirmed bulk close was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Bulk ticket close confirmation required' then
      raise;
    end if;
  end;

  result := public.bulk_update_ticket_statuses(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    array['17000000-0000-4000-8000-000000000001']::uuid[],
    'closed',
    true
  );
  if (result->>'requested')::integer <> 1
    or (result->>'updated')::integer <> 1
    or result->>'statusKey' <> 'closed' then
    raise exception 'Bulk ticket status result was incomplete';
  end if;
  if not exists (
    select 1
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.id = '17000000-0000-4000-8000-000000000001'
      and status.key = 'closed'
      and ticket.closed_at is not null
  ) then
    raise exception 'Authorized bulk close did not update the ticket';
  end if;
  if not exists (
    select 1
    from public.ticket_events
    where ticket_id = '17000000-0000-4000-8000-000000000001'
      and actor_id = '00000000-0000-4000-8000-000000000002'
      and event_type = 'ticket.bulk_status_updated'
  ) then
    raise exception 'Bulk status action did not record a ticket event';
  end if;

  begin
    perform public.bulk_update_ticket_statuses(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array['18000000-0000-4000-8000-000000000002']::uuid[],
      'closed',
      true
    );
    raise exception 'ICT agent updated an unauthorized Infrastructure ticket';
  exception when insufficient_privilege then
    null;
  end;
  if not exists (
    select 1
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.id = '18000000-0000-4000-8000-000000000002'
      and status.key = 'open'
      and ticket.closed_at is null
  ) then
    raise exception 'Denied bulk update partially changed an unauthorized ticket';
  end if;
end;
$$;

-- Enforce cross-tenant FK integrity.
do $$
begin
  begin
    insert into public.tickets (tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id)
    values ('10000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000003', 'BAD-2026-000001', 'Invalid relation', 'Must be rejected', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
    raise exception 'Cross-tenant ticket relationship was accepted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.ticket_tag_assignments (ticket_id, tag_id, tenant_id)
    values (
      '17000000-0000-4000-8000-000000000001',
      '27500000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'Cross-tenant ticket tag assignment was accepted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

-- Sensitive tables must have RLS; ticket number reservation must not be a client RPC.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array['roles', 'role_permissions', 'user_role_assignments', 'ticket_number_sequences', 'ticket_statuses', 'ticket_priorities', 'ticket_categories', 'ticket_presence_sessions', 'ticket_tags', 'ticket_tag_assignments', 'ticket_custom_field_definitions', 'ticket_custom_field_values']
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', relation_name)::regclass) then
      raise exception 'RLS not enabled for %', relation_name;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.reserve_ticket_number(uuid,uuid,text,integer)', 'execute') then
    raise exception 'authenticated may execute reserve_ticket_number';
  end if;
  if has_function_privilege('authenticated', 'public.provision_tenant(uuid,citext,text,uuid,jsonb)', 'execute') then
    raise exception 'authenticated may execute provision_tenant';
  end if;
  if not has_function_privilege('service_role', 'public.provision_tenant(uuid,citext,text,uuid,jsonb)', 'execute') then
    raise exception 'service_role may not execute provision_tenant';
  end if;
  if has_table_privilege('authenticated', 'public.ticket_presence_sessions', 'select')
    or has_table_privilege('authenticated', 'public.ticket_presence_sessions', 'insert') then
    raise exception 'authenticated may access ticket presence sessions directly';
  end if;
end;
$$;

-- Provisioning requires a fresh MFA-verified platform operator and creates isolated defaults.
insert into public.platform_administrators (user_id, enabled, mfa_verified_at)
values ('00000000-0000-4000-8000-000000000001', true, timezone('utc', now()));

do $$
declare
  tenant_c_id uuid;
begin
  tenant_c_id := public.provision_tenant(
    '00000000-0000-4000-8000-000000000001',
    'tenant-c',
    'Tenant C',
    '00000000-0000-4000-8000-000000000004',
    '[{"key":"ict","name":"ICT","kind":"ict"},{"key":"infrastructure","name":"Infrastructure","kind":"infrastructure"}]'::jsonb
  );

  if not exists (select 1 from public.tenant_settings where tenant_id = tenant_c_id) then
    raise exception 'Tenant provisioning did not create settings';
  end if;
  if (select count(*) from public.departments where tenant_id = tenant_c_id) <> 2 then
    raise exception 'Tenant provisioning did not create both departments';
  end if;
  if not public.user_has_tenant_permission('00000000-0000-4000-8000-000000000004', tenant_c_id, 'user.manage') then
    raise exception 'Initial tenant administrator lacks user.manage';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.provision_tenant(
      '00000000-0000-4000-8000-000000000002',
      'tenant-denied',
      'Denied Tenant',
      '00000000-0000-4000-8000-000000000002',
      '[{"key":"ict","name":"ICT","kind":"ict"}]'::jsonb
    );
    raise exception 'Non-operator was allowed to provision a tenant';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

do $$
declare
  tenant_c_id uuid;
  invitation_id uuid;
begin
  select id into tenant_c_id from public.tenants where slug = 'tenant-c';
  invitation_id := public.prepare_tenant_invitation(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    'invitee@example.ch'::citext
  );
  perform public.record_tenant_invitation_delivery(
    '00000000-0000-4000-8000-000000000004',
    invitation_id,
    '00000000-0000-4000-8000-000000000005'
  );
  if not exists (
    select 1 from public.tenant_memberships
    where tenant_id = tenant_c_id
      and user_id = '00000000-0000-4000-8000-000000000005'
      and status = 'invited'
  ) then
    raise exception 'Delivered invitation did not create invited membership';
  end if;
end;
$$;

begin;
select set_config('app.test.invitation_id', id::text, true),
       set_config('app.test.tenant_id', tenant_id::text, true)
from public.tenant_invitations
where email = 'invitee@example.ch'::citext;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000005';
set local role authenticated;
do $$
declare
  tenant_c_id uuid;
begin
  tenant_c_id := current_setting('app.test.tenant_id')::uuid;
  if public.accept_current_tenant_invitation(current_setting('app.test.invitation_id')::uuid) <> tenant_c_id then
    raise exception 'Invitation acceptance returned the wrong tenant';
  end if;
end;
$$;
reset role;
commit;

do $$
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id
    where tenant.slug = 'tenant-c'
      and membership.user_id = '00000000-0000-4000-8000-000000000005'
      and membership.status = 'active'
  ) then
    raise exception 'Invitation acceptance did not activate the membership';
  end if;
end;
$$;

-- Re-inviting a previously privileged but removed user must expire historic roles.
do $$
declare
  tenant_c_id uuid;
  tenant_admin_role_id uuid;
  reinvitation_id uuid;
begin
  select id into tenant_c_id from public.tenants where slug = 'tenant-c';
  select id into tenant_admin_role_id from public.roles where tenant_id = tenant_c_id and name = 'Tenant administrator';

  insert into public.user_role_assignments (tenant_id, user_id, role_id, assigned_by)
  values (tenant_c_id, '00000000-0000-4000-8000-000000000005', tenant_admin_role_id, '00000000-0000-4000-8000-000000000004');
  if not public.user_has_tenant_permission('00000000-0000-4000-8000-000000000005', tenant_c_id, 'user.manage') then
    raise exception 'Test fixture did not grant historical tenant administrator role';
  end if;

  update public.tenant_memberships
  set status = 'removed'
  where tenant_id = tenant_c_id
    and user_id = '00000000-0000-4000-8000-000000000005';

  reinvitation_id := public.prepare_tenant_invitation(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    'invitee@example.ch'::citext
  );
  perform public.record_tenant_invitation_delivery(
    '00000000-0000-4000-8000-000000000004',
    reinvitation_id,
    '00000000-0000-4000-8000-000000000005'
  );
  if exists (
    select 1 from public.user_role_assignments
    where tenant_id = tenant_c_id
      and user_id = '00000000-0000-4000-8000-000000000005'
      and role_id = tenant_admin_role_id
      and expires_at is null
  ) then
    raise exception 'Re-invite retained a privileged role';
  end if;
end;
$$;

begin;
select set_config('app.test.invitation_id', id::text, true)
from public.tenant_invitations
where email = 'invitee@example.ch'::citext and status = 'sent';
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000005';
set local role authenticated;
select public.accept_current_tenant_invitation(current_setting('app.test.invitation_id')::uuid);
reset role;
commit;

do $$
declare
  tenant_c_id uuid;
begin
  select id into tenant_c_id from public.tenants where slug = 'tenant-c';
  if public.user_has_tenant_permission('00000000-0000-4000-8000-000000000005', tenant_c_id, 'user.manage') then
    raise exception 'Re-invited user regained a privileged role';
  end if;
end;
$$;

do $$
declare
  tenant_c_id uuid;
  cancellation_id uuid;
begin
  select id into tenant_c_id from public.tenants where slug = 'tenant-c';
  cancellation_id := public.prepare_tenant_invitation(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    'cancel@example.ch'::citext
  );
  perform public.record_tenant_invitation_delivery(
    '00000000-0000-4000-8000-000000000004', cancellation_id, '00000000-0000-4000-8000-000000000006');
  perform public.cancel_tenant_invitation('00000000-0000-4000-8000-000000000004', cancellation_id);
  if not exists (select 1 from public.tenant_invitations where id = cancellation_id and status = 'cancelled')
    or not exists (
      select 1 from public.tenant_memberships
      where tenant_id = tenant_c_id
        and user_id = '00000000-0000-4000-8000-000000000006'
        and status = 'removed'
    ) then
    raise exception 'Invitation cancellation did not remove the staged membership';
  end if;
end;
$$;

do $$
declare
  tenant_c_id uuid;
  tenant_c_ict_id uuid;
  team_id uuid;
begin
  select id into tenant_c_id from public.tenants where slug = 'tenant-c';
  select id into tenant_c_ict_id from public.departments where tenant_id = tenant_c_id and key = 'ict';

  perform public.update_tenant_settings(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    'Tenant C Helpdesk',
    'support@tenant-c.example.ch',
    true,
    true
  );
  if not exists (
    select 1 from public.tenant_settings
    where tenant_id = tenant_c_id
      and portal_name = 'Tenant C Helpdesk'
      and allow_external_ticket_access
  ) then
    raise exception 'Tenant settings update was not persisted';
  end if;

  update public.tenant_settings
  set portal_name = null
  where tenant_id = tenant_c_id;
  if exists (
    select 1 from public.tenant_settings
    where tenant_id = tenant_c_id
      and portal_name is not null
  ) then
    raise exception 'An explicitly removed portal name was not persisted as null';
  end if;

  team_id := public.create_tenant_team(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    tenant_c_ict_id,
    'ICT Operations'
  );
  if not exists (select 1 from public.teams where id = team_id and tenant_id = tenant_c_id) then
    raise exception 'Tenant team was not created';
  end if;

  perform public.set_department_membership(
    '00000000-0000-4000-8000-000000000004',
    tenant_c_id,
    tenant_c_ict_id,
    '00000000-0000-4000-8000-000000000005',
    'active'
  );
  if not exists (
    select 1 from public.department_memberships
    where department_id = tenant_c_ict_id
      and user_id = '00000000-0000-4000-8000-000000000005'
      and status = 'active'
  ) then
    raise exception 'Department membership was not persisted';
  end if;
end;
$$;

-- RLS behavior: ICT agent only sees ICT, requester sees own but not internal notes, Tenant B sees none of Tenant A.
begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$
begin
  if (select count(*) from public.tickets) <> 1 then
    raise exception 'ICT agent must see exactly one ICT ticket';
  end if;
  if (select count(*) from public.ticket_comments) <> 1 then
    raise exception 'ICT agent must see the internal ICT note';
  end if;
  if has_table_privilege('authenticated', 'public.ticket_tags', 'select')
    or has_table_privilege('authenticated', 'public.ticket_tag_assignments', 'select') then
    raise exception 'Authenticated users must not retain access to retired ticket tags';
  end if;
  begin
    insert into public.ticket_tags (tenant_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Unzulässig');
    raise exception 'Authenticated client was allowed to create a retired ticket tag directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.apply_ticket_category_selection(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '17000000-0000-4000-8000-000000000001',
      '13500000-0000-4000-8000-000000000001',
      null
    );
    raise exception 'Authenticated client was allowed to call the privileged category procedure directly';
  exception when insufficient_privilege then
    null;
  end;
  if not exists (select 1 from public.ticket_statuses)
    or not exists (select 1 from public.ticket_priorities)
    or not exists (select 1 from public.ticket_categories)
    or exists (select 1 from public.ticket_statuses where tenant_id <> '10000000-0000-4000-8000-000000000001')
    or exists (select 1 from public.ticket_priorities where tenant_id <> '10000000-0000-4000-8000-000000000001')
    or exists (select 1 from public.ticket_categories where tenant_id <> '10000000-0000-4000-8000-000000000001') then
    raise exception 'ICT agent must only see dashboard reference data from Tenant A';
  end if;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if (select count(*) from public.tickets) <> 1 then
    raise exception 'Requester must see exactly one own ticket';
  end if;
  if (select count(*) from public.ticket_comments) <> 0 then
    raise exception 'Requester must not see internal comments';
  end if;
end;
$$;
reset role;
rollback;

begin;
select set_config('app.test.tenant_c_id', id::text, true)
from public.tenants
where slug = 'tenant-c';
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if (select count(*) from public.tickets) <> 0 then
    raise exception 'Tenant B member must not see Tenant A tickets';
  end if;
  if not exists (select 1 from public.ticket_statuses)
    or not exists (select 1 from public.ticket_priorities)
    or not exists (select 1 from public.ticket_categories)
    or exists (select 1 from public.ticket_statuses where tenant_id not in ('20000000-0000-4000-8000-000000000002', current_setting('app.test.tenant_c_id')::uuid))
    or exists (select 1 from public.ticket_priorities where tenant_id not in ('20000000-0000-4000-8000-000000000002', current_setting('app.test.tenant_c_id')::uuid))
    or exists (select 1 from public.ticket_categories where tenant_id not in ('20000000-0000-4000-8000-000000000002', current_setting('app.test.tenant_c_id')::uuid)) then
    raise exception 'Tenant B member must only see reference data from active memberships';
  end if;
end;
$$;
reset role;
rollback;

-- Saved views are personal. Even a tenant administrator cannot read, change or
-- delete another member's saved filters through direct table access.
begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if (select count(*) from public.saved_ticket_views) <> 1 then
    raise exception 'Tenant A administrator must see only own saved views';
  end if;
  update public.saved_ticket_views
  set name = 'Unzulässig verwaltet'
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and owner_id = '00000000-0000-4000-8000-000000000002';
  if found then
    raise exception 'Tenant administrator could update another personal view';
  end if;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$
begin
  if (select count(*) from public.saved_ticket_views) <> 0 then
    raise exception 'Tenant A member must not see another personal view';
  end if;
  insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters)
  values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Privat B', 'private', '{"query":"","queue":"alle","ticketScope":"all"}');
  begin
    insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters)
    values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Unzulässig', 'private', '{"query":"","queue":"alle","ticketScope":"all"}');
    raise exception 'Member was allowed to create a view for another owner';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters)
    values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Mandantenweit', 'tenant', '{"query":"","queue":"alle","ticketScope":"all"}');
    raise exception 'Member was allowed to create a tenant-shared view';
  exception when check_violation or insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if (select count(*) from public.saved_ticket_views) <> 1
    or exists (select 1 from public.saved_ticket_views where tenant_id <> '20000000-0000-4000-8000-000000000002') then
    raise exception 'Tenant B member must not see Tenant A saved views';
  end if;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000006';
set local role authenticated;
do $$
begin
  if (select count(*) from public.saved_ticket_views) <> 0 then
    raise exception 'User without an active membership must not see saved views';
  end if;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000006';
set local role authenticated;
do $$
begin
  if (select count(*) from public.ticket_statuses) <> 0
    or (select count(*) from public.ticket_priorities) <> 0
    or (select count(*) from public.ticket_categories) <> 0 then
    raise exception 'User without an active membership must not see dashboard reference data';
  end if;
end;
$$;
reset role;
rollback;

-- A knowledge author may draft internal ticket knowledge, but publishing an
-- external article from a ticket requires the separate knowledge.publish grant.
insert into public.roles (id, tenant_id, name, scope) values
  ('16600000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Knowledge author', 'tenant');
insert into public.role_permissions (role_id, permission_code) values
  ('16600000-0000-4000-8000-000000000002', 'ticket.update'),
  ('16600000-0000-4000-8000-000000000002', 'knowledge.manage');
insert into public.user_role_assignments (tenant_id, user_id, role_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '16600000-0000-4000-8000-000000000002');

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$
begin
  begin
    perform public.ticket_knowledge_mutate(
      'createAndAttach',
      '10000000-0000-4000-8000-000000000001',
      '17000000-0000-4000-8000-000000000001',
      null,
      'external',
      'Unfreigegebene externe Anleitung',
      'Darf ohne knowledge.publish nicht extern sichtbar werden.'
    );
    raise exception 'Knowledge author published ticket knowledge without knowledge.publish';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

-- The database rejects revoking the final active Tenant administrator even if
-- a future caller bypasses the Edge Function's own preflight.
insert into public.roles (id, tenant_id, name, scope) values
  ('16700000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Tenant administrator', 'tenant');
insert into public.user_role_assignments (id, tenant_id, user_id, role_id) values
  ('16800000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '16700000-0000-4000-8000-000000000002');

do $$
begin
  begin
    update public.user_role_assignments
    set expires_at = timezone('utc', now())
    where id = '16800000-0000-4000-8000-000000000002';
    raise exception 'Final Tenant administrator assignment was revoked';
  exception when check_violation then
    null;
  end;
end;
$$;

-- 0057 Experience/KI foundation: a Tenant A record must not be observable by
-- a Tenant B member, and anon retains no table privilege.  The AI queue is
-- metadata-only and has no browser table grant at all.
insert into public.workspace_preferences (tenant_id, user_id, preferences)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{"theme":"dark","density":"compact"}'::jsonb
);
insert into public.experience_follow_ups (
  tenant_id, owner_id, ticket_id, title, description, due_at, priority
) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  'Rückfrage', 'Rückfrage nach Abschluss', timezone('utc', now()), 'normal'
);
insert into public.ticket_resolution_confirmations (
  tenant_id, ticket_id, confirmed_by, confirmed, comment
) values (
  '10000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001', true, 'Bestätigt'
);
insert into public.tenant_ai_provider_approvals (
  tenant_id, provider_key, enabled, allowed_purposes, approved_by, approved_at
) values (
  '10000000-0000-4000-8000-000000000001',
  'nextdesk-managed', true, array['general_draft']::text[],
  '00000000-0000-4000-8000-000000000001', timezone('utc', now())
);
insert into public.tenant_ai_provider_approvals (
  tenant_id, provider_key, enabled, allowed_purposes,
  allow_external_article_content, approved_by, approved_at
) values (
  '10000000-0000-4000-8000-000000000001',
  'anthropic', true,
  array['general_draft', 'knowledge_article_draft']::text[],
  true,
  '00000000-0000-4000-8000-000000000001', timezone('utc', now())
);

begin;
set local role service_role;
do $$
declare
  queued uuid;
begin
  select request_id into queued
  from public.queue_ai_draft_request(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'nextdesk-managed', 'general_draft', 'none', null, 12, 16, 1, false
  );
  if queued is null then
    raise exception 'AI metadata queue did not return a request id';
  end if;
  select request_id into queued
  from public.queue_ai_draft_request(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'anthropic', 'general_draft', 'none', null, 12, 16, 1, false
  );
  if queued is null then
    raise exception 'Anthropic AI metadata queue did not return a request id';
  end if;
end;
$$;
reset role;
commit;

-- 0095: a tenant's explicit provider approval does not implicitly permit
-- external article content. The atomic queue must reject it before a provider
-- call can occur, even for a not-yet-saved article.
begin;
update public.tenant_ai_provider_approvals
set allow_external_article_content = false
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and provider_key = 'anthropic';
set local role service_role;
do $$
begin
  begin
    perform public.queue_ai_draft_request(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      'anthropic', 'general_draft', 'none', null, 12, 16, 1, true
    );
    raise exception 'External article content was queued without explicit approval';
  exception when sqlstate 'P0003' then
    null;
  end;
end;
$$;
reset role;
rollback;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if (select count(*) from public.workspace_preferences) <> 0
    or (select count(*) from public.experience_follow_ups) <> 0
    or (select count(*) from public.ticket_resolution_confirmations) <> 0
    or (select count(*) from public.tenant_ai_provider_approvals) <> 0 then
    raise exception 'Tenant B member could see 0057 data from Tenant A';
  end if;
  if has_table_privilege('authenticated', 'public.ai_draft_requests', 'select')
    or has_table_privilege('authenticated', 'public.ai_draft_requests', 'insert')
    or has_function_privilege(
      'authenticated',
      'public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer, boolean)',
      'execute'
    ) then
    raise exception 'Authenticated users must not access AI queue metadata or RPC directly';
  end if;
end;
$$;
reset role;
rollback;

do $$
begin
  if has_table_privilege('anon', 'public.workspace_preferences', 'select')
    or has_table_privilege('anon', 'public.experience_follow_ups', 'select')
    or has_table_privilege('anon', 'public.ticket_resolution_confirmations', 'select')
    or has_table_privilege('anon', 'public.tenant_ai_provider_approvals', 'select')
    or has_table_privilege('anon', 'public.ai_draft_requests', 'select')
    or has_function_privilege(
      'anon',
      'public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer, boolean)',
      'execute'
    ) then
    raise exception 'anon retained access to 0057 Experience or AI data';
  end if;
end;
$$;

-- 0058 Agentenwerkbank/Anfragendenportal: Fremdmandanten erhalten auch bei
-- vorhandener SELECT-Berechtigung keine Zeilen; anon hat keinerlei Zugriff.
insert into public.tenant_macros (tenant_id, name, response_text, created_by)
values (
  '10000000-0000-4000-8000-000000000001', 'Rückmeldung', 'Wir prüfen das.',
  '00000000-0000-4000-8000-000000000002'
);
insert into public.ticket_mentions (tenant_id, ticket_id, mentioned_user_id, author_id)
values (
  '10000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
);
insert into public.agent_delegations (tenant_id, agent_id, delegate_id, starts_at, ends_at, created_by)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001', timezone('utc', now()),
  timezone('utc', now()) + interval '1 day', '00000000-0000-4000-8000-000000000002'
);
insert into public.service_incident_notices (tenant_id, title, description, created_by)
values (
  '10000000-0000-4000-8000-000000000001', 'Störung', 'Untersuchung läuft.',
  '00000000-0000-4000-8000-000000000002'
);
insert into public.ticket_reopen_requests (tenant_id, ticket_id, requested_by, reason)
values (
  '10000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001', 'Bitte erneut prüfen.'
);

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if (select count(*) from public.tenant_macros) <> 0
    or (select count(*) from public.ticket_mentions) <> 0
    or (select count(*) from public.agent_delegations) <> 0
    or (select count(*) from public.service_incident_notices) <> 0
    or (select count(*) from public.ticket_reopen_requests) <> 0 then
    raise exception 'Tenant B member could read Welle-3 records from Tenant A';
  end if;
  if has_table_privilege('authenticated', 'public.tenant_macros', 'insert')
    or has_table_privilege('authenticated', 'public.ticket_mentions', 'insert')
    or has_table_privilege('authenticated', 'public.agent_delegations', 'insert')
    or has_table_privilege('authenticated', 'public.service_incident_notices', 'insert')
    or has_table_privilege('authenticated', 'public.ticket_reopen_requests', 'insert') then
    raise exception 'Authenticated users retained direct Welle-3 write privileges';
  end if;
  begin
    insert into public.service_incident_notices (tenant_id, title, description, created_by)
    values (
      '10000000-0000-4000-8000-000000000001', 'Unzulässig', 'Fremdmandant.',
      '00000000-0000-4000-8000-000000000004'
    );
    raise exception 'Authenticated foreign tenant could write Welle-3 data';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

do $$
begin
  if has_table_privilege('anon', 'public.tenant_macros', 'select')
    or has_table_privilege('anon', 'public.ticket_mentions', 'select')
    or has_table_privilege('anon', 'public.agent_delegations', 'select')
    or has_table_privilege('anon', 'public.service_incident_notices', 'select')
    or has_table_privilege('anon', 'public.ticket_reopen_requests', 'select')
    or has_table_privilege('anon', 'public.tenant_macros', 'insert')
    or has_table_privilege('anon', 'public.ticket_mentions', 'insert')
    or has_table_privilege('anon', 'public.agent_delegations', 'insert')
    or has_table_privilege('anon', 'public.service_incident_notices', 'insert')
    or has_table_privilege('anon', 'public.ticket_reopen_requests', 'insert') then
    raise exception 'anon retained access to Welle-3 data';
  end if;
end;
$$;

-- 0059 Anfragendenzusammenarbeit und Outbox-Grundlage: Die Abteilungsansicht
-- ist standardmässig deaktiviert. Outbox-Ereignisse sind ausschliesslich für
-- service_role les- und schreibbar, auch nicht für Mitglieder anderer Mandanten.
do $$
begin
  if (select default_enabled from public.feature_catalog where key = 'requester.department-view') then
    raise exception 'requester.department-view must default to disabled';
  end if;
  if not exists (
    select 1
    from public.tenant_feature_flags
    where tenant_id = '10000000-0000-4000-8000-000000000001'
      and feature_key = 'requester.department-view'
      and not enabled
  ) then
    raise exception 'Existing tenant did not receive disabled requester.department-view flag';
  end if;
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.outbound_events'::regclass
  ) then
    raise exception 'outbound_events must enable and force RLS';
  end if;
  if not has_table_privilege('service_role', 'public.outbound_events', 'select')
    or not has_table_privilege('service_role', 'public.outbound_events', 'insert') then
    raise exception 'service_role must access outbound_events';
  end if;
end;
$$;

begin;
set local role service_role;
insert into public.outbound_events (tenant_id, event_type, entity_type, entity_id, payload)
values (
  '10000000-0000-4000-8000-000000000001',
  'ticket.watcher.added',
  'ticket',
  '17000000-0000-4000-8000-000000000001',
  '{"watcherId":"00000000-0000-4000-8000-000000000001"}'::jsonb
);
reset role;
commit;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if has_table_privilege('authenticated', 'public.outbound_events', 'select')
    or has_table_privilege('authenticated', 'public.outbound_events', 'insert') then
    raise exception 'Authenticated users retained outbound_events privileges';
  end if;
  begin
    perform count(*) from public.outbound_events;
    raise exception 'Foreign tenant member could read outbound_events';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.outbound_events (tenant_id, event_type, entity_type, entity_id)
    values (
      '20000000-0000-4000-8000-000000000002',
      'unapproved.event',
      'ticket',
      '17000000-0000-4000-8000-000000000001'
    );
    raise exception 'Foreign tenant member could write outbound_events';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

begin;
set local role anon;
do $$
begin
  if has_table_privilege('anon', 'public.outbound_events', 'select')
    or has_table_privilege('anon', 'public.outbound_events', 'insert') then
    raise exception 'anon retained outbound_events privileges';
  end if;
  begin
    perform count(*) from public.outbound_events;
    raise exception 'anon could read outbound_events';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.outbound_events (tenant_id, event_type, entity_type, entity_id)
    values (
      '10000000-0000-4000-8000-000000000001',
      'unapproved.event',
      'ticket',
      '17000000-0000-4000-8000-000000000001'
    );
    raise exception 'anon could write outbound_events';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

-- Push-Arbeitszeit: Die Tabelle ist mit erzwungener RLS geschützt und der
-- Vertragsstandard gilt, wenn die Mandantenkonfiguration keine Arbeitszeitwerte enthält.
do $$
declare
  v_state jsonb;
begin
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.push_work_checkins'::regclass
  ) then
    raise exception 'Push work check-ins must have forced RLS';
  end if;
  if has_function_privilege('authenticated', 'public.push_work_state(uuid, uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.push_work_state(uuid, uuid)', 'execute') then
    raise exception 'Push work state RPC privileges are not service-role-only';
  end if;
  select public.push_work_state(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  ) into v_state;
  if coalesce((v_state ->> 'required')::boolean, false) is not true
    or (v_state ->> 'startHour')::integer <> 6
    or (v_state ->> 'endHour')::integer <> 17 then
    raise exception 'Push work state did not apply contractual defaults';
  end if;
end;
$$;

-- Push notifications are fail-closed: fixtures explicitly enable the feature
-- and register only the devices required for the positive-path checks below.
update public.tenant_feature_flags
set enabled = true,
    configuration = '{"contentLevel":"minimal","checkInRequired":false}'::jsonb
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'notifications.push';

insert into public.push_devices (id, tenant_id, user_id, apns_token, apns_environment, device_name)
values
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', repeat('a', 64), 'production', 'iPhone A'),
  ('a2000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', repeat('b', 64), 'production', 'iPhone Agent');

insert into public.tickets (
  id, tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id
) values (
  '19000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'ICT-2026-009001',
  'Push Trigger Test',
  'Testticket fuer Push-Benachrichtigungen.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001'
);

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '19000000-0000-4000-8000-000000000003';
commit;

-- Edge functions write with the service role and pass the authenticated actor
-- as a header. A self-assignment must not notify the actor, and the header must
-- be ignored for anything but service-role requests. Rolled back afterwards.
begin;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-nextdesk-actor-id":"00000000-0000-4000-8000-000000000002"}', true);
update public.tickets set assigned_agent_id = null
where id = '19000000-0000-4000-8000-000000000003';
update public.tickets set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '19000000-0000-4000-8000-000000000003';
do $$
begin
  if (
    select count(*) from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000002'
      and kind = 'ticket.assigned'
  ) <> 1 then
    raise exception 'Service-role self-assignment with actor header must not notify the actor';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
update public.tickets set assigned_agent_id = null
where id = '19000000-0000-4000-8000-000000000003';
update public.tickets set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '19000000-0000-4000-8000-000000000003';
do $$
begin
  if (
    select count(*) from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000002'
      and kind = 'ticket.assigned'
  ) <> 2 then
    raise exception 'Actor header must only be trusted for service-role requests';
  end if;
end;
$$;
rollback;

insert into public.ticket_comments (id, ticket_id, author_id, visibility, body)
values
  ('19100000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'external', 'Antwort von der anfragenden Person.'),
  ('19200000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'external', 'Antwort durch den Support.'),
  ('19300000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'internal', 'Interne Notiz fuer die Erwaehnung.');

insert into public.ticket_mentions (id, tenant_id, ticket_id, comment_id, mentioned_user_id, author_id)
values (
  '19400000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000003',
  '19300000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
);

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
update public.tickets
set resolved_at = timezone('utc', now())
where id = '19000000-0000-4000-8000-000000000003';
commit;

insert into public.role_permissions (role_id, permission_code)
values ('16000000-0000-4000-8000-000000000002', 'ticket.approval.decide')
on conflict do nothing;
insert into public.ticket_approval_requests (
  id, tenant_id, ticket_id, approval_kind, requested_by, reason
) values (
  '19500000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000003',
  'change',
  '00000000-0000-4000-8000-000000000001',
  'Freigabe fuer den Push-Test erforderlich.'
);

do $$
begin
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000002'
      and kind = 'ticket.assigned'
      and payload = '{"ticketNumber":"ICT-2026-009001"}'::jsonb
  ) then
    raise exception 'Assignment did not create the contracted in-app notification';
  end if;
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000002'
      and kind = 'ticket.requester_reply'
      and payload ? 'commentId'
  ) then
    raise exception 'Requester external comment did not notify the assigned agent';
  end if;
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000001'
      and kind = 'ticket.support_reply'
      and payload ? 'commentId'
  ) then
    raise exception 'Support external comment did not notify the requester';
  end if;
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000001'
      and kind = 'ticket.mention'
      and payload ? 'mentionId'
  ) then
    raise exception 'Mention did not create the contracted in-app notification';
  end if;
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000001'
      and kind = 'ticket.resolved'
  ) then
    raise exception 'Resolution did not notify the requester';
  end if;
  if not exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19000000-0000-4000-8000-000000000003'
      and user_id = '00000000-0000-4000-8000-000000000002'
      and kind = 'ticket.approval.requested'
      and payload ? 'approvalId'
  ) then
    raise exception 'Pending approval did not notify a qualified approver';
  end if;
  if not exists (
    select 1
    from public.push_outbox outbox
    join public.ticket_notifications notification on notification.id = outbox.notification_id
    where notification.ticket_id = '19000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Enabled feature with devices and categories did not enqueue push work';
  end if;
end;
$$;

-- Fällige ticketgebundene Wiedervorlagen erzeugen genau eine In-App-
-- Benachrichtigung. Der Test bleibt vollständig transaktional und benötigt kein pg_cron.
begin;
do $$
declare
  v_due_id uuid := '1f000000-0000-4000-8000-000000000003';
  v_old_id uuid := '1f100000-0000-4000-8000-000000000003';
begin
  insert into public.experience_follow_ups (
    id, tenant_id, owner_id, ticket_id, title, priority, due_at
  ) values (
    v_due_id,
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000003',
    'Rückmeldung einholen',
    'normal',
    timezone('utc', now()) - interval '5 minutes'
  );

  perform public.follow_up_send_due_reminders();
  if (
    select count(*)
    from public.ticket_notifications notification
    where notification.user_id = '00000000-0000-4000-8000-000000000002'
      and notification.ticket_id = '19000000-0000-4000-8000-000000000003'
      and notification.kind = 'ticket.follow_up_due'
      and notification.payload ->> 'followUpId' = v_due_id::text
  ) <> 1 then
    raise exception 'Fällige Wiedervorlage erzeugte nicht genau eine Benachrichtigung';
  end if;
  if not exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = v_due_id
      and follow_up.reminder_sent_at is not null
  ) then
    raise exception 'Fällige Wiedervorlage wurde nicht als erinnert markiert';
  end if;

  perform public.follow_up_send_due_reminders();
  if (
    select count(*)
    from public.ticket_notifications notification
    where notification.kind = 'ticket.follow_up_due'
      and notification.payload ->> 'followUpId' = v_due_id::text
  ) <> 1 then
    raise exception 'Wiedervorlagen-Erinnerung wurde doppelt erzeugt';
  end if;

  update public.experience_follow_ups
  set due_at = timezone('utc', now()) + interval '1 hour'
  where id = v_due_id;
  if exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = v_due_id
      and follow_up.reminder_sent_at is not null
  ) then
    raise exception 'Änderung der Fälligkeit setzte reminder_sent_at nicht zurück';
  end if;

  insert into public.experience_follow_ups (
    id, tenant_id, owner_id, ticket_id, title, priority, due_at
  ) values (
    v_old_id,
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000003',
    'Historische Wiedervorlage',
    'normal',
    timezone('utc', now()) - interval '24 hours 1 minute'
  );
  perform public.follow_up_send_due_reminders();
  if not exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = v_old_id
      and follow_up.reminder_sent_at is not null
  ) then
    raise exception 'Überfälliger Altbestand wurde nicht als erinnert markiert';
  end if;
  if exists (
    select 1
    from public.ticket_notifications notification
    where notification.kind = 'ticket.follow_up_due'
      and notification.payload ->> 'followUpId' = v_old_id::text
  ) then
    raise exception 'Überfälliger Altbestand erzeugte eine Benachrichtigung';
  end if;
end;
$$;
rollback;

begin;
set local role service_role;
do $$
declare
  v_claim record;
  v_claimed integer := 0;
begin
  if not has_function_privilege('service_role', 'public.push_claim_outbox(integer)', 'execute')
    or has_function_privilege('authenticated', 'public.push_claim_outbox(integer)', 'execute')
    or has_function_privilege('authenticated', 'public.push_verify_dispatch_secret(text)', 'execute') then
    raise exception 'Push dispatch RPC privileges are not service-role-only';
  end if;
  for v_claim in select * from public.push_claim_outbox(50)
  loop
    v_claimed := v_claimed + 1;
    if v_claim.subject is not null
      or v_claim.quiet_hours is null
      or jsonb_typeof(v_claim.devices) <> 'array'
      or jsonb_array_length(v_claim.devices) < 1 then
      raise exception 'Push claim did not return contracted minimal delivery data';
    end if;
  end loop;
  if v_claimed < 1 then
    raise exception 'Push claim did not reserve the enabled outbox rows';
  end if;
end;
$$;
reset role;
commit;

-- Ohne Check-in wird ein Eintrag ausserhalb des aktiven Push-Zustands übersprungen.
-- Das Fenster 00:00–24:00 hält den positiven Pfad unabhängig von der Testuhr offen.
update public.tenant_feature_flags
set configuration = '{"contentLevel":"minimal","checkInRequired":true,"workStartHour":0,"workEndHour":24}'::jsonb
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'notifications.push';
insert into public.ticket_notifications (id, tenant_id, user_id, ticket_id, kind, payload)
values (
  '1e100000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000003',
  'ticket.assigned',
  '{"ticketNumber":"ICT-2026-009001"}'
);
begin;
set local role service_role;
do $$
begin
  if exists (
    select 1
    from public.push_claim_outbox(50) claim
    where claim.notification_id = '1e100000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Push claim returned a row without today''s check-in';
  end if;
  if not exists (
    select 1 from public.push_outbox
    where notification_id = '1e100000-0000-4000-8000-000000000003'
      and status = 'pending'
      and last_error = 'deferred_off_shift'
  ) then
    raise exception 'Push claim did not defer an unchecked-in user';
  end if;
end;
$$;
reset role;
commit;

begin;
set local role service_role;
do $$
declare
  v_state jsonb;
begin
  select public.push_work_state(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  ) into v_state;
  if coalesce((v_state ->> 'withinWindow')::boolean, false) is not true then
    raise exception 'All-day push work test window was not active';
  end if;
  insert into public.push_work_checkins (tenant_id, user_id, work_date, checked_in_at)
  values (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    (v_state ->> 'localDate')::date,
    timezone('utc', now())
  );
end;
$$;
reset role;
commit;

insert into public.ticket_notifications (id, tenant_id, user_id, ticket_id, kind, payload)
values (
  '1e200000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000003',
  'ticket.assigned',
  '{"ticketNumber":"ICT-2026-009001"}'
);
begin;
set local role service_role;
do $$
begin
  if not exists (
    select 1
    from public.push_claim_outbox(50) claim
    where claim.notification_id = '1e200000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Push claim did not return an in-window checked-in user';
  end if;
end;
$$;
reset role;
commit;

-- Actor and recipient being identical must not generate a self-notification.
insert into public.tickets (
  id, tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id
) values (
  '19600000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'ICT-2026-009002',
  'Push Selbsttest',
  'Ticket fuer die Selbstbenachrichtigungspruefung.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001'
);
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '19600000-0000-4000-8000-000000000003';
commit;
do $$
begin
  if exists (
    select 1 from public.ticket_notifications
    where ticket_id = '19600000-0000-4000-8000-000000000003'
      and kind = 'ticket.assigned'
  ) then
    raise exception 'Self-assignment created a push notification';
  end if;
end;
$$;

-- Enqueue preconditions are independently fail-closed for feature, device and category.
update public.tenant_feature_flags
set enabled = false
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'notifications.push';
insert into public.ticket_notifications (id, tenant_id, user_id, ticket_id, kind, payload)
values ('19700000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'ticket.assigned', '{"ticketNumber":"ICT-2026-009001"}');

update public.tenant_feature_flags
set enabled = true
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'notifications.push';
insert into public.ticket_notifications (id, tenant_id, user_id, ticket_id, kind, payload)
values ('19800000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000003', 'ticket.assigned', '{"ticketNumber":"ICT-2026-009001"}');

insert into public.push_preferences (tenant_id, user_id, enabled_categories)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', array['mention']::text[])
on conflict (tenant_id, user_id) do update set enabled_categories = excluded.enabled_categories;
insert into public.ticket_notifications (id, tenant_id, user_id, ticket_id, kind, payload)
values ('19900000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000003', 'ticket.assigned', '{"ticketNumber":"ICT-2026-009001"}');
do $$
begin
  if exists (
    select 1 from public.push_outbox
    where notification_id in (
      '19700000-0000-4000-8000-000000000003',
      '19800000-0000-4000-8000-000000000003',
      '19900000-0000-4000-8000-000000000003'
    )
  ) then
    raise exception 'Push outbox ignored a disabled feature, missing device or disabled category';
  end if;
end;
$$;

-- A provider-side notification failure must never prevent the ticket operation.
alter table public.ticket_notifications
  add constraint push_test_assignment_rejected check (kind <> 'ticket.assigned') not valid;
insert into public.tickets (
  id, tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id
) values (
  '1a000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'ICT-2026-009003',
  'Push Fehlerisolation',
  'Ticket fuer die Fehlerisolation im Trigger.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001'
);
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '1a000000-0000-4000-8000-000000000003';
commit;
do $$
begin
  if not exists (
    select 1 from public.tickets
    where id = '1a000000-0000-4000-8000-000000000003'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Ticket operation failed when notification generation raised an error';
  end if;
end;
$$;
alter table public.ticket_notifications drop constraint push_test_assignment_rejected;

begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if (select count(*) from public.push_devices) <> 1 then
    raise exception 'Authenticated user may read push devices other than their own';
  end if;
  if has_table_privilege('authenticated', 'public.push_devices', 'insert')
    or has_table_privilege('authenticated', 'public.push_preferences', 'update')
    or has_table_privilege('authenticated', 'public.push_work_checkins', 'insert') then
    raise exception 'Authenticated users retained direct push write privileges';
  end if;
  begin
    insert into public.push_work_checkins (tenant_id, user_id, work_date)
    values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      current_date + 1
    );
    raise exception 'Authenticated user directly inserted a push work check-in';
  exception when insufficient_privilege then
    null;
  end;
  if has_schema_privilege('authenticated', 'push_private', 'usage') then
    raise exception 'Authenticated users retained push_private schema access';
  end if;
  begin
    insert into public.push_devices (tenant_id, user_id, apns_token, apns_environment)
    values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', repeat('c', 64), 'production');
    raise exception 'Authenticated user directly inserted a push device';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
rollback;

-- Exchange Online mail: all new tables are private, RLS is forced and direct
-- browser roles have neither access nor a dispatch-secret RPC.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'exchange_mail_channels', 'exchange_mail_subscriptions', 'mail_messages'
  ]
  loop
    if not (
      select relrowsecurity and relforcerowsecurity
      from pg_class
      where oid = format('public.%I', relation_name)::regclass
    ) then
      raise exception 'Exchange mail RLS is not enabled and forced for %', relation_name;
    end if;
    if has_table_privilege('anon', format('public.%I', relation_name), 'select')
      or has_table_privilege('authenticated', format('public.%I', relation_name), 'select') then
      raise exception 'Browser role retained Exchange mail table access for %', relation_name;
    end if;
  end loop;
  foreach relation_name in array array[
    'dispatch_config',
    'service_identity',
    'exchange_mail_connection_credentials',
    'exchange_mail_oauth_states'
  ]
  loop
    if not (
      select relrowsecurity and relforcerowsecurity
      from pg_class
      where oid = format('mail_private.%I', relation_name)::regclass
    ) then
      raise exception 'Private Exchange mail RLS is not enabled and forced for %', relation_name;
    end if;
    if has_table_privilege('anon', format('mail_private.%I', relation_name), 'select')
      or has_table_privilege('authenticated', format('mail_private.%I', relation_name), 'select') then
      raise exception 'Browser role retained private Exchange mail table access for %', relation_name;
    end if;
  end loop;
  if has_schema_privilege('anon', 'mail_private', 'usage')
    or has_schema_privilege('authenticated', 'mail_private', 'usage')
    or has_function_privilege('authenticated', 'public.exchange_mail_verify_dispatch_secret(text)', 'execute')
    or has_function_privilege('authenticated', 'public.exchange_mail_create_oauth_state(text, uuid, uuid, text, text, timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.exchange_mail_consume_oauth_state(text)', 'execute')
    or has_function_privilege('authenticated', 'public.exchange_mail_store_connection_credential(uuid, uuid, text, smallint)', 'execute')
    or has_function_privilege('authenticated', 'public.exchange_mail_read_connection_credential(uuid, uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_mail_verify_dispatch_secret(text)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_mail_create_oauth_state(text, uuid, uuid, text, text, timestamptz)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_mail_consume_oauth_state(text)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_mail_store_connection_credential(uuid, uuid, text, smallint)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_mail_read_connection_credential(uuid, uuid)', 'execute') then
    raise exception 'Exchange mail dispatch privileges are not service-role-only';
  end if;
end;
$$;

-- Before any active channel or due mail exists, maintenance has no work and its
-- optional pg_net wakeup must be a no-op in the local cluster.
do $$
begin
  if exists (select 1 from public.exchange_mail_channels where status = 'active')
    or exists (
      select 1 from public.mail_messages
      where processing_status in ('pending', 'failed') and next_attempt_at <= now()
    ) then
    raise exception 'Exchange mail no-op maintenance fixture is not clean';
  end if;
  perform public.exchange_mail_kick_maintenance();
end;
$$;

insert into public.ticket_requesters (id, tenant_id, email, display_name, source) values
  ('1b000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'requester@tenant-a.example', 'Requester A', 'email');
insert into public.ticket_requesters (tenant_id, email, display_name, source)
values (
  '10000000-0000-4000-8000-000000000001',
  'upsert-requester@tenant-a.example',
  'Initial requester',
  'email'
)
on conflict (tenant_id, email) do update
set display_name = excluded.display_name;
insert into public.ticket_requesters (tenant_id, email, display_name, source)
values (
  '10000000-0000-4000-8000-000000000001',
  'upsert-requester@tenant-a.example',
  'Updated requester',
  'email'
)
on conflict (tenant_id, email) do update
set display_name = excluded.display_name;
do $$
begin
  if (select count(*) from public.ticket_requesters where tenant_id = '10000000-0000-4000-8000-000000000001' and email = 'upsert-requester@tenant-a.example') <> 1
     or (select display_name from public.ticket_requesters where tenant_id = '10000000-0000-4000-8000-000000000001' and email = 'upsert-requester@tenant-a.example') <> 'Updated requester' then
    raise exception 'Email requester upsert conflict target is not usable';
  end if;
end;
$$;
update public.tickets
set requester_contact_id = '1b000000-0000-4000-8000-000000000003'
where id = '17000000-0000-4000-8000-000000000001';
insert into public.ticket_statuses (id, tenant_id, key, label, is_closed, sort_order)
values ('13100000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resolved', 'Gelöst', true, 99)
on conflict (tenant_id, key) do nothing;
update public.tenant_feature_flags
set enabled = true
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'integrations.email';
insert into public.exchange_mail_connections (
  id, tenant_id, entra_tenant_id, connector_object_id, connector_principal,
  granted_scopes, created_by, updated_by
) values (
  '1e000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '1f000000-0000-4000-8000-000000000003',
  'connector@tenant-a.example',
  array['user.read', 'mail.read', 'mail.send', 'mail.read.shared', 'mail.send.shared'],
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002'
);
insert into public.exchange_mail_channels (
  id, tenant_id, entra_tenant_id, connection_id, access_mode, mailbox_address, mailbox_object_id, default_department_id,
  send_agent_replies, send_resolution, status, created_by, updated_by, activated_at
) values (
  '1c000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000003',
  'delegated',
  'support@tenant-a.example',
  '1a000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  true, true, 'active',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002', now()
);
update public.tickets
set exchange_mail_channel_id = '1c000000-0000-4000-8000-000000000003'
where id = '17000000-0000-4000-8000-000000000001';

-- Saving a delegated mailbox draft must not require Entra directory-profile
-- access for that mailbox. The explicit verification step later proves actual
-- mailbox, read and send access through the connector's Exchange delegation.
insert into public.exchange_mail_channels (
  id, tenant_id, entra_tenant_id, connection_id, access_mode, mailbox_address,
  mailbox_object_id, default_department_id, send_agent_replies, send_resolution,
  status, created_by, updated_by
) values (
  '1c000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000003',
  'delegated',
  'draft-support@tenant-a.example',
  null,
  '11000000-0000-4000-8000-000000000001',
  false, false, 'draft',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002'
);
do $$
begin
  if not exists (
    select 1
    from public.exchange_mail_channels
    where id = '1c000000-0000-4000-8000-000000000004'
      and access_mode = 'delegated'
      and connection_id is not null
      and mailbox_object_id is null
      and status = 'draft'
  ) then
    raise exception 'Delegated address-only mailbox draft was not accepted';
  end if;
end;
$$;

create schema if not exists net;
create table net.http_post_calls (
  id bigint generated always as identity primary key,
  body jsonb not null,
  params jsonb not null
);
create function net.http_post(
  url text,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into net.http_post_calls (body, params)
  values (body, params)
  returning id into v_id;
  return v_id;
end;
$$;

select public.exchange_mail_wake_worker(
  jsonb_build_object('action', 'maintenance')
);
do $$
begin
  if not exists (
    select 1
    from net.http_post_calls
    where body = jsonb_build_object('action', 'maintenance')
      and params = '{}'::jsonb
  ) then
    raise exception 'Exchange worker dispatch did not send the action in the JSON body';
  end if;
end;
$$;

-- Exactly one external portal response from a tenant agent queues exactly one
-- agent reply. Internal notes, customer responses and a paused channel queue none.
insert into public.ticket_comments (ticket_id, author_id, visibility, body)
values ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'external', 'Externe Agentenantwort');
do $$
begin
  if (select count(*) from public.mail_messages where kind = 'agent_reply' and ticket_id = '17000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'External agent reply did not create exactly one Exchange outbound entry';
  end if;
end;
$$;
insert into public.ticket_comments (ticket_id, author_id, visibility, body)
values ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'internal', 'Interne Notiz');
insert into public.ticket_comments (ticket_id, author_id, visibility, body)
values ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'external', 'Kundenantwort');
update public.exchange_mail_channels set status = 'paused'
where id = '1c000000-0000-4000-8000-000000000003';
insert into public.ticket_comments (ticket_id, author_id, visibility, body)
values ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'external', 'Antwort bei pausiertem Kanal');
do $$
begin
  if (select count(*) from public.mail_messages where kind = 'agent_reply' and ticket_id = '17000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Internal note, customer reply or paused channel queued Exchange mail';
  end if;
end;
$$;

-- The established tenant-local resolved status is the resolution category and
-- queues the optional resolution notice only when the channel is active.
update public.exchange_mail_channels set status = 'active'
where id = '1c000000-0000-4000-8000-000000000003';
update public.tickets
set status_id = (
  select id
  from public.ticket_statuses
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and key = 'resolved'
)
where id = '17000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.mail_messages where kind = 'resolution' and ticket_id = '17000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Resolved ticket did not queue exactly one Exchange resolution notice';
  end if;
end;
$$;

-- Removing a support mailbox retains its ticket origin and message history,
-- releases its active address reservation and rejects every later queue entry
-- for the archived channel.
update public.exchange_mail_channels
set status = 'paused',
    deleted_at = timezone('utc', now()),
    deleted_by = '00000000-0000-4000-8000-000000000002',
    configuration_version = configuration_version + 1
where id = '1c000000-0000-4000-8000-000000000003';
insert into public.exchange_mail_channels (
  id, tenant_id, entra_tenant_id, connection_id, access_mode, mailbox_address,
  mailbox_object_id, default_department_id, send_agent_replies, send_resolution,
  status, created_by, updated_by, activated_at
) values (
  '1c000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000003',
  'delegated',
  'support@tenant-a.example',
  '1a000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001',
  true, true, 'active',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002', now()
);
insert into public.mail_messages (
  tenant_id, channel_id, exchange_configuration_version, direction, kind,
  from_address, to_addresses, subject
) values (
  '10000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000005',
  1, 'outbound', 'test', 'support@tenant-a.example',
  array['recipient@tenant-a.example'], 'Aktiver Kanal akzeptiert Queue'
);
update public.exchange_mail_channels
set status = 'paused',
    deleted_at = timezone('utc', now()),
    deleted_by = '00000000-0000-4000-8000-000000000002',
    configuration_version = configuration_version + 1
where id = '1c000000-0000-4000-8000-000000000005';
insert into public.mail_messages (
  tenant_id, channel_id, exchange_configuration_version, direction, kind,
  from_address, to_addresses, subject
) values (
  '10000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000005',
  1, 'outbound', 'test', 'support@tenant-a.example',
  array['recipient@tenant-a.example'], 'Entfernter Kanal darf nicht queueen'
);
do $$
begin
  if not exists (
    select 1 from public.tickets
    where id = '17000000-0000-4000-8000-000000000001'
      and exchange_mail_channel_id = '1c000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Mailbox removal lost the historical ticket origin';
  end if;
  if (select count(*) from public.exchange_mail_channels
      where mailbox_address = 'support@tenant-a.example' and deleted_at is null) <> 0 then
    raise exception 'Archived mailbox still reserves an active mailbox address';
  end if;
  if not exists (
    select 1 from public.mail_messages
    where subject = 'Aktiver Kanal akzeptiert Queue'
  ) or exists (
    select 1 from public.mail_messages
    where subject = 'Entfernter Kanal darf nicht queueen'
  ) then
    raise exception 'Mailbox queue guard did not fence archived channels';
  end if;
end;
$$;
-- OAuth states and encrypted credentials remain private, but Edge Functions with
-- a service-role context can use only the narrow, atomic RPC surface.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.exchange_mail_create_oauth_state(
  repeat('a', 64),
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  repeat('A', 43),
  repeat('b', 64),
  timezone('utc', now()) + interval '10 minutes'
);
do $$
begin
  if not exists (
    select 1 from mail_private.exchange_mail_oauth_states
    where state_hash = repeat('a', 64)
      and consumed_at is null
  ) then
    raise exception 'Service-role OAuth-state RPC did not store the state';
  end if;
  if (select count(*) from public.exchange_mail_consume_oauth_state(repeat('a', 64))) <> 1
     or (select count(*) from public.exchange_mail_consume_oauth_state(repeat('a', 64))) <> 0 then
    raise exception 'OAuth-state consumption is not atomic and single-use';
  end if;
end;
$$;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.exchange_mail_create_oauth_state(
  repeat('f', 64),
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  repeat('A', 43),
  repeat('e', 64),
  timezone('utc', now()) + interval '10 minutes'
);
do $$
begin
  if (select count(*) from public.exchange_mail_consume_oauth_state(repeat('f', 64))) <> 1 then
    raise exception 'Current Supabase JWT claims did not authorize the OAuth-state RPC';
  end if;
end;
$$;
select public.exchange_mail_store_connection_credential(
  '1e000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  repeat('c', 64),
  1::smallint
);
do $$
begin
  if (select refresh_token_ciphertext from public.exchange_mail_read_connection_credential(
    '1e000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001'
  )) <> repeat('c', 64) then
    raise exception 'Service-role credential RPC did not return the stored ciphertext';
  end if;
end;
$$;
commit;
begin;
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.exchange_mail_create_oauth_state(
      repeat('d', 64),
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      repeat('A', 43),
      repeat('e', 64),
      timezone('utc', now()) + interval '10 minutes'
    );
    raise exception 'Authenticated callers created a private OAuth state';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.exchange_mail_read_connection_credential(
      '1e000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'Authenticated callers read a private Exchange credential';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
rollback;

-- Permanent bulk deletion requires an explicit confirmation and the dedicated
-- ticket.delete permission for every selected ticket. Legal holds block the
-- mutation, department boundaries keep it atomic and the durable audit record
-- survives the cascaded ticket history.
do $$
declare
  result jsonb;
  cleanup_job_id uuid;
begin
  if has_function_privilege('authenticated', 'public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)', 'execute') then
    raise exception 'authenticated may execute bulk_delete_tickets';
  end if;
  if not has_function_privilege('service_role', 'public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)', 'execute') then
    raise exception 'service_role may not execute bulk_delete_tickets';
  end if;
  if has_table_privilege('authenticated', 'public.ticket_deletion_attachment_cleanup', 'select')
    or has_function_privilege('authenticated', 'public.claim_ticket_deletion_attachment_cleanup(uuid, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.complete_ticket_deletion_attachment_cleanup(uuid[])', 'execute')
    or has_function_privilege('authenticated', 'public.release_ticket_deletion_attachment_cleanup(uuid[])', 'execute') then
    raise exception 'authenticated retained ticket attachment cleanup access';
  end if;
  if not has_function_privilege('service_role', 'public.claim_ticket_deletion_attachment_cleanup(uuid, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.complete_ticket_deletion_attachment_cleanup(uuid[])', 'execute')
    or not has_function_privilege('service_role', 'public.release_ticket_deletion_attachment_cleanup(uuid[])', 'execute') then
    raise exception 'service_role may not maintain ticket attachment cleanup';
  end if;

  insert into public.tickets (
    id, tenant_id, department_id, ticket_number, subject, description,
    status_id, priority_id, requester_id
  ) values
    (
      '1f000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      'ICT-2026-DELETE01',
      'Delete test ICT',
      'Must be removed only with ticket.delete',
      '13000000-0000-4000-8000-000000000001',
      '14000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    ),
    (
      '1f000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000002',
      'INF-2026-DELETE01',
      'Delete test Infrastructure',
      'Must remain outside the ICT scope',
      '13000000-0000-4000-8000-000000000001',
      '14000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003'
    );
  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
  values (
    '1f000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'internal',
    'Comment that must cascade with the deletion'
  );
  insert into public.ticket_attachments (
    id, ticket_id, uploaded_by, storage_bucket, storage_object_path,
    original_filename, content_type, byte_size, malware_status
  ) values (
    '1f000000-0000-4000-8000-000000000003',
    '1f000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'ticket-attachments',
    '10000000-0000-4000-8000-000000000001/1f000000-0000-4000-8000-000000000001/1f000000-0000-4000-8000-000000000004',
    'delete-test.txt',
    'text/plain',
    12,
    'clean'
  );
  insert into public.experience_follow_ups (
    id, tenant_id, owner_id, ticket_id, title, priority, resolved_at, resolved_by
  ) values (
    '1f000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '1f000000-0000-4000-8000-000000000001',
    'Erledigte Wiedervorlage zur Löschregression',
    'normal',
    timezone('utc', now()),
    '00000000-0000-4000-8000-000000000002'
  );
  insert into public.ticket_resolution_confirmations (
    id, tenant_id, ticket_id, confirmed_by, confirmed
  ) values (
    '1f000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000001',
    '1f000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    true
  );

  begin
    perform public.bulk_delete_tickets(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array['1f000000-0000-4000-8000-000000000001']::uuid[],
      false
    );
    raise exception 'Unconfirmed bulk delete was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Bulk ticket delete confirmation required' then
      raise;
    end if;
  end;

  update public.tenant_data_retention_policies
  set legal_hold = true
  where tenant_id = '10000000-0000-4000-8000-000000000001';
  begin
    perform public.bulk_delete_tickets(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array['1f000000-0000-4000-8000-000000000001']::uuid[],
      true
    );
    raise exception 'Legal hold did not block bulk delete';
  exception when raise_exception then
    if sqlerrm <> 'Ticket deletion blocked by legal hold' then
      raise;
    end if;
  end;
  update public.tenant_data_retention_policies
  set legal_hold = false
  where tenant_id = '10000000-0000-4000-8000-000000000001';

  begin
    perform public.bulk_delete_tickets(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array['1f000000-0000-4000-8000-000000000001']::uuid[],
      true
    );
    raise exception 'Ticket deletion without ticket.delete was accepted';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.role_permissions (role_id, permission_code)
  values ('16000000-0000-4000-8000-000000000002', 'ticket.delete');

  begin
    perform public.bulk_delete_tickets(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      array[
        '1f000000-0000-4000-8000-000000000001',
        '1f000000-0000-4000-8000-000000000002'
      ]::uuid[],
      true
    );
    raise exception 'ICT agent deleted an Infrastructure ticket';
  exception when insufficient_privilege then
    null;
  end;
  if (select count(*) from public.tickets where id in (
    '1f000000-0000-4000-8000-000000000001',
    '1f000000-0000-4000-8000-000000000002'
  )) <> 2 then
    raise exception 'Denied bulk deletion partially changed tickets';
  end if;

  result := public.bulk_delete_tickets(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    array['1f000000-0000-4000-8000-000000000001']::uuid[],
    true
  );
  if (result->>'requested')::integer <> 1
    or (result->>'deleted')::integer <> 1
    or (result->>'cleanupQueued')::integer <> 1 then
    raise exception 'Authorized bulk deletion returned an incomplete result';
  end if;
  if exists (
    select 1 from public.tickets
    where id = '1f000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.ticket_comments
    where ticket_id = '1f000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.experience_follow_ups
    where ticket_id = '1f000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.ticket_resolution_confirmations
    where ticket_id = '1f000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Authorized bulk deletion did not cascade every ticket-scoped record';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where tenant_id = '10000000-0000-4000-8000-000000000001'
      and actor_id = '00000000-0000-4000-8000-000000000002'
      and action = 'ticket.deleted'
      and entity_type = 'ticket'
      and entity_id = '1f000000-0000-4000-8000-000000000001'
      and severity = 'warning'
  ) then
    raise exception 'Authorized bulk deletion did not write a durable audit record';
  end if;
  if not exists (
    select 1 from public.ticket_deletion_attachment_cleanup
    where tenant_id = '10000000-0000-4000-8000-000000000001'
      and ticket_id = '1f000000-0000-4000-8000-000000000001'
      and status = 'pending'
  ) then
    raise exception 'Ticket deletion did not persist attachment cleanup before cascade';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select cleanup_id
  into cleanup_job_id
  from public.claim_ticket_deletion_attachment_cleanup(
    '10000000-0000-4000-8000-000000000001',
    1
  );
  if cleanup_job_id is null then
    raise exception 'Ticket attachment cleanup was not claimable';
  end if;
  if public.complete_ticket_deletion_attachment_cleanup(array[cleanup_job_id]) <> 1 then
    raise exception 'Ticket attachment cleanup was not completable';
  end if;
  if exists (
    select 1 from public.ticket_deletion_attachment_cleanup
    where id = cleanup_job_id
  ) then
    raise exception 'Completed ticket attachment cleanup remained queued';
  end if;
end;
$$;

-- The standard tenant-administrator system role must receive the dedicated
-- sensitive permission so it can execute the already-confirmed, audited and
-- legal-hold-protected bulk deletion flow for its own tenant.
do $$
declare
  v_result jsonb;
begin
  insert into public.roles (id, tenant_id, name, scope, is_system)
  values (
    '1f000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000002',
    'Tenant administrator',
    'tenant',
    true
  );
  if not exists (
    select 1
    from public.role_permissions
    where role_id = '1f000000-0000-4000-8000-000000000005'
      and permission_code = 'ticket.delete'
  ) then
    raise exception 'Tenant administrator did not receive ticket.delete';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.grant_ticket_delete_to_tenant_administrator()',
    'execute'
  ) then
    raise exception 'Authenticated callers may execute the tenant-admin delete permission trigger';
  end if;

  insert into public.department_memberships (department_id, tenant_id, user_id, status)
  values (
    '21000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004',
    'active'
  );
  insert into public.user_role_assignments (tenant_id, user_id, role_id)
  values (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004',
    '1f000000-0000-4000-8000-000000000005'
  );
  insert into public.tickets (
    id, tenant_id, department_id, ticket_number, subject, description,
    status_id, priority_id, requester_id
  ) values (
    '1f000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000003',
    'ICT-B-2026-DELETE02',
    'Tenant-administrator deletion',
    'Must be deletable by the standard tenant administrator role.',
    '23000000-0000-4000-8000-000000000002',
    '24000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004'
  );
  v_result := public.bulk_delete_tickets(
    '00000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002',
    array['1f000000-0000-4000-8000-000000000006']::uuid[],
    true
  );
  if (v_result->>'deleted')::integer <> 1
    or exists (
      select 1 from public.tickets
      where id = '1f000000-0000-4000-8000-000000000006'
    ) then
    raise exception 'Tenant administrator could not delete an authorized tenant ticket';
  end if;
end;
$$;

-- Die Listen-RPC muss vor Pagination global sortieren und exakt dieselben
-- Ticketrechte wie die RLS anwenden. Ein ICT-Agent darf keine Daten der
-- Infrastrukturabteilung lesen oder über Agentennamen erschliessen.
insert into public.ticket_priorities (id, tenant_id, key, label, sort_order)
values (
  '14100000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'filter_sort_urgent',
  'Filter Sort Dringend',
  1
)
on conflict do nothing;
insert into public.tickets (
  id, tenant_id, department_id, ticket_number, subject, description,
  status_id, priority_id, requester_id, assigned_agent_id, updated_at
)
values
  (
    '1a000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'ICT-2099-000001',
    'Filter sort dringend',
    'Sichtbar und prioritär sortiert',
    '13000000-0000-4000-8000-000000000001',
    '14100000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '2099-01-01T00:00:00Z'
  ),
  (
    '1a000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'ICT-2099-000002',
    'Filter sort normal',
    'Sichtbar und nachrangig sortiert',
    '13000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '2099-01-02T00:00:00Z'
  );
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
declare
  v_expected_count bigint;
  v_reported_count bigint;
  v_first_subject text;
  v_fulltext_count bigint;
begin
  select count(*)
  into v_expected_count
  from public.tickets ticket
  where ticket.tenant_id = '10000000-0000-4000-8000-000000000001'
    and public.can_read_ticket(ticket.id);

  select page.matching_ticket_count, page.subject
  into v_reported_count, v_first_subject
  from public.list_authorized_ticket_list_page(
    '10000000-0000-4000-8000-000000000001',
    null, null, null, null, false, 'priority', 'asc', 1, 0
  ) page;
  if v_reported_count <> v_expected_count
    or v_first_subject <> 'Filter sort dringend' then
    raise exception 'Authorized ticket list did not count or globally sort before pagination';
  end if;

  if exists (
    select 1
    from public.list_authorized_ticket_list_page(
      '10000000-0000-4000-8000-000000000001',
      null, null, null, null, false, 'updated', 'desc', 1, 0
    ) page
    where to_jsonb(page) ? 'assigned_agent_name'
  ) then
    raise exception 'Authorized ticket list exposed a user profile display name';
  end if;

  select page.subject
  into v_first_subject
  from public.list_authorized_ticket_list_page(
    p_tenant_id => '10000000-0000-4000-8000-000000000001',
    p_sort_by => 'agent',
    p_sort_direction => 'asc',
    p_limit => 1,
    p_agent_sort_order => array[
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]::uuid[]
  ) page;
  if v_first_subject <> 'Filter sort normal' then
    raise exception 'Authorized ticket list did not globally apply agent sort order';
  end if;

  if exists (
    select 1
    from public.list_authorized_ticket_list_page(
      '10000000-0000-4000-8000-000000000001',
      null, null,
      array['12000000-0000-4000-8000-000000000002']::uuid[],
      null, false, 'updated', 'desc', 51, 0
    )
  ) then
    raise exception 'Authorized ticket list exposed an unreadable department';
  end if;

  if exists (
    select 1
    from public.list_authorized_ticket_list_page(
      p_tenant_id => '10000000-0000-4000-8000-000000000001',
      p_queue_key => 'infrastructure'
    )
  ) then
    raise exception 'Queue filter exposed an unreadable department after pagination';
  end if;

  select count(*)
  into v_fulltext_count
  from public.list_authorized_ticket_list_page(
    p_tenant_id => '10000000-0000-4000-8000-000000000001',
    p_search_free_text => array['prioritär']::text[]
  ) page;
  if v_fulltext_count <> 1 then
    raise exception 'Ticket description full-text search did not return the authorized match';
  end if;

  select count(*)
  into v_fulltext_count
  from public.list_authorized_ticket_list_page(
    p_tenant_id => '10000000-0000-4000-8000-000000000001',
    p_search_free_text => array['x']::text[]
  ) page;
  if v_fulltext_count <> v_expected_count then
    raise exception 'Ticket full-text search did not ignore a one-character term';
  end if;

  if exists (
    select 1
    from public.list_authorized_ticket_list_page(
      p_tenant_id => '10000000-0000-4000-8000-000000000001',
      p_search_free_text => array['hidden']::text[]
    ) page
  ) then
    raise exception 'Ticket full-text search exposed an unreadable ticket description';
  end if;

  begin
    perform public.list_authorized_ticket_list_page(
      '10000000-0000-4000-8000-000000000001',
      null, null, null, null, false, 'invalid', 'desc', 51, 0
    );
    raise exception 'Invalid ticket sort was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;
reset role;

-- Die Entra-Agentenzuordnung ist immer eine bewusste Mandantenadmin-Aktion.
-- Sie wird bei noch nicht angemeldeten Personen nur vorgemerkt, erst beim
-- objektgebundenen Login angewendet und beim Entra-Offboarding zuverlässig
-- beendet. Browserrollen erhalten nie direkten Zugriff auf die RPCs.
do $$
declare
  v_result jsonb;
  v_assignment_id uuid;
  v_assignment_starts_at timestamptz;
  v_assignment_expires_at timestamptz;
begin
  if has_function_privilege(
    'authenticated',
    'public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.apply_entra_agent_request(uuid, uuid, uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.deactivate_stale_entra_directory_people(uuid, timestamptz, uuid)',
    'execute'
  ) then
    raise exception 'authenticated may execute Entra agent assignment RPCs';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid)',
    'execute'
  ) then
    raise exception 'service_role may not execute Entra agent assignment RPCs';
  end if;

  if not exists (
    select 1 from public.roles
    where tenant_id = '10000000-0000-4000-8000-000000000001'
      and name = 'Support agent'
      and scope = 'department'
  ) then
    insert into public.roles (tenant_id, name, scope)
    values (
      '10000000-0000-4000-8000-000000000001',
      'Support agent',
      'department'
    );
  end if;

  insert into public.user_profiles (id, display_name)
  values ('00000000-0000-4000-8000-000000000005', 'Vorher nicht angemeldet')
  on conflict (id) do nothing;
  insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
  values (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000005',
    'active',
    timezone('utc', now())
  ) on conflict (tenant_id, user_id) do update set status = 'active';

  insert into public.tenant_entra_directory_people (
    tenant_id, entra_object_id, email, display_name
  ) values (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'vormerkung@beispiel-a.ch',
    'Vorgemerkte Person'
  );

  begin
    perform public.set_entra_agent_request(
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      true,
      '11000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'Non-admin set an Entra agent request';
  exception when raise_exception then
    if sqlerrm <> 'tenant_admin_required' then
      raise;
    end if;
  end;

  select public.set_entra_agent_request(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    true,
    '11000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  ) into v_result;
  if not coalesce((v_result->>'updated')::boolean, false)
    or coalesce((v_result->>'effectiveImmediately')::boolean, true)
    or not exists (
      select 1 from public.tenant_entra_directory_people
      where tenant_id = '10000000-0000-4000-8000-000000000001'
        and entra_object_id = '30000000-0000-4000-8000-000000000003'
        and agent_requested
        and agent_requested_by = '00000000-0000-4000-8000-000000000002'
        and agent_requested_at is not null
        and agent_role_assignment_id is null
    ) then
    raise exception 'Pre-login Entra agent request was not only recorded';
  end if;

  update public.tenant_entra_directory_people
  set local_user_id = '00000000-0000-4000-8000-000000000003'
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and entra_object_id = '30000000-0000-4000-8000-000000000003';
  select public.apply_entra_agent_request(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003'
  ) into v_result;
  if not coalesce((v_result->>'applied')::boolean, false)
    or not exists (
      select 1
      from public.tenant_entra_directory_people person
      join public.user_role_assignments assignment
        on assignment.id = person.agent_role_assignment_id
      join public.roles role on role.id = assignment.role_id
      where person.tenant_id = '10000000-0000-4000-8000-000000000001'
        and person.entra_object_id = '30000000-0000-4000-8000-000000000003'
        and assignment.user_id = '00000000-0000-4000-8000-000000000003'
        and assignment.department_id = '11000000-0000-4000-8000-000000000001'
        and role.name = 'Support agent'
        and role.scope = 'department'
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
  ) then
    raise exception 'Verified Entra login did not apply the requested agent role';
  end if;

  select agent_role_assignment_id
  into v_assignment_id
  from public.tenant_entra_directory_people
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and entra_object_id = '30000000-0000-4000-8000-000000000003';
  perform set_config('nextdesk.entra_agent_assignment_operation', 'off', true);
  begin
    update public.user_role_assignments
    set expires_at = timezone('utc', now())
    where id = v_assignment_id;
    raise exception 'Generic role revocation changed a tracked Entra agent role';
  exception when raise_exception then
    if sqlerrm <> 'entra_agent_assignment_managed_separately' then
      raise;
    end if;
  end;
  select public.apply_entra_agent_request(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003'
  ) into v_result;
  if not coalesce((v_result->>'applied')::boolean, false)
    or not coalesce((v_result->>'alreadyApplied')::boolean, false) then
    raise exception 'Repeated Entra SSO did not preserve the protected tracked role';
  end if;

  perform public.set_entra_agent_request(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    false,
    null,
    '00000000-0000-4000-8000-000000000002'
  );
  if exists (
    select 1
    from public.tenant_entra_directory_people person
    join public.user_role_assignments assignment
      on assignment.id = person.agent_role_assignment_id
    where person.tenant_id = '10000000-0000-4000-8000-000000000001'
      and person.entra_object_id = '30000000-0000-4000-8000-000000000003'
  ) or not exists (
    select 1
    from public.user_role_assignments assignment
    where assignment.tenant_id = '10000000-0000-4000-8000-000000000001'
      and assignment.user_id = '00000000-0000-4000-8000-000000000003'
      and assignment.expires_at is not null
      and assignment.expires_at > assignment.starts_at
  ) then
    raise exception 'Revoking an Entra agent request did not safely end its role';
  end if;

  insert into public.tenant_entra_directory_people (
    tenant_id, entra_object_id, email, display_name, local_user_id
  ) values (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'offboarding@beispiel-a.ch',
    'Offboarding Person',
    '00000000-0000-4000-8000-000000000005'
  );
  perform public.set_entra_agent_request(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    true,
    '11000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  );
  if not exists (
    select 1
    from public.tenant_member_directory directory
    where directory.tenant_id = '10000000-0000-4000-8000-000000000001'
      and directory.user_id = '00000000-0000-4000-8000-000000000005'
      and directory.department_id = '11000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Immediate Entra agent assignment did not update the member directory';
  end if;
  select assignment.id, assignment.starts_at
  into v_assignment_id, v_assignment_starts_at
  from public.tenant_entra_directory_people person
  join public.user_role_assignments assignment
    on assignment.id = person.agent_role_assignment_id
  where person.tenant_id = '10000000-0000-4000-8000-000000000001'
    and person.entra_object_id = '30000000-0000-4000-8000-000000000005';
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);
  update public.user_role_assignments
  set starts_at = timezone('utc', now()) + interval '1 hour'
  where id = v_assignment_id;
  perform set_config('nextdesk.entra_agent_assignment_operation', 'off', true);
  update public.tenant_entra_directory_people
  set account_enabled = false,
      inactive_at = timezone('utc', now()),
      last_synced_at = timezone('utc', now()) + interval '1 hour'
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and entra_object_id = '30000000-0000-4000-8000-000000000005';
  perform public.deactivate_stale_entra_directory_people(
    '10000000-0000-4000-8000-000000000001',
    timezone('utc', now()),
    '00000000-0000-4000-8000-000000000002'
  );
  select starts_at, expires_at
  into v_assignment_starts_at, v_assignment_expires_at
  from public.user_role_assignments
  where id = v_assignment_id;
  if v_assignment_expires_at is null
    or v_assignment_expires_at > timezone('utc', now())
    or v_assignment_starts_at >= v_assignment_expires_at
    or exists (
      select 1 from public.user_role_assignments assignment
      where assignment.id = v_assignment_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    )
    or exists (
      select 1 from public.tenant_entra_directory_people
      where tenant_id = '10000000-0000-4000-8000-000000000001'
        and entra_object_id = '30000000-0000-4000-8000-000000000005'
        and agent_requested
    ) then
    raise exception 'Direct Entra account disable did not revoke the tracked agent role';
  end if;
end;
$$;

-- The scheduler must receive only new breaches. Existing events, closed or
-- answered tickets and disabled tenant features must not consume a small batch
-- before later valid tickets.
update public.tenant_feature_flags
set enabled = true
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'automation.sla';

insert into public.tickets (
  id, tenant_id, department_id, ticket_number, subject, description,
  status_id, priority_id, requester_id
) values
  ('51000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-SLA-001', 'Bereits verarbeitet', 'SLA-Regressionsfall mit bestehendem Breach.', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-SLA-002', 'Noch ausstehend', 'SLA-Regressionsfall ohne Breach.', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003', 'ICTB-2026-SLA-003', 'Deaktivierter Mandant', 'SLA-Regressionsfall ohne aktivierte Automatisierung.', '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'),
  ('51000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-SLA-004', 'Geschlossen', 'SLA-Regressionsfall mit geschlossenem Ticket.', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-SLA-005', 'Bereits beantwortet', 'SLA-Regressionsfall mit bereits erfolgter Antwort.', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

update public.tickets
set response_due_at = case id
      when '51000000-0000-4000-8000-000000000001' then clock_timestamp() - interval '3 hours'
      when '51000000-0000-4000-8000-000000000002' then clock_timestamp() - interval '2 hours'
      when '52000000-0000-4000-8000-000000000003' then clock_timestamp() - interval '4 hours'
      when '51000000-0000-4000-8000-000000000004' then clock_timestamp() - interval '5 hours'
      else clock_timestamp() - interval '6 hours'
    end,
    resolution_due_at = case id
      when '51000000-0000-4000-8000-000000000001' then clock_timestamp() - interval '3 hours'
      when '51000000-0000-4000-8000-000000000002' then clock_timestamp() - interval '2 hours'
      else null
    end,
    first_responded_at = case
      when id = '51000000-0000-4000-8000-000000000005' then clock_timestamp()
      else first_responded_at
    end,
    closed_at = case
      when id = '51000000-0000-4000-8000-000000000004' then clock_timestamp()
      else closed_at
    end
where id in (
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000005'
);

insert into public.ticket_sla_events (ticket_id, event_type, occurred_at, metadata)
values (
  '51000000-0000-4000-8000-000000000001',
  'response_breached',
  timezone('utc', now()),
  '{"source":"test"}'::jsonb
);

begin;
set local role service_role;
do $$
declare
  v_ticket_ids uuid[];
begin
  select array_agg(candidate.id order by candidate.id)
  into v_ticket_ids
  from public.list_pending_sla_breaches('response', 1) as candidate;

  if v_ticket_ids is distinct from array['51000000-0000-4000-8000-000000000002'::uuid] then
    raise exception 'Pending SLA selection was blocked by an earlier event or disabled tenant';
  end if;

  select array_agg(candidate.id order by candidate.id)
  into v_ticket_ids
  from public.list_pending_sla_breaches('resolution', 1) as candidate;

  if v_ticket_ids is distinct from array['51000000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'A response breach incorrectly suppressed a pending resolution breach';
  end if;

  if exists (
    select 1
    from public.list_pending_sla_breaches('response', 100) as candidate
    where candidate.id in (
      '51000000-0000-4000-8000-000000000004'::uuid,
      '51000000-0000-4000-8000-000000000005'::uuid
    )
  ) then
    raise exception 'Closed or answered ticket was selected for a response breach';
  end if;

  begin
    perform public.list_pending_sla_breaches('unsupported', 1);
    raise exception 'Unsupported SLA kind was accepted';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.list_pending_sla_breaches(null, 1);
    raise exception 'Null SLA kind was accepted';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.list_pending_sla_breaches('response', 0);
    raise exception 'Zero SLA limit was accepted';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.list_pending_sla_breaches('response', 101);
    raise exception 'Oversized SLA limit was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;
commit;

update public.tenant_feature_flags
set pilot_ends_at = clock_timestamp() - interval '1 minute'
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'automation.sla';

begin;
set local role service_role;
do $$
begin
  if exists (
    select 1 from public.list_pending_sla_breaches('response', 100)
  ) then
    raise exception 'Expired SLA pilot still selected candidates';
  end if;
end;
$$;
commit;

update public.tenant_feature_flags
set pilot_ends_at = null,
    enabled = false
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'automation.sla';

begin;
set local role service_role;
do $$
declare
  v_applied boolean;
begin
  select public.apply_sla_breach(
    '51000000-0000-4000-8000-000000000002',
    'response_breached',
    '51000000-0000-4000-8000-000000000099'
  ) into v_applied;

  if v_applied then
    raise exception 'Disabled SLA feature allowed a direct breach mutation';
  end if;
end;
$$;
commit;

do $$
begin
  if exists (
    select 1
    from public.ticket_sla_events
    where ticket_id = '51000000-0000-4000-8000-000000000002'
      and event_type = 'response_breached'
  ) then
    raise exception 'Disabled SLA feature created a breach event';
  end if;
end;
$$;

update public.tenant_feature_flags
set enabled = true
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'automation.sla';

begin;
set local role service_role;
do $$
declare
  v_response_applied boolean;
  v_response_repeat boolean;
  v_resolution_applied boolean;
  v_resolution_repeat boolean;
begin
  select public.apply_sla_breach(
    '51000000-0000-4000-8000-000000000002',
    'response_breached',
    '51000000-0000-4000-8000-000000000100'
  ) into v_response_applied;
  select public.apply_sla_breach(
    '51000000-0000-4000-8000-000000000002',
    'response_breached',
    '51000000-0000-4000-8000-000000000101'
  ) into v_response_repeat;
  select public.apply_sla_breach(
    '51000000-0000-4000-8000-000000000001',
    'resolution_breached',
    '51000000-0000-4000-8000-000000000102'
  ) into v_resolution_applied;
  select public.apply_sla_breach(
    '51000000-0000-4000-8000-000000000001',
    'resolution_breached',
    '51000000-0000-4000-8000-000000000103'
  ) into v_resolution_repeat;

  if v_response_applied is not true
    or v_resolution_applied is not true
    or v_response_repeat is not false
    or v_resolution_repeat is not false then
    raise exception 'SLA breach mutation did not remain idempotent per breach type';
  end if;
end;
$$;
commit;

do $$
begin
  if (select count(*) from public.ticket_sla_events
      where ticket_id = '51000000-0000-4000-8000-000000000002'
        and event_type = 'response_breached') <> 1
    or (select count(*) from public.ticket_sla_events
        where ticket_id = '51000000-0000-4000-8000-000000000001'
          and event_type = 'resolution_breached') <> 1
    or (select count(*) from public.ticket_escalations
        where ticket_id = '51000000-0000-4000-8000-000000000001'
          and kind = 'sla') <> 1
    or (select escalation_level from public.tickets
        where id = '51000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'SLA breach mutation did not write exactly one expected event and escalation';
  end if;
end;
$$;

begin;
set local role authenticated;
do $$
begin
  begin
    perform public.list_pending_sla_breaches('response', 1);
    raise exception 'Authenticated role executed private SLA candidate selection';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.apply_sla_breach(
      '51000000-0000-4000-8000-000000000002',
      'response_breached',
      '51000000-0000-4000-8000-000000000104'
    );
    raise exception 'Authenticated role executed private SLA breach mutation';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
rollback;

begin;
set local role anon;
do $$
begin
  begin
    perform public.list_pending_sla_breaches('response', 1);
    raise exception 'Anonymous role executed private SLA candidate selection';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.apply_sla_breach(
      '51000000-0000-4000-8000-000000000002',
      'response_breached',
      '51000000-0000-4000-8000-000000000105'
    );
    raise exception 'Anonymous role executed private SLA breach mutation';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
rollback;

-- The Entra directory connector is exclusively operated through service-role
-- RPCs. Its Entra tenant is derived from the active tenant-specific Azure SSO
-- URL; browser roles can neither read its private configuration nor call it.
do $$
begin
  if has_table_privilege('anon', 'public.tenant_entra_directory_sync_configurations', 'select')
    or has_table_privilege('authenticated', 'public.tenant_entra_directory_sync_configurations', 'select') then
    raise exception 'Browser roles retained Entra directory configuration access';
  end if;
  if has_function_privilege('authenticated', 'public.configure_entra_directory_sync(uuid, uuid, boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.record_entra_directory_connection_test(uuid, uuid, uuid, bigint, boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_entra_directory_sync_run(uuid, uuid, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.renew_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.upsert_fenced_entra_directory_people_batch(uuid, uuid, uuid, bigint, uuid, timestamptz, jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_fenced_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid, timestamptz, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.fail_entra_directory_sync_run(uuid, uuid, uuid, bigint)', 'execute')
    or has_function_privilege('authenticated', 'public.trusted_entra_tenant_id_for_tenant(uuid)', 'execute') then
    raise exception 'Authenticated role executed Entra directory service RPCs';
  end if;
  if not has_function_privilege('service_role', 'public.configure_entra_directory_sync(uuid, uuid, boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.record_entra_directory_connection_test(uuid, uuid, uuid, bigint, boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_entra_directory_sync_run(uuid, uuid, uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.renew_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.upsert_fenced_entra_directory_people_batch(uuid, uuid, uuid, bigint, uuid, timestamptz, jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.finalize_fenced_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid, timestamptz, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.fail_entra_directory_sync_run(uuid, uuid, uuid, bigint)', 'execute')
    or not has_function_privilege('service_role', 'public.trusted_entra_tenant_id_for_tenant(uuid)', 'execute') then
    raise exception 'Service role lost an Entra directory service RPC';
  end if;
end;
$$;

begin;
update public.tenant_sso_configurations
set provider = 'azure_ad',
    enabled = true,
    issuer_url = 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0',
    discovery_url = null
where tenant_id = '10000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  v_tenant_a constant uuid := '10000000-0000-4000-8000-000000000001';
  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
  v_requester constant uuid := '00000000-0000-4000-8000-000000000001';
  v_entra_tenant constant uuid := '11111111-1111-4111-8111-111111111111';
  v_first_run constant uuid := '40000000-0000-4000-8000-000000000001';
  v_second_run constant uuid := '40000000-0000-4000-8000-000000000002';
  v_third_run constant uuid := '40000000-0000-4000-8000-000000000003';
  v_outcome text;
  v_claimed_tenant uuid;
  v_started_at timestamptz;
  v_sync_generation bigint;
  v_test_generation bigint;
  v_connection_test_status text;
  v_completed boolean;
  v_configured_tenant uuid;
  v_configured_enabled boolean;
  v_connection_tested_at timestamptz;
begin
  begin
    perform public.configure_entra_directory_sync(v_requester, v_tenant_a, false);
    raise exception 'Non-admin configured the Entra directory connector';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Non-admin configured the Entra directory connector' then
      raise;
    end if;
  end;

  if public.trusted_entra_tenant_id_for_tenant(v_tenant_a) is distinct from v_entra_tenant then
    raise exception 'Tenant-specific active Azure SSO issuer was not trusted';
  end if;

  select entra_tenant_id, enabled, last_connection_tested_at
  into v_configured_tenant, v_configured_enabled, v_connection_tested_at
  from public.configure_entra_directory_sync(v_admin, v_tenant_a, false);
  if v_configured_tenant is distinct from v_entra_tenant
    or v_configured_enabled is distinct from false
    or v_connection_tested_at is not null then
    raise exception 'Disabled Entra connector was not bound to the trusted SSO tenant';
  end if;

  -- An active connector without a successful test must stay blocked. A saved
  -- but disabled connector can then be tested without enabling a sync.
  perform public.configure_entra_directory_sync(v_admin, v_tenant_a, true);
  select outcome
  into v_outcome
  from public.claim_entra_directory_sync_run(v_admin, v_tenant_a, v_first_run);
  if v_outcome <> 'not_ready' then
    raise exception 'Untested Entra connector permitted an actual sync claim';
  end if;
  select sync_generation
  into v_test_generation
  from public.configure_entra_directory_sync(v_admin, v_tenant_a, false);
  perform public.record_entra_directory_connection_test(
    v_admin,
    v_tenant_a,
    v_entra_tenant,
    v_test_generation,
    true
  );

  select outcome, entra_tenant_id, started_at
  into v_outcome, v_claimed_tenant, v_started_at
  from public.claim_entra_directory_sync_run(v_admin, v_tenant_a, v_first_run);
  if v_outcome <> 'not_ready' or v_claimed_tenant is not null or v_started_at is not null then
    raise exception 'Disabled Entra connector permitted an actual sync claim';
  end if;

  perform public.configure_entra_directory_sync(v_admin, v_tenant_a, true);
  select outcome, entra_tenant_id, started_at, sync_generation
  into v_outcome, v_claimed_tenant, v_started_at, v_sync_generation
  from public.claim_entra_directory_sync_run(v_admin, v_tenant_a, v_first_run);
  if v_outcome <> 'claimed'
    or v_claimed_tenant is distinct from v_entra_tenant
    or v_started_at is null
    or v_sync_generation < 1 then
    raise exception 'Enabled Entra connector did not issue a bound sync lease';
  end if;

  select outcome
  into v_outcome
  from public.claim_entra_directory_sync_run(v_admin, v_tenant_a, v_second_run);
  if v_outcome <> 'in_progress' then
    raise exception 'Concurrent Entra sync was not prevented by the lease';
  end if;

  begin
    perform public.configure_entra_directory_sync(v_admin, v_tenant_a, false);
    raise exception 'Entra connector changed during an active sync';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Entra connector changed during an active sync' then
      raise;
    end if;
  end;

  select public.fail_entra_directory_sync_run(
    v_admin, v_tenant_a, v_second_run, v_sync_generation
  ) into v_completed;
  if v_completed then
    raise exception 'A sync run with a mismatched run ID was completed';
  end if;

  begin
    perform public.fail_entra_directory_sync_run(
      v_requester, v_tenant_a, v_first_run, v_sync_generation
    );
    raise exception 'Non-admin completed an Entra sync run';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Non-admin completed an Entra sync run' then
      raise;
    end if;
  end;

end;
$$;
reset role;
select set_config(
  'nextdesk.test_entra_sync_generation',
  (
    select sync_generation::text
    from public.tenant_entra_directory_sync_configurations
    where tenant_id = '10000000-0000-4000-8000-000000000001'
  ),
  true
);
update public.tenant_sso_configurations
set issuer_url = 'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0'
where tenant_id = '10000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  v_generation bigint := current_setting('nextdesk.test_entra_sync_generation', true)::bigint;
begin
  begin
    perform public.upsert_fenced_entra_directory_people_batch(
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      v_generation,
      '11111111-1111-4111-8111-111111111111',
      timezone('utc', now()),
      jsonb_build_array(jsonb_build_object(
        'entra_object_id', '40000000-0000-4000-8000-000000000099',
        'email', 'old-directory@example.test',
        'display_name', 'Old Directory',
        'job_title', null,
        'source_department_name', null,
        'account_enabled', true
      ))
    );
    raise exception 'Rebound SSO permitted an old Entra directory write';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'Rebound SSO permitted an old Entra directory write' then
      raise;
    end if;
  end;
end;
$$;
reset role;
update public.tenant_sso_configurations
set issuer_url = 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0'
where tenant_id = '10000000-0000-4000-8000-000000000001';
update public.tenant_entra_directory_sync_configurations
set sync_lease_expires_at = timezone('utc', now()) - interval '1 second'
where tenant_id = '10000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  v_tenant_a constant uuid := '10000000-0000-4000-8000-000000000001';
  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
  v_entra_tenant constant uuid := '11111111-1111-4111-8111-111111111111';
  v_third_run constant uuid := '40000000-0000-4000-8000-000000000003';
  v_outcome text;
  v_claimed_tenant uuid;
  v_started_at timestamptz;
  v_sync_generation bigint;
begin
  select outcome, entra_tenant_id, started_at, sync_generation
  into v_outcome, v_claimed_tenant, v_started_at, v_sync_generation
  from public.claim_entra_directory_sync_run(v_admin, v_tenant_a, v_third_run);
  if v_outcome <> 'claimed'
    or v_claimed_tenant is distinct from v_entra_tenant
    or v_started_at is null
    or v_sync_generation < 1 then
    raise exception 'Expired Entra sync lease was not recoverable';
  end if;

  perform *
  from public.finalize_fenced_entra_directory_sync_run(
    v_admin,
    v_tenant_a,
    v_third_run,
    v_sync_generation,
    v_entra_tenant,
    v_started_at,
    12
  );
end;
$$;
reset role;
-- A late success for a test started against tenant A must never unlock a
-- connector that has meanwhile been rebound and saved for tenant B.
select set_config(
  'nextdesk.test_entra_connection_generation',
  (
    select sync_generation::text
    from public.tenant_entra_directory_sync_configurations
    where tenant_id = '10000000-0000-4000-8000-000000000001'
  ),
  true
);
update public.tenant_sso_configurations
set issuer_url = 'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0'
where tenant_id = '10000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  v_tenant_a constant uuid := '10000000-0000-4000-8000-000000000001';
  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
  v_tenant_a_entra constant uuid := '11111111-1111-4111-8111-111111111111';
  v_old_generation bigint := current_setting('nextdesk.test_entra_connection_generation', true)::bigint;
  v_connection_test_status text;
begin
  select last_connection_test_status
  into v_connection_test_status
  from public.configure_entra_directory_sync(v_admin, v_tenant_a, false);
  if v_connection_test_status is not null then
    raise exception 'Rebound Entra configuration retained a prior test success';
  end if;

  begin
    perform public.record_entra_directory_connection_test(
      v_admin,
      v_tenant_a,
      v_tenant_a_entra,
      v_old_generation,
      true
    );
    raise exception 'Late Entra connection test marked a rebound configuration as successful';
  exception when others then
    if sqlstate = 'P0001'
      and sqlerrm = 'Late Entra connection test marked a rebound configuration as successful' then
      raise;
    end if;
  end;

  select last_connection_test_status
  into v_connection_test_status
  from public.configure_entra_directory_sync(v_admin, v_tenant_a, false);
  if v_connection_test_status is not null then
    raise exception 'Rebound Entra configuration retained a late test success';
  end if;
end;
$$;
reset role;
update public.tenant_sso_configurations
set issuer_url = 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0'
where tenant_id = '10000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  v_tenant_a constant uuid := '10000000-0000-4000-8000-000000000001';
  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
  v_tenant_a_entra constant uuid := '11111111-1111-4111-8111-111111111111';
  v_generation bigint;
begin
  select sync_generation
  into v_generation
  from public.configure_entra_directory_sync(v_admin, v_tenant_a, true);
  perform public.record_entra_directory_connection_test(
    v_admin,
    v_tenant_a,
    v_tenant_a_entra,
    v_generation,
    true
  );
end;
$$;
reset role;
do $$
begin
  if exists (
    select 1
    from public.audit_logs
	    where tenant_id = '10000000-0000-4000-8000-000000000001'
	      and action like 'tenant.entra_directory.%'
	      and (metadata ? 'email' or metadata ? 'token' or metadata ? 'entra_tenant_id')
	  ) then
	    raise exception 'Entra directory audit metadata retained sensitive values';
	  end if;
	end;
	$$;

	-- P1.5: the Intune control plane is local-only, auditable and explicitly
	-- idempotent. It must not become a hidden Graph sync or browser-writable table.
update public.tenant_feature_flags
set enabled = true
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'assets.management';
insert into public.assets (
  id, tenant_id, name, asset_tag, inventory_number, serial_number, kind, status
) values (
  '71000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'P1.5 Privacy Test Asset',
  'P15-PRIVACY',
  'P15-INV-001',
  'P15-SERIAL-001',
  'computer',
  'active'
);
insert into public.asset_intune_asset_links (
  tenant_id, asset_id, canonical_external_device_id
) values (
  '10000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'p15-intune-device-001'
);
insert into public.asset_intune_devices (
  tenant_id, asset_id, external_device_id, device_name, user_display_name,
  user_principal_name, snapshot
) values (
  '10000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'P15-INTUNE-DEVICE-001',
  'P1.5 Privacy Test Device',
  'Private Test Person',
  'private.test@example.invalid',
  jsonb_build_object('sensitive_provider_snapshot', true)
);
do $$
begin
  if has_table_privilege('authenticated', 'public.asset_intune_devices', 'select')
    or has_table_privilege('authenticated', 'public.asset_identifiers', 'select')
    or has_table_privilege('authenticated', 'public.asset_intune_asset_links', 'select') then
    raise exception 'Authenticated browser role retained a private Intune table privilege';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assets'
      and column_name = 'intune_device_id'
  ) then
    raise exception 'Browser-readable assets table retained an Intune device ID column';
  end if;
  begin
    update public.assets
    set metadata = jsonb_build_object('external_device_id', 'must-remain-private')
    where id = '71000000-0000-4000-8000-000000000001';
    raise exception 'Asset metadata accepted a private provider device ID';
  exception when invalid_parameter_value then
    null;
  end;
  if exists (
    select 1
    from public.assets
    where id = '71000000-0000-4000-8000-000000000001'
      and metadata ? 'external_device_id'
  ) then
    raise exception 'Private provider device ID remained in asset metadata';
  end if;
  begin
    update public.assets
    set metadata = jsonb_build_object(
      'provider', jsonb_build_object('user_display_name', 'must-remain-private'),
      'array', jsonb_build_array(
        jsonb_build_object('managed_device_id', 'must-remain-private')
      )
    )
    where id = '71000000-0000-4000-8000-000000000001';
    raise exception 'Asset metadata accepted a nested private provider device ID';
  exception when invalid_parameter_value then
    null;
  end;
  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'assets'
      and policy.policyname = 'assets_select_member'
      and policy.qual like '%is_asset_management_client_enabled%'
  ) then
    raise exception 'Asset read policy did not enforce the feature and pilot gate';
  end if;
  if (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('ticket_services', 'ticket_assets', 'problem_tickets')
      and policy.policyname like '%_select_member'
      and policy.qual like '%is_asset_management_client_enabled%'
  ) <> 3 then
    raise exception 'Ticket asset link policies did not enforce the feature and pilot gate';
  end if;
end;
$$;
insert into public.role_permissions (role_id, permission_code)
select assignment.role_id, 'asset.integration.manage'
from public.user_role_assignments assignment
where assignment.tenant_id = '10000000-0000-4000-8000-000000000001'
  and assignment.user_id = '00000000-0000-4000-8000-000000000002'
on conflict do nothing;

update public.tenant_feature_flags
set enabled = true
where tenant_id = '20000000-0000-4000-8000-000000000002'
  and feature_key = 'assets.management';

set local role authenticated;
	select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
	do $$
	begin
	  if not exists (
	    select 1
	    from public.assets
	    where id = '71000000-0000-4000-8000-000000000001'
	  ) then
	    raise exception 'Enabled asset feature unexpectedly hid an authorized asset';
	  end if;
	  begin
	    perform public.configure_asset_intune_preflight(
	      '00000000-0000-4000-8000-000000000002',
	      '10000000-0000-4000-8000-000000000001',
	      true
	    );
	    raise exception 'Authenticated browser role configured Intune preflight directly';
	  exception when insufficient_privilege then
	    null;
	  end;
	  begin
	    perform 1
	    from public.asset_intune_connections
	    limit 1;
	    raise exception 'Authenticated browser role read private Intune configuration';
	  exception when insufficient_privilege then
	    null;
	  end;
	  begin
	    perform 1 from public.asset_intune_devices limit 1;
	    raise exception 'Authenticated browser role read private Intune device data';
	  exception when insufficient_privilege then
	    null;
	  end;
	  begin
	    perform 1 from public.asset_identifiers limit 1;
	    raise exception 'Authenticated browser role read private asset identifiers';
	  exception when insufficient_privilege then
	    null;
	  end;
		  begin
		    perform 1 from public.asset_intune_asset_links limit 1;
		    raise exception 'Authenticated browser role read private Intune device links';
		  exception when insufficient_privilege then
		    null;
		  end;
		  if public.is_asset_management_client_enabled(
		    '20000000-0000-4000-8000-000000000002'
		  ) then
		    raise exception 'An active member could probe the asset feature state of another tenant';
		  end if;
		end;
		$$;
	reset role;
	update public.tenant_feature_flags
	set enabled = false
	where tenant_id = '10000000-0000-4000-8000-000000000001'
	  and feature_key = 'assets.management';
	set local role authenticated;
	select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
	do $$
	begin
	  if exists (
	    select 1
	    from public.assets
	    where id = '71000000-0000-4000-8000-000000000001'
	  ) then
	    raise exception 'Disabled asset feature still exposed direct browser asset reads';
	  end if;
	end;
	$$;
	reset role;
	update public.tenant_feature_flags
	set enabled = true
	where tenant_id = '10000000-0000-4000-8000-000000000001'
	  and feature_key = 'assets.management';

	set local role service_role;
	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
  v_first record;
  v_duplicate record;
  v_retry record;
  v_blocked record;
	  v_generation bigint;
	begin
	  select configuration_generation
	  into v_generation
	  from public.configure_asset_intune_preflight(v_admin, v_tenant, true);
	  if v_generation < 2 then
	    raise exception 'Intune preflight configuration did not advance its generation';
	  end if;
	  if exists (
	    select 1
	    from public.asset_intune_connections
	    where tenant_id = v_tenant and sync_enabled
	  ) then
	    raise exception 'Local Intune preflight enabled a provider sync';
	  end if;

	  select * into v_first
	  from public.run_asset_intune_local_preflight(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000001'
	  );
	  if v_first.status <> 'succeeded'
	    or v_first.result_code <> 'preflight_ready'
	    or v_first.provider_contacted
	    or v_first.attempt_no <> 1 then
	    raise exception 'Local Intune preflight was not provider-free and ready';
	  end if;
	  if exists (
	    select 1
	    from public.asset_intune_sync_runs
	    where id = v_first.id
	      and (devices_seen <> 0 or assets_created <> 0 or assets_updated <> 0)
	  ) then
	    raise exception 'Local Intune preflight modified asset counters';
	  end if;

	  select * into v_duplicate
	  from public.run_asset_intune_local_preflight(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000001'
	  );
	  if v_duplicate.id <> v_first.id then
	    raise exception 'Duplicate local Intune preflight was not idempotent';
	  end if;

	  select * into v_retry
	  from public.run_asset_intune_local_preflight(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000002',
	    v_first.id
	  );
	  if v_retry.retry_of_run_id <> v_first.id
	    or v_retry.root_run_id <> v_first.root_run_id
	    or v_retry.attempt_no <> 2
	    or v_retry.provider_contacted then
	    raise exception 'Local Intune preflight retry lost its audited recovery lineage';
	  end if;

	  perform public.configure_asset_intune_preflight(v_admin, v_tenant, false);
	  select * into v_blocked
	  from public.run_asset_intune_local_preflight(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000003'
	  );
	  if v_blocked.status <> 'blocked'
	    or v_blocked.result_code <> 'connection_disabled'
	    or v_blocked.provider_contacted then
	    raise exception 'Disabled Intune preflight was not safely recorded as local-only';
	  end if;
	end;
	$$;
	reset role;

	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	begin
	  if exists (
	    select 1
	    from public.audit_logs audit
	    where audit.tenant_id = v_tenant
	      and audit.action like 'asset.intune_preflight.%'
			  and audit.metadata ?| array['directory_tenant_id', 'device_id', 'token', 'provider_error']
		  ) then
		    raise exception 'Local Intune preflight audit leaked provider or tenant details';
		  end if;
		end;
		$$;

	-- Der manuelle P1.5.1-Graph-Lauf bleibt privat, gefencet, idempotent und
	-- trennt Vorschau und Übernahme. Der Test kontaktiert keinen Provider;
	-- der dokumentierte Graph-Kontakt wird nur über die service-role-RPC
	-- markiert, wie dies die Edge Function unmittelbar vor dem GET tut.
	do $$
	begin
	  if has_table_privilege('authenticated', 'public.asset_intune_manual_sync_runs', 'select')
	    or has_table_privilege('authenticated', 'public.asset_intune_manual_sync_stage', 'select')
	    or has_table_privilege('authenticated', 'public.asset_intune_primary_person_links', 'select')
	    or has_function_privilege(
	      'authenticated',
	      'public.claim_asset_intune_manual_sync_run(uuid, uuid, uuid, text, uuid)',
	      'execute'
	    ) or has_function_privilege(
	      'authenticated',
	      'public.sync_asset_intune_primary_person_link(uuid, uuid, uuid, uuid)',
	      'execute'
	    ) then
	    raise exception 'Authenticated browser role retained private manual Intune sync access';
	  end if;
	end;
	$$;

	set local role service_role;
	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
	  v_configuration record;
	  v_dry_claim record;
	  v_dry_complete record;
	  v_sync_claim record;
	  v_sync_complete record;
	  v_duplicate record;
	  v_expired_claim record;
	  v_stage_count integer;
	begin
	  perform public.configure_asset_intune_preflight(v_admin, v_tenant, true);
	  select * into v_configuration
	  from public.configure_asset_intune_manual_sync(v_admin, v_tenant, true);
	  if not v_configuration.manual_sync_enabled then
	    raise exception 'Manual Intune sync configuration did not enable explicitly';
	  end if;
	  if exists (
	    select 1 from public.asset_intune_connections
	    where tenant_id = v_tenant and sync_enabled
	  ) then
	    raise exception 'Manual Intune sync configuration enabled a scheduler switch';
	  end if;

	  select * into v_dry_claim
	  from public.claim_asset_intune_manual_sync_run(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000011',
	    'dry_run'
	  );
	  if v_dry_claim.outcome <> 'claimed'
	    or v_dry_claim.status <> 'running'
	    or v_dry_claim.entra_tenant_id is null then
	    raise exception 'Manual Intune dry run was not claimed with a server-bound tenant';
	  end if;
	  begin
	    perform public.stage_asset_intune_manual_sync_devices(
	      v_admin, v_tenant, v_dry_claim.id,
	      v_dry_claim.configuration_generation, v_dry_claim.manual_sync_generation,
	      '[]'::jsonb
	    );
	    raise exception 'Manual Intune staging proceeded before a confirmed Graph request';
	  exception when sqlstate 'P0002' then
	    null;
	  end;
	  perform public.mark_asset_intune_manual_sync_provider_contact(
	    v_admin, v_tenant, v_dry_claim.id,
	    v_dry_claim.configuration_generation, v_dry_claim.manual_sync_generation
	  );
	  perform public.renew_asset_intune_manual_sync_fence(
	    v_admin, v_tenant, v_dry_claim.id,
	    v_dry_claim.configuration_generation, v_dry_claim.manual_sync_generation
	  );
	  select public.stage_asset_intune_manual_sync_devices(
	    v_admin, v_tenant, v_dry_claim.id,
	    v_dry_claim.configuration_generation, v_dry_claim.manual_sync_generation,
	    jsonb_build_array(
	      jsonb_build_object(
	        'external_device_id', 'P15-INTUNE-DEVICE-001',
	        'device_name', 'Eindeutig verknüpftes Gerät',
	        'serial_number', 'P15-SERIAL-001',
	        'manufacturer', 'nextDesk Test',
	        'model', 'Ambiguous',
	        'operating_system', 'Windows',
	        'os_version', '11',
	        'compliance_state', 'compliant',
	        'is_encrypted', true,
	        'last_sync_at', '2026-10-21T05:00:00Z',
	        'enrolled_at', '2026-10-01T05:00:00Z'
	      ),
	      jsonb_build_object(
	        'external_device_id', 'P15-DRY-NEW-001',
	        'device_name', 'P1.5.1 Dry Run neu',
	        'serial_number', 'P15-DRY-NEW-001',
	        'manufacturer', 'nextDesk Test',
	        'model', 'Preview',
	        'operating_system', 'Windows',
	        'os_version', '11',
	        'compliance_state', 'compliant',
	        'is_encrypted', true,
	        'last_sync_at', '2026-10-21T05:00:00Z',
	        'enrolled_at', '2026-10-01T05:00:00Z'
	      ),
	      jsonb_build_object(
	        'external_device_id', 'P15-SERIAL-COLLISION-001',
	        'device_name', 'P1.5.1 Seriennummernkollision',
	        'serial_number', 'P15-SERIAL-001',
	        'manufacturer', 'nextDesk Test',
	        'model', 'Collision',
	        'operating_system', 'Windows',
	        'os_version', '11',
	        'compliance_state', 'compliant',
	        'is_encrypted', true,
	        'last_sync_at', '2026-10-21T05:00:00Z',
	        'enrolled_at', '2026-10-01T05:00:00Z'
	      )
	    )
	  ) into v_stage_count;
	  if v_stage_count <> 3 then
	    raise exception 'Manual Intune dry run did not stage every bounded device';
	  end if;
	  select * into v_dry_complete
	  from public.complete_asset_intune_manual_sync_run(
	    v_admin, v_tenant, v_dry_claim.id,
	    v_dry_claim.configuration_generation, v_dry_claim.manual_sync_generation
	  );
	  if v_dry_complete.status <> 'succeeded'
	    or v_dry_complete.result_code <> 'provider_dry_run_succeeded'
	    or not v_dry_complete.provider_contacted
	    or v_dry_complete.devices_seen <> 3
	    or v_dry_complete.assets_created <> 1
	    or v_dry_complete.assets_updated <> 1
	    or v_dry_complete.assets_skipped <> 1
	    or v_dry_complete.ambiguous_devices <> 0 then
	    raise exception 'Manual Intune dry run did not retain its atomic preview contract';
	  end if;
	  if exists (
	    select 1 from public.assets
	    where tenant_id = v_tenant and name = 'P1.5.1 Dry Run neu'
	  ) or exists (
	    select 1 from public.asset_intune_manual_sync_stage
	    where run_id = v_dry_claim.id and tenant_id = v_tenant
	  ) then
	    raise exception 'Manual Intune dry run persisted staged or preview-only data';
	  end if;

	  select * into v_sync_claim
	  from public.claim_asset_intune_manual_sync_run(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000012',
	    'synchronize'
	  );
	  perform public.mark_asset_intune_manual_sync_provider_contact(
	    v_admin, v_tenant, v_sync_claim.id,
	    v_sync_claim.configuration_generation, v_sync_claim.manual_sync_generation
	  );
	  perform public.stage_asset_intune_manual_sync_devices(
	    v_admin, v_tenant, v_sync_claim.id,
	    v_sync_claim.configuration_generation, v_sync_claim.manual_sync_generation,
	    jsonb_build_array(jsonb_build_object(
	      'external_device_id', 'P15-SYNC-NEW-001',
	      'device_name', 'P1.5.1 Synchronisation neu',
	      'serial_number', 'P15-SYNC-NEW-001',
	      'manufacturer', 'nextDesk Test',
	      'model', 'Sync',
	      'operating_system', 'Windows',
	      'os_version', '11',
	      'compliance_state', 'compliant',
	      'is_encrypted', true,
	      'last_sync_at', '2026-10-21T05:00:00Z',
	      'enrolled_at', '2026-10-01T05:00:00Z',
	      'primary_user_object_id', '30000000-0000-4000-8000-000000000003'
	    ))
	  );
	  select * into v_sync_complete
	  from public.complete_asset_intune_manual_sync_run(
	    v_admin, v_tenant, v_sync_claim.id,
	    v_sync_claim.configuration_generation, v_sync_claim.manual_sync_generation
	  );
	  if v_sync_complete.status <> 'succeeded'
	    or v_sync_complete.result_code <> 'provider_sync_succeeded'
	    or v_sync_complete.assets_created <> 1
	    or v_sync_complete.assets_updated <> 0 then
	    raise exception 'Manual Intune sync did not create the explicitly confirmed new asset';
	  end if;
	  select * into v_duplicate
	  from public.claim_asset_intune_manual_sync_run(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000012',
	    'synchronize'
	  );
	  if v_duplicate.outcome <> 'existing' or v_duplicate.id <> v_sync_claim.id then
	    raise exception 'Manual Intune sync request was not idempotent';
	  end if;

	  select * into v_expired_claim
	  from public.claim_asset_intune_manual_sync_run(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000013',
	    'dry_run'
	  );
	  perform public.mark_asset_intune_manual_sync_provider_contact(
	    v_admin, v_tenant, v_expired_claim.id,
	    v_expired_claim.configuration_generation, v_expired_claim.manual_sync_generation
	  );
	  perform public.stage_asset_intune_manual_sync_devices(
	    v_admin, v_tenant, v_expired_claim.id,
	    v_expired_claim.configuration_generation, v_expired_claim.manual_sync_generation,
	    jsonb_build_array(jsonb_build_object('external_device_id', 'P15-EXPIRED-001'))
	  );
	end;
	$$;
	reset role;
	update public.asset_intune_connections
	set manual_sync_lease_expires_at = timezone('utc', now()) - interval '1 second'
	where tenant_id = '10000000-0000-4000-8000-000000000001'
	  and active_manual_sync_run_id = (
	    select run.id
	    from public.asset_intune_manual_sync_runs run
	    where run.tenant_id = '10000000-0000-4000-8000-000000000001'
	      and run.client_request_id = '60000000-0000-4000-8000-000000000013'
	  );
	set local role service_role;
	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
	  v_recovery_claim record;
	begin
	  select * into v_recovery_claim
	  from public.claim_asset_intune_manual_sync_run(
	    v_admin,
	    v_tenant,
	    '60000000-0000-4000-8000-000000000014',
	    'dry_run'
	  );
	  if v_recovery_claim.outcome <> 'claimed' then
	    raise exception 'Expired manual Intune run blocked the next manual recovery (outcome %, status %, result %)',
	      v_recovery_claim.outcome, v_recovery_claim.status, v_recovery_claim.result_code;
	  end if;
	  perform public.fail_asset_intune_manual_sync_run(
	    v_tenant, v_recovery_claim.id, 'run_expired'
	  );
	end;
	$$;
	reset role;
	do $$
	begin
	  if not exists (
	    select 1
	    from public.asset_intune_manual_sync_runs run
	    where run.tenant_id = '10000000-0000-4000-8000-000000000001'
	      and run.client_request_id = '60000000-0000-4000-8000-000000000013'
	      and run.status = 'blocked'
	      and run.result_code = 'run_expired'
	  ) or exists (
	    select 1
	    from public.asset_intune_manual_sync_stage stage
	    join public.asset_intune_manual_sync_runs run on run.id = stage.run_id
	    where run.tenant_id = '10000000-0000-4000-8000-000000000001'
	      and run.client_request_id = '60000000-0000-4000-8000-000000000013'
	  ) then
	    raise exception 'Expired manual Intune run was not closed and purged before recovery';
	  end if;
	  if not exists (
	    select 1
	    from public.assets asset
	    join public.asset_intune_asset_links link
	      on link.tenant_id = asset.tenant_id and link.asset_id = asset.id
	    where asset.tenant_id = '10000000-0000-4000-8000-000000000001'
	      and asset.name = 'P1.5.1 Synchronisation neu'
	      and link.canonical_external_device_id = 'p15-sync-new-001'
	  ) then
	    raise exception 'Manual Intune sync did not create its private exact device link';
	  end if;
	end;
	$$;

	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
	begin
	  update public.tenant_feature_flags
	  set pilot_ends_at = timezone('utc', now()) - interval '1 second'
	  where tenant_id = v_tenant and feature_key = 'assets.management';
	  begin
	    perform public.get_asset_intune_preflight_configuration(v_admin, v_tenant);
	    raise exception 'Expired asset pilot still allowed a local Intune preflight operation';
	  exception when insufficient_privilege then
	    null;
	  end;
	  update public.tenant_feature_flags
	  set pilot_ends_at = null
	  where tenant_id = v_tenant and feature_key = 'assets.management';
	end;
	$$;

	do $$
	declare
	  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
	  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
	  v_problem uuid := '70000000-0000-4000-8000-000000000001';
	begin
	  insert into public.problems (
	    id, tenant_id, title, description, status, owner_id, created_by
	  ) values (
	    v_problem, v_tenant, 'Owner integrity test', 'P1.5 test case', 'open', v_admin, v_admin
	  );
	  begin
	    update public.problems
	    set owner_id = '00000000-0000-4000-8000-000000000099'
	    where id = v_problem and tenant_id = v_tenant;
	    raise exception 'An inactive or foreign problem owner was accepted';
	  exception when foreign_key_violation then
	    null;
	  end;
	end;
	$$;

		-- A verified SSO claim may promote an invitation, but a later cancellation
		-- must still terminate that membership and expire every active role. A retry
		-- of the SSO claim then remains removed instead of restoring access.
		do $$
		declare
		  v_tenant uuid;
		  v_department uuid;
		  v_invitation uuid;
		  v_role uuid;
		  v_claim jsonb;
		  v_user constant uuid := '00000000-0000-4000-8000-000000000006';
		  v_current_invitation_user constant uuid := '00000000-0000-4000-8000-000000000007';
		  v_after_claim_user constant uuid := '00000000-0000-4000-8000-000000000008';
		  v_admin constant uuid := '00000000-0000-4000-8000-000000000004';
		begin
		  select id into v_tenant
		  from public.tenants
		  where slug = 'tenant-c';
		  select id into v_role
		  from public.roles
		  where tenant_id = v_tenant
		    and name = 'Requester'
		    and scope = 'tenant';
		  select id into v_department
		  from public.departments
		  where tenant_id = v_tenant
		    and key = 'ict';

		  v_invitation := public.prepare_tenant_invitation(
		    v_admin,
		    v_tenant,
		    'sso-offboarding@example.ch'::citext
		  );
		  perform public.record_tenant_invitation_delivery(
		    v_admin,
		    v_invitation,
		    v_user
		  );
		  v_claim := public.claim_verified_tenant_sso_membership(
		    v_tenant,
		    v_user,
		    'sso-offboarding@example.ch'::citext
		  );
		  if v_claim->>'status' <> 'active'
		    or coalesce((v_claim->>'was_active')::boolean, true) then
		    raise exception 'Verified SSO claim did not activate an invited member';
		  end if;

		  insert into public.user_role_assignments (
		    tenant_id,
		    user_id,
		    role_id,
		    assigned_by
		  ) values (v_tenant, v_user, v_role, v_admin);
		  update public.tenant_invitations
		  set status = 'accepted',
		      accepted_at = timezone('utc', now())
		  where id = v_invitation
		    and status = 'sent';
		  perform public.cancel_tenant_invitation(v_admin, v_invitation);

		  if not exists (
		    select 1
		    from public.tenant_memberships membership
		    where membership.tenant_id = v_tenant
		      and membership.user_id = v_user
		      and membership.status = 'removed'
		  ) or exists (
		    select 1
		    from public.user_role_assignments assignment
		    where assignment.tenant_id = v_tenant
		      and assignment.user_id = v_user
		      and (
		        assignment.expires_at is null
		        or assignment.expires_at > timezone('utc', now()) + interval '1 second'
		      )
		  ) then
		    raise exception 'Cancelling an SSO invitation did not remove access atomically';
		  end if;

		  v_claim := public.claim_verified_tenant_sso_membership(
		    v_tenant,
		    v_user,
		    'sso-offboarding@example.ch'::citext
		  );
		  if v_claim->>'status' <> 'removed' then
		    raise exception 'Delayed SSO claim reactivated a removed membership';
		  end if;
		  begin
		    update public.tenant_memberships
		    set status = 'active'
		    where tenant_id = v_tenant and user_id = v_user;
		    raise exception 'Removed membership was reactivated outside a re-invitation';
		  exception when raise_exception then
		    if sqlerrm <> 'A removed tenant membership cannot be reactivated' then
		      raise;
		    end if;
		  end;

		  -- The current tenant-users invitation flow has no local membership until
		  -- its locked acceptance claim promotes it. Revocation must therefore both
		  -- block a future claim and remove a claim that committed immediately before.
		  insert into auth.users (id)
		  values (v_current_invitation_user)
		  on conflict (id) do nothing;
		  insert into public.user_profiles (id, display_name)
		  values (v_current_invitation_user, 'Current invitation SSO test')
		  on conflict (id) do nothing;
		  insert into public.tenant_user_invitations (
		    tenant_id,
		    email,
		    invited_by,
		    expires_at,
		    role_name
		  ) values (
		    v_tenant,
		    'sso-current-revocation@example.ch'::citext,
		    v_admin,
		    timezone('utc', now()) + interval '1 day',
		    'Requester'
		  ) returning id into v_invitation;
		  v_claim := public.claim_current_tenant_user_invitation(
		    v_current_invitation_user,
		    'sso-current-revocation@example.ch'::citext,
		    v_invitation
		  );
		  if v_claim->>'status' <> 'active' or v_claim->'invitation' is null then
		    raise exception 'Current invitation claim did not lock and bind the invitation';
		  end if;
		  if not exists (
		    select 1 from public.roles
		    where tenant_id = v_tenant
		      and name = 'Support agent'
		      and scope = 'department'
		  ) then
		    insert into public.roles (tenant_id, name, scope)
		    values (v_tenant, 'Support agent', 'department');
		  end if;
		  insert into public.tenant_entra_directory_people (
		    tenant_id,
		    entra_object_id,
		    email,
		    display_name,
		    local_user_id
		  ) values (
		    v_tenant,
		    '30000000-0000-4000-8000-000000000009',
		    'sso-current-revocation@example.ch',
		    'Tracked current invitation agent',
		    v_current_invitation_user
		  );
		  perform public.set_entra_agent_request(
		    v_tenant,
		    '30000000-0000-4000-8000-000000000009',
		    true,
		    v_department,
		    v_admin
		  );
		  if not exists (
		    select 1
		    from public.tenant_entra_directory_people person
		    join public.user_role_assignments assignment
		      on assignment.id = person.agent_role_assignment_id
		    where person.tenant_id = v_tenant
		      and person.entra_object_id = '30000000-0000-4000-8000-000000000009'
		      and assignment.user_id = v_current_invitation_user
		      and assignment.expires_at is null
		  ) then
		    raise exception 'Test fixture did not create a tracked Entra agent role';
		  end if;
		  insert into public.user_role_assignments (
		    tenant_id,
		    user_id,
		    role_id,
		    assigned_by
		  ) values (
		    v_tenant,
		    v_current_invitation_user,
		    v_role,
		    v_admin
		  );
		  update public.tenant_user_invitations
		  set status = 'accepted',
		      accepted_at = timezone('utc', now())
		  where id = v_invitation
		    and status = 'sent'
		    and accepted_by = v_current_invitation_user;
		  perform public.revoke_tenant_user_invitation(
		    v_admin,
		    v_tenant,
		    v_invitation
		  );
		  if not exists (
		    select 1
		    from public.tenant_user_invitations invitation
		    where invitation.id = v_invitation
		      and invitation.status = 'revoked'
		      and invitation.accepted_by = v_current_invitation_user
		  ) or not exists (
		    select 1
		    from public.tenant_memberships membership
		    where membership.tenant_id = v_tenant
		      and membership.user_id = v_current_invitation_user
		      and membership.status = 'removed'
		  ) or exists (
		    select 1
		    from public.user_role_assignments assignment
		    where assignment.tenant_id = v_tenant
		      and assignment.user_id = v_current_invitation_user
		      and (
		        assignment.expires_at is null
		        or assignment.expires_at > timezone('utc', now()) + interval '1 second'
		      )
		  ) then
		    raise exception 'Revoking a current invitation left SSO access or a role active';
		  end if;
		  v_claim := public.claim_current_tenant_user_invitation(
		    v_current_invitation_user,
		    'sso-current-revocation@example.ch'::citext,
		    v_invitation
		  );
		  if v_claim->>'status' <> 'removed' then
		    raise exception 'Revoked current invitation allowed a later SSO claim';
		  end if;

		  -- If a revocation happens after the claim but before the browser can
		  -- write downstream profile/role data, the locked role trigger must make
		  -- the late role grant fail. This models the TOCTOU window in the former
		  -- acceptMyInvitations browser path.
		  insert into auth.users (id)
		  values (v_after_claim_user)
		  on conflict (id) do nothing;
		  insert into public.user_profiles (id, display_name)
		  values (v_after_claim_user, 'Post claim revocation SSO test')
		  on conflict (id) do nothing;
		  insert into public.tenant_user_invitations (
		    tenant_id,
		    email,
		    invited_by,
		    expires_at,
		    role_name
		  ) values (
		    v_tenant,
		    'sso-after-claim-revocation@example.ch'::citext,
		    v_admin,
		    timezone('utc', now()) + interval '1 day',
		    'Requester'
		  ) returning id into v_invitation;
		  v_claim := public.claim_current_tenant_user_invitation(
		    v_after_claim_user,
		    'sso-after-claim-revocation@example.ch'::citext,
		    v_invitation
		  );
		  if v_claim->>'status' <> 'active' then
		    raise exception 'Current invitation claim was not active before revocation race test';
		  end if;
		  perform public.revoke_tenant_user_invitation(v_admin, v_tenant, v_invitation);
		  begin
		    insert into public.user_role_assignments (
		      tenant_id,
		      user_id,
		      role_id,
		      assigned_by
		    ) values (v_tenant, v_after_claim_user, v_role, v_admin);
		    raise exception 'Role write after current invitation revocation was accepted';
		  exception when raise_exception then
		    if sqlerrm <> 'A role can only be assigned to an active tenant member' then
		      raise;
		    end if;
		  end;
		  if public.claim_current_tenant_user_invitation(
		    v_after_claim_user,
		    'sso-after-claim-revocation@example.ch'::citext,
		    v_invitation
		  )->>'status' <> 'removed' then
		    raise exception 'Current invitation claim reactivated access after post-claim revocation';
		  end if;
		end;
		$$;

		do $$
		begin
		  if has_function_privilege(
		    'authenticated',
		    'public.claim_verified_tenant_sso_membership(uuid, uuid, citext)',
		    'execute'
		  ) or has_function_privilege(
		    'anon',
		    'public.claim_verified_tenant_sso_membership(uuid, uuid, citext)',
		    'execute'
		  ) or not has_function_privilege(
		    'service_role',
		    'public.claim_verified_tenant_sso_membership(uuid, uuid, citext)',
		    'execute'
		  ) or has_function_privilege(
		    'authenticated',
		    'public.claim_current_tenant_user_invitation(uuid, citext, uuid)',
		    'execute'
		  ) or has_function_privilege(
		    'anon',
		    'public.claim_current_tenant_user_invitation(uuid, citext, uuid)',
		    'execute'
		  ) or not has_function_privilege(
		    'service_role',
		    'public.claim_current_tenant_user_invitation(uuid, citext, uuid)',
		    'execute'
		  ) then
		    raise exception 'SSO invitation claims did not remain service-role-only';
		  end if;
			end;
			$$;

			-- P1.6: Only a fresh, actor-bound and server-revalidated confirmation
			-- may close the reviewed resolved tickets. Browser roles see neither the
			-- private confirmation rows nor the service-only procedures.
			select set_config('request.jwt.claim.role', 'service_role', true);
			do $$
			declare
			  v_tenant constant uuid := '10000000-0000-4000-8000-000000000001';
			  v_admin constant uuid := '00000000-0000-4000-8000-000000000002';
			  v_department_operator constant uuid := '00000000-0000-4000-8000-000000000009';
			  v_resolved_status uuid;
			  v_closed_status uuid;
			  v_priority uuid;
			  v_prepared record;
			  v_second_prepared record;
			  v_expiring_prepared record;
			  v_execution record;
			begin
			  insert into public.role_permissions (role_id, permission_code)
			  values
			    ('16500000-0000-4000-8000-000000000002', 'automation.manage'),
			    ('16500000-0000-4000-8000-000000000002', 'ticket.update'),
			    ('16500000-0000-4000-8000-000000000002', 'ticket.close'),
			    ('16000000-0000-4000-8000-000000000002', 'automation.manage')
			  on conflict do nothing;
			  insert into auth.users (id) values (v_department_operator)
			  on conflict (id) do nothing;
			  insert into public.user_profiles (id, display_name)
			  values (v_department_operator, 'P1.6 Department automation test')
			  on conflict (id) do nothing;
			  insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
			  values (v_tenant, v_department_operator, 'active', timezone('utc', now()))
			  on conflict (tenant_id, user_id) do update set status = 'active';
			  insert into public.department_memberships (department_id, tenant_id, user_id, status)
			  values (
			    '11000000-0000-4000-8000-000000000001', v_tenant,
			    v_department_operator, 'active'
			  ) on conflict (department_id, user_id) do update set status = 'active';
			  insert into public.user_role_assignments (
			    tenant_id, user_id, role_id, department_id, assigned_by
			  ) values (
			    v_tenant, v_department_operator,
			    '16000000-0000-4000-8000-000000000002',
			    '11000000-0000-4000-8000-000000000001', v_admin
			  );

			  update public.tenant_feature_flags
			  set enabled = true,
			      pilot_ends_at = null
			  where tenant_id = v_tenant
			    and feature_key = 'automation.sla';
			  update public.tenant_automation_policies
			  set enabled = true,
			      configuration = jsonb_build_object('afterDays', 1, 'requirePreview', true),
			      updated_by = v_admin,
			      updated_at = timezone('utc', now())
			  where tenant_id = v_tenant
			    and policy_key = 'auto_close';

			  insert into public.ticket_statuses (tenant_id, key, label, sort_order)
			  select v_tenant, 'resolved', 'Gelöst', coalesce(max(status.sort_order), 0) + 1
			  from public.ticket_statuses status
			  where status.tenant_id = v_tenant
			  on conflict (tenant_id, key) do update
			  set is_closed = false;
			  insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order)
			  select v_tenant, 'closed', 'Geschlossen', true, coalesce(max(status.sort_order), 0) + 1
			  from public.ticket_statuses status
			  where status.tenant_id = v_tenant
			  on conflict (tenant_id, key) do update
			  set is_closed = true;
			  select id into v_resolved_status
			  from public.ticket_statuses
			  where tenant_id = v_tenant and key = 'resolved';
			  select id into v_closed_status
			  from public.ticket_statuses
			  where tenant_id = v_tenant and key = 'closed';
			  select id into v_priority
			  from public.ticket_priorities
			  where tenant_id = v_tenant
			  limit 1;
			  if v_resolved_status is null or v_closed_status is null or v_priority is null then
			    raise exception 'P1.6 fixture could not establish resolved and closed ticket states';
			  end if;
			  begin
			    perform public.prepare_ticket_automation_auto_close(
			      v_department_operator,
			      v_tenant,
			      array['17000000-0000-4000-8000-000000000001'::uuid]
			    );
			    raise exception 'A department-scoped automation permission prepared a tenant-wide confirmation';
			  exception when insufficient_privilege then
			    null;
			  end;

			  insert into public.tickets (
			    id, tenant_id, department_id, ticket_number, subject, description,
			    status_id, priority_id, requester_id, resolved_at
			  ) values (
			    '76000000-0000-4000-8000-000000000001', v_tenant,
			    '11000000-0000-4000-8000-000000000001', 'ICT-2026-AUTO-001',
			    'Kontrollierter Automationsabschluss', 'P1.6-Revalidierungsfixtur',
			    v_resolved_status, v_priority, '00000000-0000-4000-8000-000000000001',
			    timezone('utc', now()) - interval '2 days'
			  );
			  select * into v_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000001'::uuid]
			  );
			  if v_prepared.candidate_count <> 1 or v_prepared.expires_at <= timezone('utc', now()) then
			    raise exception 'P1.6 did not issue a bounded auto-close confirmation';
			  end if;
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'executed' or v_execution.requested <> 1 or v_execution.updated <> 1 then
			    raise exception 'P1.6 confirmation did not execute the reviewed close';
			  end if;
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'unavailable' or v_execution.requested <> 0 or v_execution.updated <> 0 then
			    raise exception 'P1.6 allowed a confirmation to be executed more than once';
			  end if;
			  if not exists (
			    select 1 from public.tickets ticket
			    where ticket.id = '76000000-0000-4000-8000-000000000001'
			      and ticket.status_id = v_closed_status
			      and ticket.closed_at is not null
			  ) then
			    raise exception 'P1.6 executed confirmation did not close the reviewed ticket';
			  end if;

			  insert into public.tickets (
			    id, tenant_id, department_id, ticket_number, subject, description,
			    status_id, priority_id, requester_id, resolved_at
			  ) values (
			    '76000000-0000-4000-8000-000000000002', v_tenant,
			    '11000000-0000-4000-8000-000000000001', 'ICT-2026-AUTO-002',
			    'Ungültige Automationsfreigabe', 'P1.6-Kandidatenänderungsfixtur',
			    v_resolved_status, v_priority, '00000000-0000-4000-8000-000000000001',
			    timezone('utc', now()) - interval '2 days'
			  );
			  select * into v_second_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000002'::uuid]
			  );
			  update public.tickets
			  set resolved_at = timezone('utc', now())
			  where id = '76000000-0000-4000-8000-000000000002';
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'invalidated' or exists (
			    select 1 from public.tickets
			    where id = '76000000-0000-4000-8000-000000000002' and closed_at is not null
			  ) then
			    raise exception 'P1.6 executed a changed auto-close candidate';
			  end if;

			  update public.tickets
			  set resolved_at = timezone('utc', now()) - interval '2 days'
			  where id = '76000000-0000-4000-8000-000000000002';
			  select * into v_expiring_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000002'::uuid]
			  );
			  update public.tenant_automation_confirmation_requests
			  set created_at = timezone('utc', now()) - interval '2 minutes',
			      expires_at = timezone('utc', now()) - interval '1 second'
			  where id = v_expiring_prepared.confirmation_id;
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'expired' then
			    raise exception 'P1.6 executed an expired auto-close confirmation';
			  end if;

			  insert into public.tickets (
			    id, tenant_id, department_id, ticket_number, subject, description,
			    status_id, priority_id, requester_id, resolved_at
			  ) values (
			    '76000000-0000-4000-8000-000000000003', v_tenant,
			    '11000000-0000-4000-8000-000000000001', 'ICT-2026-AUTO-003',
			    'Ersetzte Automationsfreigabe', 'P1.6-Bestaetigungsersetzungsfixtur',
			    v_resolved_status, v_priority, '00000000-0000-4000-8000-000000000001',
			    timezone('utc', now()) - interval '2 days'
			  );
			  select * into v_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000003'::uuid]
			  );
			  select * into v_second_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000003'::uuid]
			  );
			  if not exists (
			    select 1
			    from public.tenant_automation_confirmation_requests request
			    where request.id = v_prepared.confirmation_id
			      and request.state = 'invalidated'
			      and request.result ->> 'reason' = 'superseded'
			  ) then
			    raise exception 'P1.6 did not supersede the former pending confirmation';
			  end if;
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'executed' or v_execution.updated <> 1 then
			    raise exception 'P1.6 did not execute the sole current confirmation';
			  end if;

			  insert into public.tickets (
			    id, tenant_id, department_id, ticket_number, subject, description,
			    status_id, priority_id, requester_id, resolved_at
			  ) values (
			    '76000000-0000-4000-8000-000000000004', v_tenant,
			    '11000000-0000-4000-8000-000000000001', 'ICT-2026-AUTO-004',
			    'Geaenderte Automationsregel', 'P1.6-Policy-Revalidierungsfixtur',
			    v_resolved_status, v_priority, '00000000-0000-4000-8000-000000000001',
			    timezone('utc', now()) - interval '2 days'
			  );
			  select * into v_prepared
			  from public.prepare_ticket_automation_auto_close(
			    v_admin, v_tenant, array['76000000-0000-4000-8000-000000000004'::uuid]
			  );
			  update public.tenant_automation_policies
			  set configuration = jsonb_build_object('afterDays', 2, 'requirePreview', true),
			      updated_at = timezone('utc', now())
			  where tenant_id = v_tenant and policy_key = 'auto_close';
			  select * into v_execution
			  from public.execute_ticket_automation_auto_close(v_admin, v_tenant);
			  if v_execution.outcome <> 'invalidated' or exists (
			    select 1 from public.tickets
			    where id = '76000000-0000-4000-8000-000000000004' and closed_at is not null
			  ) then
			    raise exception 'P1.6 executed after the auto-close policy changed';
			  end if;
			  update public.tenant_automation_policies
			  set configuration = jsonb_build_object('afterDays', 1, 'requirePreview', true),
			      updated_at = timezone('utc', now())
			  where tenant_id = v_tenant and policy_key = 'auto_close';

			  if exists (
			    select 1 from public.audit_logs audit
			    where audit.tenant_id = v_tenant
			      and audit.action like 'automation.auto_close.%'
			      and (
			        audit.entity_id is not null
			        or audit.metadata ?| array['ticketIds', 'subject', 'description']
			      )
			  ) then
			    raise exception 'P1.6 automation audit retained ticket details or an internal confirmation ID';
			  end if;
			end;
			$$;

			-- Veranstaltungsräume sind planbare ICT-Arbeit und dürfen weder
			-- Ticketdaten erzeugen noch mandantenübergreifend verknüpft werden.
			insert into public.event_spaces (
			  id, tenant_id, name, kind, location, capacity, created_by
			) values (
			  '79000000-0000-4000-8000-000000000001',
			  '10000000-0000-4000-8000-000000000001',
			  'Aula Test', 'event_room', 'Hauptgebäude', 120,
			  '00000000-0000-4000-8000-000000000002'
			);
			insert into public.event_space_requests (
			  id, tenant_id, space_id, title, starts_at, ends_at,
			  responsible_user_id, created_by
			) values (
			  '79100000-0000-4000-8000-000000000001',
			  '10000000-0000-4000-8000-000000000001',
			  '79000000-0000-4000-8000-000000000001',
			  'Raumauftrag Regression', timezone('utc', now()) + interval '1 day',
			  timezone('utc', now()) + interval '1 day 1 hour',
			  '00000000-0000-4000-8000-000000000002',
			  '00000000-0000-4000-8000-000000000002'
			);
			insert into public.event_space_request_equipment (
			  tenant_id, request_id, equipment_key
			) values (
			  '10000000-0000-4000-8000-000000000001',
			  '79100000-0000-4000-8000-000000000001', 'projector'
			);
			insert into public.event_space_tasks (
			  tenant_id, request_id, template_id, title, position
			)
			select
			  '10000000-0000-4000-8000-000000000001',
			  '79100000-0000-4000-8000-000000000001',
			  template.id, template.task_label, template.position
			from public.event_space_task_templates as template
			where template.tenant_id = '10000000-0000-4000-8000-000000000001'
			  and template.name = 'Standard Raumauftrag'
			  and template.active;
			do $$
			begin
			  if (
			    select count(*)
			    from public.event_space_task_templates
			    where tenant_id = '10000000-0000-4000-8000-000000000001'
			      and name = 'Standard Raumauftrag'
			      and active
			  ) <> 5 or (
			    select count(*)
			    from public.event_space_tasks
			    where request_id = '79100000-0000-4000-8000-000000000001'
			  ) <> 5 then
			    raise exception 'Event-space standard tasks were not created exactly once';
			  end if;
			  begin
			    insert into public.event_space_request_equipment (
			      tenant_id, request_id, equipment_key
			    ) values (
			      '20000000-0000-4000-8000-000000000002',
			      '79100000-0000-4000-8000-000000000001', 'videocall'
			    );
			    raise exception 'Event-space equipment accepted a request from another tenant';
			  exception when foreign_key_violation then
			    null;
			  end;
			  if exists (
			    select 1 from public.tickets
			    where ticket_number = 'EVENT-SPACE-REGRESSION'
			  ) then
			    raise exception 'Event-space planning created a ticket';
			  end if;
				end;
				$$;

				-- Future tenant provisioning assigns ticket baselines after role creation.
				-- The event-space rights must follow that proven provisioning path.
				insert into public.tenants (id, slug, name) values
				  ('79200000-0000-4000-8000-000000000001', 'event-space-future', 'Event Space Future');
				insert into public.roles (id, tenant_id, name, scope, is_system) values
				  ('79200000-0000-4000-8000-000000000010', '79200000-0000-4000-8000-000000000001', 'Future Requester', 'tenant', false),
				  ('79200000-0000-4000-8000-000000000011', '79200000-0000-4000-8000-000000000001', 'Future Support', 'department', false);
				insert into public.role_permissions (role_id, permission_code) values
				  ('79200000-0000-4000-8000-000000000010', 'ticket.create'),
				  ('79200000-0000-4000-8000-000000000011', 'ticket.update');
				do $$
				begin
				  if not exists (
				    select 1 from public.role_permissions
				    where role_id = '79200000-0000-4000-8000-000000000010'
				      and permission_code = 'event.spaces.request'
				  ) or not exists (
				    select 1 from public.role_permissions
				    where role_id = '79200000-0000-4000-8000-000000000011'
				      and permission_code = 'event.spaces.manage'
				  ) or not exists (
				    select 1 from public.role_permissions
				    where role_id = '79200000-0000-4000-8000-000000000011'
				      and permission_code = 'event.spaces.request'
				  ) then
				    raise exception 'Future tenant role baselines did not receive event-space permissions';
				  end if;
				end;
				$$;

				-- Final conflict revalidation, task creation and audit happen in one
				-- service-only transaction. A subsequent unconfirmed collision returns
				-- aggregate counts and leaves no partial request behind.
				do $$
				declare
				  v_created integer;
				  v_room_conflicts integer;
				  v_equipment_conflicts integer;
				  v_room_signature text;
				  v_equipment_signature text;
				  v_snapshot text;
				begin
				  select created_count, room_conflict_count, equipment_conflict_count
				    into v_created, v_room_conflicts, v_equipment_conflicts
				  from public.create_event_space_request_series(
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001',
				    'Atomarer Raumauftrag', null, 18,
				    '00000000-0000-4000-8000-000000000002',
				    'none',
				    array[timezone('utc', now()) + interval '3 days'],
				    array[timezone('utc', now()) + interval '3 days 1 hour'],
				    array['audio']::text[], false, null,
				    '00000000-0000-4000-8000-000000000002'
				  );
				  if v_created <> 1 or v_room_conflicts <> 0 or v_equipment_conflicts <> 0 then
				    raise exception 'Atomic event-space creation did not create the expected clean request';
				  end if;
				  if (
				    select count(*) from public.event_space_tasks task
				    join public.event_space_requests request on request.id = task.request_id
				    where request.tenant_id = '10000000-0000-4000-8000-000000000001'
				      and request.title = 'Atomarer Raumauftrag'
				  ) <> 5 then
				    raise exception 'Atomic event-space creation did not create its complete task template';
				  end if;
				  select created_count, room_conflict_count, equipment_conflict_count
				    into v_created, v_room_conflicts, v_equipment_conflicts
				  from public.create_event_space_request_series(
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001',
				    'Unbestätigte Kollision', null, 18,
				    '00000000-0000-4000-8000-000000000002',
				    'none',
				    array[timezone('utc', now()) + interval '3 days'],
				    array[timezone('utc', now()) + interval '3 days 1 hour'],
				    array['audio']::text[], false, null,
				    '00000000-0000-4000-8000-000000000002'
				  );
				  if v_created <> 0 or v_room_conflicts < 1 or v_equipment_conflicts < 1
				    or exists (
				      select 1 from public.event_space_requests
				      where tenant_id = '10000000-0000-4000-8000-000000000001'
				        and title = 'Unbestätigte Kollision'
				    ) then
				    raise exception 'Atomic event-space conflict handling allowed an unconfirmed collision';
				  end if;
				  select
				    encode(digest(string_agg(request.id::text, ',' order by request.id::text), 'sha256'), 'hex'),
				    encode(digest(string_agg(request.id::text, ',' order by request.id::text), 'sha256'), 'hex')
				    into v_room_signature, v_equipment_signature
				  from public.event_space_requests request
				  join public.event_space_request_equipment equipment
				    on equipment.request_id = request.id
				   and equipment.tenant_id = request.tenant_id
				   and equipment.equipment_key = 'audio'
				  where request.tenant_id = '10000000-0000-4000-8000-000000000001'
				    and request.title = 'Atomarer Raumauftrag';
				  v_snapshot := v_room_signature || '.' || v_equipment_signature;
				  select created_count, room_conflict_count, equipment_conflict_count
				    into v_created, v_room_conflicts, v_equipment_conflicts
				  from public.create_event_space_request_series(
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001',
				    'Bestätigte Kollision', null, 18,
				    '00000000-0000-4000-8000-000000000002',
				    'none',
				    array[timezone('utc', now()) + interval '3 days'],
				    array[timezone('utc', now()) + interval '3 days 1 hour'],
				    array['audio']::text[], true, v_snapshot,
				    '00000000-0000-4000-8000-000000000002'
				  );
				  if v_created <> 1 or v_room_conflicts <> 1 or v_equipment_conflicts <> 1 then
				    raise exception 'A matching event-space conflict snapshot was not accepted';
				  end if;
				  select
				    encode(digest(string_agg(request.id::text, ',' order by request.id::text), 'sha256'), 'hex'),
				    encode(digest(string_agg(request.id::text, ',' order by request.id::text), 'sha256'), 'hex')
				    into v_room_signature, v_equipment_signature
				  from public.event_space_requests request
				  join public.event_space_request_equipment equipment
				    on equipment.request_id = request.id
				   and equipment.tenant_id = request.tenant_id
				   and equipment.equipment_key = 'audio'
				  where request.tenant_id = '10000000-0000-4000-8000-000000000001'
				    and request.title in ('Atomarer Raumauftrag', 'Bestätigte Kollision');
				  v_snapshot := v_room_signature || '.' || v_equipment_signature;
				  insert into public.event_space_requests (
				    tenant_id, space_id, title, starts_at, ends_at, responsible_user_id, created_by
				  ) values (
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001', 'Zwischenzeitliche Kollision',
				    timezone('utc', now()) + interval '3 days',
				    timezone('utc', now()) + interval '3 days 1 hour',
				    '00000000-0000-4000-8000-000000000002',
				    '00000000-0000-4000-8000-000000000002'
				  );
				  select created_count, room_conflict_count, equipment_conflict_count
				    into v_created, v_room_conflicts, v_equipment_conflicts
				  from public.create_event_space_request_series(
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001',
				    'Veraltete Bestätigung', null, 18,
				    '00000000-0000-4000-8000-000000000002',
				    'none',
				    array[timezone('utc', now()) + interval '3 days'],
				    array[timezone('utc', now()) + interval '3 days 1 hour'],
				    array['audio']::text[], true, v_snapshot,
				    '00000000-0000-4000-8000-000000000002'
				  );
				  if v_created <> 0 or v_room_conflicts <> 3 or v_equipment_conflicts <> 2
				    or exists (
				      select 1 from public.event_space_requests
				      where title = 'Veraltete Bestätigung'
				    ) then
				    raise exception 'A stale event-space conflict snapshot created an unconfirmed collision';
				  end if;
				  begin
				    perform * from public.create_event_space_request_series(
				      '10000000-0000-4000-8000-000000000001',
				      '79000000-0000-4000-8000-000000000001', 'Ungültig wöchentlich', null, 1,
				      '00000000-0000-4000-8000-000000000002', 'weekly',
				      array['2027-02-03 08:00:00+00'::timestamptz, '2027-02-04 08:00:00+00'::timestamptz],
				      array['2027-02-03 10:00:00+00'::timestamptz, '2027-02-04 10:00:00+00'::timestamptz],
				      array[]::text[], false, null,
				      '00000000-0000-4000-8000-000000000002'
				    );
				    raise exception 'Service-only creation accepted a non-weekly or internally overlapping series';
				  exception when invalid_parameter_value then
				    null;
				  end;
				  begin
				    perform * from public.create_event_space_request_series(
				      '10000000-0000-4000-8000-000000000001',
				      '79000000-0000-4000-8000-000000000001', 'Ungültig monatlich', null, 1,
				      '00000000-0000-4000-8000-000000000002', 'monthly',
				      array['2027-01-31 08:00:00+00'::timestamptz, '2027-02-15 08:00:00+00'::timestamptz],
				      array['2027-01-31 10:00:00+00'::timestamptz, '2027-02-15 10:00:00+00'::timestamptz],
				      array[]::text[], false, null,
				      '00000000-0000-4000-8000-000000000002'
				    );
				    raise exception 'Service-only creation accepted an invalid monthly series';
				  exception when invalid_parameter_value then
				    null;
				  end;
				end;
				$$;

				-- Strukturierte Quellreservationen bleiben opt-in, haben keine
				-- Rückwirkung und dürfen Raumaufträge oder Eintritte bei fehlendem
				-- Bestand beziehungsweise einer inaktiven Zielkonfiguration nie
				-- zurückrollen. Erfolgreiche Entfernungen lösen ausschliesslich eine
				-- noch offene Reservation mit einer Gegenbewegung.
				update public.tenant_feature_flags
				set enabled = true
				where tenant_id = '10000000-0000-4000-8000-000000000001'
				  and feature_key = 'inventory.management';
				insert into public.inventory_locations (id, tenant_id, code, name) values (
				  '7a100000-0000-4000-8000-000000000001',
				  '10000000-0000-4000-8000-000000000001', 'source-auto', 'Source Auto'
				);
				insert into public.inventory_items (id, tenant_id, article_number, name) values (
				  '7a100000-0000-4000-8000-000000000002',
				  '10000000-0000-4000-8000-000000000001', 'source-auto-item', 'Source Auto Item'
				);
				insert into public.inventory_stock_balances (
				  tenant_id, item_id, location_id, physical_quantity, reserved_quantity
				) values (
				  '10000000-0000-4000-8000-000000000001',
				  '7a100000-0000-4000-8000-000000000002',
				  '7a100000-0000-4000-8000-000000000001', 5, 0
				);
				insert into public.inventory_source_reservation_rules (
				  id, tenant_id, source_kind, event_equipment_key, item_id, location_id, quantity, enabled
				) values
				  (
				    '7a100000-0000-4000-8000-000000000010',
				    '10000000-0000-4000-8000-000000000001', 'event_space_equipment', 'projector',
				    '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000001', 2, true
				  ),
				  (
				    '7a100000-0000-4000-8000-000000000011',
				    '10000000-0000-4000-8000-000000000001', 'event_space_equipment', 'audio',
				    '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000001', 6, true
				  ),
				  (
				    '7a100000-0000-4000-8000-000000000012',
				    '10000000-0000-4000-8000-000000000001', 'event_space_equipment', 'display',
				    '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000001', 1, true
				  ),
				  (
				    '7a100000-0000-4000-8000-000000000013',
				    '10000000-0000-4000-8000-000000000001', 'event_space_equipment', 'videocall',
				    '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000001', 1, false
				  );
				do $$
				begin
				  if exists (
				    select 1
				    from public.inventory_source_reservations source_reservation
				    where source_reservation.event_space_request_id = '79100000-0000-4000-8000-000000000001'
				  ) then
				    raise exception 'An automatic rule was applied retrospectively to an existing room source';
				  end if;
				  if (select enabled from public.inventory_source_reservation_rules
				      where id = '7a100000-0000-4000-8000-000000000013') then
				    raise exception 'Automatic source reservation rules are not disabled by default';
				  end if;
				end;
				$$;
				insert into public.event_space_requests (
				  id, tenant_id, space_id, title, starts_at, ends_at, responsible_user_id, created_by
				) values
				  (
				    '7a100000-0000-4000-8000-000000000020',
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001', 'Source Reservation Event',
				    timezone('utc', now()) + interval '11 days', timezone('utc', now()) + interval '11 days 1 hour',
				    '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'
				  ),
				  (
				    '7a100000-0000-4000-8000-000000000021',
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001', 'Source Exception Event',
				    timezone('utc', now()) + interval '12 days', timezone('utc', now()) + interval '12 days 1 hour',
				    '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'
				  ),
				  (
				    '7a100000-0000-4000-8000-000000000022',
				    '10000000-0000-4000-8000-000000000001',
				    '79000000-0000-4000-8000-000000000001', 'Source Disabled Event',
				    timezone('utc', now()) + interval '13 days', timezone('utc', now()) + interval '13 days 1 hour',
				    '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'
				  );
				insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key) values (
				  '10000000-0000-4000-8000-000000000001',
				  '7a100000-0000-4000-8000-000000000020', 'projector'
				);
				do $$
				declare
				  v_reservation_id uuid;
				begin
				  select reservation_id into v_reservation_id
				  from public.inventory_source_reservations
				  where tenant_id = '10000000-0000-4000-8000-000000000001'
				    and rule_id = '7a100000-0000-4000-8000-000000000010'
				    and event_space_request_id = '7a100000-0000-4000-8000-000000000020'
				    and event_equipment_key = 'projector';
				  if v_reservation_id is null
				    or not exists (
				      select 1 from public.inventory_reservations reservation
				      where reservation.id = v_reservation_id
				        and reservation.status = 'open' and reservation.quantity = 2
				    )
				    or (select reserved_quantity from public.inventory_stock_balances
				        where tenant_id = '10000000-0000-4000-8000-000000000001'
				          and item_id = '7a100000-0000-4000-8000-000000000002'
				          and location_id = '7a100000-0000-4000-8000-000000000001') <> 2 then
				    raise exception 'A new room-equipment source did not create its exact open inventory hold';
				  end if;
				end;
				$$;
				do $$
				begin
				  perform public.create_inventory_source_reservation(
				    '10000000-0000-4000-8000-000000000001', 'event_space_equipment',
				    '7a100000-0000-4000-8000-000000000020', 'projector', null, null,
				    '7a100000-0000-4000-8000-000000000010',
				    '00000000-0000-4000-8000-000000000002'
				  );
				  if (select count(*) from public.inventory_source_reservations source_reservation
				      where source_reservation.rule_id = '7a100000-0000-4000-8000-000000000010'
				        and source_reservation.event_space_request_id = '7a100000-0000-4000-8000-000000000020') <> 1
				    or not exists (
				      select 1 from public.inventory_source_reservation_exceptions exception_state
				      where exception_state.rule_id = '7a100000-0000-4000-8000-000000000010'
				        and exception_state.event_space_request_id = '7a100000-0000-4000-8000-000000000020'
				        and exception_state.exception_code = 'duplicate_source'
				    ) then
				    raise exception 'A duplicate source delivery was not idempotent and auditable';
				  end if;
				end;
				$$;
				delete from public.event_space_request_equipment
				where tenant_id = '10000000-0000-4000-8000-000000000001'
				  and request_id = '7a100000-0000-4000-8000-000000000020'
				  and equipment_key = 'projector';
				do $$
				begin
				  if exists (
				    select 1
				    from public.inventory_reservations reservation
				    where reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
				      and reservation.item_id = '7a100000-0000-4000-8000-000000000002'
				      and reservation.location_id = '7a100000-0000-4000-8000-000000000001'
				      and reservation.status = 'open'
				  ) or (select reserved_quantity from public.inventory_stock_balances
				        where tenant_id = '10000000-0000-4000-8000-000000000001'
				          and item_id = '7a100000-0000-4000-8000-000000000002'
				          and location_id = '7a100000-0000-4000-8000-000000000001') <> 0
				    or not exists (
				      select 1 from public.inventory_events event
				      where event.tenant_id = '10000000-0000-4000-8000-000000000001'
				        and event.event_type = 'reservation_release'
				    ) then
				    raise exception 'Removing an equipment source did not release only its open hold by counterbooking';
					  end if;
					end;
					$$;
					-- Eine fehlgeschlagene Gegenbuchung, Statusaktualisierung oder Auditierung
					-- darf die Quellenloeschung nicht bis zur FK-Cascade fortsetzen. Die
					-- Quelle und ihr Mapping muessen fuer einen spaeteren Retry erhalten bleiben.
					insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key) values (
					  '10000000-0000-4000-8000-000000000001',
					  '7a100000-0000-4000-8000-000000000020', 'projector'
					);
					create or replace function public.reject_inventory_source_reservation_release_audit()
					returns trigger
					language plpgsql
					set search_path = pg_catalog, public, pg_temp
					as $$
					begin
					  if new.action = 'inventory.source_reservation.released' then
					    raise exception 'Injected inventory source release audit failure' using errcode = 'P0001';
					  end if;
					  return new;
					end;
					$$;
					create trigger reject_inventory_source_reservation_release_audit
					before insert on public.audit_logs
					for each row execute function public.reject_inventory_source_reservation_release_audit();
					do $$
					declare
					  v_reservation_id uuid;
					begin
					  select source_reservation.reservation_id into v_reservation_id
					  from public.inventory_source_reservations source_reservation
					  where source_reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
					    and source_reservation.rule_id = '7a100000-0000-4000-8000-000000000010'
					    and source_reservation.event_space_request_id = '7a100000-0000-4000-8000-000000000020'
					    and source_reservation.event_equipment_key = 'projector';
					  if v_reservation_id is null then
					    raise exception 'The audit-failure regression source did not create an open hold';
					  end if;

					  begin
					    delete from public.event_space_request_equipment
					    where tenant_id = '10000000-0000-4000-8000-000000000001'
					      and request_id = '7a100000-0000-4000-8000-000000000020'
					      and equipment_key = 'projector';
					    raise exception 'Source deletion continued despite a failed release audit';
					  exception when raise_exception then
					    if sqlerrm <> 'Injected inventory source release audit failure' then
					      raise;
					    end if;
					  end;

					  if not exists (
					    select 1 from public.event_space_request_equipment equipment
					    where equipment.tenant_id = '10000000-0000-4000-8000-000000000001'
					      and equipment.request_id = '7a100000-0000-4000-8000-000000000020'
					      and equipment.equipment_key = 'projector'
					  ) or not exists (
					    select 1 from public.inventory_source_reservations source_reservation
					    where source_reservation.reservation_id = v_reservation_id
					      and source_reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
					  ) or not exists (
					    select 1 from public.inventory_reservations reservation
					    where reservation.id = v_reservation_id and reservation.status = 'open'
					  ) or exists (
					    select 1 from public.inventory_events event
					    where event.tenant_id = '10000000-0000-4000-8000-000000000001'
					      and event.event_type = 'reservation_release'
					      and event.reference_id = v_reservation_id
					  ) or (select reserved_quantity from public.inventory_stock_balances
					        where tenant_id = '10000000-0000-4000-8000-000000000001'
					          and item_id = '7a100000-0000-4000-8000-000000000002'
					          and location_id = '7a100000-0000-4000-8000-000000000001') <> 2 then
					    raise exception 'A failed source-release audit did not retain a retryable source, mapping and open hold';
					  end if;
					end;
					$$;
					drop trigger reject_inventory_source_reservation_release_audit on public.audit_logs;
					drop function public.reject_inventory_source_reservation_release_audit();
					delete from public.event_space_request_equipment
					where tenant_id = '10000000-0000-4000-8000-000000000001'
					  and request_id = '7a100000-0000-4000-8000-000000000020'
					  and equipment_key = 'projector';
					do $$
					begin
					  if exists (
					    select 1 from public.event_space_request_equipment equipment
					    where equipment.tenant_id = '10000000-0000-4000-8000-000000000001'
					      and equipment.request_id = '7a100000-0000-4000-8000-000000000020'
					      and equipment.equipment_key = 'projector'
					  ) or exists (
					    select 1 from public.inventory_source_reservations source_reservation
					    where source_reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
					      and source_reservation.rule_id = '7a100000-0000-4000-8000-000000000010'
					      and source_reservation.event_space_request_id = '7a100000-0000-4000-8000-000000000020'
					      and source_reservation.event_equipment_key = 'projector'
					  ) or exists (
					    select 1 from public.inventory_reservations reservation
					    where reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
					      and reservation.item_id = '7a100000-0000-4000-8000-000000000002'
					      and reservation.location_id = '7a100000-0000-4000-8000-000000000001'
					      and reservation.status = 'open'
					  ) or (select reserved_quantity from public.inventory_stock_balances
					        where tenant_id = '10000000-0000-4000-8000-000000000001'
					          and item_id = '7a100000-0000-4000-8000-000000000002'
					          and location_id = '7a100000-0000-4000-8000-000000000001') <> 0 then
					    raise exception 'The successful source-release retry did not release the retained hold';
					  end if;
					end;
					$$;
					insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key) values
					  ('10000000-0000-4000-8000-000000000001', '7a100000-0000-4000-8000-000000000021', 'audio'),
					  ('10000000-0000-4000-8000-000000000001', '7a100000-0000-4000-8000-000000000022', 'videocall');
				update public.inventory_locations
				set active = false
				where id = '7a100000-0000-4000-8000-000000000001';
				insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key) values (
				  '10000000-0000-4000-8000-000000000001',
				  '7a100000-0000-4000-8000-000000000021', 'display'
				);
				update public.inventory_locations
				set active = true
				where id = '7a100000-0000-4000-8000-000000000001';
				do $$
				begin
				  if not exists (
				    select 1 from public.event_space_request_equipment equipment
				    where equipment.request_id = '7a100000-0000-4000-8000-000000000021'
				      and equipment.equipment_key = 'audio'
				  ) or exists (
				    select 1 from public.inventory_source_reservations source_reservation
				    where source_reservation.event_space_request_id = '7a100000-0000-4000-8000-000000000021'
				  ) then
				    raise exception 'A source reservation failure rolled back a room source or created a partial link';
				  end if;
				  if not exists (
				    select 1 from public.inventory_source_reservation_exceptions exception_state
				    where exception_state.event_space_request_id = '7a100000-0000-4000-8000-000000000021'
				      and exception_state.exception_code = 'stock_unavailable'
				  ) or not exists (
				    select 1 from public.inventory_source_reservation_exceptions exception_state
				    where exception_state.event_space_request_id = '7a100000-0000-4000-8000-000000000021'
				      and exception_state.exception_code = 'location_unavailable'
				  ) or exists (
				    select 1 from public.inventory_source_reservations source_reservation
				    where source_reservation.event_space_request_id = '7a100000-0000-4000-8000-000000000022'
				  ) then
				    raise exception 'Structured source exceptions or the disabled rule boundary were not preserved';
				  end if;
				end;
				$$;
				do $$
				declare
				  v_template_id uuid;
				  v_template_task_id uuid;
				  v_entry_id uuid;
				  v_onboarding_task_id uuid;
				  v_reservation_id uuid;
				begin
				  select template.id, template_task.id
				  into v_template_id, v_template_task_id
				  from public.onboarding_templates template
				  join public.onboarding_template_tasks template_task
				    on template_task.template_id = template.id
				    and template_task.tenant_id = template.tenant_id
				  where template.tenant_id = '10000000-0000-4000-8000-000000000001'
				    and template.template_key = 'standard'
				    and template_task.task_key = 'device';
				  insert into public.inventory_source_reservation_rules (
				    id, tenant_id, source_kind, onboarding_template_id, onboarding_template_task_id,
				    item_id, location_id, quantity, enabled
				  ) values (
				    '7a100000-0000-4000-8000-000000000014',
				    '10000000-0000-4000-8000-000000000001', 'onboarding_template_task',
				    v_template_id, v_template_task_id,
				    '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000001', 1, true
				  );
				  select public.create_onboarding_entry(
				    '10000000-0000-4000-8000-000000000001', 'Source Reservation Entry', current_date + 30,
				    'ICT', 'Test', '00000000-0000-4000-8000-000000000002',
				    '00000000-0000-4000-8000-000000000002', v_template_id,
				    '00000000-0000-4000-8000-000000000002'
				  ) into v_entry_id;
				  select source_reservation.onboarding_task_id, source_reservation.reservation_id
				  into v_onboarding_task_id, v_reservation_id
				  from public.inventory_source_reservations source_reservation
				  where source_reservation.tenant_id = '10000000-0000-4000-8000-000000000001'
				    and source_reservation.rule_id = '7a100000-0000-4000-8000-000000000014'
				    and source_reservation.onboarding_entry_id = v_entry_id;
				  if v_onboarding_task_id is null or v_reservation_id is null
				    or not exists (
				      select 1 from public.inventory_reservations reservation
				      where reservation.id = v_reservation_id and reservation.status = 'open'
				    ) then
				    raise exception 'A concrete onboarding template task did not create its source hold';
				  end if;
				  delete from public.onboarding_tasks where id = v_onboarding_task_id;
				  if not exists (
				    select 1 from public.inventory_reservations reservation
				    where reservation.id = v_reservation_id and reservation.status = 'released'
				  ) then
				    raise exception 'Removing an onboarding task did not release its open source hold';
				  end if;
				end;
				$$;
				savepoint inventory_source_reservation_rls_test;
				set local role authenticated;
				select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
				do $$
				begin
				  begin
				    perform 1 from public.inventory_source_reservation_rules limit 1;
				    raise exception 'Authenticated browser role read source reservation rules';
				  exception when insufficient_privilege then
				    null;
				  end;
				  begin
				    perform 1 from public.inventory_source_reservations limit 1;
				    raise exception 'Authenticated browser role read source reservation links';
				  exception when insufficient_privilege then
				    null;
				  end;
				  begin
				    perform 1 from public.inventory_source_reservation_exceptions limit 1;
				    raise exception 'Authenticated browser role read source reservation exceptions';
				  exception when insufficient_privilege then
				    null;
				  end;
				  begin
				    perform public.create_inventory_source_reservation(
				      '10000000-0000-4000-8000-000000000001', 'event_space_equipment',
				      '7a100000-0000-4000-8000-000000000020', 'projector', null, null,
				      '7a100000-0000-4000-8000-000000000010',
				      '00000000-0000-4000-8000-000000000002'
				    );
				    raise exception 'Authenticated browser role called the private source reservation creator';
				  exception when insufficient_privilege then
				    null;
				  end;
				end;
				$$;
				rollback to savepoint inventory_source_reservation_rls_test;
				release savepoint inventory_source_reservation_rls_test;
				do $$
				begin
				  if exists (
				    select 1 from public.audit_logs audit
				    where audit.action like 'inventory.source_reservation.%'
				      and audit.metadata ?| array['name', 'quantity', 'supplier', 'free_text']
				  ) then
				    raise exception 'Source-reservation audit metadata retained disallowed detail';
				  end if;
				end;
				$$;

				set local role authenticated;
				select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
				do $$
			begin
			  begin
			    perform public.prepare_ticket_automation_auto_close(
			      '00000000-0000-4000-8000-000000000002',
			      '10000000-0000-4000-8000-000000000001',
			      array['76000000-0000-4000-8000-000000000001'::uuid]
			    );
			    raise exception 'Authenticated browser role prepared an automation confirmation';
			  exception when insufficient_privilege then
			    null;
			  end;
			  begin
			    perform 1 from public.tenant_automation_confirmation_requests limit 1;
			    raise exception 'Authenticated browser role read automation confirmations';
			  exception when insufficient_privilege then
			    null;
			  end;
			  begin
			    perform 1 from public.event_spaces limit 1;
			    raise exception 'Authenticated browser role read direct event-space data';
			  exception when insufficient_privilege then
			    null;
			  end;
			  begin
			    perform 1 from public.event_space_requests limit 1;
			    raise exception 'Authenticated browser role read direct event-space requests';
			  exception when insufficient_privilege then
			    null;
			  end;
			  begin
			    perform 1 from public.onboarding_entries limit 1;
			    raise exception 'Authenticated browser role read direct onboarding entries';
			  exception when insufficient_privilege then
			    null;
			  end;
			  begin
			    perform public.create_onboarding_entry(
			      '10000000-0000-4000-8000-000000000001', 'Browser blocked', current_date,
			      null, null, '00000000-0000-4000-8000-000000000002',
			      '00000000-0000-4000-8000-000000000002',
			      (select id from public.onboarding_templates where tenant_id = '10000000-0000-4000-8000-000000000001' limit 1),
			      '00000000-0000-4000-8000-000000000002'
			    );
			    raise exception 'Authenticated browser role called the onboarding creation RPC';
			  exception when insufficient_privilege then
			    null;
			  end;
				  begin
				    perform * from public.create_event_space_request_series(
				      '10000000-0000-4000-8000-000000000001',
				      '79000000-0000-4000-8000-000000000001',
				      'Browser blocked', null, 1,
				      '00000000-0000-4000-8000-000000000002',
				      'none', array[timezone('utc', now()) + interval '4 days'],
				      array[timezone('utc', now()) + interval '4 days 1 hour'],
				      array[]::text[], false, null,
				      '00000000-0000-4000-8000-000000000002'
				    );
				    raise exception 'Authenticated browser role called the event-space creation RPC';
				  exception when insufficient_privilege then
				    null;
				  end;
				end;
			$$;
			rollback;

-- Wissensartikel werden serverseitig über Titel, Zusammenfassung und Revisionstext
-- durchsucht. Externe Personen sehen dabei ausschliesslich die veröffentlichte
-- Revision und niemals interne oder fremdmandantige Treffer.
insert into public.customer_organizations (id, tenant_id, name, active) values
  (
    '93000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Volltext Organisation aktiv',
    true
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Volltext Organisation inaktiv',
    false
  );
insert into public.customer_memberships (
  customer_organization_id, user_id, access
) values (
  '93000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'company'
);
insert into public.knowledge_articles (
  id, tenant_id, title, slug, visibility, status, current_revision, created_by
) values
  (
    '91000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Quasar-Drucker einrichten',
    'quasar-drucker-einrichten',
    'internal',
    'draft',
    1,
    '00000000-0000-4000-8000-000000000002'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Öffentliche Netzwerkanleitung',
    'oeffentliche-netzwerkanleitung',
    'external',
    'published',
    1,
    '00000000-0000-4000-8000-000000000002'
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'Fremdmandant-Dokument',
    'fremdmandant-dokument',
    'internal',
    'draft',
    1,
    '00000000-0000-4000-8000-000000000004'
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'Inaktive Titelkennzeichnung',
    'inaktive-titelkennzeichnung',
    'external',
    'published',
    1,
    '00000000-0000-4000-8000-000000000002'
  );
update public.knowledge_articles
set published_revision = 1,
    published_at = timezone('utc', now()),
    customer_organization_id = '93000000-0000-4000-8000-000000000001'
where id = '91000000-0000-4000-8000-000000000002';
update public.knowledge_articles
set published_revision = 1,
    published_at = timezone('utc', now()),
    customer_organization_id = '93000000-0000-4000-8000-000000000002'
where id = '91000000-0000-4000-8000-000000000004';
insert into public.knowledge_article_revisions (
  article_id, revision, body, summary, author_id
) values
  (
    '91000000-0000-4000-8000-000000000001',
    1,
    'Mit dem Wolkenfeder-Schlüssel wird die sichere Druckerverbindung eingerichtet.',
    'Druckerverbindung',
    '00000000-0000-4000-8000-000000000002'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    1,
    'Das Lichtsignal bestätigt die freigegebene Netzwerkverbindung.',
    'Netzwerkzugang',
    '00000000-0000-4000-8000-000000000002'
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    1,
    'Wolkenfeder aus einem anderen Mandanten.',
    'Fremdmandant',
    '00000000-0000-4000-8000-000000000004'
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    1,
    'Inhalt der nicht mehr aktiven Organisation.',
    'Inaktiver Zugriff',
    '00000000-0000-4000-8000-000000000002'
  );

begin;
set local role service_role;
do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.search_knowledge_article_ids(uuid, text, boolean, uuid[])',
    'execute'
  ) then
    raise exception 'Authenticated browser role executed knowledge full-text search';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.search_knowledge_article_ids(uuid, text, boolean, uuid[])',
    'execute'
  ) then
    raise exception 'service_role may not execute knowledge full-text search';
  end if;
  if not exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      true,
      array[]::uuid[]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Knowledge full-text search missed an article body match';
  end if;
  if not exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Druckerverbindung',
      true,
      array[]::uuid[]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Knowledge full-text search missed an article summary match';
  end if;
  if not exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Quasar',
      true,
      array[]::uuid[]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Knowledge full-text search missed an article title match';
  end if;
  if exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      false,
      array[]::uuid[]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'External knowledge search exposed an internal revision';
  end if;
  if not exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Lichtsignal',
      false,
      array['93000000-0000-4000-8000-000000000001'::uuid]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'External knowledge search did not find a published revision';
  end if;
  if not exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Netzwerkanleitung',
      false,
      array['93000000-0000-4000-8000-000000000001'::uuid]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'External knowledge search missed a published revision title';
  end if;
  if exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Netzwerkanleitung',
      false,
      array[]::uuid[]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'External knowledge search ignored the customer organisation scope';
  end if;
  if exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Titelkennzeichnung',
      false,
      array['93000000-0000-4000-8000-000000000002'::uuid]
    ) result
    where result.article_id = '91000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'External knowledge search exposed an inactive customer organisation';
  end if;
  if exists (
    select 1
    from public.search_knowledge_article_ids(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      true,
      array[]::uuid[]
    ) result
    where result.article_id = '92000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Knowledge full-text search crossed a tenant boundary';
  end if;
end;
$$;
rollback;
begin;
insert into public.experience_follow_ups (
  id, tenant_id, owner_id, title, priority
) values (
  '94000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'Kometenfeder',
  'normal'
);
insert into public.role_permissions (role_id, permission_code)
select distinct assignment.role_id, 'knowledge.read'
from public.user_role_assignments assignment
where assignment.tenant_id = '10000000-0000-4000-8000-000000000001'
  and assignment.user_id = '00000000-0000-4000-8000-000000000002'
on conflict do nothing;
update public.tenant_feature_flags
set enabled = true, pilot_ends_at = null
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key in ('knowledge.base', 'experience.workspace');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.search_global_workspace(uuid, text, integer)',
    'execute'
  ) then
    raise exception 'Authenticated users may not execute the global search RPC';
  end if;
  if not exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      40
    ) result
    where result.result_type = 'knowledge'
      and result.entity_id = '91000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Global search missed an accessible full-text knowledge match';
  end if;
  if exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      40
    ) result
    where result.entity_id = '92000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Global search crossed a tenant boundary';
  end if;
  if not exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Kometenfeder',
      40
    ) result
    where result.result_type = 'follow_up'
      and result.entity_id = '94000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Global search missed an accessible own follow-up';
  end if;
end;
$$;
reset role;
update public.tenant_feature_flags
set enabled = false
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'knowledge.base';
update public.tenant_feature_flags
set enabled = true, pilot_ends_at = timezone('utc', now()) - interval '1 hour'
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'experience.workspace';
set local role authenticated;
do $$
begin
  if exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Wolkenfeder',
      40
    ) result
    where result.result_type = 'knowledge'
  ) then
    raise exception 'Global search exposed knowledge while the feature was disabled';
  end if;
  if exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Kometenfeder',
      40
    ) result
    where result.result_type = 'follow_up'
  ) then
    raise exception 'Global search exposed follow-ups while the feature pilot expired';
  end if;
end;
$$;
rollback;

-- Reine Anfragende dürfen weder persönliche Wiedervorlagen noch passende
-- globale Suchtreffer erhalten oder erzeugen. Die Sperre wird über die neue
-- gemeinsame Ticketarbeitsprüfung direkt unter authentifiziertem RLS geprüft.
begin;
insert into public.experience_follow_ups (
  id, tenant_id, owner_id, title, priority
) values (
  '95000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Nur Agent:innen dürfen dies sehen',
  'normal'
);
update public.tenant_feature_flags
set enabled = true, pilot_ends_at = null
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key = 'experience.workspace';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
begin
  if public.can_work_tickets_in_tenant('10000000-0000-4000-8000-000000000001') then
    raise exception 'Requester unexpectedly passed the ticket-work authorization check';
  end if;
  if exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = '95000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Requester could read an own follow-up without ticket work permission';
  end if;
  if exists (
    select 1
    from public.search_global_workspace(
      '10000000-0000-4000-8000-000000000001',
      'Agent:innen',
      40
    ) result
    where result.result_type = 'follow_up'
  ) then
    raise exception 'Requester global search exposed a follow-up without ticket work permission';
  end if;
  update public.experience_follow_ups
  set resolved_at = timezone('utc', now()),
      resolved_by = '00000000-0000-4000-8000-000000000001'
  where id = '95000000-0000-4000-8000-000000000001';
  begin
    insert into public.experience_follow_ups (
      tenant_id, owner_id, title, priority
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      'Unzulässige Wiedervorlage',
      'normal'
    );
    raise exception 'Requester could create a follow-up without ticket work permission';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
do $$
begin
  if exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = '95000000-0000-4000-8000-000000000001'
      and follow_up.resolved_at is not null
  ) then
    raise exception 'Requester could resolve an own follow-up without ticket work permission';
  end if;
end;
$$;
rollback;

-- Ticketbearbeitende behalten ihren persönlichen Wiedervorlagenzugriff, dürfen
-- jedoch weder in einen fremden Mandanten schreiben noch fremde Daten berühren.
begin;
insert into public.experience_follow_ups (
  id, tenant_id, owner_id, title, priority
) values (
  '95000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'Agenten-Wiedervorlage',
  'normal'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
begin
  if not public.can_work_tickets_in_tenant('10000000-0000-4000-8000-000000000001') then
    raise exception 'Ticket agent did not pass the ticket-work authorization check';
  end if;
  if not exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = '95000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Ticket agent could not read an own follow-up';
  end if;
  insert into public.experience_follow_ups (
    id, tenant_id, owner_id, title, priority
  ) values (
    '95000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'Agenten-Wiedervorlage neu',
    'normal'
  );
  update public.experience_follow_ups
  set resolved_at = timezone('utc', now()),
      resolved_by = '00000000-0000-4000-8000-000000000002'
  where id = '95000000-0000-4000-8000-000000000002';
  begin
    insert into public.experience_follow_ups (
      tenant_id, owner_id, title, priority
    ) values (
      '20000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000002',
      'Fremdmandanten-Wiedervorlage',
      'normal'
    );
    raise exception 'Ticket agent could create a follow-up in a foreign tenant';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
do $$
begin
  if not exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = '95000000-0000-4000-8000-000000000002'
      and follow_up.resolved_at is not null
      and follow_up.resolved_by = '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Ticket agent could not resolve an own follow-up';
  end if;
  if not exists (
    select 1
    from public.experience_follow_ups follow_up
    where follow_up.id = '95000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Ticket agent could not create an own follow-up';
  end if;
end;
$$;
rollback;

-- Migration 0101: der serverseitige Präferenz-Upsert muss beide CHECK-Hilfen
-- ausführen können; Browserrollen erhalten daraus keine neuen Rechte.
begin;
set local role service_role;
insert into public.push_preferences (
  tenant_id, user_id, enabled_categories, category_modes, global_enabled,
  summary_hour, quiet_hours_enabled, quiet_start, quiet_end, timezone
) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  array['assigned']::text[],
  jsonb_build_object('assigned', 'immediate', 'contract_deadline', 'off'),
  false, 9, false, 22, 7, 'Europe/Zurich'
)
on conflict (tenant_id, user_id) do update
  set enabled_categories = excluded.enabled_categories,
      category_modes = excluded.category_modes,
      global_enabled = excluded.global_enabled,
      summary_hour = excluded.summary_hour;
do $$
begin
  if not exists (
    select 1
    from public.push_preferences preference
    where preference.tenant_id = '10000000-0000-4000-8000-000000000001'
      and preference.user_id = '00000000-0000-4000-8000-000000000002'
      and preference.global_enabled = false
      and preference.category_modes ->> 'contract_deadline' = 'off'
      and preference.summary_hour = 9
  ) then
    raise exception 'Service role could not persist personal push modes';
  end if;
end;
$$;
rollback;

-- Migration 0102: Ein Teamticket bleibt für Abteilungsagenten ohne
-- Mitgliedschaft unsichtbar, auch wenn es ihnen noch persönlich zugewiesen ist.
-- Beim Wechsel der Teamabteilung erzwingt die Datenbank die passenden
-- Abteilungsmitgliedschaften aller bestehenden Teammitglieder.
begin;
insert into public.teams (id, tenant_id, department_id, name, active)
values (
  '98000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'System Engineering',
  true
);
insert into public.tickets (
  id, tenant_id, department_id, assigned_team_id, assigned_agent_id,
  ticket_number, subject, description, status_id, priority_id, requester_id
) values (
  '98000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  null,
  'ICT-2026-TEAM-001',
  'Teamtest',
  'Darf nur dem zuständigen Team angezeigt werden.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
begin
  if public.can_read_ticket('98000000-0000-4000-8000-000000000002') then
    raise exception 'Agent without team membership could read a personally assigned team ticket';
  end if;
end;
$$;
do $$
begin
  perform public.create_ticket_department_question(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    'Teamgrenze prüfen'
  );
  raise exception 'Agent outside a team could create a department question for a team ticket';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;
insert into public.team_memberships (team_id, user_id, tenant_id)
values (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001'
);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '98000000-0000-4000-8000-000000000002';
insert into public.teams (id, tenant_id, department_id, name, active)
values (
  '98000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Support',
  true
);
insert into public.team_memberships (team_id, user_id, tenant_id)
values (
  '98000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001'
);
do $$
begin
  begin
    update public.teams
    set department_id = '12000000-0000-4000-8000-000000000002'
    where id = '98000000-0000-4000-8000-000000000003';
    raise exception 'Team changed department without matching member department membership';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;
insert into public.department_memberships (department_id, tenant_id, user_id, status)
values (
  '12000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'active'
) on conflict (department_id, user_id) do update set status = 'active';
update public.teams
set department_id = '12000000-0000-4000-8000-000000000002'
where id = '98000000-0000-4000-8000-000000000003';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
begin
  if not public.can_read_ticket('98000000-0000-4000-8000-000000000002') then
    raise exception 'Agent with matching team membership could not read the team ticket';
  end if;
end;
$$;
reset role;

-- Migration 0103: Ticketmetadaten dürfen nicht an aktive Watcher ausserhalb
-- des zugewiesenen Teams gelangen. Auch bereits eingereihte Alt-Einträge
-- werden vor einer Push-Zustellung neutral ausgesondert.
do $$
begin
  if public.ticket_notification_recipient_authorized(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Watcher outside the assigned team was notification-authorized';
  end if;
  if not public.ticket_notification_recipient_authorized(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Matching team member was not notification-authorized';
  end if;
end;
$$;
select public.push_insert_ticket_notification(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '98000000-0000-4000-8000-000000000002',
  'ticket.escalation_opened',
  jsonb_build_object('regression', 'outside-team-helper'),
  '00000000-0000-4000-8000-000000000001'
);
do $$
begin
  if exists (
    select 1 from public.ticket_notifications
    where ticket_id = '98000000-0000-4000-8000-000000000002'
      and user_id = '00000000-0000-4000-8000-000000000003'
      and payload ->> 'regression' = 'outside-team-helper'
  ) then
    raise exception 'Notification helper persisted metadata for an outside-team watcher';
  end if;
end;
$$;
alter table public.ticket_notifications
  disable trigger ticket_notifications_authorize_recipient_trigger;
insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '98000000-0000-4000-8000-000000000002',
  'ticket.escalation_opened',
  jsonb_build_object('regression', 'outside-team-queued')
);
alter table public.ticket_notifications
  enable trigger ticket_notifications_authorize_recipient_trigger;
insert into public.push_outbox (tenant_id, user_id, notification_id)
select tenant_id, user_id, id
from public.ticket_notifications
where ticket_id = '98000000-0000-4000-8000-000000000002'
  and user_id = '00000000-0000-4000-8000-000000000003'
  and payload ->> 'regression' = 'outside-team-queued'
on conflict (notification_id) do nothing;
select public.push_skip_unauthorized_ticket_outbox();
do $$
begin
  if not exists (
    select 1
    from public.push_outbox outbox
    join public.ticket_notifications notification on notification.id = outbox.notification_id
    where notification.payload ->> 'regression' = 'outside-team-queued'
      and outbox.status = 'skipped'
      and outbox.last_error = 'recipient_not_authorized'
  ) then
    raise exception 'Queued outside-team push was not skipped before delivery';
  end if;
end;
$$;

-- Team replacement is a delta. Only departing members lose their open
-- assignments; retained members and every closed-ticket assignment are kept.
-- Department membership loss must remove matching team memberships on both a
-- status withdrawal and a DELETE, again without changing historical tickets.
insert into public.department_memberships (department_id, tenant_id, user_id, status)
values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  'active'
) on conflict (department_id, user_id) do update set status = 'active';
insert into public.team_memberships (team_id, user_id, tenant_id)
values (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001'
);
insert into public.tickets (
  id, tenant_id, department_id, assigned_team_id, assigned_agent_id,
  ticket_number, subject, description, status_id, priority_id, requester_id, closed_at
) values
(
  '98000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  'ICT-2026-TEAM-002',
  'Delta beibehalten',
  'Die beibehaltene Mitgliedschaft darf nicht kurz entfernt werden.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  null
),
(
  '98000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'ICT-2026-TEAM-003',
  'Geschlossene Historie A',
  'Eine entfernte Mitgliedschaft darf die historische Zuweisung nicht löschen.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  timezone('utc', now())
),
(
  '98000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  'ICT-2026-TEAM-004',
  'Geschlossene Historie B',
  'Auch ein Departmententzug darf diese historische Zuweisung nicht löschen.',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  timezone('utc', now())
);
do $$
begin
  if public.replace_team_memberships(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    array['00000000-0000-4000-8000-000000000003']::uuid[]
  ) <> 'updated' then
    raise exception 'Atomic team-member replacement did not report success';
  end if;
  if exists (
    select 1 from public.team_memberships
    where team_id = '98000000-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-4000-8000-000000000002'
  ) or not exists (
    select 1 from public.team_memberships
    where team_id = '98000000-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000002'
      and assigned_agent_id is not null
  ) then
    raise exception 'Team replacement did not remove only the departing open assignment';
  end if;
  if not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000004'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000003'
  ) or not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000005'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Team replacement changed a retained or closed-ticket assignment';
  end if;
end;
$$;

update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000003'
where id = '98000000-0000-4000-8000-000000000004';
update public.department_memberships
set status = 'suspended'
where department_id = '11000000-0000-4000-8000-000000000001'
  and user_id = '00000000-0000-4000-8000-000000000003';
do $$
begin
  if exists (
    select 1 from public.team_memberships
    where team_id = '98000000-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000004'
      and assigned_agent_id is not null
  ) then
    raise exception 'Department status loss retained a team membership or open assignment';
  end if;
  if not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000006'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Department status loss altered a closed ticket assignment';
  end if;
end;
$$;

update public.department_memberships
set status = 'active'
where department_id = '11000000-0000-4000-8000-000000000001'
  and user_id = '00000000-0000-4000-8000-000000000003';
insert into public.team_memberships (team_id, user_id, tenant_id)
values (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001'
);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000003'
where id = '98000000-0000-4000-8000-000000000004';
delete from public.department_memberships
where department_id = '11000000-0000-4000-8000-000000000001'
  and user_id = '00000000-0000-4000-8000-000000000003';
do $$
begin
  if exists (
    select 1 from public.team_memberships
    where team_id = '98000000-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000004'
      and assigned_agent_id is not null
  ) or not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000006'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Department membership DELETE did not preserve the required integrity boundary';
  end if;
end;
$$;

-- Archiving uses one locked check/update, permits closed history to remain and
-- prevents a ticket from becoming open again after the team is archived.
insert into public.team_memberships (team_id, user_id, tenant_id)
values (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001'
);
update public.tickets
set assigned_agent_id = '00000000-0000-4000-8000-000000000002'
where id = '98000000-0000-4000-8000-000000000002';
do $$
begin
  begin
    update public.teams
    set active = false
    where id = '98000000-0000-4000-8000-000000000001';
    raise exception 'Direct team archive accepted an open team ticket';
  exception when check_violation then
    null;
  end;
  if public.archive_team_if_no_open_tickets(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001'
  ) <> 'team_has_open_tickets' then
    raise exception 'Atomic team archive did not reject open team tickets';
  end if;
end;
$$;
update public.tickets
set closed_at = timezone('utc', now())
where assigned_team_id = '98000000-0000-4000-8000-000000000001'
  and closed_at is null;
do $$
begin
  if public.archive_team_if_no_open_tickets(
    '10000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001'
  ) <> 'archived' then
    raise exception 'Atomic team archive did not archive a team with only closed tickets';
  end if;
  if not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000002'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000002'
  ) or not exists (
    select 1 from public.tickets
    where id = '98000000-0000-4000-8000-000000000005'
      and assigned_agent_id = '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Team archive altered a closed ticket assignment';
  end if;
  begin
    update public.tickets
    set closed_at = null
    where id = '98000000-0000-4000-8000-000000000002';
    raise exception 'Archived team ticket could be reopened';
  exception when check_violation then
    null;
  end;
  if has_function_privilege(
    'authenticated',
    'public.replace_team_memberships(uuid, uuid, uuid[])',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.archive_team_if_no_open_tickets(uuid, uuid)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.replace_team_memberships(uuid, uuid, uuid[])',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.archive_team_if_no_open_tickets(uuid, uuid)',
    'execute'
  ) then
    raise exception 'Team mutation RPC privileges are not service-role-only';
  end if;
end;
$$;
rollback;

-- Migration 0105 must find active root and direct-child taxonomy assignments
-- for internal readers, while external search never learns taxonomy names.
begin;
insert into public.tenants (id, slug, name) values
  ('f1050000-0000-4000-8000-000000000001', 'knowledge-search-a', 'Wissenssuche A'),
  ('f1050000-0000-4000-8000-000000000002', 'knowledge-search-b', 'Wissenssuche B');

insert into public.knowledge_collections (id, tenant_id, name, slug, parent_id, active) values
  ('f1050000-0000-4000-8000-000000000010', 'f1050000-0000-4000-8000-000000000001', 'Hardware', 'hardware', null, true),
  ('f1050000-0000-4000-8000-000000000011', 'f1050000-0000-4000-8000-000000000001', 'Drucker', 'hardware-drucker', 'f1050000-0000-4000-8000-000000000010', true),
  ('f1050000-0000-4000-8000-000000000012', 'f1050000-0000-4000-8000-000000000001', 'Veraltet', 'hardware-veraltet', 'f1050000-0000-4000-8000-000000000010', false),
  ('f1050000-0000-4000-8000-000000000013', 'f1050000-0000-4000-8000-000000000001', 'Verborgene Kategorie', 'verborgene-kategorie', null, false),
  ('f1050000-0000-4000-8000-000000000014', 'f1050000-0000-4000-8000-000000000001', 'Verschwunden', 'verborgene-unterkategorie', 'f1050000-0000-4000-8000-000000000013', true),
  ('f1050000-0000-4000-8000-000000000015', 'f1050000-0000-4000-8000-000000000001', 'Zwischenebene', 'hardware-zwischenebene', 'f1050000-0000-4000-8000-000000000010', true),
  ('f1050000-0000-4000-8000-000000000016', 'f1050000-0000-4000-8000-000000000001', 'Kundensegment', 'kundensegment', null, true),
  ('f1050000-0000-4000-8000-000000000018', 'f1050000-0000-4000-8000-000000000001', 'Kundenanleitung', 'kundensegment-anleitung', 'f1050000-0000-4000-8000-000000000016', true),
  ('f1050000-0000-4000-8000-000000000020', 'f1050000-0000-4000-8000-000000000002', 'Hardware', 'hardware', null, true);

-- The production trigger forbids a third level. A controlled malformed row
-- proves the search nevertheless fails closed if historical corruption exists.
set local session_replication_role = replica;
insert into public.knowledge_collections (id, tenant_id, name, slug, parent_id, active)
values ('f1050000-0000-4000-8000-000000000017', 'f1050000-0000-4000-8000-000000000001', 'Tiefe Kategorie', 'hardware-tiefe-kategorie', 'f1050000-0000-4000-8000-000000000015', true);
set local session_replication_role = origin;

insert into public.knowledge_articles (
  id, tenant_id, title, slug, visibility, status, current_revision, published_revision
) values
  ('f1050000-0000-4000-8000-000000000101', 'f1050000-0000-4000-8000-000000000001', 'Interner Leitfaden für Geräte', 'internes-geraet', 'internal', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000102', 'f1050000-0000-4000-8000-000000000001', 'Interner Leitfaden für Wartung', 'interne-wartung', 'internal', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000103', 'f1050000-0000-4000-8000-000000000001', 'Interner Leitfaden für Altbestand', 'interner-altbestand', 'internal', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000104', 'f1050000-0000-4000-8000-000000000001', 'Interner Leitfaden für geschützte Abläufe', 'interner-geschuetzt', 'internal', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000105', 'f1050000-0000-4000-8000-000000000001', 'Interner Leitfaden für Sonderfälle', 'interner-sonderfall', 'internal', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000106', 'f1050000-0000-4000-8000-000000000001', 'Externer Leitfaden für Kundschaft', 'externer-leitfaden', 'external', 'published', 1, 1),
  ('f1050000-0000-4000-8000-000000000201', 'f1050000-0000-4000-8000-000000000002', 'Fremder Leitfaden', 'fremder-leitfaden', 'internal', 'published', 1, 1);

insert into public.knowledge_article_revisions (article_id, revision, body, summary) values
  ('f1050000-0000-4000-8000-000000000101', 1, 'Ein allgemeiner Ablauf ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000102', 1, 'Ein weiterer allgemeiner Ablauf ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000103', 1, 'Ein neutraler Artikelinhalt ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000104', 1, 'Ein neutraler geschützter Ablauf ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000105', 1, 'Ein neutraler Sonderablauf ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000106', 1, 'Ein veröffentlichter Artikel ohne Taxonomiebegriff.', null),
  ('f1050000-0000-4000-8000-000000000201', 1, 'Ein fremder Artikel ohne Taxonomiebegriff.', null);

insert into public.knowledge_article_collections (tenant_id, article_id, collection_id) values
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000101', 'f1050000-0000-4000-8000-000000000010'),
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000102', 'f1050000-0000-4000-8000-000000000011'),
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000103', 'f1050000-0000-4000-8000-000000000012'),
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000104', 'f1050000-0000-4000-8000-000000000014'),
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000105', 'f1050000-0000-4000-8000-000000000017'),
  ('f1050000-0000-4000-8000-000000000001', 'f1050000-0000-4000-8000-000000000106', 'f1050000-0000-4000-8000-000000000018'),
  ('f1050000-0000-4000-8000-000000000002', 'f1050000-0000-4000-8000-000000000201', 'f1050000-0000-4000-8000-000000000020');

do $$
begin
  if not exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Hardware', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000101'
  ) or not exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Hardware', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000102'
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Hardware', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000201'
  ) then
    raise exception 'Knowledge taxonomy root search did not retain direct-child and tenant fences';
  end if;

  if not exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Drucker', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000102'
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Drucker', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000101'
  ) then
    raise exception 'Knowledge taxonomy subcategory search was not exact';
  end if;

  if exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Veraltet', true, array[]::uuid[]
    )
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Verschwunden', true, array[]::uuid[]
    )
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Tiefe Kategorie', true, array[]::uuid[]
    )
  ) then
    raise exception 'Knowledge taxonomy search accepted an inactive or incomplete hierarchy';
  end if;

  if not exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Kundensegment', true, array[]::uuid[]
    ) where article_id = 'f1050000-0000-4000-8000-000000000106'
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Kundensegment', false, array[]::uuid[]
    )
  ) or exists (
    select 1 from public.search_knowledge_article_ids(
      'f1050000-0000-4000-8000-000000000001', 'Kundenanleitung', false, array[]::uuid[]
    )
  ) then
    raise exception 'Knowledge taxonomy leaked into an external search scope';
  end if;
end;
$$;

-- Der Systemstatus bleibt mandantengefencet, zeichnet Zustandswechsel atomar
-- auf und ist ohne eine explizite Seitenfreigabe nie öffentlich.
insert into public.tenants (id, slug, name) values
  ('f1060000-0000-4000-8000-000000000001', 'service-status-a', 'Service Status A'),
  ('f1060000-0000-4000-8000-000000000002', 'service-status-b', 'Service Status B');
insert into public.services (
  id, tenant_id, name, status, status_public
) values
  (
    'f1060000-0000-4000-8000-000000000010',
    'f1060000-0000-4000-8000-000000000001',
    'Öffentlicher Dienst A',
    'operational',
    true
  ),
  (
    'f1060000-0000-4000-8000-000000000020',
    'f1060000-0000-4000-8000-000000000002',
    'Fremder Dienst B',
    'major_outage',
    true
  );

update public.services
   set status = 'partial_outage'
 where id = 'f1060000-0000-4000-8000-000000000010';

insert into public.service_status_pages (
  tenant_id, title, public_enabled
) values (
  'f1060000-0000-4000-8000-000000000001',
  'Öffentlicher Systemstatus',
  true
);

update public.service_status_events
   set changed_at = timezone('utc', now()) - interval '120 days'
 where tenant_id = 'f1060000-0000-4000-8000-000000000001'
   and service_id = 'f1060000-0000-4000-8000-000000000010'
   and status = 'operational';
update public.service_status_events
   set changed_at = timezone('utc', now()) - interval '1 day'
 where tenant_id = 'f1060000-0000-4000-8000-000000000001'
   and service_id = 'f1060000-0000-4000-8000-000000000010'
   and status = 'partial_outage';

do $$
begin
  if (select count(*) from public.service_status_events
      where tenant_id = 'f1060000-0000-4000-8000-000000000001'
        and service_id = 'f1060000-0000-4000-8000-000000000010') <> 2 then
    raise exception 'Service status history did not record creation and transition';
  end if;
  if not exists (
    select 1 from public.service_status_events
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and service_id = 'f1060000-0000-4000-8000-000000000010'
      and status = 'partial_outage'
  ) then
    raise exception 'Service status history lost the explicit current transition';
  end if;
  if not exists (
    select 1
    from public.service_status_history_baselines(
      'f1060000-0000-4000-8000-000000000001',
      array['f1060000-0000-4000-8000-000000000010']::uuid[],
      timezone('utc', now()) - interval '89 days'
    ) as baseline
    where baseline.service_id = 'f1060000-0000-4000-8000-000000000010'
      and baseline.status = 'operational'
  ) then
    raise exception 'Service status history baseline did not preserve the pre-window state';
  end if;
  if not exists (
    select 1 from public.service_status_pages
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and public_enabled
      and public_id is not null
  ) then
    raise exception 'Explicit public status page was not persisted';
  end if;
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.service_status_events'::regclass
  ) or not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.service_status_pages'::regclass
  ) then
    raise exception 'Service status tables must enable and force RLS';
  end if;
  if has_table_privilege('anon', 'public.service_status_events', 'select')
    or has_table_privilege('authenticated', 'public.service_status_events', 'select')
    or has_table_privilege('anon', 'public.service_status_pages', 'select')
    or has_table_privilege('authenticated', 'public.service_status_pages', 'select') then
    raise exception 'Browser roles retained direct access to service status data';
  end if;
  begin
    insert into public.service_status_events (
      tenant_id, service_id, status
    ) values (
      'f1060000-0000-4000-8000-000000000001',
      'f1060000-0000-4000-8000-000000000020',
      'operational'
    );
    raise exception 'A cross-tenant service status event was accepted';
  exception when foreign_key_violation then
    null;
  end;
  begin
    update public.services
       set status = 'invented_status'
     where id = 'f1060000-0000-4000-8000-000000000010';
    raise exception 'An invalid service status was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Wartungsfenster bleiben mandantengefencet, haben keine Browserpolicies und
-- verknüpfen Services ausschliesslich über zusammengesetzte Tenant-FKs.
insert into public.service_status_maintenances (
  id, tenant_id, title, description, starts_at, ends_at, state, public_enabled
) values (
  'f1060000-0000-4000-8000-000000000030',
  'f1060000-0000-4000-8000-000000000001',
  'Geplante Wartung',
  'Kurzzeitige Wartung am öffentlichen Dienst.',
  timezone('utc', now()) + interval '1 hour',
  timezone('utc', now()) + interval '2 hours',
  'scheduled',
  true
);
insert into public.service_status_maintenance_services (
  tenant_id, maintenance_id, service_id
) values (
  'f1060000-0000-4000-8000-000000000001',
  'f1060000-0000-4000-8000-000000000030',
  'f1060000-0000-4000-8000-000000000010'
);

do $$
begin
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.service_status_maintenances'::regclass
  ) or not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.service_status_maintenance_services'::regclass
  ) then
    raise exception 'Maintenance tables must enable and force RLS';
  end if;
  if has_table_privilege('anon', 'public.service_status_maintenances', 'select')
    or has_table_privilege('authenticated', 'public.service_status_maintenances', 'select')
    or has_table_privilege('anon', 'public.service_status_maintenance_services', 'select')
    or has_table_privilege('authenticated', 'public.service_status_maintenance_services', 'select') then
    raise exception 'Browser roles retained direct access to maintenance data';
  end if;
  if not has_table_privilege('service_role', 'public.service_status_maintenances', 'select')
    or has_table_privilege('service_role', 'public.service_status_maintenances', 'insert')
    or has_table_privilege('service_role', 'public.service_status_maintenances', 'update')
    or has_table_privilege('service_role', 'public.service_status_maintenance_services', 'insert')
    or has_table_privilege('service_role', 'public.service_status_maintenance_services', 'delete') then
    raise exception 'Maintenance writes must be available only through the atomic RPC';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in (
        'service_status_maintenances',
        'service_status_maintenance_services'
      )
  ) then
    raise exception 'Maintenance tables must not define browser policies';
  end if;
  if to_regclass('public.service_status_maintenances_tenant_window_idx') is null
    or to_regclass('public.service_status_maintenances_public_window_idx') is null then
    raise exception 'Maintenance lookup indexes were not created';
  end if;
  begin
    insert into public.service_status_maintenance_services (
      tenant_id, maintenance_id, service_id
    ) values (
      'f1060000-0000-4000-8000-000000000001',
      'f1060000-0000-4000-8000-000000000030',
      'f1060000-0000-4000-8000-000000000020'
    );
    raise exception 'A cross-tenant maintenance service link was accepted';
  exception when foreign_key_violation then
    null;
  end;
  begin
    update public.service_status_maintenances
       set ends_at = starts_at
     where id = 'f1060000-0000-4000-8000-000000000030';
    raise exception 'A maintenance window accepted a non-later end';
  exception when check_violation then
    null;
  end;
  begin
    update public.service_status_maintenances
       set state = 'automatic'
     where id = 'f1060000-0000-4000-8000-000000000030';
    raise exception 'An invalid maintenance state was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

-- The Edge Function service role receives exactly one maintenance write entry
-- point. The function itself owns the complete transaction, including links and
-- audit. These tests force failures after the maintenance insert to prove that
-- no unreadable, linkless maintenance window can survive.
begin;

insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
values (
  'f1060000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'active',
  timezone('utc', now())
);
insert into public.roles (id, tenant_id, name, scope) values (
  'f1060000-0000-4000-8000-000000000040',
  'f1060000-0000-4000-8000-000000000001',
  'Status publication manager',
  'tenant'
);
insert into public.role_permissions (role_id, permission_code) values (
  'f1060000-0000-4000-8000-000000000040',
  'tenant.settings.manage'
);
insert into public.user_role_assignments (tenant_id, user_id, role_id) values (
  'f1060000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'f1060000-0000-4000-8000-000000000040'
);

do $$
begin
  if has_function_privilege(
    'anon',
    'public.save_service_status_maintenance(uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean, uuid[])',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_service_status_maintenance(uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean, uuid[])',
    'execute'
  ) then
    raise exception 'Browser roles may not execute the maintenance mutation RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.save_service_status_maintenance(uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean, uuid[])',
    'execute'
  ) then
    raise exception 'service_role may not execute the maintenance mutation RPC';
  end if;
end;
$$;

set local role service_role;
select public.save_service_status_maintenance(
  '00000000-0000-4000-8000-000000000002',
  'f1060000-0000-4000-8000-000000000001',
  null,
  'Atomare RPC-Wartung',
  'Nur die atomare Wartungs-RPC darf diese Daten speichern.',
  timezone('utc', now()) + interval '4 hours',
  timezone('utc', now()) + interval '5 hours',
  'scheduled',
  true,
  array['f1060000-0000-4000-8000-000000000010']::uuid[]
);
reset role;

do $$
declare
  v_maintenance_id uuid;
begin
  select id into v_maintenance_id
    from public.service_status_maintenances
   where tenant_id = 'f1060000-0000-4000-8000-000000000001'
     and title = 'Atomare RPC-Wartung';
  if v_maintenance_id is null
    or not exists (
      select 1
      from public.service_status_maintenance_services as link
      where link.tenant_id = 'f1060000-0000-4000-8000-000000000001'
        and link.maintenance_id = v_maintenance_id
        and link.service_id = 'f1060000-0000-4000-8000-000000000010'
    ) then
    raise exception 'Atomic maintenance RPC did not persist the complete maintenance window';
  end if;
  if not exists (
    select 1
    from public.audit_logs as audit
    where audit.tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and audit.entity_id = v_maintenance_id
      and audit.action = 'service_status_maintenance.created'
      and audit.before_data is null
      and audit.after_data is null
      and audit.metadata = jsonb_build_object(
        'source', 'service_status',
        'state', 'scheduled',
        'publicEnabled', true,
        'serviceCount', 1
      )
  ) then
    raise exception 'Atomic maintenance RPC did not write data-minimal audit metadata';
  end if;
end;
$$;

-- A public window remains publication-protected inside the RPC, independent of
-- the Edge Function's earlier user-bound checks.
do $$
declare
  v_maintenance_id uuid;
begin
  if public.user_has_tenant_permission(
    '00000000-0000-4000-8000-000000000006',
    'f1060000-0000-4000-8000-000000000001',
    'tenant.settings.manage'
  ) then
    raise exception 'The selected public-maintenance denial actor unexpectedly has publication permission';
  end if;
  select id into v_maintenance_id
    from public.service_status_maintenances
   where tenant_id = 'f1060000-0000-4000-8000-000000000001'
     and title = 'Atomare RPC-Wartung';
  if v_maintenance_id is null then
    raise exception 'The public maintenance test fixture is missing';
  end if;
  perform set_config(
    'nextdesk.test_public_maintenance_id',
    v_maintenance_id::text,
    true
  );
end;
$$;
set local role service_role;
do $$
declare
  v_maintenance_id uuid := current_setting(
    'nextdesk.test_public_maintenance_id',
    true
  )::uuid;
begin
  begin
    perform public.save_service_status_maintenance(
      '00000000-0000-4000-8000-000000000006',
      'f1060000-0000-4000-8000-000000000001',
      v_maintenance_id,
      'Unberechtigte Änderung',
      null,
      timezone('utc', now()) + interval '4 hours',
      timezone('utc', now()) + interval '5 hours',
      'scheduled',
      false,
      array['f1060000-0000-4000-8000-000000000010']::uuid[]
    );
    raise exception 'A public maintenance window was editable without publication permission';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1
    from public.service_status_maintenances
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and title = 'Atomare RPC-Wartung'
      and public_enabled
  ) then
    raise exception 'Denied public maintenance update left a partial mutation behind';
  end if;
end;
$$;

create function public.test_service_status_reject_link_insert()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id = 'f1060000-0000-4000-8000-000000000001'
    and new.service_id = 'f1060000-0000-4000-8000-000000000010' then
    raise exception 'service-status-test-link-insert-failure';
  end if;
  return new;
end;
$$;
create trigger test_service_status_reject_link_insert
before insert on public.service_status_maintenance_services
for each row execute function public.test_service_status_reject_link_insert();

set local role service_role;
do $$
begin
  begin
    perform public.save_service_status_maintenance(
      '00000000-0000-4000-8000-000000000002',
      'f1060000-0000-4000-8000-000000000001',
      null,
      'Link-Fehler ohne Restdaten',
      null,
      timezone('utc', now()) + interval '6 hours',
      timezone('utc', now()) + interval '7 hours',
      'scheduled',
      false,
      array['f1060000-0000-4000-8000-000000000010']::uuid[]
    );
    raise exception 'Forced maintenance link insert failure was accepted';
  exception when raise_exception then
    if sqlerrm <> 'service-status-test-link-insert-failure' then
      raise;
    end if;
  end;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1
    from public.service_status_maintenances
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and title = 'Link-Fehler ohne Restdaten'
  ) then
    raise exception 'Failed maintenance link insert left a maintenance row behind';
  end if;
  if exists (
    select 1
    from public.audit_logs
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and action = 'service_status_maintenance.created'
      and entity_id not in (
        select id from public.service_status_maintenances
      )
  ) then
    raise exception 'Failed maintenance link insert left an orphan audit row behind';
  end if;
end;
$$;
drop trigger test_service_status_reject_link_insert
  on public.service_status_maintenance_services;
drop function public.test_service_status_reject_link_insert();

create function public.test_service_status_reject_audit_insert()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'service_status_maintenance.created'
    and new.metadata->>'source' = 'service_status' then
    raise exception 'service-status-test-audit-insert-failure';
  end if;
  return new;
end;
$$;
create trigger test_service_status_reject_audit_insert
before insert on public.audit_logs
for each row execute function public.test_service_status_reject_audit_insert();

set local role service_role;
do $$
begin
  begin
    perform public.save_service_status_maintenance(
      '00000000-0000-4000-8000-000000000002',
      'f1060000-0000-4000-8000-000000000001',
      null,
      'Audit-Fehler ohne Restdaten',
      null,
      timezone('utc', now()) + interval '8 hours',
      timezone('utc', now()) + interval '9 hours',
      'scheduled',
      false,
      array['f1060000-0000-4000-8000-000000000010']::uuid[]
    );
    raise exception 'Forced maintenance audit insert failure was accepted';
  exception when raise_exception then
    if sqlerrm <> 'service-status-test-audit-insert-failure' then
      raise;
    end if;
  end;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1
    from public.service_status_maintenances
    where tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and title = 'Audit-Fehler ohne Restdaten'
  ) or exists (
    select 1
    from public.service_status_maintenance_services as link
    join public.service_status_maintenances as maintenance
      on maintenance.id = link.maintenance_id
     and maintenance.tenant_id = link.tenant_id
    where maintenance.tenant_id = 'f1060000-0000-4000-8000-000000000001'
      and maintenance.title = 'Audit-Fehler ohne Restdaten'
  ) then
    raise exception 'Failed maintenance audit insert left partial maintenance data behind';
  end if;
end;
$$;
drop trigger test_service_status_reject_audit_insert on public.audit_logs;
drop function public.test_service_status_reject_audit_insert();
rollback;

-- Unterbestands-Empfängerbelege dürfen auch für service-role-Schreibpfade nur
-- innerhalb eines Mandanten auf die erzeugte Benachrichtigung und eine passende
-- Mitgliedschaft zeigen. Der tatsächliche Event-Trigger bleibt dabei mit den
-- zusammengesetzten Fremdschlüsseln schreibfähig.
begin;
update public.tenant_feature_flags
set enabled = true,
    pilot_ends_at = null
where tenant_id = '10000000-0000-4000-8000-000000000001'
  and feature_key in ('inventory.management', 'notifications.push');
insert into public.roles (id, tenant_id, name, scope) values (
  '11700000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Low-stock FK Testrolle',
  'tenant'
);
insert into public.role_permissions (role_id, permission_code) values (
  '11700000-0000-4000-8000-000000000001',
  'inventory.manage'
);
insert into public.user_role_assignments (tenant_id, user_id, role_id) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '11700000-0000-4000-8000-000000000001'
);
insert into public.push_preferences (
  tenant_id, user_id, enabled_categories, category_modes, global_enabled,
  summary_hour, quiet_hours_enabled, quiet_start, quiet_end, timezone
) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  array['inventory_low_stock']::text[],
  jsonb_build_object('inventory_low_stock', 'immediate'),
  true,
  8,
  false,
  22,
  7,
  'Europe/Zurich'
)
on conflict (tenant_id, user_id) do update set
  enabled_categories = excluded.enabled_categories,
  category_modes = excluded.category_modes,
  global_enabled = excluded.global_enabled,
  summary_hour = excluded.summary_hour,
  quiet_hours_enabled = excluded.quiet_hours_enabled,
  quiet_start = excluded.quiet_start,
  quiet_end = excluded.quiet_end,
  timezone = excluded.timezone;
insert into public.inventory_locations (id, tenant_id, code, name) values (
  '11700000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'low-stock-fk',
  'Low-stock FK Lager'
);
insert into public.inventory_items (
  id, tenant_id, article_number, name, minimum_quantity, target_quantity
) values (
  '11700000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'low-stock-fk-item',
  'Low-stock FK Artikel',
  1,
  1
);
insert into public.inventory_events (
  id, tenant_id, client_request_id, event_type, actor_id
) values (
  '11700000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '11700000-0000-4000-8000-000000000005',
  'movement_receipt',
  '00000000-0000-4000-8000-000000000001'
);
insert into public.inventory_event_lines (
  tenant_id, event_id, item_id, location_id, physical_delta
) values (
  '10000000-0000-4000-8000-000000000001',
  '11700000-0000-4000-8000-000000000004',
  '11700000-0000-4000-8000-000000000003',
  '11700000-0000-4000-8000-000000000002',
  1
);
do $$
begin
  if not exists (
    select 1
    from public.inventory_low_stock_episode_recipients as recipient
    join public.inventory_low_stock_episodes as episode
      on episode.id = recipient.episode_id
     and episode.tenant_id = recipient.tenant_id
    join public.ticket_notifications as notification
      on notification.id = recipient.notification_id
     and notification.tenant_id = recipient.tenant_id
    where episode.tenant_id = '10000000-0000-4000-8000-000000000001'
      and episode.item_id = '11700000-0000-4000-8000-000000000003'
      and recipient.recipient_user_id = '00000000-0000-4000-8000-000000000002'
      and notification.kind = 'inventory.low_stock'
  ) then
    raise exception 'Low-stock trigger could not create a tenant-bound recipient receipt';
  end if;
end;
$$;
insert into public.ticket_notifications (id, tenant_id, user_id, kind) values
  (
    '11700000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004',
    'low-stock-fk-test'
  ),
  (
    '11700000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'low-stock-fk-test'
  );
set local role service_role;
do $$
declare
  v_episode_id uuid;
begin
  select id into v_episode_id
  from public.inventory_low_stock_episodes
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and item_id = '11700000-0000-4000-8000-000000000003';
  if v_episode_id is null then
    raise exception 'Low-stock FK regression fixture has no episode';
  end if;

  begin
    insert into public.inventory_low_stock_episode_recipients (
      tenant_id, episode_id, recipient_user_id, notification_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      v_episode_id,
      '00000000-0000-4000-8000-000000000001',
      '11700000-0000-4000-8000-000000000006'
    );
    raise exception 'Service role linked a low-stock recipient to a foreign-tenant notification';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.inventory_low_stock_episode_recipients (
      tenant_id, episode_id, recipient_user_id, notification_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      v_episode_id,
      '00000000-0000-4000-8000-000000000004',
      '11700000-0000-4000-8000-000000000007'
    );
    raise exception 'Service role linked a low-stock recipient without a same-tenant membership';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;
reset role;
rollback;

-- Exchange-Inlinebilder bleiben private Ticketanhänge. Die Content-ID ist nur
-- ein begrenztes, nicht ausführbares Zuordnungsmerkmal und akzeptiert weder
-- Leerzeichen noch Markersteuerzeichen.
begin;
insert into public.ticket_attachments (
  id, ticket_id, uploaded_by, storage_bucket, storage_object_path,
  original_filename, content_type, byte_size, malware_status, inline_content_id
) values (
  '6f000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'ticket-attachments',
  '10000000-0000-4000-8000-000000000001/17000000-0000-4000-8000-000000000001/6f000000-0000-4000-8000-000000000002',
  'logo.png',
  'image/png',
  42,
  'clean',
  'logo-1@mail'
);
do $$
begin
  if not exists (
    select 1
    from public.ticket_attachments
    where id = '6f000000-0000-4000-8000-000000000001'
      and inline_content_id = 'logo-1@mail'
  ) then
    raise exception 'Exchange inline Content-ID was not persisted privately';
  end if;
  begin
    insert into public.ticket_attachments (
      ticket_id, uploaded_by, storage_bucket, storage_object_path,
      original_filename, content_type, byte_size, malware_status, inline_content_id
    ) values (
      '17000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      'ticket-attachments',
      '10000000-0000-4000-8000-000000000001/17000000-0000-4000-8000-000000000001/6f000000-0000-4000-8000-000000000003',
      'invalid-logo.png',
      'image/png',
      42,
      'clean',
      'invalid cid]'
    );
    raise exception 'Unsafe Exchange inline Content-ID was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;
rollback;
SQL
echo "PostgreSQL 16 migration and RLS integration checks passed."
