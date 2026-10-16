begin;

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
  ) then
    raise exception 'An enabled platform operator is required' using errcode = '42501';
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
  insert into public.tenant_branding (tenant_id) values (v_tenant_id);
  insert into public.user_profiles (id) values (p_initial_admin_user_id)
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
  values (v_requester_role_id, 'ticket.create'), (v_requester_role_id, 'ticket.read.own');

  for v_department in
    select * from jsonb_to_recordset(p_departments) as item(key text, name text, kind text)
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
  values (p_actor_id, 'tenant.provisioned', 'tenant', v_tenant_id, jsonb_build_object('slug', p_slug));

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_tenant(uuid, citext, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.provision_tenant(uuid, citext, text, uuid, jsonb) to service_role;

commit;
