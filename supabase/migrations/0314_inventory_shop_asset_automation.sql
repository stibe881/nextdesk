begin;

set local search_path = pg_catalog, public;

-- Lager, Shop, Assets und Intune automatisieren (Teil D):
--  * Ausgabe einer Serieneinheit mit Asset (Shop «übergeben» bzw. Ausgabe einer
--    Ticket-Reservation) erstellt die Gerätezuweisung an die Person, die
--    Rückgabe beendet sie.
--  * Rückgaben (Austritt, Shop-Ausleihe) buchen das Gerät als Serieneinheit an
--    einen wählbaren Lagerort (Standard pro Mandant bzw. Abteilung).
--  * Austritt: Rückgabe offener Shop-Ausleihen und Entzug von Lizenzen als
--    Aufgaben; der Abschluss bucht zurück bzw. gibt die Lizenz frei.
--  * Shop-Erinnerungen (Ausleihe fällig/überfällig, Genehmigung offen).
--  * Lager-Automatik: abgelaufene Reservationen freigeben, Nachbestellung bei
--    Mindestbestand, Inventur-Erinnerung pro Lagerort.
--  * Bestellung im Namen einer Person ohne Genehmigung (z. B. Ersatzgerät aus
--    einem Sicherheitsfall).
--  * Täglicher Intune-Abgleich (Assets und IPAM aus einem Geräteabruf).

-- ------------------------------------------------------------------ Schema

alter table public.asset_assignments
  add column if not exists shop_order_line_id uuid,
  add column if not exists inventory_reservation_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_assignments_shop_order_line_fk') then
    alter table public.asset_assignments
      add constraint asset_assignments_shop_order_line_fk
      foreign key (shop_order_line_id) references public.shop_order_lines(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_assignments_inventory_reservation_fk') then
    alter table public.asset_assignments
      add constraint asset_assignments_inventory_reservation_fk
      foreign key (inventory_reservation_id) references public.inventory_reservations(id) on delete set null;
  end if;
end;
$$;

create index if not exists asset_assignments_shop_line_idx
  on public.asset_assignments (shop_order_line_id)
  where shop_order_line_id is not null;

create index if not exists inventory_event_lines_serial_unit_idx
  on public.inventory_event_lines (tenant_id, serial_unit_id)
  where serial_unit_id is not null;

create table if not exists public.inventory_automation_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  default_return_location_id uuid,
  reorder_notify boolean not null default true,
  reorder_create_task boolean not null default false,
  reservation_hold_days integer check (reservation_hold_days is null or reservation_hold_days between 1 and 365),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint inventory_automation_settings_location_fk
    foreign key (default_return_location_id, tenant_id)
    references public.inventory_locations (id, tenant_id)
    on delete set null (default_return_location_id)
);

create table if not exists public.inventory_department_return_locations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  location_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, department_id),
  constraint inventory_department_return_locations_location_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete cascade
);

alter table public.inventory_locations
  add column if not exists count_interval_days integer,
  add column if not exists count_reminded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_locations_count_interval_check') then
    alter table public.inventory_locations
      add constraint inventory_locations_count_interval_check
      check (count_interval_days is null or count_interval_days between 7 and 730);
  end if;
end;
$$;

alter table public.inventory_reservations
  add column if not exists expires_at timestamptz,
  add column if not exists expired_at timestamptz;

create index if not exists inventory_reservations_open_expiry_idx
  on public.inventory_reservations (tenant_id, created_at)
  where status = 'open';

alter table public.inventory_low_stock_episodes
  add column if not exists reorder_handled_at timestamptz;

create table if not exists public.inventory_reorder_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  episode_id uuid,
  suggested_quantity numeric(18,3) not null check (suggested_quantity > 0),
  status text not null default 'open' check (status in ('open', 'ordered', 'done', 'dismissed')),
  note text check (note is null or char_length(note) <= 1000),
  handled_by uuid references public.user_profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reorder_requests_item_fk
    foreign key (item_id, tenant_id) references public.inventory_items (id, tenant_id) on delete cascade,
  constraint inventory_reorder_requests_episode_fk
    foreign key (episode_id) references public.inventory_low_stock_episodes(id) on delete set null
);

create unique index if not exists inventory_reorder_requests_episode_unique
  on public.inventory_reorder_requests (episode_id)
  where episode_id is not null;
create unique index if not exists inventory_reorder_requests_open_item_unique
  on public.inventory_reorder_requests (tenant_id, item_id)
  where status in ('open', 'ordered');
create index if not exists inventory_reorder_requests_tenant_status_idx
  on public.inventory_reorder_requests (tenant_id, status, created_at desc);

alter table public.shop_order_lines
  add column if not exists loan_due_notified_at timestamptz,
  add column if not exists loan_overdue_notified_at timestamptz,
  add column if not exists loan_overdue_manager_notified_at timestamptz;

alter table public.shop_orders
  add column if not exists approval_reminded_at timestamptz,
  add column if not exists approval_escalated_at timestamptz,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists source_reference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_orders_source_valid') then
    alter table public.shop_orders
      add constraint shop_orders_source_valid
      check (
        (source_type is null and source_id is null and source_reference is null)
        or (
          source_type in ('security_case')
          and source_id is not null
          and (source_reference is null or (
            char_length(btrim(source_reference)) between 1 and 60
            and source_reference = btrim(source_reference)
            and source_reference !~ '[[:cntrl:]]'
          ))
        )
      );
  end if;
end;
$$;

create index if not exists shop_orders_pending_approval_age_idx
  on public.shop_orders (created_at)
  where status = 'pending_approval';
create index if not exists shop_order_lines_open_loans_idx
  on public.shop_order_lines (tenant_id, loan_until)
  where kind = 'loan' and status = 'issued';

alter table public.onboarding_tasks
  add column if not exists completed_by uuid references public.user_profiles(id) on delete set null;

