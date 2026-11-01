begin;

set local search_path = pg_catalog, public;

-- Self-service shop
-- -----------------
-- Agents publish catalog items (optionally linked to an inventory item).
-- Employees order or borrow them through web and app. An order is its own
-- record, never a ticket. Stock is reserved when an order is placed (or
-- approved) and booked out of the inventory ledger when an agent hands it out.
-- Loans are booked back in on return. Items can require the approval of the
-- requester's manager (Entra manager or a manually maintained manager).

insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'self_service.shop',
  'Shop',
  'Interner Katalog, aus dem Mitarbeitende Zubehör bestellen oder Geräte ausleihen. Bestellungen buchen automatisch aus dem Lager.',
  'assets',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'self_service.shop', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;

insert into public.permissions (code, description, is_sensitive)
values
  ('shop.order', 'Order or borrow items from the self-service shop.', false),
  ('shop.fulfill', 'Process self-service shop orders and book them out of inventory.', true),
  ('shop.manage', 'Manage the self-service shop catalog.', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

-- Standard system roles: everybody may order, agents process orders and
-- maintain the catalog, administrators may do everything.
create or replace function public.shop_default_permissions_for_role(p_name text, p_scope text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_name = 'Tenant administrator' and p_scope = 'tenant'
      then array['shop.order', 'shop.fulfill', 'shop.manage']
    when p_name = 'Support agent'
      then array['shop.order', 'shop.fulfill', 'shop.manage']
    when p_name = 'Requester' and p_scope = 'tenant'
      then array['shop.order']
    else array[]::text[]
  end;
$$;

insert into public.role_permissions (role_id, permission_code)
select role.id, permission_code
from public.roles as role
cross join lateral unnest(public.shop_default_permissions_for_role(role.name, role.scope::text)) as permission_code
where role.active and role.is_system
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_shop_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active and new.is_system then
    insert into public.role_permissions (role_id, permission_code)
    select new.id, permission_code
    from unnest(public.shop_default_permissions_for_role(new.name, new.scope::text)) as permission_code
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_shop_permissions() from public, anon, authenticated;

drop trigger if exists roles_grant_default_shop_permissions on public.roles;
create trigger roles_grant_default_shop_permissions
after insert or update of name, scope, is_system, active on public.roles
for each row execute function public.grant_default_shop_permissions();

-- Permission check across tenant- and department-scoped roles. The standard
-- "Support agent" role is department scoped.
create or replace function public.shop_has_permission(
  p_user_id uuid,
  p_tenant_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id and tenant.status = 'active'
    join public.user_role_assignments assignment
      on assignment.user_id = membership.user_id
     and assignment.tenant_id = membership.tenant_id
     and assignment.starts_at <= timezone('utc', now())
     and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    join public.roles role
      on role.id = assignment.role_id
     and role.tenant_id = assignment.tenant_id
     and role.active
    join public.role_permissions role_permission
      on role_permission.role_id = role.id
     and role_permission.permission_code = p_permission_code
    where membership.user_id = p_user_id
      and membership.tenant_id = p_tenant_id
      and membership.status = 'active'
  );
$$;

revoke all on function public.shop_has_permission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.shop_has_permission(uuid, uuid, text) to service_role;

create or replace function public.shop_feature_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select flag.enabled
    from public.tenant_feature_flags flag
    where flag.tenant_id = p_tenant_id and flag.feature_key = 'self_service.shop'
  ), false);
$$;

revoke all on function public.shop_feature_enabled(uuid) from public, anon, authenticated;
grant execute on function public.shop_feature_enabled(uuid) to service_role;

-- Managers
-- --------
alter table public.tenant_entra_directory_people
  add column if not exists manager_entra_object_id uuid;

alter table public.tenant_member_directory
  add column if not exists manager_user_id uuid references public.user_profiles(id) on delete set null;

comment on column public.tenant_entra_directory_people.manager_entra_object_id is
  'Entra object id of the person''s manager (Microsoft Graph "manager"), refreshed by the directory sync.';
comment on column public.tenant_member_directory.manager_user_id is
  'Manually maintained manager. Overrides the Entra manager, e.g. for workspaces without Entra.';

