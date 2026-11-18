-- «Störungen» and «Phishing» (security cases) are only for the team that is
-- responsible for them, not for every agent:
-- * Störungen: the team for alarms in the PRTG settings
--   (monitoring_integrations.team_id),
-- * Phishing: the security team in the phishing settings
--   (phishing_report_settings.notify_team_id).
-- Without a team configured, all agents keep access. The edge functions, the
-- navigation counters, the web navigation and the apps use these checks.

create or replace function public.can_work_incidents(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.is_tenant_ticket_agent(p_tenant_id)
    and coalesce(
      (
        select exists (
          select 1 from public.team_memberships membership
           where membership.team_id = integration.team_id
             and membership.user_id = auth.uid()
        )
        from public.monitoring_integrations integration
       where integration.tenant_id = p_tenant_id
         and integration.team_id is not null
       limit 1
      ),
      true
    );
$$;

create or replace function public.can_work_security_cases(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.is_tenant_ticket_agent(p_tenant_id)
    and coalesce(
      (
        select exists (
          select 1 from public.team_memberships membership
           where membership.team_id = settings.notify_team_id
             and membership.user_id = auth.uid()
        )
        from public.phishing_report_settings settings
       where settings.tenant_id = p_tenant_id
         and settings.notify_team_id is not null
       limit 1
      ),
      true
    );
$$;

revoke all on function public.can_work_incidents(uuid) from public, anon;
revoke all on function public.can_work_security_cases(uuid) from public, anon;
grant execute on function public.can_work_incidents(uuid) to authenticated, service_role;
grant execute on function public.can_work_security_cases(uuid) to authenticated, service_role;

create or replace function public.navigation_ticket_attention(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_unassigned integer := 0;
  v_security integer := 0;
  v_incidents integer := 0;
  v_can_security boolean := false;
  v_can_incidents boolean := false;
begin
  if auth.uid() is null or not public.is_tenant_ticket_agent(p_tenant_id) then
    return jsonb_build_object(
      'unassignedTickets', 0, 'securityTriage', 0, 'incidentsUnacknowledged', 0,
      'canWorkSecurityCases', false, 'canWorkIncidents', false
    );
  end if;
  v_can_security := public.can_work_security_cases(p_tenant_id);
  v_can_incidents := public.can_work_incidents(p_tenant_id);

  select count(*) into v_unassigned
  from public.tickets ticket
  join public.ticket_statuses status
    on status.id = ticket.status_id and not status.is_closed
  where ticket.tenant_id = p_tenant_id
    and ticket.assigned_agent_id is null
    and ticket.deleted_at is null
    and ticket.merged_into_ticket_id is null
    and not ticket.is_security_case
    and public.can_read_ticket(ticket.id);

  if v_can_security then
    select count(*) into v_security
    from public.security_cases security_case
    join public.tickets ticket on ticket.id = security_case.ticket_id
    where security_case.tenant_id = p_tenant_id
      and security_case.state <> 'closed'
      and ticket.assigned_agent_id is null
      and ticket.deleted_at is null
      and public.can_read_ticket(security_case.ticket_id);
  end if;

  if v_can_incidents then
    select count(*) into v_incidents
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = 'active'
      and incident.parent_incident_id is null
      and incident.acknowledged_at is null;
  end if;

  return jsonb_build_object(
    'unassignedTickets', v_unassigned,
    'securityTriage', v_security,
    'incidentsUnacknowledged', v_incidents,
    'canWorkSecurityCases', v_can_security,
    'canWorkIncidents', v_can_incidents
  );
end;
$function$;

-- Cases readable through the edge function: also only for the security team.
create or replace function public.security_case_ticket_ids(p_tenant_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select security_case.ticket_id
  from public.security_cases security_case
  where security_case.tenant_id = p_tenant_id
    and public.can_work_security_cases(p_tenant_id)
    and public.can_read_ticket(security_case.ticket_id);
$$;
