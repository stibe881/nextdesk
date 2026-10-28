begin;

-- Inventory is an opt-in tenant capability. The existing feature category is
-- deliberately reused; no room, entry or onboarding domain is coupled here.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'inventory.management',
  'Bestandsverwaltung',
  'Mandantenbezogene Lagerorte, Artikel, Bestandsbewegungen, Reservierungen und Inventuren.',
  'assets',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    default_enabled = excluded.default_enabled;

-- Existing tenants need the disabled default as well; new tenants receive it
-- through initialize_tenant_feature_flags().
insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'inventory.management', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;

insert into public.permissions (code, description, is_sensitive)
values
  ('inventory.read', 'Read inventory workspace data.', false),
  ('inventory.manage', 'Manage inventory locations and item master data.', true),
  ('inventory.move', 'Post inventory receipts, issues, transfers and reservations.', true),
  ('inventory.adjust', 'Post manual inventory adjustments.', true),
  ('inventory.count.close', 'Close inventory counts and post count adjustments.', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

-- Only the exact active tenant-system administrator role receives defaults.
-- Other roles must be granted an inventory capability intentionally.
insert into public.role_permissions (role_id, permission_code)
select role.id, permission.code
from public.roles as role
cross join (values
  ('inventory.read'),
  ('inventory.manage'),
  ('inventory.move'),
  ('inventory.adjust'),
  ('inventory.count.close')
) as permission(code)
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_inventory_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values
      (new.id, 'inventory.read'),
      (new.id, 'inventory.manage'),
      (new.id, 'inventory.move'),
      (new.id, 'inventory.adjust'),
      (new.id, 'inventory.count.close')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_inventory_permissions() from public, anon, authenticated;
drop trigger if exists roles_grant_default_inventory_permissions on public.roles;
create trigger roles_grant_default_inventory_permissions
  after insert or update of active, is_system, scope, name on public.roles
  for each row execute function public.grant_default_inventory_permissions();

-- All inventory relations include tenant_id and tenant-bound composite foreign
-- keys. This preserves tenant isolation even for service-role writes, where RLS
-- is intentionally bypassed for server-side commands.
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (
    code = lower(btrim(code))
    and code ~ '^[a-z0-9][a-z0-9_-]{0,62}$'
  ),
  name text not null check (
    char_length(btrim(name)) between 1 and 160
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_locations_id_tenant_unique unique (id, tenant_id),
  constraint inventory_locations_tenant_code_unique unique (tenant_id, code)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_number text not null check (
    article_number = lower(btrim(article_number))
    and article_number ~ '^[a-z0-9][a-z0-9._/-]{0,159}$'
  ),
  name text not null check (
    char_length(btrim(name)) between 1 and 240
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  category text not null default 'general' check (
    char_length(btrim(category)) between 1 and 120
    and category = btrim(category)
    and category !~ '[[:cntrl:]]'
  ),
  unit text not null default 'each' check (
    unit = lower(btrim(unit))
    and unit ~ '^[a-z][a-z0-9_-]{0,31}$'
  ),
  tracking_mode text not null default 'quantity'
    check (tracking_mode in ('quantity', 'serial')),
  minimum_quantity numeric(18,3) not null default 0 check (minimum_quantity >= 0),
  target_quantity numeric(18,3) not null default 0 check (target_quantity >= minimum_quantity),
  manufacturer text check (
    manufacturer is null or (
      char_length(btrim(manufacturer)) between 1 and 160
      and manufacturer = btrim(manufacturer)
      and manufacturer !~ '[[:cntrl:]]'
    )
  ),
  model text check (
    model is null or (
      char_length(btrim(model)) between 1 and 160
      and model = btrim(model)
      and model !~ '[[:cntrl:]]'
    )
  ),
  supplier text check (
    supplier is null or (
      char_length(btrim(supplier)) between 1 and 160
      and supplier = btrim(supplier)
      and supplier !~ '[[:cntrl:]]'
    )
  ),
  note text check (
    note is null or (
      char_length(btrim(note)) between 1 and 2000
      and note = btrim(note)
      and note !~ '[[:cntrl:]]'
    )
  ),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_items_id_tenant_unique unique (id, tenant_id),
  constraint inventory_items_tenant_article_number_unique unique (tenant_id, article_number)
);

create table if not exists public.inventory_item_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  identifier_type text not null check (identifier_type in ('barcode', 'qr')),
  canonical_value text not null check (
    char_length(canonical_value) between 1 and 200
    and canonical_value = lower(btrim(canonical_value))
    and canonical_value !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_item_identifiers_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete cascade,
  constraint inventory_item_identifiers_tenant_value_unique
    unique (tenant_id, canonical_value),
  constraint inventory_item_identifiers_tenant_item_type_unique
    unique (tenant_id, item_id, identifier_type)
);

create table if not exists public.inventory_serial_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  serial_number text not null check (
    char_length(serial_number) between 1 and 200
    and serial_number = lower(btrim(serial_number))
    and serial_number !~ '[[:cntrl:]]'
  ),
  asset_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_serial_units_id_tenant_unique unique (id, tenant_id),
  constraint inventory_serial_units_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_serial_units_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete set null (asset_id),
  constraint inventory_serial_units_tenant_serial_number_unique
    unique (tenant_id, serial_number)
);

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

create index if not exists inventory_locations_tenant_active_name_idx
  on public.inventory_locations (tenant_id, active, name);
create index if not exists inventory_items_tenant_active_category_idx
  on public.inventory_items (tenant_id, active, category, name);
create index if not exists inventory_item_identifiers_lookup_idx
  on public.inventory_item_identifiers (tenant_id, canonical_value);
create index if not exists inventory_serial_units_item_idx
  on public.inventory_serial_units (tenant_id, item_id, active);
create index if not exists inventory_events_tenant_created_idx
  on public.inventory_events (tenant_id, created_at desc);
create index if not exists inventory_event_lines_item_location_idx
  on public.inventory_event_lines (tenant_id, item_id, location_id, created_at desc);
create index if not exists inventory_reservations_open_idx
  on public.inventory_reservations (tenant_id, item_id, location_id, created_at desc)
  where status = 'open';
create index if not exists inventory_reservations_ticket_idx
  on public.inventory_reservations (tenant_id, ticket_id)
  where ticket_id is not null;
create index if not exists inventory_counts_tenant_status_started_idx
  on public.inventory_counts (tenant_id, status, started_at desc);
create index if not exists inventory_count_lines_count_idx
  on public.inventory_count_lines (tenant_id, count_id, item_id);

drop trigger if exists inventory_locations_updated_at on public.inventory_locations;
create trigger inventory_locations_updated_at
  before update on public.inventory_locations
  for each row execute function public.set_updated_at();
drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();
drop trigger if exists inventory_serial_units_updated_at on public.inventory_serial_units;
create trigger inventory_serial_units_updated_at
  before update on public.inventory_serial_units
  for each row execute function public.set_updated_at();
drop trigger if exists inventory_reservations_updated_at on public.inventory_reservations;
create trigger inventory_reservations_updated_at
  before update on public.inventory_reservations
  for each row execute function public.set_updated_at();
drop trigger if exists inventory_counts_updated_at on public.inventory_counts;
create trigger inventory_counts_updated_at
  before update on public.inventory_counts
  for each row execute function public.set_updated_at();
drop trigger if exists inventory_count_lines_updated_at on public.inventory_count_lines;
create trigger inventory_count_lines_updated_at
  before update on public.inventory_count_lines
  for each row execute function public.set_updated_at();

-- Immutable events prevent ledger history from being altered, including by
-- service-role application code. Corrections must be compensating events.
create or replace function public.prevent_inventory_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Inventory event ledger is append-only' using errcode = '55000';
end;
$$;
revoke all on function public.prevent_inventory_event_mutation() from public, anon, authenticated;
drop trigger if exists inventory_events_append_only on public.inventory_events;
create trigger inventory_events_append_only
  before update or delete on public.inventory_events
  for each row execute function public.prevent_inventory_event_mutation();
drop trigger if exists inventory_event_lines_append_only on public.inventory_event_lines;
create trigger inventory_event_lines_append_only
  before update or delete on public.inventory_event_lines
  for each row execute function public.prevent_inventory_event_mutation();

-- Lock keys are sorted by callers before balances are read. The lock contains
-- tenant, item and location, preventing cross-tenant and cross-location
-- interference without relying only on an eventually-created balance row.
create or replace function public.inventory_lock_balance(
  p_tenant_id uuid,
  p_item_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_tenant_id is null or p_item_id is null or p_location_id is null then
    raise exception 'Inventory balance lock requires tenant, item and location' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'nextdesk:inventory:' || p_tenant_id::text || ':' || p_item_id::text || ':' || p_location_id::text,
    0
  ));