alter table public.onboarding_asset_returns
  add column if not exists return_location_id uuid,
  add column if not exists stock_result text,
  add column if not exists stock_booked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'onboarding_asset_returns_location_fk') then
    alter table public.onboarding_asset_returns
      add constraint onboarding_asset_returns_location_fk
      foreign key (return_location_id, tenant_id)
      references public.inventory_locations (id, tenant_id)
      on delete set null (return_location_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'onboarding_asset_returns_stock_result_check') then
    alter table public.onboarding_asset_returns
      add constraint onboarding_asset_returns_stock_result_check
      check (stock_result is null or stock_result in (
        'booked', 'already_in_stock', 'no_serial_unit', 'no_location', 'failed'
      ));
  end if;
end;
$$;

create table if not exists public.onboarding_loan_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  order_line_id uuid not null references public.shop_order_lines(id) on delete cascade,
  return_location_id uuid,
  result text check (result is null or result in ('returned', 'skipped', 'failed')),
  created_at timestamptz not null default now(),
  constraint onboarding_loan_returns_task_unique unique (task_id),
  constraint onboarding_loan_returns_line_unique unique (order_line_id),
  constraint onboarding_loan_returns_task_tenant_fk
    foreign key (task_id, tenant_id) references public.onboarding_tasks (id, tenant_id) on delete cascade,
  constraint onboarding_loan_returns_location_fk
    foreign key (return_location_id, tenant_id)
    references public.inventory_locations (id, tenant_id)
    on delete set null (return_location_id)
);

create table if not exists public.onboarding_license_revocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  license_assignment_id uuid not null references public.license_assignments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint onboarding_license_revocations_task_unique unique (task_id),
  constraint onboarding_license_revocations_assignment_unique unique (license_assignment_id),
  constraint onboarding_license_revocations_task_tenant_fk
    foreign key (task_id, tenant_id) references public.onboarding_tasks (id, tenant_id) on delete cascade
);

alter table public.inventory_automation_settings enable row level security;
alter table public.inventory_department_return_locations enable row level security;
alter table public.inventory_reorder_requests enable row level security;
alter table public.onboarding_loan_returns enable row level security;
alter table public.onboarding_license_revocations enable row level security;
revoke all on table public.inventory_automation_settings, public.inventory_department_return_locations,
  public.inventory_reorder_requests, public.onboarding_loan_returns, public.onboarding_license_revocations
  from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_automation_settings,
  public.inventory_department_return_locations, public.inventory_reorder_requests,
  public.onboarding_loan_returns, public.onboarding_license_revocations
  to service_role;

-- --------------------------------------------------------- Lagerorte & Assets

-- Standard-Lagerort für Rücknahmen: zuerst der Lagerort der Abteilung, sonst
-- der des Mandanten. Nur aktive Lagerorte.
create or replace function public.inventory_default_return_location(
  p_tenant_id uuid,
  p_department_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select department.location_id
      from public.inventory_department_return_locations department
      join public.inventory_locations location
        on location.id = department.location_id
       and location.tenant_id = department.tenant_id
       and location.active
      where department.tenant_id = p_tenant_id
        and department.department_id = p_department_id
    ),
    (
      select settings.default_return_location_id
      from public.inventory_automation_settings settings
      join public.inventory_locations location
        on location.id = settings.default_return_location_id
       and location.tenant_id = settings.tenant_id
       and location.active
      where settings.tenant_id = p_tenant_id
    )
  );
$$;

