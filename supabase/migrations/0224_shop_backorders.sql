begin;

set local search_path = pg_catalog, public;

-- Bestellprozess mit Lager: Beschaffung (Rückstände) für Shop-Bestellungen.
--
-- Kann eine freigegebene Bestellzeile nicht aus dem Lager reserviert werden
-- (shop_try_reserve_line setzt sie auf 'backorder'), entsteht automatisch ein
-- Beschaffungsbedarf. Die Lagerverwaltung (inventory.manage) sieht die offenen
-- Bedarfe, markiert sie als bestellt (Lieferant, voraussichtliches Datum) oder
-- storniert sie. Bei einem Wareneingang werden die wartenden Bedarfe in der
-- Reihenfolge ihrer Erfassung reserviert; ist eine Bestellung danach komplett,
-- wird sie «Bereit zur Abholung» und die bestellende Person erhält die
-- bestehende Benachrichtigung 'shop.order.ready' (inkl. Push).

create table if not exists public.shop_backorders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id uuid not null,
  order_id uuid not null,
  order_line_id uuid not null references public.shop_order_lines(id) on delete cascade,
  requester_id uuid references public.user_profiles(id) on delete set null,
  quantity integer not null check (quantity between 1 and 100),
  status text not null default 'open'
    check (status in ('open', 'ordered', 'received', 'cancelled')),
  supplier text check (
    supplier is null or (
      char_length(btrim(supplier)) between 1 and 160
      and supplier = btrim(supplier)
      and supplier !~ '[[:cntrl:]]'
    )
  ),
  expected_on date,
  note text check (note is null or char_length(note) <= 1000),
  ordered_at timestamptz,
  ordered_by uuid references public.user_profiles(id) on delete set null,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shop_backorders_order_fk
    foreign key (order_id, tenant_id) references public.shop_orders (id, tenant_id) on delete cascade,
  constraint shop_backorders_item_fk
    foreign key (inventory_item_id, tenant_id) references public.inventory_items (id, tenant_id)
    on delete cascade
);

-- Höchstens ein aktiver Bedarf pro Bestellzeile.
create unique index if not exists shop_backorders_active_line_unique
  on public.shop_backorders (order_line_id)
  where status in ('open', 'ordered');
create index if not exists shop_backorders_item_queue_idx
  on public.shop_backorders (tenant_id, inventory_item_id, created_at)
  where status in ('open', 'ordered');
create index if not exists shop_backorders_tenant_status_idx
  on public.shop_backorders (tenant_id, status, created_at);
create index if not exists shop_backorders_order_idx
  on public.shop_backorders (order_id);

-- Nur die geprüften Edge Functions (Service-Rolle) lesen und schreiben.
alter table public.shop_backorders enable row level security;
revoke all on table public.shop_backorders from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_backorders to service_role;

-- Bestellzeile → Beschaffungsbedarf
-- ---------------------------------
create or replace function public.shop_backorder_track_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.shop_orders%rowtype;
  v_supplier text;
  v_id uuid;
begin
  if new.status = 'backorder'
     and (tg_op = 'INSERT' or old.status is distinct from 'backorder')
     and new.inventory_item_id is not null then
    select * into v_order from public.shop_orders
    where id = new.order_id and tenant_id = new.tenant_id;
    select supplier into v_supplier from public.inventory_items
    where id = new.inventory_item_id and tenant_id = new.tenant_id;
    insert into public.shop_backorders (
      tenant_id, inventory_item_id, order_id, order_line_id, requester_id, quantity, supplier
    ) values (
      new.tenant_id, new.inventory_item_id, new.order_id, new.id, v_order.requester_id,
      new.quantity, v_supplier
    )
    on conflict (order_line_id) where status in ('open', 'ordered') do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.shop_log(new.tenant_id, new.order_id, null, 'backordered',
        format('%s× %s', new.quantity, new.item_name));
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'backorder' and new.status in ('reserved', 'issued') then
    update public.shop_backorders
       set status = 'received', received_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where order_line_id = new.id and status in ('open', 'ordered');
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.shop_backorders
       set status = 'cancelled', cancelled_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where order_line_id = new.id and status in ('open', 'ordered');
  end if;
  return null;
