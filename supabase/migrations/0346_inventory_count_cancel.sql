begin;

set local search_path = pg_catalog, public;

-- «Inventur löschen»: a running count is discarded (status «cancelled»).
-- A running count has not booked anything yet, so stock stays unchanged; its
-- recorded lines remain for traceability. Closed counts cannot be discarded.
-- Same capability as starting a count (inventory.manage). Only service_role
-- may call this; the Edge Function inventory checks the actor first.
create or replace function public.cancel_inventory_count(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_count_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line_count integer;
begin
  if p_actor_id is null or p_tenant_id is null or p_count_id is null then
    raise exception 'Invalid inventory count cancel request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  select * into v_count
  from public.inventory_counts
  where id = p_count_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Inventory count not found' using errcode = 'P0002';
  end if;
  -- A repeated tap returns the same result instead of an error.
  if v_count.status = 'cancelled' then
    return v_count.id;
  end if;
  if v_count.status not in ('draft', 'counting') then
    raise exception 'inventory_count_not_running' using errcode = 'ND410';
  end if;

  select count(*) into v_line_count
  from public.inventory_count_lines
  where count_id = p_count_id and tenant_id = p_tenant_id;

  update public.inventory_counts
  set status = 'cancelled',
      cancelled_at = timezone('utc', now())
  where id = p_count_id and tenant_id = p_tenant_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.count.cancelled', 'inventory_count', p_count_id, 'info',
    jsonb_build_object(
      'type', 'count_cancel',
      'count', v_line_count,
      'location_id', v_count.location_id,
      'reference_type', 'inventory_count'
    )
  );
  return p_count_id;
end;
$$;

revoke all on function public.cancel_inventory_count(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_inventory_count(uuid, uuid, uuid) to service_role;

commit;
