begin;

create or replace function public.create_inventory_source_reservation(
  p_tenant_id uuid,
  p_source_kind text,
  p_event_space_request_id uuid,
  p_event_equipment_key text,
  p_onboarding_entry_id uuid,
  p_onboarding_task_id uuid,
  p_rule_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rule public.inventory_source_reservation_rules%rowtype;
  v_mapping_id uuid;
  v_reservation_id uuid;
  v_item_ready boolean;
  v_location_ready boolean;
  v_lines jsonb;
begin
  select * into v_rule
  from public.inventory_source_reservation_rules
  where id = p_rule_id
    and tenant_id = p_tenant_id
    and enabled
  for key share;
  if not found then
    return;
  end if;

  if not public.inventory_management_feature_enabled(p_tenant_id) then
    perform public.record_inventory_source_reservation_exception(
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'feature_disabled', p_actor_id
    );
    return;
  end if;

  select item.active and item.tracking_mode = 'quantity'
  into v_item_ready
  from public.inventory_items item
  where item.id = v_rule.item_id
    and item.tenant_id = p_tenant_id;
  if not coalesce(v_item_ready, false) then
    perform public.record_inventory_source_reservation_exception(
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'item_unavailable', p_actor_id
    );
    return;
  end if;

  select location.active
  into v_location_ready
  from public.inventory_locations location
  where location.id = v_rule.location_id
    and location.tenant_id = p_tenant_id;
  if not coalesce(v_location_ready, false) then
    perform public.record_inventory_source_reservation_exception(
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'location_unavailable', p_actor_id
    );
    return;
  end if;

  if p_actor_id is null then
    perform public.record_inventory_source_reservation_exception(
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'source_unavailable', null
    );
    return;
  end if;

  -- The lock and the durable source/rule key make a repeated trigger delivery
  -- return the original hold instead of creating another reservation.
  perform pg_advisory_xact_lock(hashtextextended(
    'nextdesk:inventory-source-reservation:'
      || p_tenant_id::text || ':' || p_source_kind || ':' || p_rule_id::text || ':'
      || coalesce(p_event_space_request_id, p_onboarding_task_id)::text || ':'
      || coalesce(p_event_equipment_key, ''),
    0
  ));

  if p_source_kind = 'event_space_equipment' then
    select id into v_mapping_id
    from public.inventory_source_reservations
    where tenant_id = p_tenant_id
      and rule_id = v_rule.id
      and source_kind = p_source_kind
      and event_space_request_id = p_event_space_request_id
      and event_equipment_key = p_event_equipment_key
    for key share;
  else
    select id into v_mapping_id
    from public.inventory_source_reservations
    where tenant_id = p_tenant_id
      and rule_id = v_rule.id
      and source_kind = p_source_kind
      and onboarding_task_id = p_onboarding_task_id
    for key share;
  end if;
  if v_mapping_id is not null then
    perform public.record_inventory_source_reservation_exception(
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'duplicate_source', p_actor_id
    );
    return;
  end if;

  begin
    insert into public.inventory_reservations (
      tenant_id, item_id, location_id, quantity, created_by
    ) values (
      p_tenant_id, v_rule.item_id, v_rule.location_id, v_rule.quantity, p_actor_id
    ) returning id into v_reservation_id;

    v_lines := jsonb_build_array(jsonb_build_object(
      'item_id', v_rule.item_id,
      'location_id', v_rule.location_id,
      'serial_unit_id', null,
      'physical_delta', 0,
      'reserved_delta', v_rule.quantity
    ));
    perform public.inventory_apply_event(
      p_tenant_id,
      p_actor_id,
      gen_random_uuid(),
      'reservation_hold',
      v_lines,
      'reservation',
      v_reservation_id
    );

    insert into public.inventory_source_reservations (
      tenant_id, source_kind, event_space_request_id, event_equipment_key,
      onboarding_entry_id, onboarding_task_id, rule_id, item_id, location_id,
      reservation_id
    ) values (
      p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
      p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, v_rule.item_id,
      v_rule.location_id, v_reservation_id
    ) returning id into v_mapping_id;

    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      p_tenant_id, p_actor_id,
      'inventory.source_reservation.created',
      'inventory_source_reservation', v_mapping_id, 'info',
      jsonb_build_object('source_kind', p_source_kind)
    );
  exception
    when check_violation then
      perform public.record_inventory_source_reservation_exception(
        p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
        p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'stock_unavailable', p_actor_id
      );
    when foreign_key_violation then
      perform public.record_inventory_source_reservation_exception(
        p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
        p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'tenant_mismatch', p_actor_id
      );
    when unique_violation then
      perform public.record_inventory_source_reservation_exception(
        p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
        p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'duplicate_source', p_actor_id
      );
    when others then
      perform public.record_inventory_source_reservation_exception(
        p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
        p_onboarding_entry_id, p_onboarding_task_id, v_rule.id, 'reservation_failed', p_actor_id
      );
  end;
end;
$$;

revoke all on function public.create_inventory_source_reservation(
  uuid, text, uuid, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

commit;
