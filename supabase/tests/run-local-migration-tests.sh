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
SQL

for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

psql -v ON_ERROR_STOP=1 <<'SQL'
-- The test grants only emulate Supabase API read privileges; the migrations still provide RLS.
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.tickets, public.ticket_comments, public.ticket_statuses, public.ticket_priorities, public.ticket_categories to authenticated;

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
begin
  select public.upsert_ticket_custom_field_definition(
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    null,
    'asset_location',
    'Gerätestandort',
    'select',
    false,
    '["Büro", "Homeoffice"]'::jsonb
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

insert into public.saved_ticket_views (tenant_id, owner_id, name, visibility, filters) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Privat A', 'private', '{"query":"intern","queue":"alle","ticketScope":"all"}'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Mandant A', 'tenant', '{"query":"","queue":"alle","ticketScope":"open"}'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'Mandant B', 'tenant', '{"query":"","queue":"alle","ticketScope":"closed"}');

insert into public.tenant_member_directory (tenant_id, user_id, department_id, job_title, offer) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'Support Engineer', 'Arbeitsplatz');

insert into public.tenant_entra_directory_sync_configurations (tenant_id, entra_tenant_id, enabled) values
  ('10000000-0000-4000-8000-000000000001', 'b47990ca-e841-4d86-9517-82f60623ed26', true);
insert into public.tenant_entra_directory_people (
  tenant_id, entra_object_id, email, display_name, job_title, source_department_name,
  local_user_id, agent_requested, agent_department_id
) values (
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'neue.person@beispiel-a.ch',
  'Neue Person',
  'Mitarbeiterin',
  'ICT',
  '00000000-0000-4000-8000-000000000001',
  true,
  '11000000-0000-4000-8000-000000000001'
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
  exception when foreign_key_violation then
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

-- Saved views must remain tenant-isolated: members only see their own private
-- views plus tenant-shared views. Tenant-wide ticket managers may edit shared
-- views they do not own, while an ordinary member cannot spoof an owner.
begin;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if (select count(*) from public.saved_ticket_views) <> 2 then
    raise exception 'Tenant A manager must only see own and Tenant A shared views';
  end if;
  update public.saved_ticket_views
  set name = 'Mandant A verwaltet'
  where tenant_id = '10000000-0000-4000-8000-000000000001'
    and owner_id = '00000000-0000-4000-8000-000000000002'
    and visibility = 'tenant';
  if not found then
    raise exception 'Tenant ticket manager must update a shared view';
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
  if (select count(*) from public.saved_ticket_views) <> 1 then
    raise exception 'Tenant A member must only see shared views, not another private view';
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
    'nextdesk-managed', 'general_draft', 'none', null, 12, 16, 1
  );
  if queued is null then
    raise exception 'AI metadata queue did not return a request id';
  end if;
end;
$$;
reset role;
commit;

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
      'public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer)',
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
      'public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer)',
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
      and status = 'skipped'
      and last_error = 'off_shift'
  ) then
    raise exception 'Push claim did not skip an unchecked-in user as off_shift';
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
  foreach relation_name in array array['dispatch_config', 'service_identity']
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
    or not has_function_privilege('service_role', 'public.exchange_mail_verify_dispatch_secret(text)', 'execute') then
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
insert into public.exchange_mail_channels (
  id, tenant_id, entra_tenant_id, mailbox_address, default_department_id,
  send_agent_replies, send_resolution, status, created_by, updated_by, activated_at
) values (
  '1c000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  'support@tenant-a.example',
  '11000000-0000-4000-8000-000000000001',
  true, true, 'active',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002', now()
);

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
SQL

echo "PostgreSQL 16 migration and RLS integration checks passed."
