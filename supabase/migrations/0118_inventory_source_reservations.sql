begin;

-- Automatic source reservations are deliberately opt-in. Rules are private
-- tenant configuration and are only evaluated for sources created after this
-- migration and after a rule has been enabled; there is no backfill worker.
-- The additional tenant-composite keys let every later source link prove the
-- exact source, template task, rule, item, location and reservation tenant.
alter table public.event_space_request_equipment
  add constraint event_space_request_equipment_request_key_tenant_unique
  unique (request_id, equipment_key, tenant_id);

alter table public.onboarding_template_tasks
  add constraint onboarding_template_tasks_id_template_tenant_unique
  unique (id, template_id, tenant_id);

alter table public.inventory_reservations
  add constraint inventory_reservations_id_tenant_item_location_unique
  unique (id, tenant_id, item_id, location_id);

create table public.inventory_source_reservation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'event_space_equipment',
    'onboarding_template_task'
  )),
  event_equipment_key text,
  onboarding_template_id uuid,
  onboarding_template_task_id uuid,
  item_id uuid not null,
  location_id uuid not null,
  quantity numeric(18,3) not null check (
    quantity > 0
    and quantity = trunc(quantity, 3)
  ),
  enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_source_reservation_rules_id_tenant_unique unique (id, tenant_id),
  constraint inventory_source_reservation_rules_binding_unique
    unique (id, tenant_id, item_id, location_id),
  constraint inventory_source_reservation_rules_source_shape_check check (
    (
      source_kind = 'event_space_equipment'
      and event_equipment_key in (
        'projector', 'connections', 'display', 'audio', 'videocall', 'microphones'
      )
      and onboarding_template_id is null
      and onboarding_template_task_id is null
    )
    or (
      source_kind = 'onboarding_template_task'
      and event_equipment_key is null
      and onboarding_template_id is not null
      and onboarding_template_task_id is not null
    )
  ),
  constraint inventory_source_reservation_rules_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_source_reservation_rules_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  -- A rule names both sides of the real template-task relation. A task UUID
  -- from another template or tenant therefore cannot be configured as a rule.
  constraint inventory_source_reservation_rules_template_task_tenant_fk
    foreign key (onboarding_template_task_id, onboarding_template_id, tenant_id)
    references public.onboarding_template_tasks (id, template_id, tenant_id)
    on delete restrict
);

create index inventory_source_reservation_rules_event_lookup_idx
  on public.inventory_source_reservation_rules (
    tenant_id, event_equipment_key, enabled
  )
  where source_kind = 'event_space_equipment';
create index inventory_source_reservation_rules_onboarding_lookup_idx
  on public.inventory_source_reservation_rules (
    tenant_id, onboarding_template_id, onboarding_template_task_id, enabled
  )
  where source_kind = 'onboarding_template_task';

-- A successful hold is tied to exactly one concrete source. It stores no
-- source label, quantity copy, free-text reference, supplier or person data.
create table public.inventory_source_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'event_space_equipment',
    'onboarding_template_task'
  )),
  event_space_request_id uuid,
  event_equipment_key text,
  onboarding_entry_id uuid,
  onboarding_task_id uuid,
  rule_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  reservation_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_source_reservations_source_shape_check check (
    (
      source_kind = 'event_space_equipment'
      and event_space_request_id is not null
      and event_equipment_key is not null
      and onboarding_entry_id is null
      and onboarding_task_id is null
    )
    or (
      source_kind = 'onboarding_template_task'
      and event_space_request_id is null
      and event_equipment_key is null
      and onboarding_entry_id is not null
      and onboarding_task_id is not null
    )
  ),
  constraint inventory_source_reservations_event_source_tenant_fk
    foreign key (event_space_request_id, event_equipment_key, tenant_id)
    references public.event_space_request_equipment (request_id, equipment_key, tenant_id)
    on delete cascade,
  constraint inventory_source_reservations_onboarding_source_tenant_fk
    foreign key (onboarding_task_id, onboarding_entry_id, tenant_id)
    references public.onboarding_tasks (id, entry_id, tenant_id)
    on delete cascade,
  constraint inventory_source_reservations_rule_binding_tenant_fk
    foreign key (rule_id, tenant_id, item_id, location_id)
    references public.inventory_source_reservation_rules (id, tenant_id, item_id, location_id)
    on delete restrict,
  constraint inventory_source_reservations_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_source_reservations_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  constraint inventory_source_reservations_reservation_binding_tenant_fk
    foreign key (reservation_id, tenant_id, item_id, location_id)
    references public.inventory_reservations (id, tenant_id, item_id, location_id)
    on delete restrict
);

create unique index inventory_source_reservations_event_rule_unique
  on public.inventory_source_reservations (
    tenant_id, rule_id, event_space_request_id, event_equipment_key
  )
  where source_kind = 'event_space_equipment';
create unique index inventory_source_reservations_onboarding_rule_unique
  on public.inventory_source_reservations (
    tenant_id, rule_id, onboarding_task_id
  )
  where source_kind = 'onboarding_template_task';
create unique index inventory_source_reservations_reservation_unique
  on public.inventory_source_reservations (reservation_id, tenant_id);

