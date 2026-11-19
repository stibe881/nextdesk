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

commit;
