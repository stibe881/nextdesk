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
