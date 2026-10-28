begin;

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

commit;
