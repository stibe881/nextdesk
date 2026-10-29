begin;

-- Active catalogue services remain readable for active members with the
-- enabled Asset Management feature. Archived services are operational history
-- and are visible only to people who can manage the service catalogue.
drop policy if exists services_select_member on public.services;
create policy services_select_member on public.services
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and (
      active
      or public.has_tenant_permission(tenant_id, 'asset.manage')
    )
  );

commit;