end;
$$;

revoke all on function public.shop_backorder_track_line() from public, anon, authenticated;

create or replace trigger shop_order_lines_track_backorder
  after insert or update of status on public.shop_order_lines
  for each row execute function public.shop_backorder_track_line();

-- Bestehende Rückstände (vor dieser Migration) als Bedarf übernehmen.
insert into public.shop_backorders (
  tenant_id, inventory_item_id, order_id, order_line_id, requester_id, quantity, supplier, created_at
)
select line.tenant_id, line.inventory_item_id, line.order_id, line.id, shop_order.requester_id,
       line.quantity, item.supplier, line.updated_at
from public.shop_order_lines line
join public.shop_orders shop_order
  on shop_order.id = line.order_id and shop_order.tenant_id = line.tenant_id
join public.inventory_items item
  on item.id = line.inventory_item_id and item.tenant_id = line.tenant_id
where line.status = 'backorder'
  and shop_order.status in ('submitted', 'in_progress', 'ready')
on conflict (order_line_id) where status in ('open', 'ordered') do nothing;

-- Zuteilung
-- ---------
-- Reserviert freien Bestand eines Artikels für wartende Bedarfe in der
-- Reihenfolge ihrer Erfassung. Ein Bedarf, der (noch) nicht vollständig aus
-- einem Lagerort bedient werden kann, wartet weiter; spätere, kleinere Bedarfe
-- dürfen den freien Bestand nutzen. Gibt die Anzahl reservierter Zeilen zurück.
create or replace function public.shop_allocate_backorders(
  p_tenant_id uuid,
  p_item_id uuid,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_candidate record;
  v_order public.shop_orders%rowtype;
  v_result text;
  v_reserved integer := 0;
begin
  if p_tenant_id is null or p_item_id is null or p_actor_id is null then
    raise exception 'Invalid backorder allocation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'nextdesk:shop-backorders:' || p_tenant_id::text || ':' || p_item_id::text, 0
  ));

  for v_candidate in
    select backorder.id, backorder.order_id, backorder.order_line_id
    from public.shop_backorders backorder
    join public.shop_order_lines line
      on line.id = backorder.order_line_id and line.tenant_id = backorder.tenant_id
    join public.shop_orders shop_order
      on shop_order.id = backorder.order_id and shop_order.tenant_id = backorder.tenant_id
    where backorder.tenant_id = p_tenant_id
      and backorder.inventory_item_id = p_item_id
      and backorder.status in ('open', 'ordered')
      and line.status = 'backorder'
      and shop_order.status in ('submitted', 'in_progress', 'ready')
    order by backorder.created_at, backorder.id
  loop
    -- Gleiche Sperrreihenfolge wie shop_update_order: zuerst die Bestellung.
    select * into v_order from public.shop_orders
    where id = v_candidate.order_id and tenant_id = p_tenant_id
    for update;
    if not found or v_order.status not in ('submitted', 'in_progress', 'ready') then
      continue;
    end if;

    v_result := public.shop_try_reserve_line(p_actor_id, v_candidate.order_line_id);
    if v_result <> 'reserved' then
      continue;
    end if;
    v_reserved := v_reserved + 1;
    -- shop_backorder_track_line setzt den Bedarf dabei auf 'received'.
    perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'backorder_received',
      (select format('%s× %s', line.quantity, line.item_name)
         from public.shop_order_lines line where line.id = v_candidate.order_line_id));

    if not exists (
      select 1 from public.shop_order_lines line
      where line.order_id = v_order.id and line.status in ('open', 'backorder')
    ) then
      if v_order.status in ('submitted', 'in_progress') then
        update public.shop_orders
           set status = 'ready', updated_at = timezone('utc', now())
         where id = v_order.id;
        perform public.shop_log(p_tenant_id, v_order.id, p_actor_id, 'ready',
          'Automatisch nach Wareneingang bereitgestellt.');
      end if;
      perform public.shop_notify(p_tenant_id, v_order.requester_id, 'shop.order.ready', v_order.id);
    end if;
  end loop;
  return v_reserved;
end;
$$;

