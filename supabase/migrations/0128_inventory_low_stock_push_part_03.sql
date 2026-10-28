begin;

set local search_path = pg_catalog, public;

-- Evaluate after the immutable ledger lines have been inserted as one statement.
-- Transfers therefore expose only their final cross-location item availability,
-- never the debit side of their counterbooking pair.
create or replace function public.inventory_evaluate_low_stock_after_event_lines()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_change record;
  v_episode public.inventory_low_stock_episodes%rowtype;
  v_has_open_episode boolean;
  v_minimum numeric(18,3);
  v_available numeric(18,3);
  v_recipient record;
  v_notification_id uuid;
begin
  for v_change in
    select distinct
      line.tenant_id,
      line.item_id,
      line.event_id,
      event.actor_id
    from new_inventory_event_lines line
    join public.inventory_events event
      on event.id = line.event_id
      and event.tenant_id = line.tenant_id
    order by line.tenant_id, line.item_id, line.event_id
  loop
    -- Serializes episode transitions even when concurrent postings affect
    -- different locations of the same item.
    perform pg_advisory_xact_lock(hashtextextended(
      'nextdesk:inventory-low-stock:' || v_change.tenant_id::text || ':' || v_change.item_id::text,
      0
    ));

    select
      item.minimum_quantity,
      coalesce(sum(balance.physical_quantity - balance.reserved_quantity), 0)
    into v_minimum, v_available
    from public.inventory_items item
    left join public.inventory_stock_balances balance
      on balance.tenant_id = item.tenant_id
      and balance.item_id = item.id
    where item.id = v_change.item_id
      and item.tenant_id = v_change.tenant_id
    group by item.minimum_quantity;
    if not found then
      continue;
    end if;

    select *
    into v_episode
    from public.inventory_low_stock_episodes episode
    where episode.tenant_id = v_change.tenant_id
      and episode.item_id = v_change.item_id
      and episode.recovered_at is null
    for update;
    v_has_open_episode := found;

    if v_available <= v_minimum then
      if not v_has_open_episode then
        if not public.inventory_management_feature_enabled(v_change.tenant_id)
          or not public.push_tenant_feature_enabled(v_change.tenant_id) then
          continue;
        end if;

        insert into public.inventory_low_stock_episodes (
          tenant_id,
          item_id,
          opened_by_event_id,
          opened_by_actor_id
        ) values (
          v_change.tenant_id,
          v_change.item_id,
          v_change.event_id,
          v_change.actor_id
        ) returning * into v_episode;
        v_has_open_episode := true;
      end if;

      -- A recipient can be added later in the same episode only when a new
      -- inventory event occurs. This remains event-driven and is fenced by the
      -- durable unique receipt. The opening actor and the current booking actor
      -- are both excluded, so a booking actor never receives their own alert.
      for v_recipient in
        select membership.user_id
        from public.tenant_memberships membership
        where membership.tenant_id = v_change.tenant_id
          and membership.status = 'active'
          and membership.user_id <> v_change.actor_id
          and membership.user_id <> v_episode.opened_by_actor_id
          and public.inventory_low_stock_delivery_authorized(
            v_change.tenant_id,
            membership.user_id
          )
          and not exists (
            select 1
            from public.inventory_low_stock_episode_recipients recipient
            where recipient.episode_id = v_episode.id
              and recipient.recipient_user_id = membership.user_id
          )
        order by membership.user_id
      loop
        insert into public.ticket_notifications (
          tenant_id,
          user_id,
          ticket_id,
          kind,
          payload
        ) values (
          v_change.tenant_id,
          v_recipient.user_id,
          null,
          'inventory.low_stock',
          jsonb_build_object(
            'inventoryEpisodeId', v_episode.id,
            'inventoryItemId', v_change.item_id
          )
        ) returning id into v_notification_id;

        insert into public.inventory_low_stock_episode_recipients (
          tenant_id,
          episode_id,
          recipient_user_id,
          notification_id
        ) values (
          v_change.tenant_id,
          v_episode.id,
          v_recipient.user_id,
          v_notification_id
        );
      end loop;
    elsif v_has_open_episode then
      update public.inventory_low_stock_episodes
      set recovered_at = timezone('utc', now()),
          recovered_by_event_id = v_change.event_id,
          recovered_by_actor_id = v_change.actor_id
      where id = v_episode.id
        and tenant_id = v_change.tenant_id
        and recovered_at is null;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.inventory_evaluate_low_stock_after_event_lines()
  from public, anon, authenticated;


drop trigger if exists inventory_evaluate_low_stock_after_event_lines
  on public.inventory_event_lines;

create trigger inventory_evaluate_low_stock_after_event_lines
  after insert on public.inventory_event_lines
  referencing new table as new_inventory_event_lines
  for each statement execute function public.inventory_evaluate_low_stock_after_event_lines();


-- Queue rows can outlive a role or membership change. Null ticket IDs are only
-- valid for the exact inventory kind and are checked against the same full
-- delivery boundary before every claim.
create or replace function public.push_skip_unauthorized_ticket_outbox()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_skipped integer := 0;
begin
  update public.push_outbox outbox
  set status = 'skipped',
      last_error = 'recipient_not_authorized',
      claimed_at = null
  from public.ticket_notifications notification
  where outbox.source_type = 'ticket'
    and outbox.notification_id = notification.id
    and outbox.tenant_id = notification.tenant_id
    and outbox.status in ('pending', 'sending')
    and not coalesce(
      case
        when notification.ticket_id is not null then
          public.ticket_notification_recipient_authorized(
            outbox.tenant_id,
            notification.ticket_id,
            outbox.user_id
          )
        when notification.ticket_id is null
          and notification.kind = 'inventory.low_stock' then
          public.inventory_low_stock_delivery_authorized(
            outbox.tenant_id,
            outbox.user_id
          )
        else false
      end,
      false
    );
  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$$;

revoke all on function public.push_skip_unauthorized_ticket_outbox()
  from public, anon, authenticated;

grant execute on function public.push_skip_unauthorized_ticket_outbox()
  to service_role;

commit;
