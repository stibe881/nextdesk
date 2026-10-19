begin;

create or replace function public.apply_sla_breach(
  p_ticket_id uuid,
  p_event_type text,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_occurred_at timestamptz;
  v_feature_enabled boolean;
  v_next_level smallint;
  v_due_at timestamptz;
begin
  if p_event_type is null
     or p_event_type not in ('response_breached', 'resolution_breached') then
    raise exception 'unsupported SLA breach event type';
  end if;

  select *
  into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found or v_ticket.closed_at is not null then
    return false;
  end if;

  -- Lock the tenant feature row until the breach transaction commits. A feature
  -- disable or pilot expiry can therefore never race the subsequent writes.
  v_occurred_at := clock_timestamp();
  select feature.enabled
    and (feature.pilot_ends_at is null or feature.pilot_ends_at > v_occurred_at)
  into v_feature_enabled
  from public.tenant_feature_flags as feature
  where feature.tenant_id = v_ticket.tenant_id
    and feature.feature_key = 'automation.sla'
  for share;

  if coalesce(v_feature_enabled, false) is not true then
    return false;
  end if;

  if p_event_type = 'response_breached' then
    if v_ticket.first_responded_at is not null
       or v_ticket.response_due_at is null
       or v_ticket.response_due_at > v_occurred_at then
      return false;
    end if;
    v_due_at := v_ticket.response_due_at;
  else
    if v_ticket.resolution_due_at is null
       or v_ticket.resolution_due_at > v_occurred_at then
      return false;
    end if;
    v_due_at := v_ticket.resolution_due_at;
  end if;

  insert into public.ticket_sla_events (
    ticket_id,
    event_type,
    occurred_at,
    metadata
  )
  values (
    v_ticket.id,
    p_event_type,
    v_occurred_at,
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'dueAt', v_due_at
    )
  )
  on conflict do nothing;

  if not found then
    return false;
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    null,
    'ticket.sla.' || p_event_type,
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'dueAt', v_due_at
    )
  );

  if p_event_type = 'resolution_breached' then
    v_next_level := least(v_ticket.escalation_level + 1, 4);

    update public.tickets
    set escalation_level = v_next_level,
        updated_at = v_occurred_at
    where id = v_ticket.id;

    insert into public.ticket_escalations (
      ticket_id,
      level,
      kind,
      reason,
      opened_by,
      opened_at
    )
    values (
      v_ticket.id,
      v_next_level,
      'sla',
      'SLA-Lösungsziel überschritten.',
      null,
      v_occurred_at
    );
  end if;

  if v_ticket.assigned_agent_id is not null then
    insert into public.ticket_notifications (
      tenant_id,
      user_id,
      ticket_id,
      kind,
      payload
    )
    values (
      v_ticket.tenant_id,
      v_ticket.assigned_agent_id,
      v_ticket.id,
      'ticket.sla.' || p_event_type,
      jsonb_build_object(
        'ticketNumber', v_ticket.ticket_number,
        'dueAt', v_due_at,
        'source', 'sla_automation'
      )
    );
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    v_ticket.tenant_id,
    null,
    'ticket.sla.' || p_event_type,
    'ticket',
    v_ticket.id,
    'security',
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'departmentId', v_ticket.department_id
    )
  );

  return true;
end;
$$;

revoke all on function public.apply_sla_breach(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_sla_breach(uuid, text, uuid) to service_role;

commit;
