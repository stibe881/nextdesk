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
create table auth.users (id uuid primary key);
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

insert into public.department_memberships (department_id, tenant_id, user_id, status) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'active');

insert into public.ticket_statuses (id, tenant_id, key, label, sort_order) values
  ('13000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'open', 'Open', 1),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'open', 'Open', 1);
insert into public.ticket_priorities (id, tenant_id, key, label, sort_order) values
  ('14000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'normal', 'Normal', 1),
  ('24000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'normal', 'Normal', 1);
insert into public.ticket_categories (id, tenant_id, department_id, name) values
  ('13500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Access'),
  ('23500000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003', 'Access B');

insert into public.roles (id, tenant_id, name, scope) values
  ('15000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Requester', 'tenant'),
  ('16000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ICT agent', 'department');
insert into public.role_permissions (role_id, permission_code) values
  ('15000000-0000-4000-8000-000000000001', 'ticket.read.own'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.read.department'),
  ('16000000-0000-4000-8000-000000000002', 'ticket.internal_notes.read');
insert into public.user_role_assignments (tenant_id, user_id, role_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001');
insert into public.user_role_assignments (tenant_id, user_id, role_id, department_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001');

insert into public.tickets (id, tenant_id, department_id, ticket_number, subject, description, status_id, priority_id, requester_id) values
  ('17000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'ICT-2026-000001', 'ICT test', 'Visible for ICT', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'INF-2026-000001', 'Infrastructure test', 'Hidden from ICT', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
insert into public.ticket_comments (ticket_id, author_id, body) values
  ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Internal ICT note');

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

-- Sensitive tables must have RLS; ticket number reservation must not be a client RPC.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array['roles', 'role_permissions', 'user_role_assignments', 'ticket_number_sequences', 'ticket_statuses', 'ticket_priorities', 'ticket_categories']
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
  if (select count(*) from public.ticket_statuses) <> 1
    or (select count(*) from public.ticket_priorities) <> 1
    or (select count(*) from public.ticket_categories) <> 1 then
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
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  if (select count(*) from public.tickets) <> 0 then
    raise exception 'Tenant B member must not see Tenant A tickets';
  end if;
  if (select count(*) from public.ticket_statuses) <> 1
    or (select count(*) from public.ticket_priorities) <> 1
    or (select count(*) from public.ticket_categories) <> 1 then
    raise exception 'Tenant B member must only see dashboard reference data from Tenant B';
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
SQL

echo "PostgreSQL 16 migration and RLS integration checks passed."
