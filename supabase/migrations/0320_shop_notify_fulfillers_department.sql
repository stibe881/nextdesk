-- Shop orders notify only the responsible department: the department of the
-- ordered articles (catalog article, otherwise its stock article). People who
-- may fulfil shop orders get the notification only if they are an active
-- member of one of these departments.
-- Fallbacks so that nothing gets lost: an article without a department, or a
-- department without anyone who may fulfil, notifies all fulfillers as before.

create or replace function public.shop_order_departments(p_order_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  -- null in the array = an article without department (everyone is responsible)
  select coalesce(
    array_agg(distinct coalesce(catalog_item.department_id, inventory_item.department_id)),
    '{}'::uuid[]
  )
  from public.shop_order_lines line
  left join public.shop_catalog_items catalog_item on catalog_item.id = line.catalog_item_id
  left join public.inventory_items inventory_item
    on inventory_item.id = coalesce(line.inventory_item_id, catalog_item.inventory_item_id)
  where line.order_id = p_order_id;
$$;
revoke all on function public.shop_order_departments(uuid) from public, anon, authenticated;

create or replace function public.shop_notify_fulfillers(
  p_tenant_id uuid,
  p_kind text,
  p_order_id uuid,
  p_except_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_departments uuid[] := public.shop_order_departments(p_order_id);
  v_scoped boolean;
  v_sent integer := 0;
begin
  -- Only when every article has a department.
  v_scoped := cardinality(v_departments) > 0
    and not exists (select 1 from unnest(v_departments) as department_id where department_id is null);

  if v_scoped then
    for v_user_id in
      select distinct membership.user_id
      from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.status = 'active'
        and membership.user_id is distinct from p_except_user_id
        and public.shop_has_permission(membership.user_id, p_tenant_id, 'shop.fulfill')
        and exists (
          select 1
          from public.department_memberships department_membership
          where department_membership.tenant_id = p_tenant_id
            and department_membership.user_id = membership.user_id
            and department_membership.status = 'active'
            and department_membership.department_id = any (v_departments)
        )
    loop
      perform public.shop_notify(p_tenant_id, v_user_id, p_kind, p_order_id);
      v_sent := v_sent + 1;
    end loop;
    if v_sent > 0 then
      return;
    end if;
  end if;

  for v_user_id in
    select distinct membership.user_id
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.status = 'active'
      and membership.user_id is distinct from p_except_user_id
      and public.shop_has_permission(membership.user_id, p_tenant_id, 'shop.fulfill')
  loop
    perform public.shop_notify(p_tenant_id, v_user_id, p_kind, p_order_id);
  end loop;
end;
$function$;
