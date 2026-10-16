-- TicketHub: ausstehende Provisionierungs- und Mandantenadministrationsmigrationen
-- Ausführen im Supabase SQL Editor als eine Sitzung. Nicht erneut ausführen.
-- Abschnitt 1: 0007_tenant_provisioning_and_invitations.sql

begin;

create type public.invitation_status as enum ('pending', 'sent', 'accepted', 'failed', 'cancelled', 'expired');

create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  invited_user_id uuid references auth.users(id) on delete set null,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (timezone('utc', now()) + interval '7 days'),
  sent_at timestamptz,
  accepted_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check ((status <> 'sent' and status <> 'accepted') or invited_user_id is not null),
  check (status <> 'accepted' or accepted_at is not null)
);
create unique index tenant_invitations_open_email_unique
  on public.tenant_invitations (tenant_id, email)
  where status in ('pending', 'sent');
create index tenant_invitations_tenant_status_idx on public.tenant_invitations (tenant_id, status, created_at desc);
create trigger tenant_invitations_updated_at before update on public.tenant_invitations for each row execute function public.set_updated_at();

alter table public.tenant_invitations enable row level security;
revoke all on table public.tenant_invitations from anon, authenticated;

-- Role expiry must remain possible after a member was removed, without allowing scope changes.
create or replace function public.validate_role_assignment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_scope public.role_scope;
begin
  if TG_OP = 'UPDATE'
    and new.role_id = old.role_id
    and new.tenant_id = old.tenant_id
    and new.user_id = old.user_id
    and new.department_id is not distinct from old.department_id
    and new.team_id is not distinct from old.team_id
    and new.starts_at = old.starts_at
    and new.assigned_by is not distinct from old.assigned_by
    and new.expires_at is not null
    and (old.expires_at is null or new.expires_at <= old.expires_at)
  then
    return new;
  end if;

  select scope into assigned_scope from public.roles where id = new.role_id and tenant_id = new.tenant_id;

  if assigned_scope is null or assigned_scope = 'platform' then
    raise exception 'Role must belong to the assignment tenant and must not be a platform role';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.user_id
      and membership.status = 'active'
  ) then
    raise exception 'A role can only be assigned to an active tenant member';
  end if;

  if assigned_scope = 'tenant' and (new.department_id is not null or new.team_id is not null) then
    raise exception 'Tenant role assignments may not contain a department or team scope';
  end if;
  if assigned_scope = 'department' and (new.department_id is null or new.team_id is not null) then
    raise exception 'Department role assignments require exactly a department scope';
  end if;
  if assigned_scope = 'team' and new.team_id is null then
    raise exception 'Team role assignments require a team scope';
  end if;

  return new;
end;
$$;

create or replace function public.user_has_tenant_permission(
  p_user_id uuid,
  p_tenant_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id and tenant.status = 'active'
    join public.user_role_assignments assignment
      on assignment.user_id = membership.user_id
      and assignment.tenant_id = membership.tenant_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = assignment.tenant_id
      and role.active
      and role.scope = 'tenant'
    join public.role_permissions role_permission
      on role_permission.role_id = role.id
      and role_permission.permission_code = p_permission_code
    where membership.user_id = p_user_id
      and membership.tenant_id = p_tenant_id
      and membership.status = 'active'
  );
$$;

