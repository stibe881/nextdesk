begin;
set local search_path = pg_catalog, public;

-- Lagerbereiche: Beim Einlagern kann ein Artikel auf mehrere aufeinanderfolgende
-- Lagerplätze gebucht werden (z. B. G10.2.1 bis G10.2.4). Der Bereich gilt als
-- EIN Lagerplatz: Die Menge wird einmal gebucht (auf dem ersten Platz, dem
-- «Anker»), und alle Plätze des Bereichs sind belegt, solange dort Bestand
-- liegt. Auf einen belegten Bereich kann kein anderer Artikel gebucht werden,
-- und ein neuer Bereich ist nur auf vollständig freien Plätzen möglich.
--
-- Ein Bereich ist aktiv, solange der Anker-Bestand des Artikels grösser als 0 ist.
-- Abgeschlossene (leere) Bereiche werden beim nächsten Belegen der Plätze
-- aufgeräumt; es gibt keinen separaten «Freigeben»-Schritt.
--
-- Die Prüfung der Plätze (Namensmuster, gleiche Präfixe, Existenz) erfolgt in
-- der Edge Function inventory; die Datenbank erzwingt Belegung und Atomarität.

create table if not exists public.inventory_placements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  anchor_location_id uuid not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_placements_id_tenant_unique unique (id, tenant_id),
  constraint inventory_placements_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete cascade,
  constraint inventory_placements_anchor_tenant_fk
    foreign key (anchor_location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict
);

create table if not exists public.inventory_placement_slots (
  placement_id uuid not null,
  tenant_id uuid not null,
  location_id uuid not null,
  slot_no smallint not null check (slot_no between 1 and 50),
  primary key (placement_id, location_id),
  constraint inventory_placement_slots_position_unique unique (placement_id, slot_no),
  constraint inventory_placement_slots_placement_fk
    foreign key (placement_id, tenant_id)
    references public.inventory_placements (id, tenant_id) on delete cascade,
  constraint inventory_placement_slots_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.inventory_locations (id, tenant_id) on delete restrict
);

create index if not exists inventory_placements_tenant_item_idx
  on public.inventory_placements (tenant_id, item_id);
create index if not exists inventory_placement_slots_location_idx
  on public.inventory_placement_slots (tenant_id, location_id);

alter table public.inventory_placements enable row level security;
alter table public.inventory_placement_slots enable row level security;
revoke all on table public.inventory_placements from public, anon, authenticated;
revoke all on table public.inventory_placement_slots from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_placements to service_role;
grant select, insert, update, delete on table public.inventory_placement_slots to service_role;

-- An area is occupied while its anchor still holds stock of the item.
create or replace function public.inventory_placement_is_active(p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.inventory_placements placement
    join public.inventory_stock_balances balance
      on balance.tenant_id = placement.tenant_id
     and balance.item_id = placement.item_id
     and balance.location_id = placement.anchor_location_id
    where placement.id = p_placement_id
      and balance.physical_quantity > 0
  );
$$;
revoke all on function public.inventory_placement_is_active(uuid)
  from public, anon, authenticated;
grant execute on function public.inventory_placement_is_active(uuid) to service_role;

-- No booking may add stock to a place of an occupied area, except more of the
-- same item on the area's anchor. The range receipt below opts out for its own
-- (already validated) booking through a transaction-local flag.
-- ND411 maps to a 409 «belegt» in the Edge Function.
create or replace function public.inventory_placement_balance_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before numeric := 0;
begin
  if tg_op = 'UPDATE' then
    v_before := old.physical_quantity;
  end if;
  if new.physical_quantity <= v_before then
    return new;
  end if;
  if coalesce(current_setting('nextdesk.inventory_range_receipt', true), 'off') = 'on' then
    return new;
  end if;
  if exists (
    select 1
    from public.inventory_placement_slots slot
    join public.inventory_placements placement
      on placement.id = slot.placement_id and placement.tenant_id = slot.tenant_id
    where slot.tenant_id = new.tenant_id
      and slot.location_id = new.location_id
      and not (placement.item_id = new.item_id and placement.anchor_location_id = new.location_id)
      and public.inventory_placement_is_active(placement.id)
  ) then
    raise exception 'Inventory location is part of an occupied area' using errcode = 'ND411';
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_placement_balance_guard()
  from public, anon, authenticated;

drop trigger if exists inventory_stock_balances_placement_guard on public.inventory_stock_balances;
create trigger inventory_stock_balances_placement_guard
  before insert or update of physical_quantity on public.inventory_stock_balances
  for each row execute function public.inventory_placement_balance_guard();

