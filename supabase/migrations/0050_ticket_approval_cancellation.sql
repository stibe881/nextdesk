begin;

-- Ein Freigabeantrag kann kontrolliert abgebrochen werden. Die Funktion läuft
-- ausschliesslich mit Service Role, prüft den tatsächlichen Akteur jedoch erneut
-- gegen Mandant, Ticketabteilung und ursprüngliche Antragstellung.
create or replace function public.cancel_ticket_approval(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.ticket_approval_requests%rowtype;
  v_department_id uuid;
  v_can_cancel boolean := false;
begin
  if p_actor_id is null or p_tenant_id is null or p_approval_id is null then
    raise exception 'invalid_ticket_approval_cancellation' using errcode = '22023';
  end if;

  select request.*
  into v_request
  from public.ticket_approval_requests request
  where request.id = p_approval_id
    and request.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_approval_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'ticket_approval_not_pending' using errcode = '22023';
  end if;

  select ticket.department_id
  into v_department_id
  from public.tickets ticket
  where ticket.id = v_request.ticket_id
    and ticket.tenant_id = p_tenant_id
  for share;
  if not found then
    raise exception 'ticket_approval_ticket_not_found' using errcode = 'P0002';
  end if;

  v_can_cancel := v_request.requested_by = p_actor_id
    or public.user_has_ticket_permission_for(
      p_actor_id,
      p_tenant_id,
      v_department_id,
      'ticket.approval.request'
    );
  if not v_can_cancel then
    raise exception 'ticket_approval_cancellation_denied' using errcode = '42501';
  end if;

  update public.ticket_approval_requests
  set status = 'cancelled',
      decided_at = timezone('utc', now())
  where id = p_approval_id
    and tenant_id = p_tenant_id;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_request.ticket_id,
    p_actor_id,
    'ticket.approval.cancelled',
    jsonb_build_object('approvalId', p_approval_id)
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'ticket.approval.cancelled',
    'ticket_approval_request',
    p_approval_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('ticketId', v_request.ticket_id)
  );

  return jsonb_build_object(
    'approvalId', p_approval_id,
    'status', 'cancelled'
  );
end;
$$;

revoke all on function public.cancel_ticket_approval(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_ticket_approval(uuid, uuid, uuid) to service_role;

comment on function public.cancel_ticket_approval(uuid, uuid, uuid) is
  'Bricht eine offene Ticketfreigabe atomar, mandanten- und abteilungsgeprüft ab.';

commit;
