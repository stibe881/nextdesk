begin;

-- Private ledger writer shared only by the service-only command RPCs below.
-- It validates all rows, acquires deterministic advisory locks, updates the
-- private balance projection, then appends the event and immutable lines in
-- the same transaction. There is intentionally no client-supplied note or
-- free-text reference in this interface.
create or replace function public.inventory_apply_event(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_client_request_id uuid,
  p_event_type text,
  p_lines jsonb,
  p_reference_type text,
  p_reference_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_event_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_serial_unit_id uuid;
  v_physical_delta numeric;
  v_reserved_delta numeric;
  v_item public.inventory_items%rowtype;
  v_location public.inventory_locations%rowtype;
  v_serial public.inventory_serial_units%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_delta record;
  v_new_physical numeric;
  v_new_reserved numeric;
begin
  if p_tenant_id is null or p_actor_id is null or p_client_request_id is null
     or p_event_type is null
     or p_event_type not in (
       'movement_receipt', 'movement_issue', 'movement_transfer', 'movement_adjustment',
       'reservation_hold', 'reservation_release', 'count_adjustment'
     )
     or (p_reference_type is null) <> (p_reference_id is null)
     or (p_reference_type is not null and p_reference_type not in ('reservation', 'inventory_count')) then
    raise exception 'Invalid inventory event request' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Inventory event requires at least one line' using errcode = '22023';
  end if;

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id
    and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type is distinct from p_event_type
       or v_existing.reference_type is distinct from p_reference_type
       or v_existing.reference_id is distinct from p_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  -- Validate every line before mutating any balance. Count reconciliation keeps
  -- a zero-delta line as an immutable observation for each recorded count line.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Inventory event line must be an object' using errcode = '22023';
    end if;
    v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
    v_location_id := nullif(v_line ->> 'location_id', '')::uuid;
    v_serial_unit_id := nullif(v_line ->> 'serial_unit_id', '')::uuid;
    v_physical_delta := coalesce(nullif(v_line ->> 'physical_delta', '')::numeric, 0);
    v_reserved_delta := coalesce(nullif(v_line ->> 'reserved_delta', '')::numeric, 0);
    if v_item_id is null or v_location_id is null
       or v_physical_delta <> trunc(v_physical_delta, 3)
       or v_reserved_delta <> trunc(v_reserved_delta, 3)
       or abs(v_physical_delta) > 999999999999999.999
       or abs(v_reserved_delta) > 999999999999999.999
       or ((v_physical_delta <> 0 or v_reserved_delta <> 0) = false and p_event_type <> 'count_adjustment') then
      raise exception 'Invalid inventory event line' using errcode = '22023';
    end if;

    select * into v_item
    from public.inventory_items
    where id = v_item_id and tenant_id = p_tenant_id
    for key share;
    if not found or (not v_item.active and p_event_type not in ('reservation_release', 'count_adjustment')) then
      raise exception 'Inventory item is unavailable' using errcode = 'P0002';
    end if;

    select * into v_location
    from public.inventory_locations
    where id = v_location_id and tenant_id = p_tenant_id
    for key share;
    if not found or (not v_location.active and p_event_type not in ('reservation_release', 'count_adjustment')) then
      raise exception 'Inventory location is unavailable' using errcode = 'P0002';
    end if;

    -- Serial-tracked stock has no aggregate fallback: every ledger line must
    -- identify an existing serial unit and may affect at most that one unit.
    if v_item.tracking_mode = 'serial'
       and (
         v_serial_unit_id is null
         or v_physical_delta not in (-1, 0, 1)
         or v_reserved_delta not in (-1, 0, 1)
       ) then
      raise exception 'Serial-tracked inventory event lines require a serial unit and unit deltas' using errcode = '22023';
    end if;

    if v_serial_unit_id is not null then
      select * into v_serial
      from public.inventory_serial_units
      where id = v_serial_unit_id
        and tenant_id = p_tenant_id
        and item_id = v_item_id
        and active
      for key share;
      if not found then
        raise exception 'Inventory serial unit is unavailable for this item' using errcode = 'P0002';
      end if;
      if v_item.tracking_mode <> 'serial' then
        raise exception 'Invalid serial-unit inventory event line' using errcode = '22023';
      end if;
    elsif v_item.tracking_mode = 'quantity' then
      -- Quantity-tracked items must never acquire a serial link accidentally.
      null;
    end if;
  end loop;

  -- Acquire all tenant/item/location locks in deterministic order before any
  -- balance projection is inspected or updated.
  for v_delta in
    select distinct
      (value ->> 'item_id')::uuid as item_id,
      (value ->> 'location_id')::uuid as location_id
    from jsonb_array_elements(p_lines)
    order by 1, 2
  loop
    perform public.inventory_lock_balance(p_tenant_id, v_delta.item_id, v_delta.location_id);
  end loop;

  v_event_id := null;
  insert into public.inventory_events (
    tenant_id, client_request_id, event_type, actor_id, reference_type, reference_id
  ) values (
    p_tenant_id, p_client_request_id, p_event_type, p_actor_id, p_reference_type, p_reference_id
  ) on conflict (tenant_id, client_request_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    select * into v_existing
    from public.inventory_events
    where tenant_id = p_tenant_id
      and client_request_id = p_client_request_id
    for key share;
    if not found
       or v_existing.event_type is distinct from p_event_type
       or v_existing.reference_type is distinct from p_reference_type
       or v_existing.reference_id is distinct from p_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  for v_delta in
    select
      (value ->> 'item_id')::uuid as item_id,
      (value ->> 'location_id')::uuid as location_id,
      sum(coalesce(nullif(value ->> 'physical_delta', '')::numeric, 0)) as physical_delta,
      sum(coalesce(nullif(value ->> 'reserved_delta', '')::numeric, 0)) as reserved_delta
    from jsonb_array_elements(p_lines)
    group by 1, 2
    order by 1, 2
  loop
    insert into public.inventory_stock_balances (tenant_id, item_id, location_id)
    values (p_tenant_id, v_delta.item_id, v_delta.location_id)
    on conflict (tenant_id, item_id, location_id) do nothing;

    select * into v_balance
    from public.inventory_stock_balances
    where tenant_id = p_tenant_id
      and item_id = v_delta.item_id
      and location_id = v_delta.location_id
    for update;

    v_new_physical := v_balance.physical_quantity + v_delta.physical_delta;
    v_new_reserved := v_balance.reserved_quantity + v_delta.reserved_delta;
    if v_new_physical < 0 or v_new_reserved < 0 or v_new_reserved > v_new_physical then
      raise exception 'Inventory balance cannot become negative or over-reserved' using errcode = '23514';
    end if;

    update public.inventory_stock_balances
    set physical_quantity = v_new_physical,
        reserved_quantity = v_new_reserved,
        updated_at = timezone('utc', now())
    where tenant_id = p_tenant_id
      and item_id = v_delta.item_id
      and location_id = v_delta.location_id;
  end loop;

  insert into public.inventory_event_lines (
    tenant_id, event_id, item_id, location_id, serial_unit_id, physical_delta, reserved_delta
  )
  select
    p_tenant_id,
    v_event_id,
    (value ->> 'item_id')::uuid,
    (value ->> 'location_id')::uuid,
    nullif(value ->> 'serial_unit_id', '')::uuid,
    coalesce(nullif(value ->> 'physical_delta', '')::numeric, 0),
    coalesce(nullif(value ->> 'reserved_delta', '')::numeric, 0)
  from jsonb_array_elements(p_lines);

  return v_event_id;
end;
$$;

commit;
