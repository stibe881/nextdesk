begin;

create or replace function public.reserve_inventory_from_event_space_equipment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_source_available boolean := false;
  v_rule public.inventory_source_reservation_rules%rowtype;
begin
  if tg_table_schema <> 'public'
    or tg_table_name <> 'event_space_request_equipment'
    or tg_op <> 'INSERT' then
    raise exception 'Unsupported event equipment reservation trigger target' using errcode = '22023';
  end if;

  select request.created_by,
         request.status <> 'completed' and space.active
  into v_actor_id, v_source_available
  from public.event_space_request_equipment equipment
  join public.event_space_requests request
    on request.id = equipment.request_id
    and request.tenant_id = equipment.tenant_id
  join public.event_spaces space
    on space.id = request.space_id
    and space.tenant_id = request.tenant_id
  where equipment.request_id = new.request_id
    and equipment.equipment_key = new.equipment_key
    and equipment.tenant_id = new.tenant_id;

  for v_rule in
    select *
    from public.inventory_source_reservation_rules rule
    where rule.tenant_id = new.tenant_id
      and rule.source_kind = 'event_space_equipment'
      and rule.event_equipment_key = new.equipment_key
      and rule.enabled
    order by rule.id
  loop
    begin
      if not coalesce(v_source_available, false) then
        perform public.record_inventory_source_reservation_exception(
          new.tenant_id, 'event_space_equipment', new.request_id, new.equipment_key,
          null, null, v_rule.id, 'source_unavailable', v_actor_id
        );
      else
        perform public.create_inventory_source_reservation(
          new.tenant_id, 'event_space_equipment', new.request_id, new.equipment_key,
          null, null, v_rule.id, v_actor_id
        );
      end if;
    exception when others then
      begin
        perform public.record_inventory_source_reservation_exception(
          new.tenant_id, 'event_space_equipment', new.request_id, new.equipment_key,
          null, null, v_rule.id, 'reservation_failed', v_actor_id
        );
      exception when others then
        null;
      end;
    end;
  end loop;
  return new;
exception when others then
  begin
    perform public.record_inventory_source_reservation_exception(
      new.tenant_id, 'event_space_equipment', new.request_id, new.equipment_key,
      null, null, null, 'reservation_failed', null
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.reserve_inventory_from_event_space_equipment()
  from public, anon, authenticated;


create or replace function public.reserve_inventory_from_onboarding_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_entry_template_id uuid;
  v_source_available boolean := false;
  v_rule public.inventory_source_reservation_rules%rowtype;
begin
  if tg_table_schema <> 'public'
    or tg_table_name <> 'onboarding_tasks'
    or tg_op <> 'INSERT' then
    raise exception 'Unsupported onboarding reservation trigger target' using errcode = '22023';
  end if;

  select entry.created_by,
         entry.template_id,
         task.template_task_id is not null
           and template_task.template_id = entry.template_id
           and template_task.active
           and template.active
  into v_actor_id, v_entry_template_id, v_source_available
  from public.onboarding_tasks task
  join public.onboarding_entries entry
    on entry.id = task.entry_id
    and entry.tenant_id = task.tenant_id
  left join public.onboarding_template_tasks template_task
    on template_task.id = task.template_task_id
    and template_task.tenant_id = task.tenant_id
  left join public.onboarding_templates template
    on template.id = template_task.template_id
    and template.tenant_id = task.tenant_id
  where task.id = new.id
    and task.entry_id = new.entry_id
    and task.tenant_id = new.tenant_id;

  for v_rule in
    select *
    from public.inventory_source_reservation_rules rule
    where rule.tenant_id = new.tenant_id
      and rule.source_kind = 'onboarding_template_task'
      and rule.onboarding_template_task_id = new.template_task_id
      and rule.enabled
    order by rule.id
  loop
    begin
      if v_rule.onboarding_template_id is distinct from v_entry_template_id
        or not coalesce(v_source_available, false) then
        perform public.record_inventory_source_reservation_exception(
          new.tenant_id, 'onboarding_template_task', null, null,
          new.entry_id, new.id, v_rule.id, 'source_unavailable', v_actor_id
        );
      else
        perform public.create_inventory_source_reservation(
          new.tenant_id, 'onboarding_template_task', null, null,
          new.entry_id, new.id, v_rule.id, v_actor_id
        );
      end if;
    exception when others then
      begin
        perform public.record_inventory_source_reservation_exception(
          new.tenant_id, 'onboarding_template_task', null, null,
          new.entry_id, new.id, v_rule.id, 'reservation_failed', v_actor_id
        );
      exception when others then
        null;
      end;
    end;
  end loop;
  return new;
exception when others then
  begin
    perform public.record_inventory_source_reservation_exception(
      new.tenant_id, 'onboarding_template_task', null, null,
      new.entry_id, new.id, null, 'reservation_failed', null
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.reserve_inventory_from_onboarding_task()
  from public, anon, authenticated;


create or replace function public.release_inventory_source_reservations(
  p_tenant_id uuid,
  p_source_kind text,
  p_event_space_request_id uuid,
  p_event_equipment_key text,
  p_onboarding_entry_id uuid,
  p_onboarding_task_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_mapping record;
  v_lines jsonb;
begin
  for v_mapping in
    select source_reservation.id as source_reservation_id,
           source_reservation.rule_id,
           reservation.id as reservation_id,
           reservation.item_id,
           reservation.location_id,
           reservation.serial_unit_id,
           reservation.quantity,
           reservation.created_by
    from public.inventory_source_reservations source_reservation
    join public.inventory_reservations reservation
      on reservation.id = source_reservation.reservation_id
      and reservation.tenant_id = source_reservation.tenant_id
      and reservation.item_id = source_reservation.item_id
      and reservation.location_id = source_reservation.location_id
    where source_reservation.tenant_id = p_tenant_id
      and source_reservation.source_kind = p_source_kind
      and (
        (
          p_source_kind = 'event_space_equipment'
          and source_reservation.event_space_request_id = p_event_space_request_id
          and source_reservation.event_equipment_key = p_event_equipment_key
        )
        or (
          p_source_kind = 'onboarding_template_task'
          and source_reservation.onboarding_task_id = p_onboarding_task_id
          and source_reservation.onboarding_entry_id = p_onboarding_entry_id
        )
      )
      and reservation.status = 'open'
    for update of reservation
  loop
    v_lines := jsonb_build_array(jsonb_build_object(
      'item_id', v_mapping.item_id,
      'location_id', v_mapping.location_id,
      'serial_unit_id', v_mapping.serial_unit_id,
      'physical_delta', 0,
      'reserved_delta', -v_mapping.quantity
    ));
    perform public.inventory_apply_event(
      p_tenant_id,
      v_mapping.created_by,
      gen_random_uuid(),
      'reservation_release',
      v_lines,
      'reservation',
      v_mapping.reservation_id
    );

    update public.inventory_reservations
    set status = 'released',
        released_at = timezone('utc', now()),
        released_by = v_mapping.created_by
    where id = v_mapping.reservation_id
      and tenant_id = p_tenant_id
      and status = 'open';
    if not found then
      raise exception 'Source reservation was not open for release' using errcode = '23514';
    end if;

    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      p_tenant_id, v_mapping.created_by,
      'inventory.source_reservation.released',
      'inventory_source_reservation', v_mapping.source_reservation_id, 'info',
      jsonb_build_object('source_kind', p_source_kind)
    );
  end loop;
end;
$$;

revoke all on function public.release_inventory_source_reservations(
  uuid, text, uuid, text, uuid, uuid
) from public, anon, authenticated;

commit;