end;
$$;
revoke all on function public.inventory_lock_balance(uuid, uuid, uuid) from public, anon, authenticated;

-- A request lock complements item/location locks: concurrent Edge retries with
-- the same client_request_id must return the original command result rather
-- than racing to create a second reservation or count header.
create or replace function public.inventory_lock_request(
  p_tenant_id uuid,
  p_client_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_tenant_id is null or p_client_request_id is null then
    raise exception 'Inventory request lock requires tenant and client request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'nextdesk:inventory-request:' || p_tenant_id::text || ':' || p_client_request_id::text,
    0
  ));
end;
$$;
revoke all on function public.inventory_lock_request(uuid, uuid) from public, anon, authenticated;

-- Private ledger writer shared only by the service-only command RPCs below.
-- It validates all rows, acquires deterministic advisory locks, updates the
-- private balance projection, then appends the event and immutable lines in
-- the same transaction. There is intentionally no client-supplied note or
-- free-text reference in this interface.
create or replace function public.inventory_apply_event(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_client_request_id uuid,
  p_event_type text,
  p_lines jsonb,
  p_reference_type text,
  p_reference_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_event_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_serial_unit_id uuid;
  v_physical_delta numeric;
  v_reserved_delta numeric;
  v_item public.inventory_items%rowtype;
  v_location public.inventory_locations%rowtype;
  v_serial public.inventory_serial_units%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_delta record;
  v_new_physical numeric;
  v_new_reserved numeric;
begin
  if p_tenant_id is null or p_actor_id is null or p_client_request_id is null
     or p_event_type is null
     or p_event_type not in (
       'movement_receipt', 'movement_issue', 'movement_transfer', 'movement_adjustment',
       'reservation_hold', 'reservation_release', 'count_adjustment'
     )
     or (p_reference_type is null) <> (p_reference_id is null)
     or (p_reference_type is not null and p_reference_type not in ('reservation', 'inventory_count')) then
    raise exception 'Invalid inventory event request' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Inventory event requires at least one line' using errcode = '22023';
  end if;

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id
    and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type is distinct from p_event_type
       or v_existing.reference_type is distinct from p_reference_type
       or v_existing.reference_id is distinct from p_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  -- Validate every line before mutating any balance. Count reconciliation keeps
  -- a zero-delta line as an immutable observation for each recorded count line.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Inventory event line must be an object' using errcode = '22023';
    end if;
    v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
    v_location_id := nullif(v_line ->> 'location_id', '')::uuid;
    v_serial_unit_id := nullif(v_line ->> 'serial_unit_id', '')::uuid;
    v_physical_delta := coalesce(nullif(v_line ->> 'physical_delta', '')::numeric, 0);
    v_reserved_delta := coalesce(nullif(v_line ->> 'reserved_delta', '')::numeric, 0);
    if v_item_id is null or v_location_id is null
       or v_physical_delta <> trunc(v_physical_delta, 3)
       or v_reserved_delta <> trunc(v_reserved_delta, 3)
       or abs(v_physical_delta) > 999999999999999.999
       or abs(v_reserved_delta) > 999999999999999.999
       or ((v_physical_delta <> 0 or v_reserved_delta <> 0) = false and p_event_type <> 'count_adjustment') then
      raise exception 'Invalid inventory event line' using errcode = '22023';
    end if;

    select * into v_item
    from public.inventory_items
    where id = v_item_id and tenant_id = p_tenant_id
    for key share;
    if not found or (not v_item.active and p_event_type not in ('reservation_release', 'count_adjustment')) then
      raise exception 'Inventory item is unavailable' using errcode = 'P0002';
    end if;

    select * into v_location
    from public.inventory_locations
    where id = v_location_id and tenant_id = p_tenant_id
    for key share;
    if not found or (not v_location.active and p_event_type not in ('reservation_release', 'count_adjustment')) then
      raise exception 'Inventory location is unavailable' using errcode = 'P0002';
    end if;

    -- Serial-tracked stock has no aggregate fallback: every ledger line must
    -- identify an existing serial unit and may affect at most that one unit.
    if v_item.tracking_mode = 'serial'
       and (
         v_serial_unit_id is null
         or v_physical_delta not in (-1, 0, 1)
         or v_reserved_delta not in (-1, 0, 1)
       ) then
      raise exception 'Serial-tracked inventory event lines require a serial unit and unit deltas' using errcode = '22023';
    end if;

    if v_serial_unit_id is not null then
      select * into v_serial
      from public.inventory_serial_units
      where id = v_serial_unit_id
        and tenant_id = p_tenant_id
        and item_id = v_item_id
        and active
      for key share;
      if not found then
        raise exception 'Inventory serial unit is unavailable for this item' using errcode = 'P0002';
      end if;
      if v_item.tracking_mode <> 'serial' then
        raise exception 'Invalid serial-unit inventory event line' using errcode = '22023';
      end if;
    elsif v_item.tracking_mode = 'quantity' then
      -- Quantity-tracked items must never acquire a serial link accidentally.
      null;
    end if;
  end loop;

  -- Acquire all tenant/item/location locks in deterministic order before any
  -- balance projection is inspected or updated.
  for v_delta in
    select distinct
      (value ->> 'item_id')::uuid as item_id,
      (value ->> 'location_id')::uuid as location_id
    from jsonb_array_elements(p_lines)
    order by 1, 2
  loop
    perform public.inventory_lock_balance(p_tenant_id, v_delta.item_id, v_delta.location_id);
  end loop;

  v_event_id := null;
  insert into public.inventory_events (
    tenant_id, client_request_id, event_type, actor_id, reference_type, reference_id
  ) values (
    p_tenant_id, p_client_request_id, p_event_type, p_actor_id, p_reference_type, p_reference_id
  ) on conflict (tenant_id, client_request_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    select * into v_existing
    from public.inventory_events
    where tenant_id = p_tenant_id
      and client_request_id = p_client_request_id
    for key share;
    if not found
       or v_existing.event_type is distinct from p_event_type
       or v_existing.reference_type is distinct from p_reference_type
       or v_existing.reference_id is distinct from p_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  for v_delta in
    select
      (value ->> 'item_id')::uuid as item_id,
      (value ->> 'location_id')::uuid as location_id,
      sum(coalesce(nullif(value ->> 'physical_delta', '')::numeric, 0)) as physical_delta,
      sum(coalesce(nullif(value ->> 'reserved_delta', '')::numeric, 0)) as reserved_delta
    from jsonb_array_elements(p_lines)
    group by 1, 2
    order by 1, 2
  loop
    insert into public.inventory_stock_balances (tenant_id, item_id, location_id)
    values (p_tenant_id, v_delta.item_id, v_delta.location_id)
    on conflict (tenant_id, item_id, location_id) do nothing;

    select * into v_balance
    from public.inventory_stock_balances
    where tenant_id = p_tenant_id
      and item_id = v_delta.item_id
      and location_id = v_delta.location_id
    for update;

    v_new_physical := v_balance.physical_quantity + v_delta.physical_delta;
    v_new_reserved := v_balance.reserved_quantity + v_delta.reserved_delta;
    if v_new_physical < 0 or v_new_reserved < 0 or v_new_reserved > v_new_physical then
      raise exception 'Inventory balance cannot become negative or over-reserved' using errcode = '23514';
    end if;

    update public.inventory_stock_balances
    set physical_quantity = v_new_physical,
        reserved_quantity = v_new_reserved,
        updated_at = timezone('utc', now())
    where tenant_id = p_tenant_id
      and item_id = v_delta.item_id
      and location_id = v_delta.location_id;
  end loop;

  insert into public.inventory_event_lines (
    tenant_id, event_id, item_id, location_id, serial_unit_id, physical_delta, reserved_delta
  )
  select
    p_tenant_id,
    v_event_id,
    (value ->> 'item_id')::uuid,
    (value ->> 'location_id')::uuid,
    nullif(value ->> 'serial_unit_id', '')::uuid,
    coalesce(nullif(value ->> 'physical_delta', '')::numeric, 0),
    coalesce(nullif(value ->> 'reserved_delta', '')::numeric, 0)
  from jsonb_array_elements(p_lines);

  return v_event_id;
end;
$$;
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

create or replace function public.post_inventory_movement(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_movement_type text,
  p_lines jsonb,
  p_reservation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_event_id uuid;
  v_event_type text;
  v_input jsonb;
  v_event_lines jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_from_location_id uuid;
  v_to_location_id uuid;
  v_serial_unit_id uuid;
  v_quantity numeric;
  v_physical_delta numeric;
  v_reservation public.inventory_reservations%rowtype;
  v_reference_type text;
  v_reference_id uuid;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_movement_type is null
     or p_movement_type not in ('receipt', 'issue', 'transfer', 'adjustment')
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Invalid inventory movement request' using errcode = '22023';
  end if;

  if p_movement_type = 'adjustment' then
    perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.adjust');
  else
    perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');
  end if;

  v_event_type := 'movement_' || p_movement_type;
  v_reference_type := case when p_reservation_id is null then null else 'reservation' end;
  v_reference_id := p_reservation_id;
  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type is distinct from v_event_type
       or v_existing.reference_type is distinct from v_reference_type
       or v_existing.reference_id is distinct from v_reference_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  for v_input in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_input) <> 'object' then
      raise exception 'Inventory movement line must be an object' using errcode = '22023';
    end if;
    v_item_id := nullif(v_input ->> 'item_id', '')::uuid;
    v_serial_unit_id := nullif(v_input ->> 'serial_unit_id', '')::uuid;
    if v_item_id is null then
      raise exception 'Inventory movement item is required' using errcode = '22023';
    end if;

    if p_movement_type in ('receipt', 'issue') then
      v_location_id := nullif(v_input ->> 'location_id', '')::uuid;
      v_quantity := nullif(v_input ->> 'quantity', '')::numeric;
      if v_location_id is null or v_quantity is null or v_quantity <= 0
         or v_quantity <> trunc(v_quantity, 3) then
        raise exception 'Receipt or issue requires a positive location quantity' using errcode = '22023';
      end if;
      v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'location_id', v_location_id,
        'serial_unit_id', v_serial_unit_id,
        'physical_delta', case when p_movement_type = 'receipt' then v_quantity else -v_quantity end,
        'reserved_delta', 0
      ));
    elsif p_movement_type = 'transfer' then
      v_from_location_id := nullif(v_input ->> 'from_location_id', '')::uuid;
      v_to_location_id := nullif(v_input ->> 'to_location_id', '')::uuid;
      v_quantity := nullif(v_input ->> 'quantity', '')::numeric;
      if v_from_location_id is null or v_to_location_id is null
         or v_from_location_id = v_to_location_id
         or v_quantity is null or v_quantity <= 0
         or v_quantity <> trunc(v_quantity, 3) then
        raise exception 'Transfer requires distinct locations and a positive quantity' using errcode = '22023';
      end if;
      -- Transfers intentionally produce an explicit counterbooking pair.
      v_event_lines := v_event_lines || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'location_id', v_from_location_id,
          'serial_unit_id', v_serial_unit_id,
          'physical_delta', -v_quantity,
          'reserved_delta', 0
        ),
        jsonb_build_object(
          'item_id', v_item_id,
          'location_id', v_to_location_id,
          'serial_unit_id', v_serial_unit_id,
          'physical_delta', v_quantity,
          'reserved_delta', 0
        )
      );
    else
      v_location_id := nullif(v_input ->> 'location_id', '')::uuid;
      v_physical_delta := nullif(v_input ->> 'physical_delta', '')::numeric;
      if v_location_id is null or v_physical_delta is null or v_physical_delta = 0
         or v_physical_delta <> trunc(v_physical_delta, 3) then
        raise exception 'Adjustment requires a non-zero physical delta' using errcode = '22023';
      end if;
      v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'location_id', v_location_id,
        'serial_unit_id', v_serial_unit_id,
        'physical_delta', v_physical_delta,
        'reserved_delta', 0
      ));
    end if;
  end loop;

  if p_reservation_id is not null then
    if p_movement_type <> 'issue' or jsonb_array_length(v_event_lines) <> 1 then
      raise exception 'A reservation may only be consumed by one matching issue line' using errcode = '22023';
    end if;
    select * into v_reservation
    from public.inventory_reservations
    where id = p_reservation_id and tenant_id = p_tenant_id
    for update;
    if not found or v_reservation.status <> 'open' then
      raise exception 'Open inventory reservation not found' using errcode = 'P0002';
    end if;
    if (v_event_lines -> 0 ->> 'item_id')::uuid is distinct from v_reservation.item_id
       or (v_event_lines -> 0 ->> 'location_id')::uuid is distinct from v_reservation.location_id
       or (v_event_lines -> 0 ->> 'serial_unit_id')::uuid is distinct from v_reservation.serial_unit_id
       or (v_event_lines -> 0 ->> 'physical_delta')::numeric <> -v_reservation.quantity then
      raise exception 'Issue line does not match the open reservation' using errcode = '23514';
    end if;
    v_event_lines := jsonb_set(
      v_event_lines,
      '{0,reserved_delta}',
      to_jsonb(-v_reservation.quantity),
      true
    );
  end if;

  v_event_id := public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, v_event_type, v_event_lines, v_reference_type, v_reference_id
  );

  if p_reservation_id is not null then
    update public.inventory_reservations
    set status = 'consumed',
        consumed_at = timezone('utc', now()),
        consumed_by = p_actor_id
    where id = p_reservation_id
      and tenant_id = p_tenant_id
      and status = 'open';
    if not found then
      raise exception 'Inventory reservation was not open for consumption' using errcode = '23514';
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.movement.posted', 'inventory_event', v_event_id, 'info',
    jsonb_build_object(
      'type', p_movement_type,
      'count', jsonb_array_length(v_event_lines),
      'reference_type', coalesce(v_reference_type, 'none')
    )
  );
  return v_event_id;