-- Physischer Bestand einer Serieneinheit (0 = ausgegeben, 1 = an Lager).
create or replace function public.inventory_serial_unit_on_hand(
  p_tenant_id uuid,
  p_serial_unit_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(sum(line.physical_delta), 0)
  from public.inventory_event_lines line
  where line.tenant_id = p_tenant_id
    and line.serial_unit_id = p_serial_unit_id;
$$;

-- Bucht ein zurückgenommenes Gerät als Serieneinheit an einen Lagerort. Ohne
-- verknüpfte Serieneinheit bleibt es beim Lebenszyklus «An Lager».
create or replace function public.inventory_book_asset_into_stock(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_location_id uuid,
  p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_serial public.inventory_serial_units%rowtype;
begin
  select unit.* into v_serial
  from public.inventory_serial_units unit
  join public.inventory_items item
    on item.id = unit.item_id and item.tenant_id = unit.tenant_id and item.tracking_mode = 'serial'
  where unit.tenant_id = p_tenant_id
    and unit.asset_id = p_asset_id
    and unit.active
  order by unit.created_at
  limit 1;
  if not found then
    return 'no_serial_unit';
  end if;
  if public.inventory_serial_unit_on_hand(p_tenant_id, v_serial.id) >= 1 then
    return 'already_in_stock';
  end if;
  if p_location_id is null or p_actor_id is null then
    return 'no_location';
  end if;
  perform public.inventory_apply_event(
    p_tenant_id, p_actor_id, gen_random_uuid(), 'movement_receipt',
    jsonb_build_array(jsonb_build_object(
      'item_id', v_serial.item_id,
      'location_id', p_location_id,
      'serial_unit_id', v_serial.id,
      'physical_delta', 1,
      'reserved_delta', 0
    )),
    null, null
  );
  return 'booked';
end;
$$;

-- Gerät an eine Person ausgeben: beendet eine andere aktive Zuweisung,
-- erstellt die neue und setzt den Lebenszyklus auf «In Betrieb».
create or replace function public.asset_assignment_hand_out(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_requester_contact_id uuid,
  p_actor_id uuid,
  p_note text,
  p_shop_order_line_id uuid default null,
  p_inventory_reservation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_existing public.asset_assignments%rowtype;
  v_id uuid;
  v_note text := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 2000), '');
  v_changed integer;
begin
  if p_tenant_id is null or p_asset_id is null or p_requester_contact_id is null then
    raise exception 'Invalid asset hand-out' using errcode = '22023';
  end if;
  select * into v_existing
  from public.asset_assignments held
  where held.tenant_id = p_tenant_id and held.asset_id = p_asset_id and held.returned_at is null
  for update;
  if found then
    if v_existing.requester_id = p_requester_contact_id then
      update public.asset_assignments
         set shop_order_line_id = coalesce(shop_order_line_id, p_shop_order_line_id),
             inventory_reservation_id = coalesce(inventory_reservation_id, p_inventory_reservation_id)
       where id = v_existing.id;
      return v_existing.id;
    end if;
    update public.asset_assignments
       set returned_at = greatest(v_now, assigned_at)
     where id = v_existing.id;
  end if;
  insert into public.asset_assignments (
    tenant_id, asset_id, requester_id, assigned_at, note, assigned_by,
    shop_order_line_id, inventory_reservation_id
  ) values (
    p_tenant_id, p_asset_id, p_requester_contact_id, v_now, v_note, p_actor_id,
    p_shop_order_line_id, p_inventory_reservation_id
  ) returning id into v_id;

  update public.assets device
     set lifecycle_state = 'active', lifecycle_changed_at = v_now
   where device.id = p_asset_id and device.tenant_id = p_tenant_id
     and device.lifecycle_state in ('ordered', 'stock');
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    update public.asset_lifecycle_events history
       set reason = 'Ausgabe an Person'
     where history.asset_id = p_asset_id and history.tenant_id = p_tenant_id
       and history.next_state = 'active' and history.reason is null
       and history.occurred_at = v_now;
  end if;
  return v_id;
end;
$$;

-- Rücknahme: beendet die aktive Zuweisung, Lebenszyklus «An Lager».
create or replace function public.asset_assignment_take_back(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_asset_id uuid;
  v_changed integer;
begin
  update public.asset_assignments held
     set returned_at = greatest(v_now, held.assigned_at)
   where held.id = p_assignment_id and held.tenant_id = p_tenant_id and held.returned_at is null
  returning held.asset_id into v_asset_id;
  if v_asset_id is null then
    return false;
  end if;
  update public.assets device
     set lifecycle_state = 'stock', lifecycle_changed_at = v_now
   where device.id = v_asset_id and device.tenant_id = p_tenant_id
     and device.lifecycle_state in ('active', 'repair');
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    update public.asset_lifecycle_events history
       set reason = left(coalesce(nullif(btrim(p_reason), ''), 'Rückgabe'), 500)
     where history.asset_id = v_asset_id and history.tenant_id = p_tenant_id
       and history.next_state = 'stock' and history.reason is null
       and history.occurred_at = v_now;
  end if;
  return true;
end;
$$;

-- Shop: «übergeben» einer Serieneinheit mit Asset erstellt die Zuweisung, die
-- Rückgabe der Ausleihe beendet sie.
create or replace function public.shop_order_line_asset_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.shop_orders%rowtype;
  v_asset_id uuid;
  v_contact_id uuid;
  v_assignment record;
begin
  if new.status = 'issued' and old.status is distinct from 'issued' and new.serial_unit_id is not null then
    select unit.asset_id into v_asset_id
    from public.inventory_serial_units unit
    where unit.id = new.serial_unit_id and unit.tenant_id = new.tenant_id;
    if v_asset_id is null then
      return null;
    end if;
    select * into v_order from public.shop_orders where id = new.order_id and tenant_id = new.tenant_id;
    if not found then
      return null;
    end if;
    v_contact_id := public.ensure_ticket_user_requester(new.tenant_id, v_order.requester_id, 'manual');
    perform public.asset_assignment_hand_out(
      new.tenant_id, v_asset_id, v_contact_id, coalesce(v_order.handled_by, v_order.placed_by),
      format('Ausgabe aus dem Shop (Bestellung %s)', v_order.order_number),
      new.id, null
    );
  elsif new.status = 'returned' and old.status = 'issued' then
    for v_assignment in
      select held.id from public.asset_assignments held
      where held.tenant_id = new.tenant_id
        and held.shop_order_line_id = new.id
        and held.returned_at is null
    loop
      perform public.asset_assignment_take_back(new.tenant_id, v_assignment.id, 'Rückgabe der Shop-Ausleihe');
    end loop;
  end if;
  return null;
end;
$$;

create or replace trigger shop_order_lines_asset_assignment
  after update of status on public.shop_order_lines
  for each row
  when (new.status is distinct from old.status and new.status in ('issued', 'returned'))
  execute function public.shop_order_line_asset_assignment();

-- Lager: Ausgabe einer Ticket-Reservation mit Serieneinheit/Asset weist das
-- Gerät der anfragenden Person des Tickets zu.
create or replace function public.inventory_reservation_asset_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset_id uuid;
  v_contact_id uuid;
  v_ticket_number text;
begin
  if new.serial_unit_id is null or new.ticket_id is null then
    return null;
  end if;
  select unit.asset_id into v_asset_id
  from public.inventory_serial_units unit
  where unit.id = new.serial_unit_id and unit.tenant_id = new.tenant_id;
  select ticket.requester_contact_id, ticket.ticket_number::text into v_contact_id, v_ticket_number
  from public.tickets ticket
  where ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id;
  if v_asset_id is null or v_contact_id is null then
    return null;
  end if;
  perform public.asset_assignment_hand_out(
    new.tenant_id, v_asset_id, v_contact_id, new.consumed_by,
    format('Ausgabe aus dem Lager (Ticket %s)', coalesce(v_ticket_number, '–')),
    null, new.id
  );
  return null;
end;
$$;

create or replace trigger inventory_reservations_asset_assignment
  after update of status on public.inventory_reservations
  for each row
  when (new.status = 'consumed' and old.status is distinct from 'consumed')
  execute function public.inventory_reservation_asset_assignment();

-- ------------------------------------------------------------ Shop-Rückgabe

-- Gibt eine einzelne Ausleihposition zurück (Austritt). Bucht sie an den
-- gewählten Lagerort, sonst an den Herkunftsort. Ist keine Ausleihe der
-- Bestellung mehr offen, gilt die Bestellung als zurückgegeben.
create or replace function public.shop_return_loan_line(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_line_id uuid,
  p_location_id uuid default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shop_order_lines%rowtype;
  v_order public.shop_orders%rowtype;
  v_location_id uuid;
  v_open integer;
  v_now timestamptz := now();
begin
  if p_actor_id is null or p_tenant_id is null or p_line_id is null then
    raise exception 'Invalid loan return' using errcode = '22023';
  end if;
  select * into v_line from public.shop_order_lines where id = p_line_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Order line not found' using errcode = 'P0002';
  end if;
  -- Gleiche Sperrreihenfolge wie shop_update_order: zuerst die Bestellung.
  select * into v_order from public.shop_orders
  where id = v_line.order_id and tenant_id = p_tenant_id
  for update;
  select * into v_line from public.shop_order_lines where id = p_line_id for update;
  if v_line.kind <> 'loan' or v_line.status <> 'issued' then
    return v_line.status;
  end if;
  v_location_id := coalesce(p_location_id, v_line.location_id);
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
     set status = 'returned', returned_at = v_now,
         location_id = coalesce(v_location_id, location_id), updated_at = v_now
   where id = v_line.id;

  select count(*) into v_open from public.shop_order_lines
  where order_id = v_order.id and kind = 'loan' and status = 'issued';
  if v_open = 0 and v_order.status = 'loaned' then
    update public.shop_orders
       set status = 'returned', returned_at = v_now, closed_at = v_now, updated_at = v_now
     where id = v_order.id;
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'returned', p_note);
    perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.returned', v_order.id);
  else
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'line_returned',
      coalesce(p_note, v_line.item_name), true);
  end if;
  return 'returned';
end;
$$;

-- ------------------------------------------------- Austritt: Abschluss bucht

create or replace function public.onboarding_complete_asset_return()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_link record;
  v_returned integer;
  v_now timestamptz := now();
  v_actor uuid;
  v_location uuid;
  v_result text;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return null;
  end if;
  select coalesce(new.completed_by, new.responsible_user_id, entry.ict_responsible_user_id, entry.created_by)
    into v_actor
  from public.onboarding_entries entry
  where entry.id = new.entry_id and entry.tenant_id = new.tenant_id;

  -- Geräte (Zuweisungen)
  for v_link in
    select link.id, link.assignment_id, link.asset_id, link.tenant_id, link.return_location_id,
           device.department_id
    from public.onboarding_asset_returns link
    left join public.assets device on device.id = link.asset_id and device.tenant_id = link.tenant_id
    where link.task_id = new.id and link.tenant_id = new.tenant_id
  loop
    update public.asset_assignments held
    set returned_at = greatest(v_now, held.assigned_at)
    where held.id = v_link.assignment_id
      and held.tenant_id = v_link.tenant_id
      and held.returned_at is null;
    get diagnostics v_returned = row_count;
    -- Only the return that actually closed the assignment moves the device;
    -- a device that was already handed back and reassigned stays untouched.
    if v_returned = 0 then
      continue;
    end if;
    update public.assets device
    set lifecycle_state = 'stock',
        lifecycle_changed_at = v_now
    where device.id = v_link.asset_id
      and device.tenant_id = v_link.tenant_id
      and device.lifecycle_state in ('active', 'repair');
    -- assets_record_lifecycle wrote the history row in this statement; it
    -- records the reason like the other documented transitions.
    update public.asset_lifecycle_events history
    set reason = 'Rückgabe beim Austritt'
    where history.asset_id = v_link.asset_id
      and history.tenant_id = v_link.tenant_id
      and history.next_state = 'stock'
      and history.reason is null
      and history.occurred_at = v_now;
    -- Als Serieneinheit an den gewählten bzw. Standard-Lagerort buchen.
    v_location := coalesce(
      v_link.return_location_id,
      public.inventory_default_return_location(v_link.tenant_id, v_link.department_id)
    );
    begin
      v_result := public.inventory_book_asset_into_stock(v_link.tenant_id, v_link.asset_id, v_location, v_actor);
    exception when others then
      v_result := 'failed';
    end;
    update public.onboarding_asset_returns
       set stock_result = v_result,
           stock_booked_at = case when v_result = 'booked' then v_now end,
           return_location_id = coalesce(return_location_id, case when v_result = 'booked' then v_location end)
     where id = v_link.id;
  end loop;

  -- Offene Shop-Ausleihen
  for v_link in
    select link.id, link.order_line_id, link.return_location_id, link.tenant_id
    from public.onboarding_loan_returns link
    where link.task_id = new.id and link.tenant_id = new.tenant_id
  loop
    if v_actor is null then
      update public.onboarding_loan_returns set result = 'failed' where id = v_link.id;
      continue;
    end if;
    begin
      v_result := public.shop_return_loan_line(
        v_actor, v_link.tenant_id, v_link.order_line_id,
        coalesce(v_link.return_location_id, public.inventory_default_return_location(v_link.tenant_id, null)),
        'Rückgabe beim Austritt'
      );
      v_result := case when v_result = 'returned' then 'returned' else 'skipped' end;
    exception when others then
      v_result := 'failed';
    end;
    update public.onboarding_loan_returns set result = v_result where id = v_link.id;
  end loop;

  -- Lizenzen entziehen
  update public.license_assignments assignment
     set released_at = greatest(v_now, assignment.assigned_at),
         released_by = v_actor,
         release_reason = 'Austritt',
         updated_at = v_now
    from public.onboarding_license_revocations link
   where link.task_id = new.id
     and link.tenant_id = new.tenant_id
     and assignment.id = link.license_assignment_id
     and assignment.tenant_id = link.tenant_id
     and assignment.released_at is null;
  return null;
end;
$$;

create or replace trigger onboarding_tasks_complete_asset_return
  after update of status on public.onboarding_tasks
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.onboarding_complete_asset_return();

-- ------------------------------------- Bestellung im Namen ohne Genehmigung

-- Agenten (shop.fulfill) bestellen für eine aktive Person ohne Genehmigung,
-- z. B. ein Ersatzgerät aus einem Sicherheitsfall. Die Herkunft wird an der
-- Bestellung gespeichert und im Verlauf vermerkt.
create or replace function public.shop_submit_order_direct(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_requester_id uuid,
  p_client_request_id uuid,
  p_lines jsonb,
  p_delivery_method text,
  p_delivery_location text,
  p_needed_by date,
  p_reason text,
  p_comment text,
  p_source_type text,
  p_source_id uuid,
  p_source_reference text
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
  v_line record;
  v_seen uuid[] := '{}';
  v_line_from date;
  v_line_until date;
  v_min_from date;
  v_max_until date;
  v_has_loan boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reference text := nullif(btrim(coalesce(p_source_reference, '')), '');
  v_now timestamptz := now();
  v_note text;
begin
  if p_actor_id is null or p_tenant_id is null or p_requester_id is null or p_client_request_id is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 30
     or coalesce(p_delivery_method, 'pickup') not in ('pickup', 'desk')
     or (p_source_type is null) <> (p_source_id is null)
     or (p_source_type is not null and p_source_type not in ('security_case'))
     or (v_reason is not null and char_length(v_reason) not between 3 and 500) then
    raise exception 'Invalid shop order' using errcode = '22023';
  end if;
  if not public.shop_feature_enabled(p_tenant_id) then
    raise exception 'The shop is not enabled' using errcode = '42501';
  end if;
  if not (public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.fulfill')
          or public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.manage')) then
    raise exception 'Not allowed to order without approval' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_requester_id
      and membership.status = 'active'
  ) then
    raise exception 'The requester is not an active member' using errcode = '22023';
  end if;

  select id into v_existing from public.shop_orders
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id;
  if found then
    return v_existing;
  end if;

  insert into public.shop_orders (
    tenant_id, order_number, client_request_id, requester_id, placed_by, status,
    approved_by, approved_at, delivery_method, delivery_location, needed_by, comment, reason,
    source_type, source_id, source_reference
  ) values (
    p_tenant_id, public.shop_next_order_number(p_tenant_id), p_client_request_id, p_requester_id,
    case when p_requester_id <> p_actor_id then p_actor_id end, 'submitted',
    p_actor_id, v_now,
    coalesce(p_delivery_method, 'pickup'), nullif(btrim(coalesce(p_delivery_location, '')), ''),
    p_needed_by, nullif(btrim(coalesce(p_comment, '')), ''), v_reason,
    p_source_type, p_source_id, case when p_source_type is not null then left(v_reference, 60) end
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
    v_line_from := null;
    v_line_until := null;
    if v_item.kind = 'loan' then
      v_has_loan := true;
      v_line_from := (v_input ->> 'loan_from')::date;
      v_line_until := (v_input ->> 'loan_until')::date;
      if v_line_from is null or v_line_until is null or v_line_until < v_line_from
         or v_line_from < (timezone('Europe/Zurich', now()))::date then
        raise exception 'A loan needs a valid period' using errcode = '22023';
      end if;
      if v_item.max_loan_days is not null
         and v_line_until - v_line_from + 1 > v_item.max_loan_days then
        raise exception 'Loan period exceeds % days', v_item.max_loan_days using errcode = '22023';
      end if;
      v_min_from := least(coalesce(v_min_from, v_line_from), v_line_from);
      v_max_until := greatest(coalesce(v_max_until, v_line_until), v_line_until);
    end if;
    insert into public.shop_order_lines (
      tenant_id, order_id, catalog_item_id, inventory_item_id, item_name, kind, quantity,
      loan_from, loan_until
    ) values (
      p_tenant_id, v_order_id, v_item.id, v_item.inventory_item_id, v_item.name, v_item.kind, v_quantity,
      v_line_from, v_line_until
    );
  end loop;
  if v_has_loan then
    update public.shop_orders set loan_from = v_min_from, loan_until = v_max_until where id = v_order_id;
  end if;

  v_note := case
    when p_source_type = 'security_case' then
      'Ersatzgerät aus Sicherheitsfall ' || coalesce(v_reference, p_source_id::text)
        || ' – ohne Genehmigung bestellt'
    else 'Ohne Genehmigung bestellt'
  end;
  if p_requester_id <> p_actor_id then
    perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'placed_on_behalf');
    perform public.shop_notify(p_tenant_id, p_requester_id, 'shop.order.placed_for_you', v_order_id);
  else
    perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'submitted');
  end if;
  perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'approval_skipped', v_note);
  for v_line in select id from public.shop_order_lines where order_id = v_order_id loop
    perform public.shop_try_reserve_line(p_actor_id, v_line.id);
  end loop;
  perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.submitted', v_order_id, p_actor_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'shop.order.submitted', 'shop_order', v_order_id, 'info',
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'approval', false, 'approval_skipped', true,
      'requester_id', p_requester_id, 'source_type', p_source_type, 'source_id', p_source_id));
  return v_order_id;