-- Wareneingang auf einen Bereich: p_location_ids sind die Plätze in
-- Reihenfolge (mindestens 2, höchstens 50, erster = Anker).
create or replace function public.post_inventory_range_receipt(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_item_id uuid,
  p_location_ids uuid[],
  p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
  v_anchor uuid;
  v_slot uuid;
  v_existing_event uuid;
  v_placement uuid;
  v_event uuid;
  v_slot_no smallint := 0;
begin
  v_count := coalesce(cardinality(p_location_ids), 0);
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_item_id is null or p_quantity is null
     or v_count < 2 or v_count > 50
     or array_position(p_location_ids, null) is not null
     or v_count <> (select count(distinct id) from unnest(p_location_ids) as id)
     or p_quantity <= 0 or p_quantity <> trunc(p_quantity, 3) then
    raise exception 'Invalid inventory range receipt request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.move');

  -- A retry of an already booked receipt must not place the area twice.
  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select event.id into v_existing_event
  from public.inventory_events event
  where event.tenant_id = p_tenant_id and event.client_request_id = p_client_request_id
  for key share;
  if found then
    return v_existing_event;
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.id = p_item_id and item.tenant_id = p_tenant_id
      and item.active and item.tracking_mode = 'quantity'
  ) then
    raise exception 'Inventory item is unavailable for a range receipt' using errcode = 'P0002';
  end if;
  if (
    select count(*) from public.inventory_locations location
    where location.tenant_id = p_tenant_id and location.active
      and location.id = any(p_location_ids)
  ) <> v_count then
    raise exception 'Inventory location is unavailable' using errcode = 'P0002';
  end if;

  -- Deterministic order keeps two concurrent bookings on overlapping areas
  -- from deadlocking.
  for v_slot in select id from unnest(p_location_ids) as id order by id loop
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:inventory:slot:' || p_tenant_id::text || ':' || v_slot::text, 0)
    );
  end loop;
  v_anchor := p_location_ids[1];

  -- Same item on exactly the same area: add to it.
  select placement.id into v_placement
  from public.inventory_placements placement
  where placement.tenant_id = p_tenant_id
    and placement.item_id = p_item_id
    and placement.anchor_location_id = v_anchor
    and (
      select array_agg(slot.location_id order by slot.slot_no)
      from public.inventory_placement_slots slot
      where slot.placement_id = placement.id
    ) = p_location_ids
    and public.inventory_placement_is_active(placement.id)
  limit 1;

  if v_placement is null then
    -- Clean up finished (empty) areas on these places, then require them free.
    delete from public.inventory_placements placement
    where placement.tenant_id = p_tenant_id
      and placement.id in (
        select slot.placement_id from public.inventory_placement_slots slot
        where slot.tenant_id = p_tenant_id and slot.location_id = any(p_location_ids)
      )
      and not public.inventory_placement_is_active(placement.id);

    if exists (
      select 1
      from public.inventory_placement_slots slot
      where slot.tenant_id = p_tenant_id and slot.location_id = any(p_location_ids)
    ) or exists (
      select 1
      from public.inventory_stock_balances balance
      where balance.tenant_id = p_tenant_id
        and balance.location_id = any(p_location_ids)
        and balance.physical_quantity > 0
    ) then
      raise exception 'Inventory area is occupied' using errcode = 'ND411';
    end if;

    insert into public.inventory_placements (tenant_id, item_id, anchor_location_id, created_by)
    values (p_tenant_id, p_item_id, v_anchor, p_actor_id)
    returning id into v_placement;
    for v_slot in select id from unnest(p_location_ids) with ordinality as t(id, ord) order by ord loop
      v_slot_no := v_slot_no + 1;
      insert into public.inventory_placement_slots (placement_id, tenant_id, location_id, slot_no)
      values (v_placement, p_tenant_id, v_slot, v_slot_no);
    end loop;
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      p_tenant_id, p_actor_id, 'inventory.placement.created', 'inventory_placement',
      v_placement, 'info',
      jsonb_build_object('type', 'placement_create', 'count', v_count,
                         'reference_type', 'inventory_item')
    );
  end if;

  perform set_config('nextdesk.inventory_range_receipt', 'on', true);
  v_event := public.post_inventory_movement(
    p_actor_id, p_tenant_id, p_client_request_id, 'receipt',
    jsonb_build_array(jsonb_build_object(
      'item_id', p_item_id,
      'location_id', v_anchor,
      'quantity', p_quantity
    )),
    null
  );
  perform set_config('nextdesk.inventory_range_receipt', 'off', true);
  return v_event;
end;
$$;

revoke all on function public.post_inventory_range_receipt(uuid, uuid, uuid, uuid, uuid[], numeric)
  from public, anon, authenticated;
grant execute on function public.post_inventory_range_receipt(uuid, uuid, uuid, uuid, uuid[], numeric)
  to service_role;

commit;
