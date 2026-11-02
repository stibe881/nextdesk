-- Contracts and licences were only available to roles named
-- "Tenant administrator" or "Verträge". Any active tenant-wide role that holds
-- the contracts.manage permission now grants access, like the other modules.
begin;

create or replace function public.has_contracts_management_permission(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.user_role_assignments assignment
      on assignment.tenant_id = membership.tenant_id
      and assignment.user_id = membership.user_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = membership.tenant_id
      and role.scope = 'tenant'
      and role.active
    join public.role_permissions permission
      on permission.role_id = role.id
      and permission.permission_code = 'contracts.manage'
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  );
$$;

commit;