-- Stores the managers delivered by the directory sync. Pairs:
-- [{"entra_object_id": "...", "manager_entra_object_id": "..." | null}]
create or replace function public.apply_entra_directory_managers(
  p_tenant_id uuid,
  p_pairs jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_tenant_id is null or p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'Invalid manager payload' using errcode = '22023';
  end if;
  update public.tenant_entra_directory_people person
     set manager_entra_object_id = nullif(pair ->> 'manager_entra_object_id', '')::uuid
    from jsonb_array_elements(p_pairs) pair
   where person.tenant_id = p_tenant_id
     and person.entra_object_id = (pair ->> 'entra_object_id')::uuid
     and person.manager_entra_object_id is distinct from nullif(pair ->> 'manager_entra_object_id', '')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_entra_directory_managers(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_entra_directory_managers(uuid, jsonb) to service_role;

-- Effective manager: manual entry first, then the Entra manager. Only active
-- members of the same workspace qualify.
create or replace function public.shop_effective_manager(p_tenant_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select directory.manager_user_id
      from public.tenant_member_directory directory
      join public.tenant_memberships membership
        on membership.tenant_id = directory.tenant_id
       and membership.user_id = directory.manager_user_id
       and membership.status = 'active'
      where directory.tenant_id = p_tenant_id
        and directory.user_id = p_user_id
        and directory.manager_user_id is not null
        and directory.manager_user_id <> p_user_id
    ),
    (
      select manager.local_user_id
      from public.tenant_entra_directory_people person
      join public.tenant_entra_directory_people manager
        on manager.tenant_id = person.tenant_id
       and manager.entra_object_id = person.manager_entra_object_id
      join public.tenant_memberships membership
        on membership.tenant_id = manager.tenant_id
       and membership.user_id = manager.local_user_id
       and membership.status = 'active'
      where person.tenant_id = p_tenant_id
        and person.local_user_id = p_user_id
        and manager.local_user_id is not null
        and manager.local_user_id <> p_user_id
        and manager.inactive_at is null
      limit 1
    )
  );
$$;

revoke all on function public.shop_effective_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_effective_manager(uuid, uuid) to service_role;

-- Display name of the Entra manager, also when that manager has no nextDesk account.
create or replace function public.shop_manager_label(p_tenant_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select coalesce(profile.display_name, 'Unbekannt')
      from public.tenant_member_directory directory
      left join public.user_profiles profile on profile.id = directory.manager_user_id
      where directory.tenant_id = p_tenant_id
        and directory.user_id = p_user_id
        and directory.manager_user_id is not null
    ),
    (
      select manager.display_name
      from public.tenant_entra_directory_people person
      join public.tenant_entra_directory_people manager
        on manager.tenant_id = person.tenant_id
       and manager.entra_object_id = person.manager_entra_object_id
      where person.tenant_id = p_tenant_id
        and person.local_user_id = p_user_id
      limit 1
    )
  );
$$;

revoke all on function public.shop_manager_label(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_manager_label(uuid, uuid) to service_role;

-- Catalog
-- -------
create table if not exists public.shop_catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id uuid,
  name text not null check (char_length(btrim(name)) between 2 and 160 and name = btrim(name)),
  description text check (description is null or char_length(description) <= 2000),
  category text not null default 'Allgemein'
    check (char_length(btrim(category)) between 2 and 80 and category = btrim(category)),
  kind text not null default 'order' check (kind in ('order', 'loan')),
  requires_approval boolean not null default false,
  max_quantity integer not null default 5 check (max_quantity between 1 and 100),
  max_loan_days integer check (max_loan_days is null or max_loan_days between 1 and 365),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shop_catalog_items_id_tenant_unique unique (id, tenant_id),
  constraint shop_catalog_items_inventory_item_fk
    foreign key (inventory_item_id, tenant_id)
    references public.inventory_items (id, tenant_id)
    on delete set null (inventory_item_id)
);

create index if not exists shop_catalog_items_tenant_active_idx
  on public.shop_catalog_items (tenant_id, active, category, sort_order, name);

-- Orders
-- ------
create table if not exists public.shop_order_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  calendar_year integer not null,
  last_value integer not null default 0,
  primary key (tenant_id, calendar_year)
);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_number text not null,
  client_request_id uuid not null,
  requester_id uuid not null references public.user_profiles(id) on delete restrict,
  status text not null check (status in (
    'pending_approval', 'submitted', 'in_progress', 'ready',
    'issued', 'loaned', 'returned', 'rejected', 'cancelled'
  )),
  approver_id uuid references public.user_profiles(id) on delete set null,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  handled_by uuid references public.user_profiles(id) on delete set null,
  delivery_method text not null default 'pickup' check (delivery_method in ('pickup', 'desk')),
  delivery_location text check (delivery_location is null or char_length(delivery_location) <= 200),
  needed_by date,
  loan_from date,
  loan_until date,
  comment text check (comment is null or char_length(comment) <= 2000),
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 1000),
  issued_at timestamptz,
  returned_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shop_orders_id_tenant_unique unique (id, tenant_id),
  constraint shop_orders_number_unique unique (tenant_id, order_number),
  constraint shop_orders_client_request_unique unique (tenant_id, client_request_id),
  constraint shop_orders_loan_period_valid
    check (loan_from is null or loan_until is null or loan_until >= loan_from)
);

