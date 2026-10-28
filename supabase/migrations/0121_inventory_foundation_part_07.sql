begin;

create or replace function public.post_inventory_movement(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_movement_type text,
  p_lines jsonb,
  p_reservation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_event_id uuid;
  v_event_type text;
  v_input jsonb;
  v_event_lines jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_from_location_id uuid;
  v_to_location_id uuid;
  v_serial_unit_id uuid;
  v_quantity numeric;
  v_physical_delta numeric;
  v_reservation public.inventory_reservations%rowtype;
  v_reference_type text;
  v_reference_id uuid;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_movement_type is null
     or p_movement_type not in ('receipt', 'issue', 'transfer', 'adjustment')
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Invalid inventory movement request' using errcode = '22023';
  end if;

  if p_movement_type = 'adjustment' then
    perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.adjust');
  else
    perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');
  end if;

  v_event_type := 'movement_' || p_movement_type;
  v_reference_type := case when p_reservation_id is null then null else 'reservation' end;
  v_reference_id := p_reservation_id;
  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type is distinct from v_event_type
       or v_existing.reference_type is distinct from v_reference_type
       or v_existing.reference_id is distinct from v_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  for v_input in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_input) <> 'object' then
      raise exception 'Inventory movement line must be an object' using errcode = '22023';
    end if;
    v_item_id := nullif(v_input ->> 'item_id', '')::uuid;
    v_serial_unit_id := nullif(v_input ->> 'serial_unit_id', '')::uuid;
    if v_item_id is null then
      raise exception 'Inventory movement item is required' using errcode = '22023';
    end if;

    if p_movement_type in ('receipt', 'issue') then
      v_location_id := nullif(v_input ->> 'location_id', '')::uuid;
      v_quantity := nullif(v_input ->> 'quantity', '')::numeric;
      if v_location_id is null or v_quantity is null or v_quantity <= 0
         or v_quantity <> trunc(v_quantity, 3) then
        raise exception 'Receipt or issue requires a positive location quantity' using errcode = '22023';
      end if;
      v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'location_id', v_location_id,
        'serial_unit_id', v_serial_unit_id,
        'physical_delta', case when p_movement_type = 'receipt' then v_quantity else -v_quantity end,
        'reserved_delta', 0
      ));
    elsif p_movement_type = 'transfer' then
      v_from_location_id := nullif(v_input ->> 'from_location_id', '')::uuid;
      v_to_location_id := nullif(v_input ->> 'to_location_id', '')::uuid;
      v_quantity := nullif(v_input ->> 'quantity', '')::numeric;
      if v_from_location_id is null or v_to_location_id is null
         or v_from_location_id = v_to_location_id
         or v_quantity is null or v_quantity <= 0
         or v_quantity <> trunc(v_quantity, 3) then
        raise exception 'Transfer requires distinct locations and a positive quantity' using errcode = '22023';
      end if;
      -- Transfers intentionally produce an explicit counterbooking pair.
      v_event_lines := v_event_lines || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'location_id', v_from_location_id,
          'serial_unit_id', v_serial_unit_id,
          'physical_delta', -v_quantity,
          'reserved_delta', 0
        ),
        jsonb_build_object(
          'item_id', v_item_id,
          'location_id', v_to_location_id,
          'serial_unit_id', v_serial_unit_id,
          'physical_delta', v_quantity,
          'reserved_delta', 0
        )
      );
    else
      v_location_id := nullif(v_input ->> 'location_id', '')::uuid;
      v_physical_delta := nullif(v_input ->> 'physical_delta', '')::numeric;
      if v_location_id is null or v_physical_delta is null or v_physical_delta = 0
         or v_physical_delta <> trunc(v_physical_delta, 3) then
        raise exception 'Adjustment requires a non-zero physical delta' using errcode = '22023';
      end if;
      v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'location_id', v_location_id,
        'serial_unit_id', v_serial_unit_id,
        'physical_delta', v_physical_delta,
        'reserved_delta', 0
      ));
    end if;
  end loop;

  if p_reservation_id is not null then
    if p_movement_type <> 'issue' or jsonb_array_length(v_event_lines) <> 1 then
      raise exception 'A reservation may only be consumed by one matching issue line' using errcode = '22023';
    end if;
    select * into v_reservation
    from public.inventory_reservations
    where id = p_reservation_id and tenant_id = p_tenant_id
    for update;
    if not found or v_reservation.status <> 'open' then
      raise exception 'Open inventory reservation not found' using errcode = 'P0002';
    end if;
    if (v_event_lines -> 0 ->> 'item_id')::uuid is distinct from v_reservation.item_id
       or (v_event_lines -> 0 ->> 'location_id')::uuid is distinct from v_reservation.location_id
       or (v_event_lines -> 0 ->> 'serial_unit_id')::uuid is distinct from v_reservation.serial_unit_id
       or (v_event_lines -> 0 ->> 'physical_delta')::numeric <> -v_reservation.quantity then
      raise exception 'Issue line does not match the open reservation' using errcode = '23514';
    end if;
    v_event_lines := jsonb_set(
      v_event_lines,
      '{0,reserved_delta}',
      to_jsonb(-v_reservation.quantity),
      true
    );
  end if;

  v_event_id := public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, v_event_type, v_event_lines, v_reference_type, v_reference_id
  );

  if p_reservation_id is not null then
    update public.inventory_reservations
    set status = 'consumed',
        consumed_at = timezone('utc', now()),
        consumed_by = p_actor_id
    where id = p_reservation_id
      and tenant_id = p_tenant_id
      and status = 'open';
    if not found then
      raise exception 'Inventory reservation was not open for consumption' using errcode = '23514';
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.movement.posted', 'inventory_event', v_event_id, 'info',
    jsonb_build_object(
      'type', p_movement_type,
      'count', jsonb_array_length(v_event_lines),
      'reference_type', coalesce(v_reference_type, 'none')
    )
  );
  return v_event_id;
end;
$$;

commit;
