-- Überwachung: Kategorien für überwachte Geräte.
--
-- Eine frei benennbare Gliederung neben der Art eines Geräts: Kategorien mit
-- einer Ebene Unterkategorien (z. B. «Standort Baar → Verteiler 2. OG»). Ein
-- Gerät gehört zu höchstens einer Kategorie oder Unterkategorie.

create table if not exists public.monitoring_device_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid references public.monitoring_device_groups(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_device_groups_not_own_parent check (parent_id is distinct from id)
);
create unique index if not exists monitoring_device_groups_name_unique
  on public.monitoring_device_groups (
    tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name))
  );
create index if not exists monitoring_device_groups_tenant_idx
  on public.monitoring_device_groups (tenant_id);

-- Nur eine Ebene Unterkategorien, und nur im selben Mandanten.
create or replace function public.monitoring_device_groups_check_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select tenant_id, parent_id into v_parent
    from public.monitoring_device_groups where id = new.parent_id;
  if not found or v_parent.tenant_id <> new.tenant_id then
    raise exception 'monitoring device group: parent not found' using errcode = '23503';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'monitoring device group: only one level of subcategories' using errcode = '23514';
  end if;
  if exists (select 1 from public.monitoring_device_groups where parent_id = new.id) then
    raise exception 'monitoring device group: a category with subcategories cannot become one' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists monitoring_device_groups_check_parent on public.monitoring_device_groups;
create trigger monitoring_device_groups_check_parent
  before insert or update of parent_id, tenant_id on public.monitoring_device_groups
  for each row execute function public.monitoring_device_groups_check_parent();

alter table public.asset_infrastructure
  add column if not exists monitoring_group_id uuid
    references public.monitoring_device_groups(id) on delete set null;
create index if not exists asset_infrastructure_monitoring_group_idx
  on public.asset_infrastructure (monitoring_group_id)
  where monitoring_group_id is not null;

alter table public.monitoring_device_groups enable row level security;
revoke all on public.monitoring_device_groups from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_device_groups to service_role;

comment on table public.monitoring_device_groups is
  'Categories of monitored devices with one level of subcategories. Service role only.';
comment on column public.asset_infrastructure.monitoring_group_id is
  'Category or subcategory of the device in the monitoring (monitoring_device_groups).';
