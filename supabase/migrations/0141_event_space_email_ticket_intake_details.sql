begin;

-- Keep the e-mail form's seven positive requirements distinct. This extends the
-- existing allow-list without changing historic request rows or task templates.
alter table public.event_space_request_equipment
  drop constraint if exists event_space_request_equipment_equipment_key_check;

alter table public.event_space_request_equipment
  add constraint event_space_request_equipment_equipment_key_check
  check (
    equipment_key in (
      'ict_material', 'internet_access', 'sobe_network_access',
      'projector', 'connections', 'display', 'audio', 'videocall',
      'microphones', 'screen', 'reception_laptop'
    )
  );

-- E-mail tickets are persisted atomically. Exact room names remain preferred;
-- the Edge Function may pass a uniquely identified active room. Only positive
-- form requirements become request equipment and checklist entries.
create or replace function public.create_event_space_email_ticket_request(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_order_number text,
  p_title text,
  p_organizer text,
  p_space_id uuid,
  p_requested_space_text text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_equipment_keys text[],
  p_room_reservation_requested boolean,
  p_ict_material_requested boolean,
  p_internet_access_requested boolean,
  p_sobe_network_access_requested boolean,
  p_reception_laptop_requested boolean,
  p_remarks text,
  p_sharepoint_url text,
  p_phone_number text,
  p_clarification_reasons text[]
)
returns table(request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
  v_existing_status text;
  v_status text := 'planned';
  v_request_id uuid;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
  v_equipment_key text;
  v_reasons text[] := coalesce(p_clarification_reasons, array[]::text[]);
begin
  if p_tenant_id is null or p_ticket_id is null
    or p_title is null or char_length(btrim(p_title)) not between 3 and 240
    or (p_remarks is not null and char_length(p_remarks) > 4000) then
    raise exception 'Invalid event-space e-mail intake' using errcode = '22023';
  end if;

  perform 1
  from public.event_space_ticket_intake_outbox outbox
  where outbox.ticket_id = p_ticket_id
    and outbox.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Event-space ticket intake is unavailable' using errcode = '23503';
  end if;

  select request.id, request.status into v_existing_id, v_existing_status
  from public.event_space_requests request
  where request.tenant_id = p_tenant_id
    and request.source_ticket_id = p_ticket_id;
  if v_existing_id is not null then
    update public.event_space_ticket_intake_outbox
    set status = 'processed', last_error_code = null,
        processed_at = timezone('utc', now()), retry_lease_expires_at = null,
        updated_at = timezone('utc', now())
    where ticket_id = p_ticket_id and tenant_id = p_tenant_id;
    return query select v_existing_id, v_existing_status;
    return;
  end if;

  if not exists (
    select 1 from public.tickets ticket
    where ticket.id = p_ticket_id
      and ticket.tenant_id = p_tenant_id
      and ticket.source = 'email'
  ) then
    raise exception 'Event-space source ticket is unavailable' using errcode = '23503';
  end if;

  if p_space_id is null then
    v_reasons := array_append(v_reasons, 'room_not_matched');
  elsif not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    v_reasons := array_append(v_reasons, 'room_unavailable');
  end if;

  if p_starts_at is null or p_ends_at is null
    or p_ends_at - p_starts_at <> interval '30 minutes' then
    v_reasons := array_append(v_reasons, 'start_time_invalid');
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_equipment_keys, array[]::text[])) as equipment(equipment_key)
    where equipment.equipment_key not in (
      'ict_material', 'internet_access', 'sobe_network_access',
      'projector', 'connections', 'display', 'audio', 'videocall',
      'microphones', 'screen', 'reception_laptop'
    )
  ) then
    v_reasons := array_append(v_reasons, 'equipment_invalid');
  end if;

  v_reasons := array(
    select distinct reason from unnest(v_reasons) as reason where reason <> ''
  );
  if coalesce(cardinality(v_reasons), 0) > 0 then
    v_status := 'clarification_required';
  else
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:event-space:room:' || p_tenant_id::text || ':' || p_space_id::text, 0)
    );
    for v_equipment_key in
      select distinct equipment_key
      from unnest(coalesce(p_equipment_keys, array[]::text[])) as item(equipment_key)
      order by equipment_key
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('nextdesk:event-space:equipment:' || p_tenant_id::text || ':' || v_equipment_key, 0)
      );
    end loop;

    select count(distinct request.id) into v_room_conflicts
    from public.event_space_requests request
    where request.tenant_id = p_tenant_id
      and request.space_id = p_space_id
      and request.status not in ('completed', 'clarification_required')
      and request.starts_at < p_ends_at
      and request.ends_at > p_starts_at;

    select count(distinct request.id) into v_equipment_conflicts
    from public.event_space_requests request
    join public.event_space_request_equipment equipment
      on equipment.request_id = request.id
     and equipment.tenant_id = request.tenant_id
     and equipment.equipment_key = any(coalesce(p_equipment_keys, array[]::text[]))
    where request.tenant_id = p_tenant_id
      and request.status not in ('completed', 'clarification_required')
      and request.starts_at < p_ends_at
      and request.ends_at > p_starts_at;

    if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
      v_reasons := array_remove(array[
        case when v_room_conflicts > 0 then 'room_conflict' end,
        case when v_equipment_conflicts > 0 then 'equipment_conflict' end
      ], null);
      v_status := 'clarification_required';
    end if;
  end if;

  insert into public.event_space_requests (
    tenant_id, space_id, title, organizer, starts_at, ends_at,
    status, recurrence_kind, series_id, series_index, conflicts_acknowledged,
    intake_source, source_ticket_id, source_order_number, requested_space_text,
    requested_starts_at, requested_ends_at, requested_equipment_keys,
    clarification_reasons, room_reservation_requested, ict_material_requested,
    internet_access_requested, sobe_network_access_requested,
    reception_laptop_requested, remarks, sharepoint_url, phone_number
  ) values (
    p_tenant_id,
    case when v_status = 'planned' then p_space_id else null end,
    btrim(p_title), nullif(btrim(p_organizer), ''),
    case when v_status = 'planned' then p_starts_at else null end,
    case when v_status = 'planned' then p_ends_at else null end,
    v_status, 'none', null, 1, false,
    'email_ticket', p_ticket_id, nullif(btrim(p_order_number), ''),
    nullif(btrim(p_requested_space_text), ''), p_starts_at, p_ends_at,
    coalesce(p_equipment_keys, array[]::text[]), v_reasons,
    coalesce(p_room_reservation_requested, false),
    coalesce(p_ict_material_requested, false),
    coalesce(p_internet_access_requested, false),
    coalesce(p_sobe_network_access_requested, false),
    coalesce(p_reception_laptop_requested, false),
    nullif(p_remarks, ''),
    case when v_status = 'planned' then nullif(p_sharepoint_url, '') else null end,
    case when v_status = 'planned' then nullif(btrim(p_phone_number), '') else null end
  ) returning id into v_request_id;

  if v_status = 'planned' then
    insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key)
    select p_tenant_id, v_request_id, equipment_key
    from (
      select distinct equipment_key
      from unnest(coalesce(p_equipment_keys, array[]::text[])) as item(equipment_key)
    ) as requested;

    insert into public.event_space_tasks (
      tenant_id, request_id, template_id, title, position
    )
    select p_tenant_id, v_request_id, null, requirement.task_label, requirement.position
    from (values
      ('ict_material'::text, 'ICT Material bereitstellen'::text, 10),
      ('internet_access'::text, 'Internetzugang prüfen'::text, 20),
      ('sobe_network_access'::text, 'SOBE-Netzwerkzugang prüfen'::text, 30),
      ('projector'::text, 'Beamer bereitstellen'::text, 40),
      ('screen'::text, 'Leinwand bereitstellen'::text, 50),
      ('microphones'::text, 'Mikrofon bereitstellen'::text, 60),
      ('reception_laptop'::text, 'Empfangslaptop bereitstellen'::text, 70)
    ) as requirement(equipment_key, task_label, position)
    where requirement.equipment_key = any(coalesce(p_equipment_keys, array[]::text[]))
    order by requirement.position;
  end if;

  update public.event_space_ticket_intake_outbox
  set status = 'processed', last_error_code = null,
      processed_at = timezone('utc', now()), retry_lease_expires_at = null,
      updated_at = timezone('utc', now())
  where ticket_id = p_ticket_id and tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, null, 'event_spaces.email_ticket_intake.created',
    'event_space_request', v_request_id, 'info',
    jsonb_build_object(
      'hasClarification', v_status = 'clarification_required',
      'hasEquipment', coalesce(cardinality(p_equipment_keys), 0) > 0,
      'hasRemarks', nullif(p_remarks, '') is not null,
      'source', 'email_ticket'
    )
  );

  return query select v_request_id, v_status;