end;
$$;

-- ---------------------------------------------------------- Shop-Erinnerungen

-- Arbeitstage (Mo–Fr, Europe/Zurich) nach dem Tag von p_from bis und mit dem
-- Tag von p_to.
create or replace function public.shop_working_days_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(count(*)::integer, 0)
  from generate_series(
    (timezone('Europe/Zurich', p_from))::date + 1,
    (timezone('Europe/Zurich', p_to))::date,
    interval '1 day'
  ) as day
  where extract(isodow from day) < 6;
$$;

-- Stellvertretungen einer Person (aktive Delegationen), sonst deren
-- vorgesetzte Person.
create or replace function public.shop_approval_deputies(p_tenant_id uuid, p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    nullif((
      select array_agg(distinct delegation.delegate_id)
      from public.agent_delegations delegation
      join public.tenant_memberships membership
        on membership.tenant_id = delegation.tenant_id
       and membership.user_id = delegation.delegate_id
       and membership.status = 'active'
      where delegation.tenant_id = p_tenant_id
        and delegation.agent_id = p_user_id
        and delegation.delegate_id <> p_user_id
        and delegation.ended_at is null
        and delegation.starts_at <= now()
        and delegation.ends_at > now()
    ), '{}'::uuid[]),
    case
      when public.shop_effective_manager(p_tenant_id, p_user_id) is not null
      then array[public.shop_effective_manager(p_tenant_id, p_user_id)]
      else '{}'::uuid[]
    end
  );
