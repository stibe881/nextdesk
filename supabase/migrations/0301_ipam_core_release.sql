begin;
set local search_path = pg_catalog, public;

-- IPAM Kern: Freigegebene Adressen (Status «deprecated») bleiben mit ihrem
-- Verlauf erhalten, werden bei «Nächste freie IP» aber wieder angeboten.
-- Ersetzt public.ipam_next_free_address aus 0300; sonst unverändert.

create or replace function public.ipam_next_free_address(
  p_tenant_id uuid,
  p_prefix_id uuid,
  p_after inet default null
)
returns inet
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix public.ipam_prefixes;
  v_candidate inet;
  v_last inet;
  v_steps integer := 0;
begin
  select * into v_prefix from public.ipam_prefixes
   where id = p_prefix_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Prefix not found' using errcode = 'P0002';
  end if;
  if family(v_prefix.prefix) = 4 and masklen(v_prefix.prefix) <= 30 then
    v_candidate := host(v_prefix.prefix)::inet + 1;
    v_last := host(broadcast(v_prefix.prefix))::inet - 1;
  else
    v_candidate := host(v_prefix.prefix)::inet + (case when family(v_prefix.prefix) = 6 then 1 else 0 end);
    v_last := host(broadcast(v_prefix.prefix))::inet;
  end if;
  if p_after is not null and p_after >= v_candidate then
    v_candidate := set_masklen(p_after, masklen(v_candidate)) + 1;
  end if;
  while v_candidate <= v_last and v_steps < 70000 loop
    v_steps := v_steps + 1;
    if (v_prefix.gateway is null or host(v_prefix.gateway) <> host(v_candidate))
       and not (v_prefix.dhcp_start is not null
                and v_candidate >= v_prefix.dhcp_start and v_candidate <= v_prefix.dhcp_end)
       and not exists (
         select 1 from public.ipam_addresses address
         where address.tenant_id = p_tenant_id
           and address.vrf_id is not distinct from v_prefix.vrf_id
           and address.address = v_candidate
           and address.status <> 'deprecated'
       ) then
      return v_candidate;
    end if;
    v_candidate := v_candidate + 1;
  end loop;
  return null;
end;
$$;

revoke all on function public.ipam_next_free_address(uuid, uuid, inet) from public, anon, authenticated;
grant execute on function public.ipam_next_free_address(uuid, uuid, inet) to service_role;

commit;