end;
$$;

create or replace function public.create_inventory_reservation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_ticket_id uuid default null,
  p_serial_unit_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_reservation_id uuid;
  v_event_id uuid;
  v_lines jsonb;
  v_item public.inventory_items%rowtype;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_item_id is null or p_location_id is null or p_quantity is null
     or p_quantity <= 0 or p_quantity <> trunc(p_quantity, 3) then
    raise exception 'Invalid inventory reservation request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type <> 'reservation_hold'
       or v_existing.reference_type <> 'reservation'
       or v_existing.reference_id is null then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return v_existing.reference_id;
  end if;

  if p_ticket_id is not null and not exists (
    select 1 from public.tickets
    where id = p_ticket_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Ticket is not available in this tenant' using errcode = 'P0002';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id and tenant_id = p_tenant_id
  for key share;
  if found
     and v_item.tracking_mode = 'serial'
     and (p_serial_unit_id is null or p_quantity <> 1) then
    raise exception 'Serial-tracked inventory reservations require a serial unit and quantity 1' using errcode = '22023';
  end if;

  insert into public.inventory_reservations (
    tenant_id, item_id, location_id, serial_unit_id, quantity, ticket_id, created_by
  ) values (
    p_tenant_id, p_item_id, p_location_id, p_serial_unit_id, p_quantity, p_ticket_id, p_actor_id
  ) returning id into v_reservation_id;

  v_lines := jsonb_build_array(jsonb_build_object(
    'item_id', p_item_id,
    'location_id', p_location_id,
    'serial_unit_id', p_serial_unit_id,
    'physical_delta', 0,
    'reserved_delta', p_quantity
  ));
  v_event_id := public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, 'reservation_hold', v_lines, 'reservation', v_reservation_id
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.reservation.created', 'inventory_reservation', v_reservation_id, 'info',
    jsonb_build_object('type', 'reservation_hold', 'count', 1, 'reference_type', 'reservation')
  );
  return v_reservation_id;
