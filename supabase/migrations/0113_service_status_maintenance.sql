begin;

-- Wartungsfenster sind ausschliesslich mandantenlokal. Ihre Zustände werden
-- bewusst nicht zeitgesteuert mutiert; autorisierte Personen pflegen sie.
create table if not exists public.service_status_maintenances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text check (
    description is null or char_length(btrim(description)) <= 2000
  ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'active', 'completed', 'cancelled')),
  public_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_status_maintenances_id_tenant_unique unique (id, tenant_id),
  constraint service_status_maintenances_time_valid check (ends_at > starts_at)
);

-- Keeping tenant_id on every link turns both relationship boundaries into real
-- database constraints, including for service-role writes and concurrent data
-- changes. A service can be affected by many independent maintenance windows.
create table if not exists public.service_status_maintenance_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  maintenance_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (maintenance_id, service_id),
  constraint service_status_maintenance_services_maintenance_tenant_fk
    foreign key (maintenance_id, tenant_id)
    references public.service_status_maintenances (id, tenant_id)
    on delete cascade,
  constraint service_status_maintenance_services_service_tenant_fk
    foreign key (service_id, tenant_id)
    references public.services (id, tenant_id)
    on delete cascade
);

create index if not exists service_status_maintenances_tenant_updated_idx
  on public.service_status_maintenances (tenant_id, updated_at desc, id);
create index if not exists service_status_maintenances_tenant_window_idx
  on public.service_status_maintenances (tenant_id, starts_at, ends_at);
create index if not exists service_status_maintenances_public_window_idx
  on public.service_status_maintenances (tenant_id, starts_at, ends_at)
  where public_enabled and state in ('scheduled', 'active');
create index if not exists service_status_maintenance_services_tenant_maintenance_idx
  on public.service_status_maintenance_services (tenant_id, maintenance_id);
create index if not exists service_status_maintenance_services_tenant_service_idx
  on public.service_status_maintenance_services (tenant_id, service_id, maintenance_id);

alter table public.service_status_maintenances enable row level security;
alter table public.service_status_maintenances force row level security;
alter table public.service_status_maintenance_services enable row level security;
alter table public.service_status_maintenance_services force row level security;

-- Browser roles never receive table access or policies. The authenticated Edge
-- Function validates membership, feature state and permissions before it uses
-- service_role for these internal records.
revoke all on table public.service_status_maintenances,
  public.service_status_maintenance_services
  from public, anon, authenticated;
grant select, insert, update, delete on table public.service_status_maintenances,
  public.service_status_maintenance_services to service_role;

drop policy if exists service_status_maintenances_no_direct_browser_access
  on public.service_status_maintenances;
drop policy if exists service_status_maintenance_services_no_direct_browser_access
  on public.service_status_maintenance_services;

create trigger service_status_maintenances_updated_at
  before update on public.service_status_maintenances
  for each row execute function public.set_updated_at();

commit;
