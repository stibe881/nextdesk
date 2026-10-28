begin;

revoke all on function public.inventory_apply_event(uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon, authenticated;


drop function if exists public.upsert_inventory_location(uuid, uuid, uuid, text, text, boolean);

create or replace function public.upsert_inventory_location(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_location_id uuid,
  p_code text,
  p_name text,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_location public.inventory_locations%rowtype;
  v_receipt_target_id uuid;
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_active is null
     or v_code !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
     or char_length(v_name) not between 1 and 160
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid inventory location' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  -- The xact lock keeps a retry outside the mutation and audit path until its
  -- prior receipt is visible. The receipt primary key remains the durable
  -- tenant-bound deduplication constraint.
  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select target_id into v_receipt_target_id
  from public.inventory_command_receipts
  where tenant_id = p_tenant_id
    and command_type = 'upsert_inventory_location'
    and client_request_id = p_client_request_id
  for key share;
  if found then
    return v_receipt_target_id;
  end if;

  if p_location_id is null then
    select * into v_location
    from public.inventory_locations
    where tenant_id = p_tenant_id and code = v_code
    for update;
    if found then
      update public.inventory_locations
      set name = v_name, active = p_active
      where id = v_location.id and tenant_id = p_tenant_id
      returning * into v_location;
    else
      insert into public.inventory_locations (tenant_id, code, name, active)
      values (p_tenant_id, v_code, v_name, p_active)
      returning * into v_location;
    end if;
  else
    select * into v_location
    from public.inventory_locations
    where id = p_location_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'Inventory location not found' using errcode = 'P0002';
    end if;
    update public.inventory_locations
    set code = v_code, name = v_name, active = p_active
    where id = p_location_id and tenant_id = p_tenant_id
    returning * into v_location;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.location.upserted', 'inventory_location', v_location.id, 'info',
    jsonb_build_object('type', 'location_upsert', 'count', 1, 'reference_type', 'inventory_location')
  );
  insert into public.inventory_command_receipts (
    tenant_id, command_type, client_request_id, target_id
  ) values (
    p_tenant_id, 'upsert_inventory_location', p_client_request_id, v_location.id
  ) on conflict (tenant_id, command_type, client_request_id) do nothing
  returning target_id into v_receipt_target_id;
  if v_receipt_target_id is null then
    select target_id into v_receipt_target_id
    from public.inventory_command_receipts
    where tenant_id = p_tenant_id
      and command_type = 'upsert_inventory_location'
      and client_request_id = p_client_request_id
    for key share;
  end if;
  return v_receipt_target_id;
end;
$$;


drop function if exists public.upsert_inventory_item(uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, boolean);

commit;
