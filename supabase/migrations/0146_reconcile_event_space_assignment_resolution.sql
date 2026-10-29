begin;

-- 0141 is being applied after 0145 in production. Restore the later,
-- separated agent assignment implementation after its historical RPC definition.
create or replace function public.resolve_event_space_email_ticket_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_space_id uuid,
  p_responsible_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_actor_id uuid
)
returns table(resolved boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.event_space_requests%rowtype;
  v_equipment_key text;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
begin
  select request.* into v_request
  from public.event_space_requests request
  where request.id = p_request_id
    and request.tenant_id = p_tenant_id
    and request.intake_source = 'email_ticket'
    and request.status = 'clarification_required'
  for update;
  if not found then
    raise exception 'Event-space clarification request is unavailable' using errcode = 'P0002';
  end if;
  if p_starts_at is null or p_ends_at is null
    or p_ends_at - p_starts_at <> interval '30 minutes' then
    raise exception 'Event-space clarification still lacks a valid 30-minute time' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    raise exception 'Event-space resolution target is unavailable' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nextdesk:event-space:room:' || p_tenant_id::text || ':' || p_space_id::text, 0)
  );
  for v_equipment_key in
    select distinct equipment_key
    from unnest(coalesce(v_request.requested_equipment_keys, array[]::text[])) as item(equipment_key)
    order by equipment_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:event-space:equipment:' || p_tenant_id::text || ':' || v_equipment_key, 0)
    );
  end loop;

  select count(distinct request.id) into v_room_conflicts
  from public.event_space_requests request
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.space_id = p_space_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at;
  select count(distinct request.id) into v_equipment_conflicts
  from public.event_space_requests request
  join public.event_space_request_equipment equipment
    on equipment.request_id = request.id
   and equipment.tenant_id = request.tenant_id
   and equipment.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at;
  if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
    return query select false;
    return;
  end if;

  update public.event_space_requests
  set space_id = p_space_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      requested_starts_at = p_starts_at,
      requested_ends_at = p_ends_at,
      responsible_user_id = null,
      assigned_agent_id = p_responsible_user_id,
      status = 'planned',
      clarification_reasons = array[]::text[]
  where id = p_request_id
    and tenant_id = p_tenant_id;

  insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key)
  select p_tenant_id, p_request_id, equipment_key
  from (
    select distinct equipment_key
    from unnest(coalesce(v_request.requested_equipment_keys, array[]::text[])) as item(equipment_key)
  ) as requested
  on conflict do nothing;

  insert into public.event_space_tasks (
    tenant_id, request_id, template_id, title, position
  )
  select p_tenant_id, p_request_id, null, requirement.task_label, requirement.position
  from (values
    ('ict_material'::text, 'ICT Material bereitstellen'::text, 10),
    ('internet_access'::text, 'Internetzugang prüfen'::text, 20),
    ('sobe_network_access'::text, 'SOBE-Netzwerkzugang prüfen'::text, 30),
    ('projector'::text, 'Beamer bereitstellen'::text, 40),
    ('screen'::text, 'Leinwand bereitstellen'::text, 50),
    ('microphones'::text, 'Mikrofon bereitstellen'::text, 60),
    ('reception_laptop'::text, 'Empfangslaptop bereitstellen'::text, 70)
  ) as requirement(equipment_key, task_label, position)
  where requirement.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  order by requirement.position
  on conflict (request_id, position) do nothing;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.email_ticket_intake.resolved',
    'event_space_request', p_request_id, 'info', jsonb_build_object('conflictFree', true)
  );
  return query select true;
end;
$$;

revoke all on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) to service_role;

commit;
