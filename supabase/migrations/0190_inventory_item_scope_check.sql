begin;

set local search_path = pg_catalog, public;

-- Inventory items: the department scope check moves into
-- upsert_inventory_item (on the locked row). A create that hits an existing
-- article number of another department, or an edit of an item that was moved
-- to another department meanwhile, fails with SQLSTATE ND409.

drop function if exists public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean, uuid, boolean
);

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
  p_active boolean,
  p_department_id uuid default null,
  p_set_department boolean default false,
  p_allowed_department_ids uuid[] default null
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
  v_department_changed boolean := false;
  v_exists boolean;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_active is null
     or p_set_department is null
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
  v_exists := found;

  -- Department scope of the caller (null = not scoped, e.g. system calls).
  -- Checked here, on the locked row, so a concurrent department change
  -- cannot slip between the edge function's check and this write.
  if v_exists
     and p_allowed_department_ids is not null
     and v_item.department_id is not null
     and not (v_item.department_id = any(p_allowed_department_ids)) then
    raise exception 'Inventory item belongs to another department'
      using errcode = 'ND409';
  end if;

  -- A department that is newly assigned must be an active department of the
  -- tenant. Keeping the current department is always allowed.
  if p_department_id is not null
     and (not v_exists
          or (p_set_department and v_item.department_id is distinct from p_department_id))
     and not exists (
       select 1 from public.departments department
       where department.id = p_department_id
         and department.tenant_id = p_tenant_id
         and department.active
     ) then
    raise exception 'Invalid inventory item department' using errcode = '22023';
  end if;

  if v_exists then
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
    v_department_changed := p_set_department
      and v_item.department_id is distinct from p_department_id;
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
        active = p_active,
        department_id = case when p_set_department then p_department_id else department_id end
    where id = v_item.id and tenant_id = p_tenant_id
    returning * into v_item;
  else
    insert into public.inventory_items (
      tenant_id, article_number, name, category, unit, tracking_mode,
      minimum_quantity, target_quantity, manufacturer, model, supplier, note, active,
      department_id
    ) values (
      p_tenant_id, v_article_number, v_name, v_category, v_unit, p_tracking_mode,
      p_minimum_quantity, p_target_quantity, v_manufacturer, v_model, v_supplier, v_note, p_active,
      p_department_id
    ) returning * into v_item;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.item.upserted', 'inventory_item', v_item.id, 'info',
    jsonb_build_object('type', 'item_upsert', 'count', 1, 'reference_type', 'inventory_item')
      || case when v_department_changed
              then jsonb_build_object('department_changed', true)
              else '{}'::jsonb end
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

revoke all on function public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean, uuid, boolean, uuid[]
) from public, anon, authenticated;
grant execute on function public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean, uuid, boolean, uuid[]
) to service_role;

-- 2. Expiry reminder tickets -------------------------------------------------

-- p_department_id is optional, so calls with the four old parameters keep
-- working. The old signature is dropped to keep calls unambiguous.

commit;
