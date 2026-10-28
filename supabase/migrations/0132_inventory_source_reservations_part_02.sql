begin;

create unique index inventory_source_reservation_exceptions_state_unique
  on public.inventory_source_reservation_exceptions (
    tenant_id,
    source_kind,
    coalesce(event_space_request_id, onboarding_task_id),
    coalesce(event_equipment_key, ''),
    coalesce(rule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    exception_code
  );

create index inventory_source_reservation_exceptions_tenant_observed_idx
  on public.inventory_source_reservation_exceptions (
    tenant_id, last_observed_at desc
  );


create or replace function public.validate_inventory_source_reservation_rule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_location public.inventory_locations%rowtype;
begin
  if tg_table_schema <> 'public'
    or tg_table_name <> 'inventory_source_reservation_rules' then
    raise exception 'Unsupported inventory source reservation rule target' using errcode = '22023';
  end if;

  select * into v_item
  from public.inventory_items
  where id = new.item_id
    and tenant_id = new.tenant_id
  for key share;
  if not found or not v_item.active or v_item.tracking_mode <> 'quantity' then
    raise exception 'Automatic source reservations require an active quantity-tracked item' using errcode = '23514';
  end if;

  select * into v_location
  from public.inventory_locations
  where id = new.location_id
    and tenant_id = new.tenant_id
  for key share;
  if not found or not v_location.active then
    raise exception 'Automatic source reservations require an active inventory location' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_inventory_source_reservation_rule()
  from public, anon, authenticated;


drop trigger if exists inventory_source_reservation_rules_validate on public.inventory_source_reservation_rules;

create trigger inventory_source_reservation_rules_validate
  before insert or update of tenant_id, source_kind, event_equipment_key,
    onboarding_template_id, onboarding_template_task_id, item_id, location_id, quantity
  on public.inventory_source_reservation_rules
  for each row execute function public.validate_inventory_source_reservation_rule();


drop trigger if exists inventory_source_reservation_rules_updated_at on public.inventory_source_reservation_rules;

create trigger inventory_source_reservation_rules_updated_at
  before update on public.inventory_source_reservation_rules
  for each row execute function public.set_updated_at();


create or replace function public.record_inventory_source_reservation_exception(
  p_tenant_id uuid,
  p_source_kind text,
  p_event_space_request_id uuid,
  p_event_equipment_key text,
  p_onboarding_entry_id uuid,
  p_onboarding_task_id uuid,
  p_rule_id uuid,
  p_exception_code text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_exception_id uuid;
begin
  if p_tenant_id is null
    or p_source_kind not in ('event_space_equipment', 'onboarding_template_task')
    or p_exception_code not in (
      'duplicate_source', 'feature_disabled', 'source_unavailable',
      'item_unavailable', 'location_unavailable', 'stock_unavailable',
      'tenant_mismatch', 'reservation_failed', 'release_failed'
    )
    or (
      p_source_kind = 'event_space_equipment'
      and (p_event_space_request_id is null or p_event_equipment_key is null
        or p_onboarding_entry_id is not null or p_onboarding_task_id is not null)
    )
    or (
      p_source_kind = 'onboarding_template_task'
      and (p_onboarding_entry_id is null or p_onboarding_task_id is null
        or p_event_space_request_id is not null or p_event_equipment_key is not null)
    ) then
    return;
  end if;

  insert into public.inventory_source_reservation_exceptions (
    tenant_id, source_kind, event_space_request_id, event_equipment_key,
    onboarding_entry_id, onboarding_task_id, rule_id, exception_code
  ) values (
    p_tenant_id, p_source_kind, p_event_space_request_id, p_event_equipment_key,
    p_onboarding_entry_id, p_onboarding_task_id, p_rule_id, p_exception_code
  ) on conflict do nothing
  returning id into v_exception_id;

  if v_exception_id is null then
    update public.inventory_source_reservation_exceptions
    set occurrence_count = occurrence_count + 1,
        last_observed_at = timezone('utc', now())
    where tenant_id = p_tenant_id
      and source_kind = p_source_kind
      and coalesce(event_space_request_id, onboarding_task_id)
        = coalesce(p_event_space_request_id, p_onboarding_task_id)
      and coalesce(event_equipment_key, '') = coalesce(p_event_equipment_key, '')
      and rule_id is not distinct from p_rule_id
      and exception_code = p_exception_code;
  else
    -- The audit entry has only an opaque exception ID and controlled enum-like
    -- values; names, quantities, supplier data and free text are never logged.
    begin
      insert into public.audit_logs (
        tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
      ) values (
        p_tenant_id, p_actor_id,
        'inventory.source_reservation.exception.recorded',
        'inventory_source_reservation_exception', v_exception_id, 'warning',
        jsonb_build_object(
          'source_kind', p_source_kind,
          'exception_code', p_exception_code
        )
      );
    exception when others then
      -- A failure to mirror the private exception state into the generic audit
      -- stream must never turn a source operation into a failed user action.
      null;
    end;
  end if;
end;
$$;

revoke all on function public.record_inventory_source_reservation_exception(
  uuid, text, uuid, text, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;

commit;
