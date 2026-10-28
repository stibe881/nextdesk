begin;

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_request_id uuid not null,
  event_type text not null check (event_type in (
    'movement_receipt',
    'movement_issue',
    'movement_transfer',
    'movement_adjustment',
    'reservation_hold',
    'reservation_release',
    'count_adjustment'
  )),
  actor_id uuid not null references public.user_profiles(id) on delete restrict,
  reference_type text check (reference_type in ('reservation', 'inventory_count')),
  reference_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_events_id_tenant_unique unique (id, tenant_id),
  constraint inventory_events_client_request_unique unique (tenant_id, client_request_id),
  constraint inventory_events_reference_pair_check
    check ((reference_type is null) = (reference_id is null))
);


create table if not exists public.inventory_event_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  serial_unit_id uuid,
  physical_delta numeric(18,3) not null default 0,
  reserved_delta numeric(18,3) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_event_lines_event_tenant_fk
    foreign key (event_id, tenant_id)
    references public.inventory_events (id, tenant_id) on delete restrict,
  constraint inventory_event_lines_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_event_lines_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  constraint inventory_event_lines_serial_unit_tenant_fk
    foreign key (serial_unit_id, tenant_id)
    references public.inventory_serial_units (id, tenant_id) on delete restrict
);


-- This private projection is the authoritative concurrency control point. Event
-- lines remain the immutable ledger, while the projection makes balance checks
-- and service-role workspace calculation deterministic and inexpensive.
create table if not exists public.inventory_stock_balances (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  physical_quantity numeric(18,3) not null default 0 check (physical_quantity >= 0),
  reserved_quantity numeric(18,3) not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, item_id, location_id),
  constraint inventory_stock_balances_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_stock_balances_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  constraint inventory_stock_balances_reserved_not_over_physical
    check (reserved_quantity <= physical_quantity)
);


create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  serial_unit_id uuid,
  quantity numeric(18,3) not null check (quantity > 0),
  status text not null default 'open' check (status in ('open', 'released', 'consumed')),
  ticket_id uuid,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  released_by uuid references public.user_profiles(id) on delete set null,
  consumed_by uuid references public.user_profiles(id) on delete set null,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_reservations_id_tenant_unique unique (id, tenant_id),
  constraint inventory_reservations_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_reservations_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  constraint inventory_reservations_serial_unit_tenant_fk
    foreign key (serial_unit_id, tenant_id)
    references public.inventory_serial_units (id, tenant_id) on delete restrict,
  -- The ticket link is deliberately optional and tenant-composite. It is the
  -- only current business reference; no free-text room or entry reference is
  -- retained for speculative future integrations.
  constraint inventory_reservations_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete restrict,
  constraint inventory_reservations_serial_quantity_check
    check (serial_unit_id is null or quantity = 1),
  constraint inventory_reservations_status_timestamps_check
    check (
      (status = 'open' and released_at is null and released_by is null and consumed_at is null and consumed_by is null)
      or (status = 'released' and released_at is not null and released_by is not null and consumed_at is null and consumed_by is null)
      or (status = 'consumed' and consumed_at is not null and consumed_by is not null and released_at is null and released_by is null)
    )
);


create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'counting', 'closed', 'cancelled')),
  client_request_id uuid not null,
  close_client_request_id uuid,
  started_by uuid not null references public.user_profiles(id) on delete restrict,
  closed_by uuid references public.user_profiles(id) on delete restrict,
  started_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_counts_id_tenant_unique unique (id, tenant_id),
  constraint inventory_counts_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict,
  constraint inventory_counts_client_request_unique unique (tenant_id, client_request_id),
  constraint inventory_counts_closed_by_status_check
    check (
      (status = 'closed' and closed_at is not null and closed_by is not null and close_client_request_id is not null)
      or (status <> 'closed' and closed_at is null and closed_by is null and close_client_request_id is null)
    ),
  constraint inventory_counts_cancelled_at_status_check
    check ((status = 'cancelled') = (cancelled_at is not null))
);


create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  count_id uuid not null,
  item_id uuid not null,
  counted_quantity numeric(18,3) not null check (counted_quantity >= 0),
  recorded_by uuid not null references public.user_profiles(id) on delete restrict,
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_count_lines_count_tenant_fk
    foreign key (count_id, tenant_id)
    references public.inventory_counts (id, tenant_id) on delete cascade,
  constraint inventory_count_lines_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_count_lines_count_item_unique unique (count_id, item_id)
);


-- Master-data and count-line commands are not represented by an immutable
-- inventory event. Keep their terminal target in a private receipt so a retry
-- cannot execute a second update or audit path.
create table if not exists public.inventory_command_receipts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  command_type text not null check (command_type in (
    'upsert_inventory_location',
    'upsert_inventory_item',
    'record_inventory_count_line'
  )),
  client_request_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, command_type, client_request_id)
);

commit;
