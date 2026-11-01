begin;

set local search_path = pg_catalog, public;

-- Agents can place shop orders on behalf of employees. The order belongs to
-- the employee (requester); placed_by records the agent. Approval rules use
-- the employee's manager, exactly as if the employee had ordered.

alter table public.shop_orders
  add column if not exists placed_by uuid references public.user_profiles(id) on delete set null;

create or replace function public.shop_submit_order_for(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_requester_id uuid,
  p_client_request_id uuid,
  p_lines jsonb,
  p_delivery_method text,
  p_delivery_location text,
  p_needed_by date,
  p_loan_from date,
  p_loan_until date,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing uuid;
  v_order_id uuid;
  v_input jsonb;
  v_item public.shop_catalog_items%rowtype;
  v_quantity integer;
  v_needs_approval boolean := false;
  v_has_loan boolean := false;
  v_max_loan_days integer;
  v_approver uuid;
  v_line record;
  v_seen uuid[] := '{}';
  v_requester uuid;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 30
     or coalesce(p_delivery_method, 'pickup') not in ('pickup', 'desk') then
    raise exception 'Invalid shop order' using errcode = '22023';
  end if;
  if not public.shop_feature_enabled(p_tenant_id) then
    raise exception 'The shop is not enabled' using errcode = '42501';
  end if;
  if p_requester_id is null or p_requester_id = p_actor_id then
    if not public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.order') then
      raise exception 'Not allowed to order' using errcode = '42501';
    end if;
  else
    -- Agents may place an order on behalf of an active member of the workspace.
    if not public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.fulfill') then
      raise exception 'Not allowed to order for other people' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.user_id = p_requester_id
        and membership.status = 'active'
    ) then
      raise exception 'The requester is not an active member' using errcode = '22023';
    end if;
  end if;
  v_requester := coalesce(p_requester_id, p_actor_id);

  select id into v_existing from public.shop_orders
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id;
  if found then
    return v_existing;
  end if;

  insert into public.shop_orders (
    tenant_id, order_number, client_request_id, requester_id, placed_by, status,
    delivery_method, delivery_location, needed_by, loan_from, loan_until, comment
  ) values (
    p_tenant_id, public.shop_next_order_number(p_tenant_id), p_client_request_id, v_requester,
    case when v_requester <> p_actor_id then p_actor_id end, 'submitted',
    coalesce(p_delivery_method, 'pickup'), nullif(btrim(coalesce(p_delivery_location, '')), ''),
    p_needed_by, p_loan_from, p_loan_until, nullif(btrim(coalesce(p_comment, '')), '')
  ) returning id into v_order_id;

  for v_input in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.shop_catalog_items
    where id = (v_input ->> 'catalog_item_id')::uuid and tenant_id = p_tenant_id and active;
    if not found then
      raise exception 'Catalog item is not available' using errcode = 'P0002';
    end if;
    if v_item.id = any(v_seen) then
      raise exception 'Catalog item listed twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_item.id;
    v_quantity := (v_input ->> 'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > v_item.max_quantity then
      raise exception 'Invalid quantity for %', v_item.name using errcode = '22023';
    end if;
    if v_item.requires_approval then
      v_needs_approval := true;
    end if;
    if v_item.kind = 'loan' then
      v_has_loan := true;
      v_max_loan_days := least(coalesce(v_max_loan_days, v_item.max_loan_days), coalesce(v_item.max_loan_days, v_max_loan_days));
    end if;
    insert into public.shop_order_lines (
      tenant_id, order_id, catalog_item_id, inventory_item_id, item_name, kind, quantity
    ) values (
      p_tenant_id, v_order_id, v_item.id, v_item.inventory_item_id, v_item.name, v_item.kind, v_quantity
    );
  end loop;

  if v_has_loan then
    if p_loan_from is null or p_loan_until is null or p_loan_until < p_loan_from
       or p_loan_from < (timezone('Europe/Zurich', now()))::date then
      raise exception 'A loan needs a valid period' using errcode = '22023';
    end if;
    if v_max_loan_days is not null and p_loan_until - p_loan_from + 1 > v_max_loan_days then
      raise exception 'Loan period exceeds % days', v_max_loan_days using errcode = '22023';
    end if;
  elsif p_loan_from is not null or p_loan_until is not null then
    update public.shop_orders set loan_from = null, loan_until = null where id = v_order_id;
  end if;

  if v_requester <> p_actor_id then
    perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'placed_on_behalf');
    perform public.shop_notify(p_tenant_id, v_requester, 'shop.order.placed_for_you', v_order_id);
  else
    perform public.shop_log(p_tenant_id, v_order_id, p_actor_id, 'submitted');
  end if;

  if v_needs_approval then
    v_approver := public.shop_effective_manager(p_tenant_id, v_requester);
    update public.shop_orders
       set status = 'pending_approval', approver_id = v_approver
     where id = v_order_id;
    perform public.shop_log(p_tenant_id, v_order_id, null, 'approval_requested',
      case when v_approver is null then 'Keine vorgesetzte Person hinterlegt – Freigabe durch den Support.' end);
    if v_approver is not null then
      perform public.shop_notify(p_tenant_id, v_approver, 'shop.order.approval_requested', v_order_id);
    else
      perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.approval_requested', v_order_id, p_actor_id);
    end if;
  else
    for v_line in select id from public.shop_order_lines where order_id = v_order_id loop
      perform public.shop_try_reserve_line(p_actor_id, v_line.id);
    end loop;
    perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.submitted', v_order_id, p_actor_id);
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'shop.order.submitted', 'shop_order', v_order_id, 'info',
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'approval', v_needs_approval,
      'requester_id', v_requester));

  return v_order_id;
end;
$$;

revoke all on function public.shop_submit_order_for(uuid, uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  from public, anon, authenticated;
grant execute on function public.shop_submit_order_for(uuid, uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  to service_role;

create or replace function public.shop_submit_order(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_lines jsonb,
  p_delivery_method text,
  p_delivery_location text,
  p_needed_by date,
  p_loan_from date,
  p_loan_until date,
  p_comment text
)
returns uuid
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.shop_submit_order_for(
    p_actor_id, p_tenant_id, p_actor_id, p_client_request_id, p_lines,
    p_delivery_method, p_delivery_location, p_needed_by, p_loan_from, p_loan_until, p_comment
  );
$$;

revoke all on function public.shop_submit_order(uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  from public, anon, authenticated;
grant execute on function public.shop_submit_order(uuid, uuid, uuid, jsonb, text, text, date, date, date, text)
  to service_role;

commit;
