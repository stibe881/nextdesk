begin;

set local search_path = pg_catalog, public;

-- 1. A knowledge suggestion is claimed while its AI draft is being written,
--    so a double click or a second person cannot create two drafts.
alter table public.knowledge_suggestions
  add column if not exists drafting_started_at timestamptz,
  add column if not exists drafting_by uuid references public.user_profiles(id) on delete set null;

-- 2. Reminders from time-based rules are delivered as push notifications
--    (category «Wiedervorlagen», which people can switch off or bundle).
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind like 'ticket.watch.%' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.rule_reminder' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    else null
  end;
$function$;

commit;