end;
$$;

create or replace function public.release_inventory_reservation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_reservation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.inventory_events%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_lines jsonb;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_reservation_id is null then
    raise exception 'Invalid inventory reservation release request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_existing
  from public.inventory_events
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_existing.event_type <> 'reservation_release'
       or v_existing.reference_type <> 'reservation'
       or v_existing.reference_id is distinct from p_reservation_id then
      raise exception 'client_request_id was already used for a different inventory event' using errcode = '23505';
    end if;
    return p_reservation_id;
  end if;

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id and tenant_id = p_tenant_id
  for update;
  if not found or v_reservation.status <> 'open' then
    raise exception 'Open inventory reservation not found' using errcode = 'P0002';
  end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'item_id', v_reservation.item_id,
    'location_id', v_reservation.location_id,
    'serial_unit_id', v_reservation.serial_unit_id,
    'physical_delta', 0,
    'reserved_delta', -v_reservation.quantity
  ));
  perform public.inventory_apply_event(
    p_tenant_id, p_actor_id, p_client_request_id, 'reservation_release', v_lines, 'reservation', p_reservation_id
  );

  update public.inventory_reservations
  set status = 'released',
      released_at = timezone('utc', now()),
      released_by = p_actor_id
  where id = p_reservation_id and tenant_id = p_tenant_id and status = 'open';
  if not found then
    raise exception 'Inventory reservation was not open for release' using errcode = '23514';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.reservation.released', 'inventory_reservation', p_reservation_id, 'info',
    jsonb_build_object('type', 'reservation_release', 'count', 1, 'reference_type', 'reservation')
  );
  return p_reservation_id;