create index if not exists shop_orders_requester_idx
  on public.shop_orders (tenant_id, requester_id, created_at desc);
create index if not exists shop_orders_status_idx
  on public.shop_orders (tenant_id, status, created_at desc);
create index if not exists shop_orders_approver_idx
  on public.shop_orders (tenant_id, approver_id)
  where status = 'pending_approval';

create table if not exists public.shop_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  catalog_item_id uuid,
  inventory_item_id uuid,
  item_name text not null,
  kind text not null check (kind in ('order', 'loan')),
  quantity integer not null check (quantity between 1 and 100),
  status text not null default 'open'
    check (status in ('open', 'reserved', 'backorder', 'issued', 'returned', 'cancelled')),
  reservation_id uuid,
  location_id uuid,
  serial_unit_id uuid,
  issued_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shop_order_lines_order_fk
    foreign key (order_id, tenant_id) references public.shop_orders (id, tenant_id) on delete cascade,
  constraint shop_order_lines_catalog_fk
    foreign key (catalog_item_id, tenant_id) references public.shop_catalog_items (id, tenant_id)
    on delete set null (catalog_item_id),
  constraint shop_order_lines_inventory_item_fk
    foreign key (inventory_item_id, tenant_id) references public.inventory_items (id, tenant_id)
    on delete set null (inventory_item_id),
  constraint shop_order_lines_reservation_fk
    foreign key (reservation_id, tenant_id) references public.inventory_reservations (id, tenant_id)
    on delete set null (reservation_id),
  constraint shop_order_lines_location_fk
    foreign key (location_id, tenant_id) references public.inventory_locations (id, tenant_id)
    on delete set null (location_id),
  constraint shop_order_lines_serial_fk
    foreign key (serial_unit_id, tenant_id) references public.inventory_serial_units (id, tenant_id)
    on delete set null (serial_unit_id)
);

create index if not exists shop_order_lines_order_idx on public.shop_order_lines (order_id);

create table if not exists public.shop_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  note text check (note is null or char_length(note) <= 2000),
  internal boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint shop_order_events_order_fk
    foreign key (order_id, tenant_id) references public.shop_orders (id, tenant_id) on delete cascade
);

create index if not exists shop_order_events_order_idx on public.shop_order_events (order_id, created_at);

-- Only the audited Edge Function (service role) reads and writes shop data.
alter table public.shop_catalog_items enable row level security;
alter table public.shop_order_sequences enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_lines enable row level security;
alter table public.shop_order_events enable row level security;
revoke all on table public.shop_catalog_items, public.shop_order_sequences, public.shop_orders,
  public.shop_order_lines, public.shop_order_events from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_catalog_items, public.shop_order_sequences,
  public.shop_orders, public.shop_order_lines, public.shop_order_events to service_role;

-- Helpers
-- -------
create or replace function public.shop_next_order_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_year integer := extract(year from timezone('Europe/Zurich', now()))::integer;
  v_value integer;
begin
  insert into public.shop_order_sequences (tenant_id, calendar_year, last_value)
  values (p_tenant_id, v_year, 1)
  on conflict (tenant_id, calendar_year)
  do update set last_value = public.shop_order_sequences.last_value + 1
  returning last_value into v_value;
  return format('B-%s-%s', v_year, lpad(v_value::text, 6, '0'));
end;
$$;

revoke all on function public.shop_next_order_number(uuid) from public, anon, authenticated;

