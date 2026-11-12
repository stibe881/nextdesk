-- Shop notifications now carry how the order is handed over, as chosen when
-- ordering (pickup at the support, or to the workplace with a room), so the
-- mail, push and bell can say where the order is.
create or replace function public.shop_notify(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_order_id uuid,
  p_extra jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_order public.shop_orders%rowtype;
begin
  if p_user_id is null then
    return;
  end if;
  select * into v_order from public.shop_orders where id = p_order_id and tenant_id = p_tenant_id;
  insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
  values (
    p_tenant_id, p_user_id, null, p_kind,
    jsonb_strip_nulls(jsonb_build_object(
      'orderId', p_order_id,
      'orderNumber', v_order.order_number,
      'deliveryMethod', v_order.delivery_method,
      'deliveryLocation', nullif(btrim(v_order.delivery_location), '')
    )) || coalesce(p_extra, '{}'::jsonb)
  );
end;
$function$;