end;
$$;

create or replace function public.start_inventory_count(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_location_id is null then
    raise exception 'Invalid inventory count start request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select * into v_count
  from public.inventory_counts
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id
  for key share;
  if found then
    if v_count.location_id is distinct from p_location_id then
      raise exception 'client_request_id was already used for a different inventory count' using errcode = '23505';
    end if;
    return v_count.id;
  end if;

  if not exists (
    select 1 from public.inventory_locations
    where id = p_location_id and tenant_id = p_tenant_id and active
  ) then
    raise exception 'Active inventory location not found' using errcode = 'P0002';
  end if;

  insert into public.inventory_counts (
    tenant_id, location_id, status, client_request_id, started_by
  ) values (
    p_tenant_id, p_location_id, 'counting', p_client_request_id, p_actor_id
  ) returning * into v_count;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.count.started', 'inventory_count', v_count.id, 'info',
    jsonb_build_object('type', 'count_start', 'count', 1, 'reference_type', 'inventory_count')
  );
  return v_count.id;
end;
$$;

drop function if exists public.record_inventory_count_line(uuid, uuid, uuid, uuid, numeric);
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

revoke all on table public.inventory_locations, public.inventory_items,
  public.inventory_item_identifiers, public.inventory_serial_units,
  public.inventory_events, public.inventory_event_lines,
  public.inventory_stock_balances, public.inventory_reservations,
  public.inventory_counts, public.inventory_count_lines,
  public.inventory_command_receipts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_locations,
  public.inventory_items, public.inventory_item_identifiers,
  public.inventory_serial_units, public.inventory_events,
  public.inventory_event_lines, public.inventory_stock_balances,
  public.inventory_reservations, public.inventory_counts,
  public.inventory_count_lines, public.inventory_command_receipts to service_role;

