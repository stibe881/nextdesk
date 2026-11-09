-- Racks as their own records: name, location, height in units (HE), notes.
--
-- Devices keep their rack as text (asset_infrastructure.rack) and are matched
-- to a rack by name and location; renaming or moving a rack updates its
-- devices (edge function infrastructure). Racks without a record are still
-- derived from the devices, as before.

create table if not exists public.infrastructure_racks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid,
  name text not null
    check (char_length(btrim(name)) between 1 and 80),
  height_units smallint not null default 42
    check (height_units between 1 and 60),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint infrastructure_racks_location_tenant_fk
    foreign key (location_id, tenant_id)
    references public.asset_locations(id, tenant_id) on delete set null (location_id)
);

create unique index if not exists infrastructure_racks_name_unique
  on public.infrastructure_racks (
    tenant_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

-- Only the edge function (service role) reads and writes racks.
alter table public.infrastructure_racks enable row level security;
revoke all on public.infrastructure_racks from anon, authenticated;
