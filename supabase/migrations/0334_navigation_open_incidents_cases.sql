-- Navigation: Anzahl-Badges für «Sicherheitsfälle» und «Störungen» zählen alle
-- offenen Fälle bzw. aktiven Störungen (securityOpen, incidentsActive); die
-- bisherigen Zähler (nicht zugewiesen / nicht bestätigt) bleiben für die
-- Einfärbung und die App erhalten.
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
  v_incidents_active integer := 0;
  v_security_open integer := 0;
  v_can_security boolean := false;
  v_can_incidents boolean := false;
begin
  if auth.uid() is null or not public.is_tenant_ticket_agent(p_tenant_id) then
    return jsonb_build_object(
      'unassignedTickets', 0, 'securityTriage', 0, 'incidentsUnacknowledged', 0,
      'securityOpen', 0, 'incidentsActive', 0,
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

  if v_can_security then
    select count(*) into v_security_open
    from public.security_cases security_case
    join public.tickets ticket on ticket.id = security_case.ticket_id
    where security_case.tenant_id = p_tenant_id
      and security_case.state <> 'closed'
      and ticket.deleted_at is null
      and public.can_read_ticket(security_case.ticket_id);
  end if;

  if v_can_incidents then
    select count(*) into v_incidents_active
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = 'active'
      and incident.parent_incident_id is null;

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
    'securityOpen', v_security_open,
    'incidentsActive', v_incidents_active,
    'canWorkSecurityCases', v_can_security,
    'canWorkIncidents', v_can_incidents
  );
end;
$function$;
