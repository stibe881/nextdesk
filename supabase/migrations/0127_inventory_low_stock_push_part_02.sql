begin;

set local search_path = pg_catalog, public;

-- Every episode state change and recipient receipt is auditable without placing
-- item names, quantities, locations, supplier data or device tokens in the log.
create or replace function public.audit_inventory_low_stock_episode_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_action text;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'inventory_low_stock_episodes' then
    raise exception 'Unsupported inventory low-stock audit target' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    v_actor_id := new.opened_by_actor_id;
    v_action := 'inventory.low_stock.episode.opened';
  elsif tg_op = 'UPDATE'
    and old.recovered_at is null
    and new.recovered_at is not null then
    v_actor_id := new.recovered_by_actor_id;
    v_action := 'inventory.low_stock.episode.recovered';
  else
    return new;
  end if;

  if exists (select 1 from public.tenants where id = new.tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      new.tenant_id,
      v_actor_id,
      v_action,
      'inventory_low_stock_episode',
      new.id,
      'info',
      jsonb_build_object('item_id', new.item_id, 'event_id', case
        when tg_op = 'INSERT' then new.opened_by_event_id
        else new.recovered_by_event_id
      end)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_inventory_low_stock_episode_change()
  from public, anon, authenticated;


alter table public.inventory_low_stock_episodes enable row level security;

alter table public.inventory_low_stock_episodes force row level security;

revoke all on table public.inventory_low_stock_episodes from public, anon, authenticated;

grant select, insert, update, delete on table public.inventory_low_stock_episodes to service_role;

create policy inventory_low_stock_episodes_service_role_only
  on public.inventory_low_stock_episodes
  for all to service_role using (true) with check (true);


drop trigger if exists inventory_low_stock_episodes_audit_change
  on public.inventory_low_stock_episodes;

create trigger inventory_low_stock_episodes_audit_change
  after insert or update on public.inventory_low_stock_episodes
  for each row execute function public.audit_inventory_low_stock_episode_change();


create or replace function public.audit_inventory_low_stock_recipient_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
begin
  if tg_table_schema <> 'public'
    or tg_table_name <> 'inventory_low_stock_episode_recipients'
    or tg_op <> 'INSERT' then
    raise exception 'Unsupported inventory low-stock recipient audit target' using errcode = '22023';
  end if;

  select episode.opened_by_actor_id
  into v_actor_id
  from public.inventory_low_stock_episodes episode
  where episode.id = new.episode_id
    and episode.tenant_id = new.tenant_id;

  if v_actor_id is not null
    and exists (select 1 from public.tenants where id = new.tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      new.tenant_id,
      v_actor_id,
      'inventory.low_stock.recipient.recorded',
      'inventory_low_stock_episode_recipient',
      new.id,
      'info',
      jsonb_build_object('episode_id', new.episode_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_inventory_low_stock_recipient_change()
  from public, anon, authenticated;


alter table public.inventory_low_stock_episode_recipients enable row level security;

alter table public.inventory_low_stock_episode_recipients force row level security;

revoke all on table public.inventory_low_stock_episode_recipients from public, anon, authenticated;

grant select, insert, update, delete on table public.inventory_low_stock_episode_recipients to service_role;

create policy inventory_low_stock_episode_recipients_service_role_only
  on public.inventory_low_stock_episode_recipients
  for all to service_role using (true) with check (true);


drop trigger if exists inventory_low_stock_episode_recipients_audit_change
  on public.inventory_low_stock_episode_recipients;

create trigger inventory_low_stock_episode_recipients_audit_change
  after insert on public.inventory_low_stock_episode_recipients
  for each row execute function public.audit_inventory_low_stock_recipient_change();


-- The existing enqueue trigger remains the only path into push_outbox. It gets
-- an additional, exact authorization branch for the sole ticket-free kind.
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    else null
  end;
$$;

revoke all on function public.push_notification_category(text) from public, anon, authenticated;


create or replace function public.push_enqueue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_category text;
  v_categories text[];
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null then
    return new;
  end if;

  if new.kind = 'inventory.low_stock' then
    if not public.inventory_low_stock_delivery_authorized(new.tenant_id, new.user_id) then
      return new;
    end if;
  elsif not public.push_tenant_feature_enabled(new.tenant_id)
    or not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = new.tenant_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
    )
    or not exists (
      select 1
      from public.push_devices device
      where device.tenant_id = new.tenant_id
        and device.user_id = new.user_id
        and device.enabled
    ) then
    return new;
  end if;

  select preference.enabled_categories
  into v_categories
  from public.push_preferences preference
  where preference.tenant_id = new.tenant_id
    and preference.user_id = new.user_id;
  v_categories := coalesce(v_categories, array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
  ]::text[]);
  if not v_category = any(v_categories) then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  -- A deferred provider must not change the outcome of the in-app notification.
  return new;
end;
$$;

revoke all on function public.push_enqueue_ticket_notification()
  from public, anon, authenticated;

commit;
