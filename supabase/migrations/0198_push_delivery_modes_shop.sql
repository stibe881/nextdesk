-- The shop category was added to the enabled categories but not to the
-- delivery modes check, so every preference save with a shop mode failed.
create or replace function public.push_delivery_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable
strict
set search_path to 'pg_catalog'
as $function$
  select jsonb_typeof(p_modes) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(p_modes) as mode(category, delivery_mode)
      where category not in (
          'assigned', 'requester_reply', 'support_reply', 'mention',
          'resolved', 'sla', 'escalation', 'approval', 'follow_up',
          'contract_deadline', 'inventory_low_stock', 'shop'
        )
        or delivery_mode not in ('immediate', 'summary', 'off')
    );
$function$;