$$;

create or replace function public.shop_send_reminders(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (timezone('Europe/Zurich', coalesce(p_now, now())))::date;
  v_row record;
  v_manager uuid;
  v_deputy uuid;
  v_due integer := 0;
  v_overdue integer := 0;
  v_escalated integer := 0;
  v_approval integer := 0;
  v_approval_escalated integer := 0;
begin
  -- Ausleihe endet in höchstens zwei Tagen.
  for v_row in
    select line.id, line.tenant_id, line.order_id, line.item_name, line.loan_until, ord.requester_id
    from public.shop_order_lines line
    join public.shop_orders ord on ord.id = line.order_id and ord.tenant_id = line.tenant_id
    where line.kind = 'loan' and line.status = 'issued'
      and line.loan_until is not null
      and line.loan_until between v_today and v_today + 2
      and line.loan_due_notified_at is null
      and public.shop_feature_enabled(line.tenant_id)
    for update of line skip locked
  loop
    perform public.shop_notify(v_row.tenant_id, v_row.requester_id, 'shop.order.loan_due', v_row.order_id,
      jsonb_build_object('lineId', v_row.id, 'itemName', v_row.item_name, 'loanUntil', v_row.loan_until));
    update public.shop_order_lines set loan_due_notified_at = v_now where id = v_row.id;
    v_due := v_due + 1;
  end loop;

  -- Überfällig: Person sofort, nach drei Tagen die vorgesetzte Person.
  for v_row in
    select line.id, line.tenant_id, line.order_id, line.item_name, line.loan_until, ord.requester_id,
           line.loan_overdue_notified_at, line.loan_overdue_manager_notified_at
    from public.shop_order_lines line
    join public.shop_orders ord on ord.id = line.order_id and ord.tenant_id = line.tenant_id
    where line.kind = 'loan' and line.status = 'issued'
      and line.loan_until is not null and line.loan_until < v_today
      and (line.loan_overdue_notified_at is null
           or (line.loan_overdue_manager_notified_at is null and line.loan_until + 3 <= v_today))
      and public.shop_feature_enabled(line.tenant_id)
    for update of line skip locked
  loop
    if v_row.loan_overdue_notified_at is null then
      perform public.shop_notify(v_row.tenant_id, v_row.requester_id, 'shop.order.loan_overdue', v_row.order_id,
        jsonb_build_object('lineId', v_row.id, 'itemName', v_row.item_name, 'loanUntil', v_row.loan_until,
          'daysOverdue', v_today - v_row.loan_until));
      update public.shop_order_lines set loan_overdue_notified_at = v_now where id = v_row.id;
      v_overdue := v_overdue + 1;
    end if;
    if v_row.loan_overdue_manager_notified_at is null and v_row.loan_until + 3 <= v_today then
      v_manager := public.shop_effective_manager(v_row.tenant_id, v_row.requester_id);
      if v_manager is not null then
        perform public.shop_notify(v_row.tenant_id, v_manager, 'shop.order.loan_overdue', v_row.order_id,
          jsonb_build_object('lineId', v_row.id, 'itemName', v_row.item_name, 'loanUntil', v_row.loan_until,
            'daysOverdue', v_today - v_row.loan_until, 'audience', 'manager',
            'requesterId', v_row.requester_id));
        v_escalated := v_escalated + 1;
      end if;
      update public.shop_order_lines set loan_overdue_manager_notified_at = v_now where id = v_row.id;
    end if;
  end loop;

  -- Genehmigungen: nach zwei Arbeitstagen die genehmigende Person, nach fünf
  -- deren Stellvertretung.
  for v_row in
    select ord.id, ord.tenant_id, ord.approver_id, ord.created_at,
           ord.approval_reminded_at, ord.approval_escalated_at
    from public.shop_orders ord
    where ord.status = 'pending_approval'
      and ord.approver_id is not null
      and (ord.approval_reminded_at is null or ord.approval_escalated_at is null)
      and ord.created_at <= v_now - interval '2 days'
      and public.shop_feature_enabled(ord.tenant_id)
    for update of ord skip locked
  loop
    if v_row.approval_reminded_at is null
       and public.shop_working_days_between(v_row.created_at, v_now) >= 2 then
      perform public.shop_notify(v_row.tenant_id, v_row.approver_id, 'shop.order.approval_reminder', v_row.id,
        jsonb_build_object('workingDays', public.shop_working_days_between(v_row.created_at, v_now)));
      update public.shop_orders set approval_reminded_at = v_now where id = v_row.id;
      v_approval := v_approval + 1;
    end if;
    if v_row.approval_escalated_at is null
       and public.shop_working_days_between(v_row.created_at, v_now) >= 5 then
      foreach v_deputy in array public.shop_approval_deputies(v_row.tenant_id, v_row.approver_id) loop
        perform public.shop_notify(v_row.tenant_id, v_deputy, 'shop.order.approval_reminder', v_row.id,
          jsonb_build_object('workingDays', public.shop_working_days_between(v_row.created_at, v_now),
            'audience', 'deputy', 'approverId', v_row.approver_id));
      end loop;
      update public.shop_orders set approval_escalated_at = v_now where id = v_row.id;
      v_approval_escalated := v_approval_escalated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'loanDue', v_due, 'loanOverdue', v_overdue, 'loanEscalated', v_escalated,
    'approvalReminded', v_approval, 'approvalEscalated', v_approval_escalated
  );