-- Exceptions deliberately retain only controlled state codes and opaque IDs.
-- Source IDs are not foreign keys here so a later source deletion can still be
-- audited after its open hold has been released and the live source link has
-- been cascaded away.
create table public.inventory_source_reservation_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'event_space_equipment',
    'onboarding_template_task'
  )),
  event_space_request_id uuid,
  event_equipment_key text,
  onboarding_entry_id uuid,
  onboarding_task_id uuid,
  rule_id uuid,
  exception_code text not null check (exception_code in (
    'duplicate_source',
    'feature_disabled',
    'source_unavailable',
    'item_unavailable',
    'location_unavailable',
    'stock_unavailable',
    'tenant_mismatch',
    'reservation_failed',
    'release_failed'
  )),
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  first_observed_at timestamptz not null default timezone('utc', now()),
  last_observed_at timestamptz not null default timezone('utc', now()),
  constraint inventory_source_reservation_exceptions_source_shape_check check (
    (
      source_kind = 'event_space_equipment'
      and event_space_request_id is not null
      and event_equipment_key is not null
      and onboarding_entry_id is null
      and onboarding_task_id is null
    )
    or (
      source_kind = 'onboarding_template_task'
      and event_space_request_id is null
      and event_equipment_key is null
      and onboarding_entry_id is not null
      and onboarding_task_id is not null
    )
  ),
  constraint inventory_source_reservation_exceptions_rule_tenant_fk
    foreign key (rule_id, tenant_id)
    references public.inventory_source_reservation_rules (id, tenant_id)
    on delete set null (rule_id)
);

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

create or replace function public.release_inventory_source_reservations_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_op <> 'DELETE' then
    raise exception 'Unsupported inventory source reservation release target' using errcode = '22023';
  end if;

  if tg_table_name = 'event_space_request_equipment' then
    perform public.release_inventory_source_reservations(
      old.tenant_id, 'event_space_equipment', old.request_id, old.equipment_key,
      null, null
    );
  elsif tg_table_name = 'onboarding_tasks' then
    perform public.release_inventory_source_reservations(
      old.tenant_id, 'onboarding_template_task', null, null,
      old.entry_id, old.id
    );
  else
    raise exception 'Unsupported inventory source reservation release target' using errcode = '22023';
  end if;
  return old;
end;
$$;
revoke all on function public.release_inventory_source_reservations_on_delete()
  from public, anon, authenticated;

drop trigger if exists inventory_source_reservation_event_equipment_insert
  on public.event_space_request_equipment;
create trigger inventory_source_reservation_event_equipment_insert
  after insert on public.event_space_request_equipment
  for each row execute function public.reserve_inventory_from_event_space_equipment();

drop trigger if exists inventory_source_reservation_onboarding_task_insert
  on public.onboarding_tasks;
create trigger inventory_source_reservation_onboarding_task_insert
  after insert on public.onboarding_tasks
  for each row execute function public.reserve_inventory_from_onboarding_task();

drop trigger if exists inventory_source_reservation_event_equipment_release
  on public.event_space_request_equipment;
create trigger inventory_source_reservation_event_equipment_release
  before delete on public.event_space_request_equipment
  for each row execute function public.release_inventory_source_reservations_on_delete();

drop trigger if exists inventory_source_reservation_onboarding_task_release
  on public.onboarding_tasks;
create trigger inventory_source_reservation_onboarding_task_release
  before delete on public.onboarding_tasks
  for each row execute function public.release_inventory_source_reservations_on_delete();

-- Rules, successful source links and structured exception states are private to
-- service-side orchestration. Composite foreign keys provide the tenant fence
-- even when service_role bypasses browser-facing RLS checks.
alter table public.inventory_source_reservation_rules enable row level security;
alter table public.inventory_source_reservation_rules force row level security;
alter table public.inventory_source_reservations enable row level security;
alter table public.inventory_source_reservations force row level security;
alter table public.inventory_source_reservation_exceptions enable row level security;
alter table public.inventory_source_reservation_exceptions force row level security;

revoke all on table public.inventory_source_reservation_rules,
  public.inventory_source_reservations,
  public.inventory_source_reservation_exceptions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_source_reservation_rules,
  public.inventory_source_reservations,
  public.inventory_source_reservation_exceptions
  to service_role;

create policy inventory_source_reservation_rules_service_role_only
  on public.inventory_source_reservation_rules
  for all to service_role using (true) with check (true);
create policy inventory_source_reservations_service_role_only
  on public.inventory_source_reservations
  for all to service_role using (true) with check (true);
create policy inventory_source_reservation_exceptions_service_role_only
  on public.inventory_source_reservation_exceptions
  for all to service_role using (true) with check (true);

comment on table public.inventory_source_reservation_rules is
  'Service-only opt-in rules for future event-equipment and onboarding-template-task inventory holds; each rule is tenant-bound and disabled by default.';
comment on table public.inventory_source_reservations is
  'Private, tenant-composite binding of one automatic inventory reservation to one concrete source and rule; source deletion releases only open holds.';
comment on table public.inventory_source_reservation_exceptions is
  'Private structured exception states for automatic source reservations; stores opaque IDs and controlled codes only, never source text, quantities or supplier data.';

commit;
