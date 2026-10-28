begin;

create or replace function public.create_inventory_reservation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_ticket_id uuid default null,
  p_serial_unit_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_reservation_id uuid;
  v_event_id uuid;
  v_lines jsonb;
  v_item public.inventory_items%rowtype;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_item_id is null or p_location_id is null or p_quantity is null
     or p_quantity <= 0 or p_quantity <> trunc(p_quantity, 3) then
    raise exception 'Invalid inventory reservation request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type <> 'reservation_hold'
       or v_existing.reference_type <> 'reservation'
       or v_existing.reference_id is null then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.reference_id;
  end if;

  if p_ticket_id is not null and not exists (
    select 1 from public.tickets
    where id = p_ticket_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Ticket is not available in this tenant' using errcode = 'P0002';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id and tenant_id = p_tenant_id
  for key share;
  if found
     and v_item.tracking_mode = 'serial'
     and (p_serial_unit_id is null or p_quantity <> 1) then
    raise exception 'Serial-tracked inventory reservations require a serial unit and quantity 1' using errcode = '22023';
  end if;

  insert into public.inventory_reservations (
    tenant_id, item_id, location_id, serial_unit_id, quantity, ticket_id, created_by
  ) values (
    p_tenant_id, p_item_id, p_location_id, p_serial_unit_id, p_quantity, p_ticket_id, p_actor_id
  ) returning id into v_reservation_id;

  v_lines := jsonb_build_array(jsonb_build_object(
    'item_id', p_item_id,
    'location_id', p_location_id,
    'serial_unit_id', p_serial_unit_id,
    'physical_delta', 0,
    'reserved_delta', p_quantity
  ));
  v_event_id := public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, 'reservation_hold', v_lines, 'reservation', v_reservation_id
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.reservation.created', 'inventory_reservation', v_reservation_id, 'info',
    jsonb_build_object('type', 'reservation_hold', 'count', 1, 'reference_type', 'reservation')
  );
  return v_reservation_id;
end;
$$;


create or replace function public.release_inventory_reservation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_reservation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_lines jsonb;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_reservation_id is null then
    raise exception 'Invalid inventory reservation release request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type <> 'reservation_release'
       or v_existing.reference_type <> 'reservation'
       or v_existing.reference_id is distinct from p_reservation_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return p_reservation_id;
  end if;

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id and tenant_id = p_tenant_id
  for update;
  if not found or v_reservation.status <> 'open' then
    raise exception 'Open inventory reservation not found' using errcode = 'P0002';
  end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'item_id', v_reservation.item_id,
    'location_id', v_reservation.location_id,
    'serial_unit_id', v_reservation.serial_unit_id,
    'physical_delta', 0,
    'reserved_delta', -v_reservation.quantity
  ));
  perform public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, 'reservation_release', v_lines, 'reservation', p_reservation_id
  );

  update public.inventory_reservations
  set status = 'released',
      released_at = timezone('utc', now()),
      released_by = p_actor_id
  where id = p_reservation_id and tenant_id = p_tenant_id and status = 'open';
  if not found then
    raise exception 'Inventory reservation was not open for release' using errcode = '23514';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.reservation.released', 'inventory_reservation', p_reservation_id, 'info',
    jsonb_build_object('type', 'reservation_release', 'count', 1, 'reference_type', 'reservation')
  );
  return p_reservation_id;
end;
$$;


create or replace function public.start_inventory_count(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_location_id is null then
    raise exception 'Invalid inventory count start request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_count
  from public.inventory_counts
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_count.location_id is distinct from p_location_id then
      raise exception 'client_request_id was already used for a different inventory count' using errcode = '23505';
    end if;
    return v_count.id;
  end if;

  if not exists (
    select 1 from public.inventory_locations
    where id = p_location_id and tenant_id = p_tenant_id and active
  ) then
    raise exception 'Active inventory location not found' using errcode = 'P0002';
  end if;

  insert into public.inventory_counts (
    tenant_id, location_id, status, client_request_id, started_by
  ) values (
    p_tenant_id, p_location_id, 'counting', p_client_request_id, p_actor_id
  ) returning * into v_count;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.count.started', 'inventory_count', v_count.id, 'info',
    jsonb_build_object('type', 'count_start', 'count', 1, 'reference_type', 'inventory_count')
  );
  return v_count.id;
end;
$$;


drop function if exists public.record_inventory_count_line(uuid, uuid, uuid, uuid, numeric);

commit;