create or replace function public.shop_notify(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_order_id uuid,
  p_extra jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.shop_orders%rowtype;
begin
  if p_user_id is null then
    return;
  end if;
  select * into v_order from public.shop_orders where id = p_order_id and tenant_id = p_tenant_id;
  insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
  values (
    p_tenant_id, p_user_id, null, p_kind,
    jsonb_build_object('orderId', p_order_id, 'orderNumber', v_order.order_number) || coalesce(p_extra, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.shop_notify(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Notifies every person who may process orders.
create or replace function public.shop_notify_fulfillers(
  p_tenant_id uuid,
  p_kind text,
  p_order_id uuid,
  p_except_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select distinct membership.user_id
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.status = 'active'
      and membership.user_id is distinct from p_except_user_id
      and public.shop_has_permission(membership.user_id, p_tenant_id, 'shop.fulfill')
  loop
    perform public.shop_notify(p_tenant_id, v_user_id, p_kind, p_order_id);
  end loop;
end;
$$;

revoke all on function public.shop_notify_fulfillers(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.shop_log(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_note text default null,
  p_internal boolean default false
)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  insert into public.shop_order_events (tenant_id, order_id, actor_id, event_type, note, internal)
  values (p_tenant_id, p_order_id, p_actor_id, p_event_type, nullif(btrim(coalesce(p_note, '')), ''), p_internal);
$$;

revoke all on function public.shop_log(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;

-- Reserves stock for one open/backorder line of a quantity-tracked item.
-- Serial-tracked and free (non-inventory) items are handled at hand-out.
create or replace function public.shop_try_reserve_line(
  p_actor_id uuid,
  p_line_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shop_order_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_location_id uuid;
  v_reservation_id uuid;
begin
  select * into v_line from public.shop_order_lines where id = p_line_id for update;
  if not found or v_line.status not in ('open', 'backorder') or v_line.inventory_item_id is null then
    return coalesce(v_line.status, 'open');
  end if;
  select * into v_item from public.inventory_items
  where id = v_line.inventory_item_id and tenant_id = v_line.tenant_id;
  if not found or v_item.tracking_mode <> 'quantity' then
    return v_line.status;
  end if;

  select balance.location_id into v_location_id
  from public.inventory_stock_balances balance
  join public.inventory_locations location
    on location.id = balance.location_id and location.tenant_id = balance.tenant_id and location.active
  where balance.tenant_id = v_line.tenant_id
    and balance.item_id = v_line.inventory_item_id
    and balance.physical_quantity - balance.reserved_quantity >= v_line.quantity
  order by balance.physical_quantity - balance.reserved_quantity desc, location.name
  limit 1;

  if v_location_id is null then
    update public.shop_order_lines
       set status = 'backorder', updated_at = timezone('utc', now())
     where id = v_line.id;
    return 'backorder';
  end if;

  insert into public.inventory_reservations (
    tenant_id, item_id, location_id, quantity, created_by
  ) values (
    v_line.tenant_id, v_line.inventory_item_id, v_location_id, v_line.quantity, p_actor_id
  ) returning id into v_reservation_id;

  perform public.inventory_apply_event(
    v_line.tenant_id, p_actor_id, gen_random_uuid(), 'reservation_hold',
    jsonb_build_array(jsonb_build_object(
      'item_id', v_line.inventory_item_id,
      'location_id', v_location_id,
      'physical_delta', 0,
      'reserved_delta', v_line.quantity
    )),
    'reservation', v_reservation_id
  );

  update public.shop_order_lines
     set status = 'reserved',
         reservation_id = v_reservation_id,
         location_id = v_location_id,
         updated_at = timezone('utc', now())
   where id = v_line.id;
  return 'reserved';
end;
$$;

revoke all on function public.shop_try_reserve_line(uuid, uuid) from public, anon, authenticated;

create or replace function public.shop_release_line(p_actor_id uuid, p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shop_order_lines%rowtype;
  v_reservation public.inventory_reservations%rowtype;
begin
  select * into v_line from public.shop_order_lines where id = p_line_id for update;
  if not found then
    return;
  end if;
  if v_line.reservation_id is not null then
    select * into v_reservation from public.inventory_reservations
    where id = v_line.reservation_id and tenant_id = v_line.tenant_id
    for update;
    if found and v_reservation.status = 'open' then
      perform public.inventory_apply_event(
        v_line.tenant_id, p_actor_id, gen_random_uuid(), 'reservation_release',
        jsonb_build_array(jsonb_build_object(
          'item_id', v_reservation.item_id,
          'location_id', v_reservation.location_id,
          'serial_unit_id', v_reservation.serial_unit_id,
          'physical_delta', 0,
          'reserved_delta', -v_reservation.quantity
        )),
        'reservation', v_reservation.id
      );
      update public.inventory_reservations
         set status = 'released', released_at = timezone('utc', now()), released_by = p_actor_id
       where id = v_reservation.id;
    end if;
  end if;
  if v_line.status not in ('issued', 'returned') then
    update public.shop_order_lines
       set status = 'cancelled', updated_at = timezone('utc', now())
     where id = v_line.id;
  end if;
end;
$$;

revoke all on function public.shop_release_line(uuid, uuid) from public, anon, authenticated;

-- Submit
-- ------
-- p_lines: [{"catalog_item_id": "...", "quantity": 1}]
create or replace function public.shop_submit_order(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_lines jsonb,
  p_delivery_method text,
  p_delivery_location text,
  p_needed_by date,
  p_loan_from date,
  p_loan_until date,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing uuid;
  v_order_id uuid;
  v_input jsonb;
  v_item public.shop_catalog_items%rowtype;
  v_quantity integer;
  v_needs_approval boolean := false;
  v_has_loan boolean := false;
  v_max_loan_days integer;
  v_approver uuid;
  v_line record;
  v_seen uuid[] := '{}';
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 30
     or coalesce(p_delivery_method, 'pickup') not in ('pickup', 'desk') then
    raise exception 'Invalid shop order' using errcode = '22023';
  end if;
  if not public.shop_feature_enabled(p_tenant_id) then
    raise exception 'The shop is not enabled' using errcode = '42501';
  end if;
  if not public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.order') then
    raise exception 'Not allowed to order' using errcode = '42501';
  end if;

  select id into v_existing from public.shop_orders
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id;
  if found then
    return v_existing;
  end if;

  insert into public.shop_orders (
    tenant_id, order_number, client_request_id, requester_id, status,
    delivery_method, delivery_location, needed_by, loan_from, loan_until, comment
  ) values (
    p_tenant_id, public.shop_next_order_number(p_tenant_id), p_client_request_id, p_actor_id, 'submitted',
    coalesce(p_delivery_method, 'pickup'), nullif(btrim(coalesce(p_delivery_location, '')), ''),
    p_needed_by, p_loan_from, p_loan_until, nullif(btrim(coalesce(p_comment, '')), '')
  ) returning id into v_order_id;

  for v_input in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.shop_catalog_items
    where id = (v_input ->> 'catalog_item_id')::uuid and tenant_id = p_tenant_id and active;
    if not found then
      raise exception 'Catalog item is not available' using errcode = 'P0002';
    end if;
    if v_item.id = any(v_seen) then
      raise exception 'Catalog item listed twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_item.id;
    v_quantity := (v_input ->> 'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > v_item.max_quantity then
      raise exception 'Invalid quantity for %', v_item.name using errcode = '22023';
    end if;
    if v_item.requires_approval then
      v_needs_approval := true;
    end if;
    if v_item.kind = 'loan' then
      v_has_loan := true;
      v_max_loan_days := least(coalesce(v_max_loan_days, v_item.max_loan_days), coalesce(v_item.max_loan_days, v_max_loan_days));
    end if;
    insert into public.shop_order_lines (
      tenant_id, order_id, catalog_item_id, inventory_item_id, item_name, kind, quantity
    ) values (
      p_tenant_id, v_order_id, v_item.id, v_item.inventory_item_id, v_item.name, v_item.kind, v_quantity
    );
  end loop;

  if v_has_loan then
    if p_loan_from is null or p_loan_until is null or p_loan_until < p_loan_from
       or p_loan_from < (timezone('Europe/Zurich', now()))::date then
      raise exception 'A loan needs a valid period' using errcode = '22023';
    end if;
    if v_max_loan_days is not null and p_loan_until - p_loan_from + 1 > v_max_loan_days then
      raise exception 'Loan period exceeds % days', v_max_loan_days using errcode = '22023';
    end if;
  elsif p_loan_from is not null or p_loan_until is not null then
    update public.shop_orders set loan_from = null, loan_until = null where id = v_order_id;
  end if;

  perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'submitted');

  if v_needs_approval then
    v_approver := public.shop_effective_manager(p_tenant_id, p_actor_id);
    update public.shop_orders
       set status = 'pending_approval', approver_id = v_approver
     where id = v_order_id;
    perform public.shop_log(p_tenant_id, v_order_id, null, 'approval_requested',
      case when v_approver is null then 'Keine vorgesetzte Person hinterlegt – Freigabe durch den Support.' end);
    if v_approver is not null then
      perform public.shop_notify(p_tenant_id, v_approver, 'shop.order.approval_requested', v_order_id);
    else
      perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.approval_requested', v_order_id, p_actor_id);
    end if;
  else
    for v_line in select id from public.shop_order_lines where order_id = v_order_id loop
      perform public.shop_try_reserve_line(p_actor_id, v_line.id);
    end loop;
    perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.submitted', v_order_id, p_actor_id);
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'shop.order.submitted', 'shop_order', v_order_id, 'info',
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'approval', v_needs_approval));

  return v_order_id;
end;
$$;

revoke all on function public.shop_submit_order(uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  from public, anon, authenticated;
grant execute on function public.shop_submit_order(uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  to service_role;

-- Transitions
-- -----------
-- p_action: approve | reject_approval | accept | ready | issue | return | reject | cancel | note
-- p_payload: {"reason": "...", "note": "...", "lines": [{"line_id": "...", "location_id": "...", "serial_unit_id": "..."}]}
create or replace function public.shop_update_order(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.shop_orders%rowtype;
  v_line public.shop_order_lines%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_item public.inventory_items%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_reason text := nullif(btrim(coalesce(v_payload ->> 'reason', '')), '');
  v_note text := nullif(btrim(coalesce(v_payload ->> 'note', '')), '');
  v_is_fulfiller boolean;
  v_choice jsonb;
  v_location_id uuid;
  v_serial_unit_id uuid;
  v_status text;
  v_open_loans integer;
begin
  if p_actor_id is null or p_tenant_id is null or p_order_id is null or p_action is null then
    raise exception 'Invalid shop action' using errcode = '22023';
  end if;
  if not public.shop_feature_enabled(p_tenant_id) then
    raise exception 'The shop is not enabled' using errcode = '42501';
  end if;
  select * into v_order from public.shop_orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  v_is_fulfiller := public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.fulfill');

  if p_action in ('approve', 'reject_approval') then
    if v_order.status <> 'pending_approval' then
      raise exception 'Order is not waiting for approval' using errcode = '23514';
    end if;
    -- The manager decides. Without a known manager the support decides.
    if not (
      v_order.approver_id = p_actor_id
      or (v_order.approver_id is null and v_is_fulfiller)
    ) or v_order.requester_id = p_actor_id then
      raise exception 'Not allowed to decide this approval' using errcode = '42501';
    end if;
    if p_action = 'approve' then
      update public.shop_orders
         set status = 'submitted', approved_by = p_actor_id, approved_at = timezone('utc', now()),
             decision_reason = v_reason, updated_at = timezone('utc', now())
       where id = v_order.id;
      perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'approved', v_reason);
      for v_line in select * from public.shop_order_lines where order_id = v_order.id loop
        perform public.shop_try_reserve_line(p_actor_id, v_line.id);
      end loop;
      perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.approved', v_order.id);
      perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.submitted', v_order.id, p_actor_id);
      return 'submitted';
    end if;
    if v_reason is null then
      raise exception 'A reason is required' using errcode = '22023';
    end if;
    for v_line in select * from public.shop_order_lines where order_id = v_order.id loop
      perform public.shop_release_line(p_actor_id, v_line.id);
    end loop;
    update public.shop_orders
       set status = 'rejected', decision_reason = v_reason, closed_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'approval_rejected', v_reason);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.rejected', v_order.id,
      jsonb_build_object('reason', v_reason));
    return 'rejected';
  end if;

  if p_action = 'cancel' then
    if v_order.requester_id <> p_actor_id and not v_is_fulfiller then
      raise exception 'Not allowed to cancel this order' using errcode = '42501';
    end if;
    if v_order.status not in ('pending_approval', 'submitted', 'in_progress', 'ready') then
      raise exception 'Order can no longer be cancelled' using errcode = '23514';
    end if;
    for v_line in select * from public.shop_order_lines where order_id = v_order.id loop
      perform public.shop_release_line(p_actor_id, v_line.id);
    end loop;
    update public.shop_orders
       set status = 'cancelled', decision_reason = coalesce(v_reason, decision_reason),
           closed_at = timezone('utc', now()), updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'cancelled', v_reason);
    if v_order.requester_id = p_actor_id then
      perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.cancelled', v_order.id, p_actor_id);
    else
      perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.cancelled', v_order.id);
    end if;
    return 'cancelled';
  end if;

  if p_action = 'note' then
    if v_note is null then
      raise exception 'A note is required' using errcode = '22023';
    end if;
    if v_is_fulfiller then
      perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'note',
        v_note, coalesce((v_payload ->> 'internal')::boolean, true));
    elsif v_order.requester_id = p_actor_id then
      perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'note', v_note, false);
      perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.note', v_order.id, p_actor_id);
    else
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    return v_order.status;
  end if;

  -- Everything below is agent work.
  if not v_is_fulfiller then
    raise exception 'Not allowed to process orders' using errcode = '42501';
  end if;

  if p_action = 'accept' then
    if v_order.status <> 'submitted' then
      raise exception 'Only new orders can be accepted' using errcode = '23514';
    end if;
    update public.shop_orders
       set status = 'in_progress', handled_by = p_actor_id, updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'accepted', v_note);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.in_progress', v_order.id);
    return 'in_progress';
  end if;

  if p_action = 'ready' then
    if v_order.status not in ('submitted', 'in_progress') then
      raise exception 'Order cannot be marked ready' using errcode = '23514';
    end if;
    for v_line in select * from public.shop_order_lines
                  where order_id = v_order.id and status in ('open', 'backorder') loop
      perform public.shop_try_reserve_line(p_actor_id, v_line.id);
    end loop;
    update public.shop_orders
       set status = 'ready', handled_by = coalesce(handled_by, p_actor_id), updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'ready', v_note);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.ready', v_order.id);
    return 'ready';
  end if;

  if p_action = 'reject' then
    if v_order.status not in ('submitted', 'in_progress', 'ready', 'pending_approval') then
      raise exception 'Order can no longer be rejected' using errcode = '23514';
    end if;
    if v_reason is null then
      raise exception 'A reason is required' using errcode = '22023';
    end if;
    for v_line in select * from public.shop_order_lines where order_id = v_order.id loop
      perform public.shop_release_line(p_actor_id, v_line.id);
    end loop;
    update public.shop_orders
       set status = 'rejected', decision_reason = v_reason, handled_by = coalesce(handled_by, p_actor_id),
           closed_at = timezone('utc', now()), updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'rejected', v_reason);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.rejected', v_order.id,
      jsonb_build_object('reason', v_reason));
    return 'rejected';
  end if;

  if p_action = 'issue' then
    if v_order.status not in ('submitted', 'in_progress', 'ready') then
      raise exception 'Order cannot be handed out' using errcode = '23514';
    end if;
    for v_line in select * from public.shop_order_lines
                  where order_id = v_order.id and status in ('open', 'reserved', 'backorder')
                  for update loop
      v_choice := (
        select value from jsonb_array_elements(coalesce(v_payload -> 'lines', '[]'::jsonb))
        where value ->> 'line_id' = v_line.id::text
        limit 1
      );
      v_location_id := nullif(v_choice ->> 'location_id', '')::uuid;
      v_serial_unit_id := nullif(v_choice ->> 'serial_unit_id', '')::uuid;

      if v_line.inventory_item_id is not null then
        select * into v_item from public.inventory_items
        where id = v_line.inventory_item_id and tenant_id = p_tenant_id;
      end if;

      if v_line.inventory_item_id is null or not found then
        -- Free item (procured outside the inventory): nothing to book.
        null;
      elsif v_item.tracking_mode = 'serial' then
        if v_serial_unit_id is null or v_location_id is null then
          raise exception 'Serial number and location are required for %', v_line.item_name using errcode = '22023';
        end if;
        if v_line.quantity <> 1 then
          raise exception 'Serial-tracked items are handed out one at a time' using errcode = '22023';
        end if;
        perform public.inventory_apply_event(
          p_tenant_id, p_actor_id, gen_random_uuid(), 'movement_issue',
          jsonb_build_array(jsonb_build_object(
            'item_id', v_line.inventory_item_id, 'location_id', v_location_id,
            'serial_unit_id', v_serial_unit_id, 'physical_delta', -1, 'reserved_delta', 0
          )),
          null, null
        );
      elsif v_line.reservation_id is not null
            and (v_location_id is null or v_location_id = v_line.location_id) then
        select * into v_reservation from public.inventory_reservations
        where id = v_line.reservation_id and tenant_id = p_tenant_id
        for update;
        if not found or v_reservation.status <> 'open' then
          raise exception 'Reservation for % is no longer open', v_line.item_name using errcode = '23514';
        end if;
        perform public.inventory_apply_event(
          p_tenant_id, p_actor_id, gen_random_uuid(), 'movement_issue',
          jsonb_build_array(jsonb_build_object(
            'item_id', v_reservation.item_id, 'location_id', v_reservation.location_id,
            'physical_delta', -v_reservation.quantity, 'reserved_delta', -v_reservation.quantity
          )),
          'reservation', v_reservation.id
        );
        update public.inventory_reservations
           set status = 'consumed', consumed_at = timezone('utc', now()), consumed_by = p_actor_id
         where id = v_reservation.id;
        v_location_id := v_reservation.location_id;
      else
        -- No (matching) reservation: release a different one and book from the chosen
        -- or the best stocked location.
        if v_line.reservation_id is not null then
          perform public.shop_release_line(p_actor_id, v_line.id);
          update public.shop_order_lines set status = 'open', reservation_id = null where id = v_line.id;
        end if;
        if v_location_id is null then
          select balance.location_id into v_location_id
          from public.inventory_stock_balances balance
          where balance.tenant_id = p_tenant_id
            and balance.item_id = v_line.inventory_item_id
            and balance.physical_quantity - balance.reserved_quantity >= v_line.quantity
          order by balance.physical_quantity - balance.reserved_quantity desc
          limit 1;
        end if;
        if v_location_id is null then
          raise exception 'Not enough stock for %', v_line.item_name using errcode = '23514';
        end if;
        perform public.inventory_apply_event(
          p_tenant_id, p_actor_id, gen_random_uuid(), 'movement_issue',
          jsonb_build_array(jsonb_build_object(
            'item_id', v_line.inventory_item_id, 'location_id', v_location_id,
            'physical_delta', -v_line.quantity, 'reserved_delta', 0
          )),
          null, null
        );
      end if;

      update public.shop_order_lines
         set status = 'issued', issued_at = timezone('utc', now()),
             location_id = coalesce(v_location_id, location_id),
             serial_unit_id = coalesce(v_serial_unit_id, serial_unit_id),
             updated_at = timezone('utc', now())
       where id = v_line.id;
    end loop;

    select count(*) into v_open_loans from public.shop_order_lines
    where order_id = v_order.id and kind = 'loan' and status = 'issued';
    v_status := case when v_open_loans > 0 then 'loaned' else 'issued' end;
    update public.shop_orders
       set status = v_status, issued_at = timezone('utc', now()),
           handled_by = coalesce(handled_by, p_actor_id),
           closed_at = case when v_status = 'issued' then timezone('utc', now()) end,
           updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'issued', v_note);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.issued', v_order.id);
    return v_status;
  end if;

  if p_action = 'return' then
    if v_order.status <> 'loaned' then
      raise exception 'Only loaned orders can be returned' using errcode = '23514';
    end if;
    for v_line in select * from public.shop_order_lines
                  where order_id = v_order.id and kind = 'loan' and status = 'issued'
                  for update loop
      v_choice := (
        select value from jsonb_array_elements(coalesce(v_payload -> 'lines', '[]'::jsonb))
        where value ->> 'line_id' = v_line.id::text
        limit 1
      );
      v_location_id := coalesce(nullif(v_choice ->> 'location_id', '')::uuid, v_line.location_id);
      if v_line.inventory_item_id is not null and v_location_id is not null then
        perform public.inventory_apply_event(
          p_tenant_id, p_actor_id, gen_random_uuid(), 'movement_receipt',
          jsonb_build_array(jsonb_build_object(
            'item_id', v_line.inventory_item_id, 'location_id', v_location_id,
            'serial_unit_id', v_line.serial_unit_id,
            'physical_delta', v_line.quantity, 'reserved_delta', 0
          )),
          null, null
        );
      end if;
      update public.shop_order_lines
         set status = 'returned', returned_at = timezone('utc', now()),
             location_id = coalesce(v_location_id, location_id), updated_at = timezone('utc', now())
       where id = v_line.id;
    end loop;
    update public.shop_orders
       set status = 'returned', returned_at = timezone('utc', now()), closed_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'returned', v_note);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.returned', v_order.id);
    return 'returned';
  end if;

  raise exception 'Unknown shop action' using errcode = '22023';