end;
$$;

-- ----------------------------------------------------------- Lager-Automatik

-- Empfangende der Lager-Hinweise: aktive Mitglieder mit inventory.manage.
create or replace function public.inventory_automation_recipients(p_tenant_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select membership.user_id
  from public.tenant_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.status = 'active'
    and public.user_has_tenant_permission(membership.user_id, p_tenant_id, 'inventory.manage')
  order by membership.user_id;
$$;

-- Gibt offene Reservationen frei, deren Haltefrist abgelaufen ist (explizit
-- oder Standard-Haltefrist des Mandanten). Reservationen von Shop-Bestellungen
-- und automatischen Quellen (Eintritt, Raumbuchung) bleiben unberührt.
create or replace function public.inventory_release_expired_reservations(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_reservation record;
  v_count integer := 0;
begin
  for v_reservation in
    select reservation.*
    from public.inventory_reservations reservation
    left join public.inventory_automation_settings settings on settings.tenant_id = reservation.tenant_id
    where reservation.status = 'open'
      and coalesce(
        reservation.expires_at,
        reservation.created_at + make_interval(days => settings.reservation_hold_days)
      ) <= v_now
      and not exists (
        select 1 from public.shop_order_lines line
        where line.reservation_id = reservation.id and line.tenant_id = reservation.tenant_id
      )
      and not exists (
        select 1 from public.inventory_source_reservations source
        where source.reservation_id = reservation.id and source.tenant_id = reservation.tenant_id
      )
    order by reservation.created_at
    limit 500
    for update of reservation skip locked
  loop
    begin
      perform public.inventory_apply_event(
        v_reservation.tenant_id, v_reservation.created_by, gen_random_uuid(), 'reservation_release',
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
         set status = 'released', released_at = v_now, released_by = v_reservation.created_by,
             expired_at = v_now, updated_at = v_now
       where id = v_reservation.id;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
      values (v_reservation.tenant_id, null, 'inventory.reservation.expired', 'inventory_reservation',
        v_reservation.id, 'info', jsonb_build_object('item_id', v_reservation.item_id));
      v_count := v_count + 1;
    exception when others then
      raise warning 'inventory reservation % not released: %', v_reservation.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- Nachbestellung: Artikel, die (noch) unter dem Mindestbestand liegen.
-- inventory.reorder an die Lagerverwaltung (ohne die Personen, die schon den
-- Push «Mindestbestand» erhielten), optional eine Nachbestell-Aufgabe.
create or replace function public.inventory_process_reorders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_episode record;
  v_settings public.inventory_automation_settings%rowtype;
  v_available numeric;
  v_suggested numeric;
  v_request_id uuid;
  v_recipient uuid;
  v_count integer := 0;
begin
  for v_episode in
    select episode.id, episode.tenant_id, episode.item_id, item.name, item.unit,
           item.minimum_quantity, item.target_quantity
    from public.inventory_low_stock_episodes episode
    join public.inventory_items item on item.id = episode.item_id and item.tenant_id = episode.tenant_id
    where episode.recovered_at is null
      and episode.reorder_handled_at is null
      and item.active
      and public.inventory_management_feature_enabled(episode.tenant_id)
    order by episode.opened_at
    limit 500
    for update of episode skip locked
  loop
    select * into v_settings from public.inventory_automation_settings where tenant_id = v_episode.tenant_id;
    if not found then
      v_settings.reorder_notify := true;
      v_settings.reorder_create_task := false;
    end if;
    select coalesce(sum(balance.physical_quantity - balance.reserved_quantity), 0) into v_available
    from public.inventory_stock_balances balance
    where balance.tenant_id = v_episode.tenant_id and balance.item_id = v_episode.item_id;
    v_suggested := greatest(
      v_episode.target_quantity - v_available,
      v_episode.minimum_quantity - v_available + 1,
      1
    );
    v_request_id := null;
    if v_settings.reorder_create_task then
      insert into public.inventory_reorder_requests (tenant_id, item_id, episode_id, suggested_quantity)
      values (v_episode.tenant_id, v_episode.item_id, v_episode.id, v_suggested)
      on conflict do nothing
      returning id into v_request_id;
    end if;
    if v_settings.reorder_notify then
      for v_recipient in
        select recipient from public.inventory_automation_recipients(v_episode.tenant_id) recipient
        where not exists (
          select 1 from public.inventory_low_stock_episode_recipients sent
          where sent.episode_id = v_episode.id and sent.recipient_user_id = recipient
        )
      loop
        insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
        values (v_episode.tenant_id, v_recipient, null, 'inventory.reorder', jsonb_build_object(
          'inventoryEpisodeId', v_episode.id,
          'inventoryItemId', v_episode.item_id,
          'itemName', v_episode.name,
          'available', v_available,
          'minimum', v_episode.minimum_quantity,
          'suggestedQuantity', v_suggested,
          'unit', v_episode.unit,
          'reorderRequestId', v_request_id
        ));
      end loop;
    end if;
    update public.inventory_low_stock_episodes set reorder_handled_at = now()
     where id = v_episode.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Inventur-Erinnerung pro Lagerort nach dem eingestellten Intervall seit der
-- letzten abgeschlossenen Inventur (bzw. seit dem Anlegen des Lagerorts).
create or replace function public.inventory_send_count_reminders(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_location record;
  v_recipient uuid;
  v_count integer := 0;
begin
  for v_location in
    select location.id, location.tenant_id, location.name, location.count_interval_days,
           coalesce(
             (select max(count.closed_at) from public.inventory_counts count
              where count.tenant_id = location.tenant_id and count.location_id = location.id
                and count.status = 'closed'),
             location.created_at
           ) as last_counted_at
    from public.inventory_locations location
    where location.active
      and location.count_interval_days is not null
      and public.inventory_management_feature_enabled(location.tenant_id)
      and not exists (
        select 1 from public.inventory_counts running
        where running.tenant_id = location.tenant_id and running.location_id = location.id
          and running.status in ('draft', 'counting')
      )
    for update of location skip locked
  loop
    if v_location.last_counted_at + make_interval(days => v_location.count_interval_days) > v_now then
      continue;
    end if;
    if exists (
      select 1 from public.inventory_locations reminded
      where reminded.id = v_location.id
        and reminded.count_reminded_at is not null
        and reminded.count_reminded_at > v_location.last_counted_at
        and reminded.count_reminded_at > v_now - make_interval(days => least(v_location.count_interval_days, 30))
    ) then
      continue;
    end if;
    for v_recipient in select * from public.inventory_automation_recipients(v_location.tenant_id) loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (v_location.tenant_id, v_recipient, null, 'inventory.count_due', jsonb_build_object(
        'inventoryLocationId', v_location.id,
        'locationName', v_location.name,
        'lastCountedAt', v_location.last_counted_at,
        'intervalDays', v_location.count_interval_days
      ));
    end loop;
    update public.inventory_locations set count_reminded_at = v_now where id = v_location.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.inventory_shop_daily_automation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  begin
    v_result := v_result || jsonb_build_object('reorders', public.inventory_process_reorders());
  exception when others then
    v_result := v_result || jsonb_build_object('reorders', 'failed');
  end;
  begin
    v_result := v_result || jsonb_build_object('counts', public.inventory_send_count_reminders());
  exception when others then
    v_result := v_result || jsonb_build_object('counts', 'failed');
  end;
  begin
    v_result := v_result || jsonb_build_object('shop', public.shop_send_reminders());
  exception when others then
    v_result := v_result || jsonb_build_object('shop', 'failed');
  end;
  return v_result;
end;
$$;

-- ------------------------------------------------------- Intune nach Zeitplan

-- Mandanten mit aktiver Intune-Verbindung und eingerichtetem Abgleich. Der
-- Abgleich läuft im Namen der Person, die die Anbindung zuletzt gespeichert
-- hat (falls sie die Berechtigung noch hat), sonst einer anderen Person mit
-- asset.integration.manage.
create or replace function public.intune_scheduled_sync_targets()
returns table (tenant_id uuid, actor_id uuid, ipam_enabled boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select connection.tenant_id,
         coalesce(
           case when connection.updated_by is not null
                 and public.user_has_tenant_permission(connection.updated_by, connection.tenant_id, 'asset.integration.manage')
                then connection.updated_by end,
           (
             select membership.user_id
             from public.tenant_memberships membership
             where membership.tenant_id = connection.tenant_id
               and membership.status = 'active'
               and public.user_has_tenant_permission(membership.user_id, connection.tenant_id, 'asset.integration.manage')
             order by membership.joined_at nulls last, membership.user_id
             limit 1
           )
         ) as actor_id,
         case when to_regprocedure('public.ipam_feature_enabled(uuid)') is not null
              then public.ipam_feature_enabled(connection.tenant_id) else false end as ipam_enabled
  from public.asset_intune_connections connection
  where connection.enabled
    and connection.manual_sync_enabled
    and connection.directory_tenant_id is not null
  order by connection.tenant_id
  limit 500;
$$;

create or replace function public.intune_scheduled_sync_wake()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_base text;
  v_secret text;
begin
  if not exists (
    select 1 from public.asset_intune_connections connection
    where connection.enabled and connection.manual_sync_enabled and connection.directory_tenant_id is not null
  ) then
    return;
  end if;
  if to_regclass('monitoring_automation_private.dispatch_config') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select functions_base_url, dispatch_secret from monitoring_automation_private.dispatch_config where singleton'
    into v_base, v_secret;
  if v_base is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using rtrim(v_base, '/') || '/intune-scheduled-sync',
          jsonb_build_object('type', 'cron', 'job', 'intune'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          30000;
exception when others then
  return;
end;
$$;

-- ------------------------------------------------------------------- Rechte

revoke all on function public.inventory_default_return_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.inventory_serial_unit_on_hand(uuid, uuid) from public, anon, authenticated;
revoke all on function public.inventory_book_asset_into_stock(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.asset_assignment_hand_out(uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.asset_assignment_take_back(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.shop_order_line_asset_assignment() from public, anon, authenticated;
revoke all on function public.inventory_reservation_asset_assignment() from public, anon, authenticated;
revoke all on function public.shop_return_loan_line(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.onboarding_complete_asset_return() from public, anon, authenticated;
revoke all on function public.shop_submit_order_direct(uuid, uuid, uuid, uuid, jsonb, text, text, date, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.shop_working_days_between(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.shop_approval_deputies(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shop_send_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.inventory_automation_recipients(uuid) from public, anon, authenticated;
revoke all on function public.inventory_release_expired_reservations(timestamptz) from public, anon, authenticated;
revoke all on function public.inventory_process_reorders() from public, anon, authenticated;
revoke all on function public.inventory_send_count_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.inventory_shop_daily_automation() from public, anon, authenticated;
revoke all on function public.intune_scheduled_sync_targets() from public, anon, authenticated;
revoke all on function public.intune_scheduled_sync_wake() from public, anon, authenticated;

grant execute on function public.inventory_default_return_location(uuid, uuid) to service_role;
grant execute on function public.inventory_book_asset_into_stock(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.shop_return_loan_line(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.shop_submit_order_direct(uuid, uuid, uuid, uuid, jsonb, text, text, date, text, text, text, uuid, text) to service_role;
grant execute on function public.shop_send_reminders(timestamptz) to service_role;
grant execute on function public.inventory_release_expired_reservations(timestamptz) to service_role;
grant execute on function public.inventory_shop_daily_automation() to service_role;
grant execute on function public.intune_scheduled_sync_targets() to service_role;

comment on table public.inventory_automation_settings is
  'Lager-Automatik pro Mandant: Standard-Lagerort für Rücknahmen, Nachbestellung bei Mindestbestand, Haltefrist von Reservationen. Nur Service-Rolle.';
comment on table public.inventory_reorder_requests is
  'Nachbestell-Aufgaben aus dem Mindestbestand (offen, bestellt, erledigt, verworfen). Nur Service-Rolle.';
comment on column public.inventory_reservations.expires_at is
  'Optionales Ende der Reservation. Abgelaufene offene Reservationen gibt der stündliche Job frei.';
comment on column public.shop_orders.source_type is
  'Herkunft einer Bestellung ohne Genehmigung (security_case = Ersatzgerät aus einem Sicherheitsfall).';

-- -------------------------------------------------------------------- Cron

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-inventory-reservations');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('nextdesk-inventory-shop-daily');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('nextdesk-intune-scheduled-sync');
  exception when others then null;
  end;
  perform cron.schedule('nextdesk-inventory-reservations', '7 * * * *',
    $cron$select public.inventory_release_expired_reservations();$cron$);
  perform cron.schedule('nextdesk-inventory-shop-daily', '47 5 * * *',
    $cron$select public.inventory_shop_daily_automation();$cron$);
  perform cron.schedule('nextdesk-intune-scheduled-sync', '11 2 * * *',
    $cron$select public.intune_scheduled_sync_wake();$cron$);
exception when others then
  null;
end;
$$;

commit;