revoke all on function public.upsert_inventory_location(uuid, uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.upsert_inventory_item(uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.post_inventory_movement(uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_inventory_reservation(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_inventory_reservation(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_inventory_count(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_inventory_count_line(uuid, uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.close_inventory_count(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.upsert_inventory_location(uuid, uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.upsert_inventory_item(uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, boolean) to service_role;
grant execute on function public.post_inventory_movement(uuid, uuid, uuid, text, jsonb, uuid) to service_role;
grant execute on function public.create_inventory_reservation(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid) to service_role;
grant execute on function public.release_inventory_reservation(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.start_inventory_count(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.record_inventory_count_line(uuid, uuid, uuid, uuid, uuid, numeric) to service_role;
grant execute on function public.close_inventory_count(uuid, uuid, uuid, uuid) to service_role;

comment on table public.inventory_stock_balances is
  'Private current-balance projection maintained only alongside immutable inventory event lines; service-role workspace reads may use it.';
comment on table public.inventory_events is
  'Append-only tenant inventory ledger header. client_request_id makes server-side postings idempotent.';
comment on table public.inventory_command_receipts is
  'Private tenant command receipts prevent retrying master-data and count-line mutations.';
comment on table public.inventory_reservations is
  'Explicit stock hold with no automatic expiration. Ticket linkage is optional and composite-tenant-bound.';
comment on function public.inventory_apply_event(uuid, uuid, uuid, text, jsonb, text, uuid) is
  'Private SECURITY DEFINER ledger writer. Command RPCs authorize actors before calling it; public and browser roles have no execute privilege.';

commit;
