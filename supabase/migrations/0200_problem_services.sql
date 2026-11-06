-- Services affected by a case. The operational state itself stays on the
-- service (services.status), which feeds the system status page.
create table if not exists public.problem_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  problem_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (problem_id, service_id),
  constraint problem_services_problem_tenant_fk foreign key (problem_id, tenant_id)
    references public.problems (id, tenant_id) on delete cascade,
  constraint problem_services_service_tenant_fk foreign key (service_id, tenant_id)
    references public.services (id, tenant_id) on delete cascade
);

create index if not exists problem_services_service_idx
  on public.problem_services (service_id, tenant_id);

alter table public.problem_services enable row level security;

create policy problem_services_select_member on public.problem_services
  for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
  );

-- Links are written by the service-assets function after its checks.
revoke insert, update, delete on public.problem_services from anon, authenticated;
grant select on public.problem_services to authenticated;
grant all on public.problem_services to service_role;
