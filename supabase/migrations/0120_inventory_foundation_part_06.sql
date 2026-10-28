begin;

create or replace function public.upsert_inventory_item(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_item_id uuid,
  p_article_number text,
  p_name text,
  p_category text,
  p_unit text,
  p_tracking_mode text,
  p_minimum_quantity numeric,
  p_target_quantity numeric,
  p_manufacturer text,
  p_model text,
  p_supplier text,
  p_note text,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_receipt_target_id uuid;
  v_article_number text := lower(btrim(coalesce(p_article_number, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_unit text := lower(btrim(coalesce(p_unit, '')));
  v_manufacturer text := nullif(btrim(p_manufacturer), '');
  v_model text := nullif(btrim(p_model), '');
  v_supplier text := nullif(btrim(p_supplier), '');
  v_note text := nullif(btrim(p_note), '');
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_active is null
     or v_article_number !~ '^[a-z0-9][a-z0-9._/-]{0,159}$'
     or char_length(v_name) not between 1 and 240 or v_name ~ '[[:cntrl:]]'
     or char_length(v_category) not between 1 and 120 or v_category ~ '[[:cntrl:]]'
     or v_unit !~ '^[a-z][a-z0-9_-]{0,31}$'
     or p_tracking_mode is null
     or p_tracking_mode not in ('quantity', 'serial')
     or p_minimum_quantity is null or p_target_quantity is null
     or p_minimum_quantity < 0 or p_target_quantity < p_minimum_quantity
     or p_minimum_quantity <> trunc(p_minimum_quantity, 3)
     or p_target_quantity <> trunc(p_target_quantity, 3)
     or (v_manufacturer is not null and (char_length(v_manufacturer) > 160 or v_manufacturer ~ '[[:cntrl:]]'))
     or (v_model is not null and (char_length(v_model) > 160 or v_model ~ '[[:cntrl:]]'))
     or (v_supplier is not null and (char_length(v_supplier) > 160 or v_supplier ~ '[[:cntrl:]]'))
     or (v_note is not null and (char_length(v_note) > 2000 or v_note ~ '[[:cntrl:]]')) then
    raise exception 'Invalid inventory item' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select target_id into v_receipt_target_id
  from public.inventory_command_receipts
  where tenant_id = p_tenant_id
    and command_type = 'upsert_inventory_item'
    and client_request_id = p_client_request_id
  for key share;
  if found then
    return v_receipt_target_id;
  end if;

  if p_item_id is null then
    select * into v_item
    from public.inventory_items
    where tenant_id = p_tenant_id and article_number = v_article_number
    for update;
  else
    select * into v_item
    from public.inventory_items
    where id = p_item_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'Inventory item not found' using errcode = 'P0002';
    end if;
  end if;

  if found then
    if v_item.tracking_mode <> p_tracking_mode
       and (
         exists (
           select 1 from public.inventory_serial_units
           where tenant_id = p_tenant_id and item_id = v_item.id
         )
         or exists (
           select 1 from public.inventory_event_lines
           where tenant_id = p_tenant_id and item_id = v_item.id
         )
       ) then
      raise exception 'Cannot change tracking mode after serial units or ledger history exist' using errcode = '23514';
    end if;
    update public.inventory_items
    set article_number = v_article_number,
        name = v_name,
        category = v_category,
        unit = v_unit,
        tracking_mode = p_tracking_mode,
        minimum_quantity = p_minimum_quantity,
        target_quantity = p_target_quantity,
        manufacturer = v_manufacturer,
        model = v_model,
        supplier = v_supplier,
        note = v_note,
        active = p_active
    where id = v_item.id and tenant_id = p_tenant_id
    returning * into v_item;
  else
    insert into public.inventory_items (
      tenant_id, article_number, name, category, unit, tracking_mode,
      minimum_quantity, target_quantity, manufacturer, model, supplier, note, active
    ) values (
      p_tenant_id, v_article_number, v_name, v_category, v_unit, p_tracking_mode,
      p_minimum_quantity, p_target_quantity, v_manufacturer, v_model, v_supplier, v_note, p_active
    ) returning * into v_item;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.item.upserted', 'inventory_item', v_item.id, 'info',
    jsonb_build_object('type', 'item_upsert', 'count', 1, 'reference_type', 'inventory_item')
  );
  insert into public.inventory_command_receipts (
    tenant_id, command_type, client_request_id, target_id
  ) values (
    p_tenant_id, 'upsert_inventory_item', p_client_request_id, v_item.id
  ) on conflict (tenant_id, command_type, client_request_id) do nothing
  returning target_id into v_receipt_target_id;
  if v_receipt_target_id is null then
    select target_id into v_receipt_target_id
    from public.inventory_command_receipts
    where tenant_id = p_tenant_id
      and command_type = 'upsert_inventory_item'
      and client_request_id = p_client_request_id
    for key share;
  end if;
  return v_receipt_target_id;
end;
$$;

commit;
