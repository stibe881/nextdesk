begin;

set local search_path = pg_catalog, public;

-- Module data per department (stages B2–B5).
--
-- Each main record of a department-scoped module gets a department. People see
-- the records of the departments in which the module is on for them
-- (user_feature_departments); people without a department see those of all
-- departments with the module on. Records without a department stay visible
-- to everyone with the module. Existing records go to the ICT department.
--
-- Reads through the signed-in user's client are limited by a restrictive RLS
-- policy; edge functions that use the service role filter explicitly.

-- Departments whose records of module p_feature_key the signed-in person may
-- see, across all their tenants. While the module is off for a whole tenant,
-- all of that tenant's departments count (nothing is scoped there), so shared
-- records such as services on tickets keep working.
--
-- The RLS policy calls it in an uncorrelated sub-select, so it is evaluated
-- once per query and not once per row.
create or replace function public.my_scoped_departments(p_feature_key text)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(department.id), '{}'::uuid[])
  from public.departments department
  where exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = department.tenant_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
    and (
      not exists (
        select 1
        from public.tenant_feature_flags flag
        where flag.tenant_id = department.tenant_id
          and flag.feature_key = p_feature_key
          and flag.enabled
          and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
      )
      or department.id = any(
        public.user_feature_departments(department.tenant_id, auth.uid(), p_feature_key)
      )
    );
$$;

revoke all on function public.my_scoped_departments(text) from public, anon;
grant execute on function public.my_scoped_departments(text)
  to authenticated, service_role;

do $$
declare
  v_target record;
begin
  for v_target in
    select *
    from (values
      ('inventory_items', 'inventory.management'),
      ('shop_catalog_items', 'self_service.shop'),
      ('assets', 'assets.management'),
      ('services', 'assets.management'),
      ('problems', 'assets.management'),
      ('knowledge_articles', 'knowledge.base'),
      ('contracts', 'contracts.management'),
      ('licenses', 'contracts.management')
    ) as targets(table_name, feature_key)
  loop
    if to_regclass('public.' || v_target.table_name) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists department_id uuid',
      v_target.table_name
    );

    if not exists (
      select 1 from pg_constraint
      where conname = v_target.table_name || '_department_fk'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (department_id, tenant_id) '
        || 'references public.departments(id, tenant_id) on delete set null (department_id)',
        v_target.table_name,
        v_target.table_name || '_department_fk'
      );
    end if;

    execute format(
      'create index if not exists %I on public.%I (tenant_id, department_id)',
      v_target.table_name || '_department_idx',
      v_target.table_name
    );

    -- Existing records go to the ICT department of their tenant.
    execute format(
      'update public.%I target set department_id = department.id '
      || 'from public.departments department '
      || 'where target.department_id is null '
      || 'and department.tenant_id = target.tenant_id '
      || 'and department.kind = ''ict''',
      v_target.table_name
    );

    -- The shop is open to employees of every department (the edge function
    -- scopes editing), so only the other modules get the RLS restriction.
    if v_target.table_name <> 'shop_catalog_items' then
      execute format(
        'drop policy if exists %I on public.%I',
        v_target.table_name || '_department_scope',
        v_target.table_name
      );
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated '
        || 'using (department_id is null or department_id = any ((select public.my_scoped_departments(%L))::uuid[])) '
        || 'with check (department_id is null or department_id = any ((select public.my_scoped_departments(%L))::uuid[]))',
        v_target.table_name || '_department_scope',
        v_target.table_name,
        v_target.feature_key,
        v_target.feature_key
      );
    end if;
  end loop;
end
$$;

commit;
