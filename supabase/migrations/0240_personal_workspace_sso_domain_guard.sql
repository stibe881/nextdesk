-- Self-registration: a new workspace is only created for people who were not
-- invited and whose e-mail domain has no organisation with active SSO. Until
-- now only organisations that enforce SSO blocked a private workspace.

create or replace function public.provision_personal_workspace(
  p_user_id uuid,
  p_email text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_domain text := lower(split_part(coalesce(p_email, ''), '@', 2));
  v_slug text;
  v_department_id uuid;
  v_tenant_admin_role_id uuid;
  v_agent_role_id uuid;
  v_requester_role_id uuid;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown account' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Invalid workspace name' using errcode = '22023';
  end if;

  -- A person whose e-mail domain belongs to an organisation with active SSO
  -- joins that organisation through SSO instead of opening a new workspace,
  -- whether or not the organisation enforces SSO.
  if v_domain <> '' and exists (
    select 1
    from public.tenant_sso_allowed_domains domain_binding
    join public.tenant_sso_configurations sso
      on sso.tenant_id = domain_binding.tenant_id
    where domain_binding.domain = v_domain
      and sso.enabled
  ) then
    raise exception 'This e-mail domain belongs to an organisation with SSO'
      using errcode = '42501';
  end if;

  -- Serialise concurrent requests of the same person.
  perform pg_advisory_xact_lock(hashtextextended('personal-workspace:' || p_user_id::text, 0));

  if exists (
    select 1 from public.tenants
    where owner_user_id = p_user_id and workspace_kind = 'personal'
  ) then
    raise exception 'A personal workspace already exists' using errcode = '23505';
  end if;

  v_slug := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  insert into public.user_profiles (id) values (p_user_id)
  on conflict (id) do nothing;

  insert into public.tenants (slug, name, workspace_kind, owner_user_id)
  values (v_slug, v_name, 'personal', p_user_id)
  returning id into v_tenant_id;
  insert into public.tenant_settings (tenant_id, portal_name)
  values (v_tenant_id, left(v_name || ' Support', 160));
  insert into public.tenant_branding (tenant_id) values (v_tenant_id);
  insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
  values (v_tenant_id, p_user_id, 'active', timezone('utc', now()));

  -- The same standard roles as an operator-provisioned organisation. Later
  -- permission triggers on public.roles keep them complete.
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
    'ticket.comment.external', 'department.manage', 'team.manage', 'user.manage', 'role.manage',
    'report.read', 'automation.manage', 'knowledge.manage', 'asset.manage', 'tenant.settings.manage'
  ]::text[]) as permission_code
  on conflict do nothing;
  insert into public.role_permissions (role_id, permission_code)
  select v_agent_role_id, permission_code
  from unnest(array[
    'ticket.read.assigned', 'ticket.read.department', 'ticket.update', 'ticket.assign',
    'ticket.close', 'ticket.internal_notes.read', 'ticket.internal_notes.write', 'ticket.comment.external'
  ]::text[]) as permission_code
  on conflict do nothing;
  insert into public.role_permissions (role_id, permission_code)
  values (v_requester_role_id, 'ticket.create'), (v_requester_role_id, 'ticket.read.own')
  on conflict do nothing;

  insert into public.departments (tenant_id, key, name, kind)
  values (v_tenant_id, 'support', 'Support', 'ict')
  returning id into v_department_id;
  insert into public.department_memberships (department_id, tenant_id, user_id, status)
  values (v_department_id, v_tenant_id, p_user_id, 'active');

  insert into public.user_role_assignments (tenant_id, user_id, role_id, assigned_by)
  values (v_tenant_id, p_user_id, v_tenant_admin_role_id, p_user_id);
  insert into public.user_role_assignments (tenant_id, user_id, role_id, department_id, assigned_by)
  values (v_tenant_id, p_user_id, v_agent_role_id, v_department_id, p_user_id);

  insert into public.platform_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_user_id, 'tenant.personal_workspace_created', 'tenant', v_tenant_id,
    jsonb_build_object('slug', v_slug));

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_personal_workspace(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_personal_workspace(uuid, text, text)
  to service_role;
