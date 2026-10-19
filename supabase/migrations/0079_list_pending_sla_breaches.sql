begin;

create or replace function public.list_pending_sla_breaches(
  p_kind text,
  p_limit integer
)
returns table(
  id uuid,
  tenant_id uuid,
  department_id uuid,
  ticket_number text,
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  assigned_agent_id uuid,
  escalation_level smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_kind is null or p_kind not in ('response', 'resolution') then
    raise exception 'unsupported SLA breach kind' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'SLA breach limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  select
    ticket.id,
    ticket.tenant_id,
    ticket.department_id,
    ticket.ticket_number,
    ticket.response_due_at,
    ticket.resolution_due_at,
    ticket.first_responded_at,
    ticket.assigned_agent_id,
    ticket.escalation_level
  from public.tickets as ticket
  join public.tenant_feature_flags as feature
   on feature.tenant_id = ticket.tenant_id
   and feature.feature_key = 'automation.sla'
   and feature.enabled
   and (feature.pilot_ends_at is null or feature.pilot_ends_at > v_now)
  where ticket.closed_at is null
    and (
      (p_kind = 'response'
        and ticket.first_responded_at is null
        and ticket.response_due_at is not null
        and ticket.response_due_at <= v_now
        and not exists (
          select 1
          from public.ticket_sla_events as event
          where event.ticket_id = ticket.id
            and event.event_type = 'response_breached'
        ))
      or
      (p_kind = 'resolution'
        and ticket.resolution_due_at is not null
        and ticket.resolution_due_at <= v_now
        and not exists (
          select 1
          from public.ticket_sla_events as event
          where event.ticket_id = ticket.id
            and event.event_type = 'resolution_breached'
        ))
    )
  order by
    case when p_kind = 'response' then ticket.response_due_at else ticket.resolution_due_at end asc,
    ticket.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_pending_sla_breaches(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_pending_sla_breaches(text, integer)
  to service_role;

commit;
