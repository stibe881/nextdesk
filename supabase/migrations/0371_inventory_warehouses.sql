begin;
set local search_path = pg_catalog, public;

-- Lager mit Standort: Ein Lager (z. B. «Hauptlager Bern») fasst mehrere
-- Lagerplätze zusammen. Bisherige Lagerorte bleiben unverändert gültig und
-- sind zunächst keinem Lager zugeordnet («Ohne Lager»). Lagerplätze sind die
-- bisherigen inventory_locations; sie erhalten optional ein Lager.

create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (
    char_length(btrim(name)) between 1 and 160
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  -- Standort des Lagers, z. B. Ort, Adresse oder Gebäude.
  site text check (
    site is null
    or (
      char_length(btrim(site)) between 1 and 200
      and site = btrim(site)
      and site !~ '[[:cntrl:]]'
    )
  ),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_warehouses_id_tenant_unique unique (id, tenant_id)
);

create unique index if not exists inventory_warehouses_tenant_name_unique
  on public.inventory_warehouses (tenant_id, lower(name));

alter table public.inventory_warehouses enable row level security;
revoke all on table public.inventory_warehouses from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_warehouses to service_role;

create trigger inventory_warehouses_updated_at
  before update on public.inventory_warehouses
  for each row execute function public.set_updated_at();

alter table public.inventory_locations
  add column if not exists warehouse_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_locations_warehouse_tenant_fk'
  ) then
    alter table public.inventory_locations
      add constraint inventory_locations_warehouse_tenant_fk
      foreign key (warehouse_id, tenant_id)
      references public.inventory_warehouses (id, tenant_id)
      on delete set null (warehouse_id);
  end if;
end;
$$;

create index if not exists inventory_locations_tenant_warehouse_idx
  on public.inventory_locations (tenant_id, warehouse_id);

-- Der Lagerort heisst wie sein Code (z. B. «WSICT.01.02»); die bisherige
-- «Bezeichnung» wird zur optionalen «Bemerkung» und erscheint weder auf
-- Etiketten noch in Auswahllisten. Die Spalte «name» bleibt als Anzeigename des
-- Lagerorts erhalten (so, wie er eingegeben wurde, sonst in Grossbuchstaben),
-- damit Listen, Buchungen und Etiketten ihn unverändert verwenden.
alter table public.inventory_locations
  add column if not exists note text;
alter table public.inventory_locations
  drop constraint if exists inventory_locations_note_check;
alter table public.inventory_locations
  add constraint inventory_locations_note_check
  check (
    note is null
    or (
      char_length(btrim(note)) between 1 and 500
      and note = btrim(note)
      and note !~ '[[:cntrl:]]'
    )
  );

-- Einmalig: bisherige Bezeichnungen werden zu Bemerkungen, der Lagerort zeigt
-- den Code. Eine Bezeichnung, die nur dem Code entsprach, entfällt.
update public.inventory_locations
set note = case when lower(name) = code then null else name end,
    name = upper(code)
where note is null
  and name <> upper(code);

-- Inventur-Erinnerung pro Lager statt pro Lagerplatz (Lager-Automatik). Das
-- Intervall steht am Lager. Ein Lager ist fällig, sobald seine am längsten
-- nicht gezählte Lagerort-Inventur (bzw. das Anlegen des Platzes) länger als
-- das Intervall zurückliegt; läuft an einem Platz des Lagers eine Inventur,
-- wird nicht erinnert. Das bisherige Intervall am Lagerort wird nicht mehr
-- verwendet.
alter table public.inventory_warehouses
  add column if not exists count_interval_days integer,
  add column if not exists count_reminded_at timestamptz;
alter table public.inventory_warehouses
  drop constraint if exists inventory_warehouses_count_interval_check;
alter table public.inventory_warehouses
  add constraint inventory_warehouses_count_interval_check
  check (count_interval_days is null or count_interval_days between 7 and 730);

create or replace function public.inventory_send_count_reminders(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_warehouse record;
  v_recipient uuid;
  v_count integer := 0;
begin
  for v_warehouse in
    select warehouse.id, warehouse.tenant_id, warehouse.name, warehouse.count_interval_days,
           (
             select min(
               coalesce(
                 (select max(count.closed_at) from public.inventory_counts count
                  where count.tenant_id = place.tenant_id and count.location_id = place.id
                    and count.status = 'closed'),
                 place.created_at
               )
             )
             from public.inventory_locations place
             where place.tenant_id = warehouse.tenant_id
               and place.warehouse_id = warehouse.id
               and place.active
           ) as last_counted_at
    from public.inventory_warehouses warehouse
    where warehouse.active
      and warehouse.count_interval_days is not null
      and public.inventory_management_feature_enabled(warehouse.tenant_id)
      and exists (
        select 1 from public.inventory_locations place
        where place.tenant_id = warehouse.tenant_id
          and place.warehouse_id = warehouse.id and place.active
      )
      and not exists (
        select 1
        from public.inventory_counts running
        join public.inventory_locations place
          on place.id = running.location_id and place.tenant_id = running.tenant_id
        where running.tenant_id = warehouse.tenant_id
          and place.warehouse_id = warehouse.id
          and running.status in ('draft', 'counting')
      )
    for update of warehouse skip locked
  loop
    if v_warehouse.last_counted_at + make_interval(days => v_warehouse.count_interval_days) > v_now then
      continue;
    end if;
    if exists (
      select 1 from public.inventory_warehouses reminded
      where reminded.id = v_warehouse.id
        and reminded.count_reminded_at is not null
        and reminded.count_reminded_at > v_warehouse.last_counted_at
        and reminded.count_reminded_at > v_now - make_interval(days => least(v_warehouse.count_interval_days, 30))
    ) then
      continue;
    end if;
    for v_recipient in select * from public.inventory_automation_recipients(v_warehouse.tenant_id) loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (v_warehouse.tenant_id, v_recipient, null, 'inventory.count_due', jsonb_build_object(
        'inventoryWarehouseId', v_warehouse.id,
        'locationName', v_warehouse.name,
        'lastCountedAt', v_warehouse.last_counted_at,
        'intervalDays', v_warehouse.count_interval_days
      ));
    end loop;
    update public.inventory_warehouses set count_reminded_at = v_now where id = v_warehouse.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

commit;