create or replace function public.assert_user_has_tenant_permission(
  p_user_id uuid,
  p_tenant_id uuid,
  p_permission_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_has_tenant_permission(p_user_id, p_tenant_id, p_permission_code) then
    raise exception 'Missing tenant permission %', p_permission_code using errcode = '42501';
  end if;
end;
$$;

create or replace function public.provision_tenant(
  p_actor_id uuid,
  p_slug citext,
  p_name text,
  p_initial_admin_user_id uuid,
  p_departments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_department record;
  v_department_id uuid;
  v_tenant_admin_role_id uuid;
  v_agent_role_id uuid;
  v_requester_role_id uuid;
begin
  if not exists (
    select 1
    from public.platform_administrators operator
    where operator.user_id = p_actor_id
      and operator.enabled
      and operator.mfa_verified_at >= timezone('utc', now()) - interval '12 hours'
  ) then
    raise exception 'A recent MFA-verified platform operator is required' using errcode = '42501';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'Invalid tenant slug' using errcode = '22023';
  end if;

  if p_name is null or char_length(btrim(p_name)) not between 2 and 160 then
    raise exception 'Invalid tenant name' using errcode = '22023';
  end if;

  if jsonb_typeof(p_departments) <> 'array' or jsonb_array_length(p_departments) not between 1 and 50 then
    raise exception 'Between one and fifty initial departments are required' using errcode = '22023';
  end if;

  insert into public.tenants (slug, name)
  values (p_slug, btrim(p_name))
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id, portal_name)
  values (v_tenant_id, btrim(p_name) || ' Support');
  insert into public.tenant_branding (tenant_id)
  values (v_tenant_id);

  insert into public.user_profiles (id)
  values (p_initial_admin_user_id)
  on conflict (id) do nothing;
  insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
  values (v_tenant_id, p_initial_admin_user_id, 'active', timezone('utc', now()));

  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Tenant administrator', 'tenant', true)
  returning id into v_tenant_admin_role_id;
  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Support agent', 'department', true)
  returning id into v_agent_role_id;
  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Requester', 'tenant', true)
  returning id into v_requester_role_id;

  insert into public.role_permissions (role_id, permission_code)
  select v_tenant_admin_role_id, permission_code
  from unnest(array[
    'ticket.create', 'ticket.read.own', 'ticket.read.department', 'ticket.update', 'ticket.assign',
    'ticket.close', 'ticket.export', 'ticket.internal_notes.read', 'ticket.internal_notes.write',
    'department.manage', 'team.manage', 'user.manage', 'role.manage', 'report.read',
    'automation.manage', 'knowledge.manage', 'asset.manage', 'tenant.settings.manage'
  ]::text[]) as permission_code;
  insert into public.role_permissions (role_id, permission_code)
  select v_agent_role_id, permission_code
  from unnest(array[
    'ticket.read.assigned', 'ticket.read.department', 'ticket.update', 'ticket.assign',
    'ticket.close', 'ticket.internal_notes.read', 'ticket.internal_notes.write'
  ]::text[]) as permission_code;
  insert into public.role_permissions (role_id, permission_code)
  values
    (v_requester_role_id, 'ticket.create'),
    (v_requester_role_id, 'ticket.read.own');

  for v_department in
    select *
    from jsonb_to_recordset(p_departments) as item(key text, name text, kind text)
  loop
    if v_department.key is null or v_department.key !~ '^[a-z][a-z0-9_-]{1,62}$' then
      raise exception 'Invalid department key' using errcode = '22023';
    end if;
    if v_department.name is null or char_length(btrim(v_department.name)) not between 2 and 160 then
      raise exception 'Invalid department name' using errcode = '22023';
    end if;
    if v_department.kind not in ('ict', 'infrastructure', 'custom') then
      raise exception 'Invalid department kind' using errcode = '22023';
    end if;

    insert into public.departments (tenant_id, key, name, kind)
    values (v_tenant_id, v_department.key, btrim(v_department.name), v_department.kind)
    returning id into v_department_id;

    insert into public.department_memberships (department_id, tenant_id, user_id, status)
    values (v_department_id, v_tenant_id, p_initial_admin_user_id, 'active');
  end loop;

  insert into public.user_role_assignments (tenant_id, user_id, role_id, assigned_by)
  values (v_tenant_id, p_initial_admin_user_id, v_tenant_admin_role_id, p_actor_id);

  insert into public.platform_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'tenant.provisioned',
    'tenant',
    v_tenant_id,
    jsonb_build_object('slug', p_slug, 'initial_admin_user_id', p_initial_admin_user_id)
  );

  return v_tenant_id;
end;
$$;

create or replace function public.prepare_tenant_invitation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_email citext,
  p_expires_at timestamptz default timezone('utc', now()) + interval '7 days'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation_id uuid;
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'user.manage');

  if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid invitation email' using errcode = '22023';
  end if;
  if p_expires_at <= timezone('utc', now()) then
    raise exception 'Invitation expiry must be in the future' using errcode = '22023';
  end if;

  select id into v_invitation_id
  from public.tenant_invitations
  where tenant_id = p_tenant_id
    and email = lower(p_email::text)::citext
    and status in ('pending', 'sent')
  for update;

  if v_invitation_id is null then
    insert into public.tenant_invitations (tenant_id, email, requested_by, expires_at)
    values (p_tenant_id, lower(p_email::text)::citext, p_actor_id, p_expires_at)
    returning id into v_invitation_id;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'tenant.invitation.prepared', 'tenant_invitation', v_invitation_id, 'security', jsonb_build_object('email', lower(p_email::text)));

  return v_invitation_id;
end;
$$;

