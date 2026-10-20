begin;

-- The function is evaluated from RLS policies and must remain executable by
-- authenticated clients. Bind direct calls to an active membership first so a
-- caller cannot probe the asset feature state of another tenant.
create or replace function public.is_asset_management_client_enabled(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.tenant_feature_flags feature
      where feature.tenant_id = p_tenant_id
        and feature.feature_key = 'assets.management'
        and feature.enabled
        and (
          feature.pilot_ends_at is null
          or feature.pilot_ends_at > timezone('utc', now())
        )
    );
$$;

revoke all on function public.is_asset_management_client_enabled(uuid)
  from public, anon;
grant execute on function public.is_asset_management_client_enabled(uuid)
  to authenticated;

comment on function public.is_asset_management_client_enabled(uuid) is
  'Asset feature gate for RLS. Direct calls return true only to an active member of the requested tenant.';

commit;
