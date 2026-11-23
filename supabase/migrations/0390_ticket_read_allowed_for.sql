begin;

-- Geschwindigkeit: Die Edge Function «ticket-operations» prüfte die
-- Leseberechtigung mit bis zu acht Anfragen nacheinander (Mitgliedschaft,
-- Rollen, Team, Kunde, Mitarbeitende, Stellvertretung). Diese Funktion
-- bildet genau dieselbe Prüfung in einer Abfrage ab.

-- Wie hasPermission() der Function: aktive Abteilungsmitgliedschaft und eine
-- gültige, aktive Rolle (Mandant oder dieselbe Abteilung) mit dem Recht.
create or replace function public.ticket_permission_for_user(
  p_user_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
      select 1
        from public.department_memberships dm
       where dm.tenant_id = p_tenant_id
         and dm.department_id = p_department_id
         and dm.user_id = p_user_id
         and dm.status = 'active'
    )
    and exists (
      select 1
        from public.user_role_assignments assignment
        join public.roles role
          on role.id = assignment.role_id
         and role.tenant_id = assignment.tenant_id
        join public.role_permissions permission
          on permission.role_id = role.id
         and permission.permission_code = p_permission_code
       where assignment.tenant_id = p_tenant_id
         and assignment.user_id = p_user_id
         and assignment.starts_at <= timezone('utc', now())
         and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
         and role.tenant_id = p_tenant_id
         and role.active
         and (role.scope = 'tenant' or (role.scope = 'department' and assignment.department_id = p_department_id))
    );
$$;

create or replace function public.ticket_read_allowed_for(p_user_id uuid, p_ticket_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets;
begin
  if p_user_id is null or p_ticket_id is null then
    return false;
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
     where membership.tenant_id = v_ticket.tenant_id
       and membership.user_id = p_user_id
       and membership.status = 'active'
  ) then
    return false;
  end if;
  if v_ticket.requester_id = p_user_id or v_ticket.affected_user_id = p_user_id then
    return true;
  end if;
  if v_ticket.assigned_agent_id = p_user_id
     and public.ticket_permission_for_user(p_user_id, v_ticket.tenant_id, v_ticket.department_id, 'ticket.read.assigned')
     and coalesce(public.can_user_access_ticket_team(p_ticket_id => v_ticket.id, p_user_id => p_user_id), false) then
    return true;
  end if;
  if public.ticket_permission_for_user(p_user_id, v_ticket.tenant_id, v_ticket.department_id, 'ticket.read.department')
     and coalesce(public.can_user_access_ticket_team(p_ticket_id => v_ticket.id, p_user_id => p_user_id), false) then
    return true;
  end if;
  if v_ticket.customer_organization_id is not null and (
    select count(*) = 1
           and bool_and(membership.access = 'company' and organization.active and organization.ticket_access <> 'disabled')
      from public.customer_memberships membership
      join public.customer_organizations organization
        on organization.id = membership.customer_organization_id
     where membership.customer_organization_id = v_ticket.customer_organization_id
       and membership.user_id = p_user_id
  ) then
    return true;
  end if;
  if coalesce(public.employee_can_read_ticket_for(p_user_id, v_ticket.id), false) then
    return true;
  end if;
  return coalesce(public.delegate_can_read_ticket_for(p_user_id, v_ticket.id), false);
end;
$$;

revoke all on function public.ticket_permission_for_user(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ticket_permission_for_user(uuid, uuid, uuid, text) to service_role;
revoke all on function public.ticket_read_allowed_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_read_allowed_for(uuid, uuid) to service_role;

commit;
