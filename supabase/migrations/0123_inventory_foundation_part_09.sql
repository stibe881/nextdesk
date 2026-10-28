begin;

create or replace function public.record_inventory_count_line(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line_id uuid;
  v_receipt_target_id uuid;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_count_id is null or p_item_id is null
     or p_counted_quantity is null or p_counted_quantity < 0
     or p_counted_quantity <> trunc(p_counted_quantity, 3) then
    raise exception 'Invalid inventory count line' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select target_id into v_receipt_target_id
  from public.inventory_command_receipts
  where tenant_id = p_tenant_id
    and command_type = 'record_inventory_count_line'
    and client_request_id = p_client_request_id
  for key share;
  if found then
    return v_receipt_target_id;
  end if;

  -- The count row lock serializes recording with close, so a late line cannot
  -- arrive after its adjustment event has been calculated.
  select * into v_count
  from public.inventory_counts
  where id = p_count_id and tenant_id = p_tenant_id
  for update;
  if not found or v_count.status <> 'counting' then
    raise exception 'Open inventory count not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.inventory_items
    where id = p_item_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Inventory item not found' using errcode = 'P0002';
  end if;

  insert into public.inventory_count_lines (
    tenant_id, count_id, item_id, counted_quantity, recorded_by, recorded_at
  ) values (
    p_tenant_id, p_count_id, p_item_id, p_counted_quantity, p_actor_id, timezone('utc', now())
  )
  on conflict (count_id, item_id) do update
  set counted_quantity = excluded.counted_quantity,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at
  returning id into v_line_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.count.line_recorded', 'inventory_count_line', v_line_id, 'info',
    jsonb_build_object('type', 'count_line_record', 'count', 1, 'reference_type', 'inventory_count')
  );
  insert into public.inventory_command_receipts (
    tenant_id, command_type, client_request_id, target_id
  ) values (
    p_tenant_id, 'record_inventory_count_line', p_client_request_id, v_line_id
  ) on conflict (tenant_id, command_type, client_request_id) do nothing
  returning target_id into v_receipt_target_id;
  if v_receipt_target_id is null then
    select target_id into v_receipt_target_id
    from public.inventory_command_receipts
    where tenant_id = p_tenant_id
      and command_type = 'record_inventory_count_line'
      and client_request_id = p_client_request_id
    for key share;
  end if;
  return v_receipt_target_id;
end;
$$;


create or replace function public.close_inventory_count(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_count_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line public.inventory_count_lines%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_delta numeric;
  v_event_request_id uuid;
  v_event_lines jsonb;
  v_line_count integer := 0;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_count_id is null then
    raise exception 'Invalid inventory count close request' using errcode = '22023';
  end if;
  -- Count close is intentionally separate from adjustment: only this explicit
  -- permission can turn recorded observations into immutable adjustments.
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.count.close');

  select * into v_count
  from public.inventory_counts
  where id = p_count_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Inventory count not found' using errcode = 'P0002';
  end if;
  if v_count.status = 'closed' then
    if v_count.close_client_request_id is distinct from p_client_request_id then
      raise exception 'Inventory count was already closed by a different request' using errcode = '23505';
    end if;
    return v_count.id;
  end if;
  if v_count.status <> 'counting' then
    raise exception 'Only a counting inventory count may be closed' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_count_lines
    where count_id = p_count_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Inventory count needs at least one recorded line before close' using errcode = '23514';
  end if;

  for v_line in
    select *
    from public.inventory_count_lines
    where count_id = p_count_id and tenant_id = p_tenant_id
    order by item_id
  loop
    -- Take the same item/location lock before reading the current projection;
    -- the event writer reacquires it reentrantly and validates the final state.
    perform public.inventory_lock_balance(p_tenant_id, v_line.item_id, v_count.location_id);
    insert into public.inventory_stock_balances (tenant_id, item_id, location_id)
    values (p_tenant_id, v_line.item_id, v_count.location_id)
    on conflict (tenant_id, item_id, location_id) do nothing;
    select * into v_balance
    from public.inventory_stock_balances
    where tenant_id = p_tenant_id
      and item_id = v_line.item_id
      and location_id = v_count.location_id
    for update;

    v_delta := v_line.counted_quantity - v_balance.physical_quantity;
    -- A deterministic per-line UUID gives every immutable adjustment header a
    -- client_request_id while allowing the close command to be safely retried.
    v_event_request_id := (
      substr(md5(p_client_request_id::text || ':' || v_line.id::text), 1, 8) || '-' ||
      substr(md5(p_client_request_id::text || ':' || v_line.id::text), 9, 4) || '-' ||
      substr(md5(p_client_request_id::text || ':' || v_line.id::text), 13, 4) || '-' ||
      substr(md5(p_client_request_id::text || ':' || v_line.id::text), 17, 4) || '-' ||
      substr(md5(p_client_request_id::text || ':' || v_line.id::text), 21, 12)
    )::uuid;
    v_event_lines := jsonb_build_array(jsonb_build_object(
      'item_id', v_line.item_id,
      'location_id', v_count.location_id,
      'physical_delta', v_delta,
      'reserved_delta', 0
    ));
    -- This creates one count-adjustment event per count line, including an
    -- explicit zero-delta reconciliation line when stock already matches.
    perform public.inventory_apply_event(
      p_tenant_id,
      p_actor_id,
      v_event_request_id,
      'count_adjustment',
      v_event_lines,
      'inventory_count',
      p_count_id
    );
    v_line_count := v_line_count + 1;
  end loop;

  update public.inventory_counts
  set status = 'closed',
      closed_at = timezone('utc', now()),
      closed_by = p_actor_id,
      close_client_request_id = p_client_request_id
  where id = p_count_id and tenant_id = p_tenant_id and status = 'counting';
  if not found then
    raise exception 'Inventory count was not available for close' using errcode = '23514';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.count.closed', 'inventory_count', p_count_id, 'info',
    jsonb_build_object('type', 'count_close', 'count', v_line_count, 'reference_type', 'inventory_count')
  );
  return p_count_id;
end;
$$;


-- Private inventory tables have no browser/mobile policies. The Edge layer
-- invokes the RPCs as service_role after verifying the actor, and each RPC
-- independently re-checks active tenant membership plus the exact capability.
alter table public.inventory_locations enable row level security;

alter table public.inventory_items enable row level security;

alter table public.inventory_item_identifiers enable row level security;

alter table public.inventory_serial_units enable row level security;

alter table public.inventory_events enable row level security;

alter table public.inventory_event_lines enable row level security;

alter table public.inventory_stock_balances enable row level security;

alter table public.inventory_reservations enable row level security;

alter table public.inventory_counts enable row level security;

alter table public.inventory_count_lines enable row level security;

alter table public.inventory_command_receipts enable row level security;

commit;