end;
$$;

revoke all on function public.shop_update_order(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.shop_update_order(uuid, uuid, uuid, text, jsonb) to service_role;

-- Push: shop notifications form their own preference category.
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    else null
  end;
$$;

revoke all on function public.push_notification_category(text) from public, anon, authenticated;

create or replace function public.push_enqueue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_category text;
  v_categories text[];
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null then
    return new;
  end if;

  if new.kind = 'inventory.low_stock' then
    if not public.inventory_low_stock_delivery_authorized(new.tenant_id, new.user_id) then
      return new;
    end if;
  elsif not public.push_tenant_feature_enabled(new.tenant_id)
    or not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = new.tenant_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
    )
    or not exists (
      select 1
      from public.push_devices device
      where device.tenant_id = new.tenant_id
        and device.user_id = new.user_id
        and device.enabled
    ) then
    return new;
  end if;

  select preference.enabled_categories
  into v_categories
  from public.push_preferences preference
  where preference.tenant_id = new.tenant_id
    and preference.user_id = new.user_id;
  v_categories := coalesce(v_categories, array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline', 'shop'
  ]::text[]);
  if not v_category = any(v_categories) then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.push_enqueue_ticket_notification()
  from public, anon, authenticated;

alter table public.push_preferences
  drop constraint if exists push_preferences_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_categories_valid
  check (
    enabled_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'inventory_low_stock', 'shop'
    ]::text[]
    and public.push_categories_are_unique(enabled_categories)
  );

-- Existing preferences predate the shop category: enable it once.
update public.push_preferences
   set enabled_categories = array_append(enabled_categories, 'shop')
 where not ('shop' = any(enabled_categories));

commit;
