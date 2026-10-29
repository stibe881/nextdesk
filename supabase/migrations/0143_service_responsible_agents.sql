begin;

set local search_path = pg_catalog, public;

alter table public.services
  add column if not exists primary_responsible_id uuid,
  add column if not exists secondary_responsible_id uuid;

alter table public.services
  drop constraint if exists services_primary_responsible_tenant_fk,
  add constraint services_primary_responsible_tenant_fk
    foreign key (tenant_id, primary_responsible_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (primary_responsible_id),
  drop constraint if exists services_secondary_responsible_tenant_fk,
  add constraint services_secondary_responsible_tenant_fk
    foreign key (tenant_id, secondary_responsible_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (secondary_responsible_id),
  drop constraint if exists services_secondary_responsible_requires_primary,
  add constraint services_secondary_responsible_requires_primary
    check (secondary_responsible_id is null or primary_responsible_id is not null),
  drop constraint if exists services_responsible_agents_distinct,
  add constraint services_responsible_agents_distinct
    check (
      primary_responsible_id is null
      or secondary_responsible_id is null
      or primary_responsible_id <> secondary_responsible_id
    );

create index if not exists services_primary_responsible_idx
  on public.services (tenant_id, primary_responsible_id)
  where primary_responsible_id is not null;

create index if not exists services_secondary_responsible_idx
  on public.services (tenant_id, secondary_responsible_id)
  where secondary_responsible_id is not null;

create or replace function public.is_active_service_responsible(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
      and exists (
        select 1
        from public.user_role_assignments assignment
        join public.roles role
          on role.id = assignment.role_id
          and role.tenant_id = assignment.tenant_id
          and role.active
          and role.scope in ('tenant', 'department')
        join public.role_permissions permission
          on permission.role_id = role.id
        where assignment.tenant_id = p_tenant_id
          and assignment.user_id = p_user_id
          and assignment.starts_at <= timezone('utc', now())
          and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
          and permission.permission_code in ('ticket.read.assigned', 'ticket.update')
          and exists (
            select 1
            from public.department_memberships department_membership
            where department_membership.tenant_id = p_tenant_id
              and department_membership.user_id = p_user_id
              and department_membership.status = 'active'
              and (
                role.scope = 'tenant'
                or department_membership.department_id = assignment.department_id
              )
          )
      )
  );
$$;

revoke all on function public.is_active_service_responsible(uuid, uuid) from public, anon, authenticated;

create or replace function public.validate_service_responsible_agents()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.secondary_responsible_id is not null and new.primary_responsible_id is null then
    raise exception using errcode = '23514', message = 'invalid_service_responsible';
  end if;

  if new.primary_responsible_id is not null
    and not public.is_active_service_responsible(new.tenant_id, new.primary_responsible_id) then
    raise exception using errcode = '23514', message = 'invalid_service_responsible';
  end if;

  if new.secondary_responsible_id is not null
    and not public.is_active_service_responsible(new.tenant_id, new.secondary_responsible_id) then
    raise exception using errcode = '23514', message = 'invalid_service_responsible';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_service_responsible_agents() from public, anon, authenticated;

drop trigger if exists services_validate_responsible_agents on public.services;
create trigger services_validate_responsible_agents
  before insert or update of tenant_id, primary_responsible_id, secondary_responsible_id
  on public.services
  for each row
  execute function public.validate_service_responsible_agents();

commit;
