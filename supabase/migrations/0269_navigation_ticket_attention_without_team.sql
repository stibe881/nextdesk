-- The «Tickets» menu badge counts only open tickets without a team and
-- without an agent (that nobody is responsible for yet), readable by the
-- caller. Security cases, merged tickets and the trash are left out.
create or replace function public.navigation_ticket_attention(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_unassigned integer := 0;
  v_security integer := 0;
begin
  if auth.uid() is null or not public.is_tenant_ticket_agent(p_tenant_id) then
    return jsonb_build_object('unassignedTickets', 0, 'securityTriage', 0);
  end if;

  select count(*) into v_unassigned
  from public.tickets ticket
  join public.ticket_statuses status
    on status.id = ticket.status_id and not status.is_closed
  where ticket.tenant_id = p_tenant_id
    and ticket.assigned_agent_id is null
    and ticket.assigned_team_id is null
    and ticket.deleted_at is null
    and ticket.merged_into_ticket_id is null
    and not ticket.is_security_case
    and public.can_read_ticket(ticket.id);

  select count(*) into v_security
  from public.security_cases security_case
  join public.tickets ticket on ticket.id = security_case.ticket_id
  where security_case.tenant_id = p_tenant_id
    and security_case.state = 'triage'
    and ticket.deleted_at is null
    and public.can_read_ticket(security_case.ticket_id);

  return jsonb_build_object(
    'unassignedTickets', v_unassigned,
    'securityTriage', v_security
  );
end;
$$;

revoke all on function public.navigation_ticket_attention(uuid) from public, anon;
grant execute on function public.navigation_ticket_attention(uuid) to authenticated;