create or replace function public.record_tenant_invitation_delivery(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_invited_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, v_invitation.tenant_id, 'user.manage');

  if v_invitation.status not in ('pending', 'sent') then
    raise exception 'Invitation cannot be delivered in its current state' using errcode = '22023';
  end if;
  if v_invitation.expires_at <= timezone('utc', now()) then
    update public.tenant_invitations set status = 'expired' where id = p_invitation_id;
    raise exception 'Invitation has expired' using errcode = '22023';
  end if;

  insert into public.user_profiles (id)
  values (p_invited_user_id)
  on conflict (id) do nothing;

  if exists (
    select 1 from public.tenant_memberships
    where tenant_id = v_invitation.tenant_id
      and user_id = p_invited_user_id
      and status = 'active'
  ) then
    raise exception 'User is already an active tenant member' using errcode = '23505';
  end if;

  -- A re-invited user starts with no inherited privileges. Historical rows remain for audit.
  update public.user_role_assignments
  set expires_at = greatest(timezone('utc', now()), starts_at + interval '1 microsecond')
  where tenant_id = v_invitation.tenant_id
    and user_id = p_invited_user_id
    and (expires_at is null or expires_at > timezone('utc', now()));

  insert into public.tenant_memberships (tenant_id, user_id, status)
  values (v_invitation.tenant_id, p_invited_user_id, 'invited')
  on conflict (tenant_id, user_id) do update
    set status = 'invited',
        joined_at = null,
        updated_at = timezone('utc', now());

  update public.tenant_invitations
  set invited_user_id = p_invited_user_id,
      status = 'sent',
      sent_at = timezone('utc', now()),
      failure_reason = null
  where id = p_invitation_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity)
  values (v_invitation.tenant_id, p_actor_id, 'tenant.invitation.sent', 'tenant_invitation', p_invitation_id, 'security');
end;
$$;

create or replace function public.cancel_tenant_invitation(
  p_actor_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, v_invitation.tenant_id, 'user.manage');

  if v_invitation.status not in ('pending', 'sent', 'failed') then
    raise exception 'Invitation cannot be cancelled in its current state' using errcode = '22023';
  end if;

  update public.tenant_invitations
  set status = 'cancelled'
  where id = p_invitation_id;

  if v_invitation.invited_user_id is not null then
    update public.tenant_memberships
    set status = 'removed',
        updated_at = timezone('utc', now())
    where tenant_id = v_invitation.tenant_id
      and user_id = v_invitation.invited_user_id
      and status = 'invited';

    update public.user_role_assignments
    set expires_at = greatest(timezone('utc', now()), starts_at + interval '1 microsecond')
    where tenant_id = v_invitation.tenant_id
      and user_id = v_invitation.invited_user_id
      and (expires_at is null or expires_at > timezone('utc', now()));
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity)
  values (v_invitation.tenant_id, p_actor_id, 'tenant.invitation.cancelled', 'tenant_invitation', p_invitation_id, 'security');
end;
$$;

create or replace function public.fail_tenant_invitation(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, v_invitation.tenant_id, 'user.manage');

  if v_invitation.status in ('accepted', 'cancelled') then
    raise exception 'Invitation cannot be marked as failed in its current state' using errcode = '22023';
  end if;

  update public.tenant_invitations
  set status = 'failed',
      failure_reason = left(coalesce(nullif(btrim(p_failure_code), ''), 'delivery_failed'), 80)
  where id = p_invitation_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    v_invitation.tenant_id,
    p_actor_id,
    'tenant.invitation.failed',
    'tenant_invitation',
    p_invitation_id,
    'security',
    jsonb_build_object('failure_code', left(coalesce(nullif(btrim(p_failure_code), ''), 'delivery_failed'), 80))
  );
end;
$$;

create or replace function public.accept_current_tenant_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
  v_requester_role_id uuid;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
    and invited_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Invitation not found for current user' using errcode = 'P0002';
  end if;
  if v_invitation.status <> 'sent' then
    raise exception 'Invitation is not awaiting acceptance' using errcode = '22023';
  end if;
  if v_invitation.expires_at <= timezone('utc', now()) then
    update public.tenant_invitations set status = 'expired' where id = p_invitation_id;
    raise exception 'Invitation has expired' using errcode = '22023';
  end if;

  update public.tenant_memberships
  set status = 'active',
      joined_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where tenant_id = v_invitation.tenant_id
    and user_id = auth.uid()
    and status = 'invited';
  if not found then
    raise exception 'Invitation no longer has an active invited membership' using errcode = '22023';
  end if;

  select id into v_requester_role_id
  from public.roles
  where tenant_id = v_invitation.tenant_id
    and name = 'Requester'
    and scope = 'tenant'
    and active;
  if v_requester_role_id is null then
    raise exception 'Requester role missing for tenant' using errcode = 'P0001';
  end if;

  insert into public.user_role_assignments (tenant_id, user_id, role_id, assigned_by)
  select v_invitation.tenant_id, auth.uid(), v_requester_role_id, v_invitation.requested_by
  where not exists (
    select 1 from public.user_role_assignments
    where tenant_id = v_invitation.tenant_id
      and user_id = auth.uid()
      and role_id = v_requester_role_id
      and expires_at is null
  );

  update public.tenant_invitations
  set status = 'accepted',
      accepted_at = timezone('utc', now())
  where id = p_invitation_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity)
  values (v_invitation.tenant_id, auth.uid(), 'tenant.invitation.accepted', 'tenant_invitation', p_invitation_id, 'security');

  return v_invitation.tenant_id;