end;
$$;

-- Resolving an existing clarification applies exactly the same requested
-- equipment and dynamic checklist. The Edge Function verifies the selected
-- internal agent before calling this service-role-only operation.
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
  v_starts_at timestamptz;
  v_ends_at timestamptz;
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

  v_starts_at := p_starts_at;
  v_ends_at := p_ends_at;
  if v_starts_at is null or v_ends_at is null
    or v_ends_at - v_starts_at <> interval '30 minutes' then
    raise exception 'Event-space clarification still lacks a valid 30-minute time' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_responsible_user_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id and space.tenant_id = p_tenant_id and space.active
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
    and request.starts_at < v_ends_at
    and request.ends_at > v_starts_at;

  select count(distinct request.id) into v_equipment_conflicts
  from public.event_space_requests request
  join public.event_space_request_equipment equipment
    on equipment.request_id = request.id
   and equipment.tenant_id = request.tenant_id
   and equipment.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < v_ends_at
    and request.ends_at > v_starts_at;
  if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
    return query select false;
    return;
  end if;

  update public.event_space_requests
  set space_id = p_space_id,
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      requested_starts_at = v_starts_at,
      requested_ends_at = v_ends_at,
      responsible_user_id = p_responsible_user_id,
      status = 'planned',
      clarification_reasons = array[]::text[]
  where id = p_request_id and tenant_id = p_tenant_id;

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

revoke all on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) from public, anon, authenticated;

grant execute on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) to service_role;

revoke all on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) to service_role;

commit;