revoke all on function public.shop_allocate_backorders(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_allocate_backorders(uuid, uuid, uuid) to service_role;

-- Wareneingang: nach jeder Zugangsbuchung (Wareneingang, Rücknahme,
-- Korrektur oder Inventurdifferenz mit Zuwachs) die wartenden Bedarfe des
-- Artikels bedienen. Freigaben von Reservationen lösen bewusst nichts aus,
-- damit eine laufende Ausgabe ihren Bestand behält.
create or replace function public.shop_allocate_backorders_after_event_lines()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_change record;
begin
  for v_change in
    select line.tenant_id, line.item_id, min(event.actor_id::text)::uuid as actor_id
    from new_inventory_event_lines line
    join public.inventory_events event
      on event.id = line.event_id and event.tenant_id = line.tenant_id
    where event.event_type in ('movement_receipt', 'movement_adjustment', 'count_adjustment')
      and line.physical_delta > 0
    group by line.tenant_id, line.item_id
    order by line.tenant_id, line.item_id
  loop
    if exists (
      select 1 from public.shop_backorders backorder
      where backorder.tenant_id = v_change.tenant_id
        and backorder.inventory_item_id = v_change.item_id
        and backorder.status in ('open', 'ordered')
    ) then
      perform public.shop_allocate_backorders(v_change.tenant_id, v_change.item_id, v_change.actor_id);
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.shop_allocate_backorders_after_event_lines() from public, anon, authenticated;

create or replace trigger inventory_allocate_shop_backorders_after_event_lines
  after insert on public.inventory_event_lines
  referencing new table as new_inventory_event_lines
  for each statement execute function public.shop_allocate_backorders_after_event_lines();

-- Bearbeitung durch die Lagerverwaltung
-- -------------------------------------
-- p_action: 'order' (bestellt, mit Lieferant/Datum) oder 'cancel'.
create or replace function public.shop_backorder_update(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_backorder_ids uuid[],
  p_action text,
  p_supplier text default null,
  p_expected_on date default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_backorder public.shop_backorders%rowtype;
  v_supplier text := nullif(btrim(coalesce(p_supplier, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_count integer := 0;
begin
  if p_actor_id is null or p_tenant_id is null or p_action not in ('order', 'cancel')
     or p_backorder_ids is null or cardinality(p_backorder_ids) not between 1 and 200 then
    raise exception 'Invalid backorder action' using errcode = '22023';
  end if;
  if not public.shop_has_permission(p_actor_id, p_tenant_id, 'inventory.manage') then
    raise exception 'Not allowed to manage procurement' using errcode = '42501';
  end if;

  for v_backorder in
    select * from public.shop_backorders
    where tenant_id = p_tenant_id and id = any(p_backorder_ids)
    order by created_at, id
    for update
  loop
    if v_backorder.status not in ('open', 'ordered') then
      raise exception 'Backorder is already closed' using errcode = '23514';
    end if;
    if p_action = 'order' then
      update public.shop_backorders
         set status = 'ordered',
             supplier = coalesce(v_supplier, supplier),
             expected_on = p_expected_on,
             note = coalesce(v_note, note),
             ordered_at = coalesce(ordered_at, timezone('utc', now())),
             ordered_by = coalesce(ordered_by, p_actor_id),
             updated_at = timezone('utc', now())
       where id = v_backorder.id;
      perform public.shop_log(p_tenant_id, v_backorder.order_id, p_actor_id, 'backorder_ordered',
        case when p_expected_on is not null
          then 'Voraussichtlich am ' || to_char(p_expected_on, 'DD.MM.YYYY') end);
    else
      update public.shop_backorders
         set status = 'cancelled',
             note = coalesce(v_note, note),
             cancelled_at = timezone('utc', now()),
             cancelled_by = p_actor_id,
             updated_at = timezone('utc', now())
       where id = v_backorder.id;
      perform public.shop_log(p_tenant_id, v_backorder.order_id, p_actor_id, 'backorder_cancelled',
        v_note, true);
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count <> (select count(distinct backorder_id) from unnest(p_backorder_ids) backorder_id) then
    raise exception 'Backorder not found' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

revoke all on function public.shop_backorder_update(uuid, uuid, uuid[], text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.shop_backorder_update(uuid, uuid, uuid[], text, text, date, text)
  to service_role;

commit;