end;
$$;

revoke all on function public.user_has_tenant_permission(uuid, uuid, text) from public;
revoke all on function public.assert_user_has_tenant_permission(uuid, uuid, text) from public;
revoke all on function public.provision_tenant(uuid, citext, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.prepare_tenant_invitation(uuid, uuid, citext, timestamptz) from public, anon, authenticated;
revoke all on function public.record_tenant_invitation_delivery(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_tenant_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_tenant_invitation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.accept_current_tenant_invitation(uuid) from public;
grant execute on function public.accept_current_tenant_invitation(uuid) to authenticated;
grant execute on function public.provision_tenant(uuid, citext, text, uuid, jsonb) to service_role;
grant execute on function public.prepare_tenant_invitation(uuid, uuid, citext, timestamptz) to service_role;
grant execute on function public.record_tenant_invitation_delivery(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_tenant_invitation(uuid, uuid) to service_role;
grant execute on function public.fail_tenant_invitation(uuid, uuid, text) to service_role;

commit;
-- Abschnitt 2: 0008_tenant_administration.sql

begin;

create or replace function public.update_tenant_settings(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_portal_name text,
  p_support_email text,
  p_ticket_access_enabled boolean,
  p_allow_external_ticket_access boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'tenant.settings.manage');

  if p_portal_name is null or char_length(btrim(p_portal_name)) not between 2 and 160 then
    raise exception 'Invalid portal name' using errcode = '22023';
  end if;
  if p_support_email is not null and p_support_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid support email' using errcode = '22023';
  end if;
  if not p_ticket_access_enabled and p_allow_external_ticket_access then
    raise exception 'External ticket access requires ticket access to be enabled' using errcode = '22023';
  end if;

  update public.tenant_settings
  set portal_name = btrim(p_portal_name),
      support_email = nullif(lower(btrim(p_support_email)), ''),
      ticket_access_enabled = p_ticket_access_enabled,
      allow_external_ticket_access = p_allow_external_ticket_access,
      updated_at = timezone('utc', now())
  where tenant_id = p_tenant_id;

  if not found then
    raise exception 'Tenant settings not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity)
  values (p_tenant_id, p_actor_id, 'tenant.settings.updated', 'tenant_settings', p_tenant_id, 'security');
end;
$$;

create or replace function public.create_tenant_team(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'team.manage');

  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    raise exception 'Invalid team name' using errcode = '22023';
  end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments
    where id = p_department_id
      and tenant_id = p_tenant_id
      and active
  ) then
    raise exception 'Department does not belong to tenant or is inactive' using errcode = '22023';
  end if;

  insert into public.teams (tenant_id, department_id, name)
  values (p_tenant_id, p_department_id, btrim(p_name))
  returning id into v_team_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id)
  values (p_tenant_id, p_actor_id, 'team.created', 'team', v_team_id);

  return v_team_id;
end;
$$;

create or replace function public.set_department_membership(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  p_user_id uuid,
  p_status public.membership_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'department.manage');

  if p_status not in ('active', 'suspended', 'removed') then
    raise exception 'Invalid department membership status' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.departments
    where id = p_department_id
      and tenant_id = p_tenant_id
      and active
  ) then
    raise exception 'Department does not belong to tenant or is inactive' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Department membership requires an active tenant member' using errcode = '22023';
  end if;

  insert into public.department_memberships (department_id, tenant_id, user_id, status)
  values (p_department_id, p_tenant_id, p_user_id, p_status)
  on conflict (department_id, user_id) do update
    set status = excluded.status,
        updated_at = timezone('utc', now());

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'department.membership.updated',
    'department',
    p_department_id,
    'security',
    jsonb_build_object('user_id', p_user_id, 'status', p_status)
  );
end;
$$;

revoke all on function public.update_tenant_settings(uuid, uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.create_tenant_team(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_department_membership(uuid, uuid, uuid, uuid, public.membership_status) from public, anon, authenticated;
grant execute on function public.update_tenant_settings(uuid, uuid, text, text, boolean, boolean) to service_role;
grant execute on function public.create_tenant_team(uuid, uuid, uuid, text) to service_role;
grant execute on function public.set_department_membership(uuid, uuid, uuid, uuid, public.membership_status) to service_role;

commit;
