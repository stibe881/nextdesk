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

commit;
