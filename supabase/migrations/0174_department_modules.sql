begin;

set local search_path = pg_catalog, public;

-- Modules per department. The tenant switch (tenant_feature_flags) stays the
-- master switch; a department may turn a module off. A missing row means the
-- module is on for that department.
--
-- A person may use a module when it is on for at least one of their active
-- departments. People without any department membership (employees using the
-- shop, portal, …) may use it when it is on for at least one active department
-- of the tenant. Administrators follow the same rule.

create table if not exists public.department_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null,
  feature_key text not null references public.feature_catalog(key) on delete cascade,
  enabled boolean not null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (department_id, feature_key),
  constraint department_feature_flags_department_tenant_fk
    foreign key (department_id, tenant_id)
    references public.departments(id, tenant_id) on delete cascade
);

create index if not exists department_feature_flags_tenant_idx
  on public.department_feature_flags (tenant_id, feature_key);

alter table public.department_feature_flags enable row level security;
revoke all on public.department_feature_flags from anon, authenticated;

-- Departments whose data a person may see in a module: their own active
-- departments with the module on, or (without memberships) all active
-- departments of the tenant with the module on. Empty when the tenant switch
-- is off or the pilot has expired.
create or replace function public.user_feature_departments(
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature_key text
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with tenant_switch as (
    select exists (
      select 1
      from public.tenant_feature_flags flag
      where flag.tenant_id = p_tenant_id
        and flag.feature_key = p_feature_key
        and flag.enabled
        and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
    ) as on_
  ),
  member as (
    select exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.user_id = p_user_id
        and membership.status = 'active'
    ) as active
  ),
  own_departments as (
    select department.id
    from public.department_memberships membership
    join public.departments department
      on department.id = membership.department_id
     and department.tenant_id = membership.tenant_id
     and department.active
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ),
  candidates as (
    select id from own_departments
    union all
    select department.id
    from public.departments department
    where department.tenant_id = p_tenant_id
      and department.active
      and not exists (select 1 from own_departments)
  )
  select coalesce(array_agg(candidate.id order by candidate.id), '{}'::uuid[])
  from candidates candidate, tenant_switch, member
  where tenant_switch.on_
    and member.active
    and not exists (
      select 1
      from public.department_feature_flags flag
      where flag.department_id = candidate.id
        and flag.feature_key = p_feature_key
        and not flag.enabled
    );
$$;

-- Effective module switches of a person as {"feature.key": true|false}.
-- The shop is open to everyone as soon as it is on in one department, so
-- employees can order from the shops of all departments that run one.
create or replace function public.user_feature_states(
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature_keys text[]
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(
      requested.key,
      cardinality(public.user_feature_departments(p_tenant_id, p_user_id, requested.key)) > 0
        or (
          requested.key = 'self_service.shop'
          and exists (
            select 1
            from public.tenant_feature_flags flag
            where flag.tenant_id = p_tenant_id
              and flag.feature_key = requested.key
              and flag.enabled
              and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
          )
          and exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = p_tenant_id
              and membership.user_id = p_user_id
              and membership.status = 'active'
          )
          and exists (
            select 1
            from public.departments department
            where department.tenant_id = p_tenant_id
              and department.active
              and not exists (
                select 1
                from public.department_feature_flags flag
                where flag.department_id = department.id
                  and flag.feature_key = requested.key
                  and not flag.enabled
              )
          )
        )
        or (
          -- A tenant without any active department keeps the tenant switch.
          not exists (
            select 1 from public.departments department
            where department.tenant_id = p_tenant_id and department.active
          )
          and exists (
            select 1
            from public.tenant_feature_flags flag
            where flag.tenant_id = p_tenant_id
              and flag.feature_key = requested.key
              and flag.enabled
              and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
          )
          and exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = p_tenant_id
              and membership.user_id = p_user_id
              and membership.status = 'active'
          )
        )
    ),
    '{}'::jsonb
  )
  from unnest(p_feature_keys) as requested(key);
$$;

revoke all on function public.user_feature_departments(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.user_feature_states(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.user_feature_departments(uuid, uuid, text)
  to service_role;
grant execute on function public.user_feature_states(uuid, uuid, text[])
  to service_role;

commit;
