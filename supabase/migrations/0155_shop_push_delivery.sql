begin;

set local search_path = pg_catalog, public;

-- Shop order notifications have no ticket. They are delivered to active
-- members of the workspace only; inventory and ticket rules stay unchanged.
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
          and notification.kind like 'shop.order.%' then
          exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = outbox.tenant_id
              and membership.user_id = outbox.user_id
              and membership.status = 'active'
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

create or replace function public.push_claim_outbox_v2(p_limit integer default 50)
returns table (
  outbox_id uuid,
  tenant_id uuid,
  user_id uuid,
  notification_id uuid,
  source_type text,
  ticket_id uuid,
  contract_id uuid,
  kind text,
  ticket_number text,
  subject text,
  delivery_mode text,
  devices jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_kind text;
  v_ticket_id uuid;
  v_contract_id uuid;
  v_ticket_number text;
  v_subject text;
  v_ticket_available boolean;
  v_category text;
  v_mode text;
  v_global_enabled boolean;
  v_modes jsonb;
  v_enabled_categories text[];
  v_summary_hour smallint;
  v_timezone text;
  v_local_hour integer;
  v_quiet_enabled boolean;
  v_quiet_start smallint;
  v_quiet_end smallint;
  v_quiet boolean;
  v_devices jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;

  update public.push_outbox
  set status = 'failed', last_error = 'attempt_limit'
  where status in ('pending', 'sending') and attempts >= 3;

  for v_row in
    select outbox.*
    from public.push_outbox outbox
    where outbox.attempts < 3
      and outbox.available_at <= timezone('utc', now())
      and (outbox.status = 'pending' or (
        outbox.status = 'sending'
        and outbox.claimed_at < timezone('utc', now()) - interval '5 minutes'
      ))
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  loop
    if not public.push_tenant_feature_enabled(v_row.tenant_id) then
      update public.push_outbox set status = 'skipped', last_error = 'feature_disabled'
      where id = v_row.id;
      continue;
    end if;
    if not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = v_row.tenant_id
        and membership.user_id = v_row.user_id
        and membership.status = 'active'
    ) then
      update public.push_outbox set status = 'skipped', last_error = 'membership_inactive'
      where id = v_row.id;
      continue;
    end if;

    v_kind := null;
    v_ticket_id := null;
    v_contract_id := null;
    v_ticket_number := null;
    v_subject := null;
    v_ticket_available := false;
    if v_row.source_type = 'ticket' then
      select
        notification.kind,
        notification.ticket_id,
        ticket.id is not null,
        ticket.ticket_number,
        case
          when feature.configuration ->> 'contentLevel' = 'subject'
            then ticket.subject
          else null
        end
      into
        v_kind,
        v_ticket_id,
        v_ticket_available,
        v_ticket_number,
        v_subject
      from public.ticket_notifications notification
      join public.tenant_feature_flags feature
        on feature.tenant_id = notification.tenant_id
        and feature.feature_key = 'notifications.push'
      left join public.tickets ticket
        on ticket.id = notification.ticket_id
        and ticket.tenant_id = notification.tenant_id
      where notification.id = v_row.notification_id
        and notification.tenant_id = v_row.tenant_id;
      if not found then
        update public.push_outbox set status = 'skipped', last_error = 'ticket_unavailable'
        where id = v_row.id;
        continue;
      end if;

      if v_ticket_id is null then
        -- Shop orders have no ticket; active membership was checked above.
        if v_kind like 'shop.order.%' then
          null;
        elsif v_kind <> 'inventory.low_stock'
          or not public.inventory_low_stock_delivery_authorized(
            v_row.tenant_id,
            v_row.user_id
          ) then
          update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
          where id = v_row.id;
          continue;
        end if;
      elsif not v_ticket_available
        or not public.ticket_notification_recipient_authorized(
          v_row.tenant_id,
          v_ticket_id,
          v_row.user_id
        ) then
        update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
        where id = v_row.id;
        continue;
      end if;
    else
      select event.contract_id, 'contract.deadline'::text
      into v_contract_id, v_kind
      from public.contract_deadline_push_events event
      where event.id = v_row.contract_event_id
        and event.tenant_id = v_row.tenant_id
        and event.recipient_user_id = v_row.user_id;
      if not found or not public.push_contract_delivery_authorized(
        v_row.tenant_id,
        v_row.user_id,
        v_contract_id
      ) then
        update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
        where id = v_row.id;
        continue;
      end if;
    end if;

    v_category := public.push_notification_category(v_kind);
    if v_category is null then
      update public.push_outbox set status = 'skipped', last_error = 'unsupported_kind'
      where id = v_row.id;
      continue;
    end if;

    select preference.global_enabled, preference.category_modes, preference.enabled_categories,
           preference.summary_hour, preference.quiet_hours_enabled, preference.quiet_start,
           preference.quiet_end, preference.timezone
    into v_global_enabled, v_modes, v_enabled_categories, v_summary_hour,
         v_quiet_enabled, v_quiet_start, v_quiet_end, v_timezone
    from public.push_preferences preference
    where preference.tenant_id = v_row.tenant_id
      and preference.user_id = v_row.user_id;
    v_global_enabled := coalesce(v_global_enabled, true);
    v_modes := coalesce(v_modes, '{}'::jsonb);
    v_enabled_categories := coalesce(v_enabled_categories, array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'shop'
    ]::text[]);
    v_summary_hour := coalesce(v_summary_hour, 8);
    v_quiet_enabled := coalesce(v_quiet_enabled, false);
    v_quiet_start := coalesce(v_quiet_start, 22);
    v_quiet_end := coalesce(v_quiet_end, 7);
    v_timezone := coalesce(v_timezone, 'Europe/Zurich');
    if not v_global_enabled then
      update public.push_outbox set status = 'skipped', last_error = 'global_disabled'
      where id = v_row.id;
      continue;
    end if;
    v_mode := public.push_delivery_mode(v_modes, v_enabled_categories, v_category);
    if v_mode = 'off' then
      update public.push_outbox set status = 'skipped', last_error = 'preference_disabled'
      where id = v_row.id;
      continue;
    end if;

    begin
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    exception when others then
      v_timezone := 'Europe/Zurich';
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    end;
    v_quiet := v_quiet_enabled and v_quiet_start <> v_quiet_end and case
      when v_quiet_start < v_quiet_end then v_local_hour >= v_quiet_start and v_local_hour < v_quiet_end
      else v_local_hour >= v_quiet_start or v_local_hour < v_quiet_end
    end;
    if v_quiet or not coalesce((public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean, false) then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = case when v_quiet then 'deferred_quiet_hours' else 'deferred_off_shift' end
      where id = v_row.id;
      continue;
    end if;
    if v_mode = 'summary' and v_local_hour <> v_summary_hour then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = 'deferred_summary'
      where id = v_row.id;
      continue;
    end if;

    select jsonb_agg(jsonb_build_object(
      'id', device.id, 'token', device.apns_token, 'environment', device.apns_environment
    ) order by device.created_at)
    into v_devices
    from public.push_devices device
    where device.tenant_id = v_row.tenant_id
      and device.user_id = v_row.user_id
      and device.enabled;
    if v_devices is null then
      update public.push_outbox set status = 'skipped', last_error = 'no_active_devices'
      where id = v_row.id;
      continue;
    end if;

    update public.push_outbox
    set status = 'sending', attempts = attempts + 1,
        claimed_at = timezone('utc', now()), last_error = null
    where id = v_row.id;
    outbox_id := v_row.id;
    tenant_id := v_row.tenant_id;
    user_id := v_row.user_id;
    notification_id := v_row.notification_id;
    source_type := v_row.source_type;
    ticket_id := v_ticket_id;
    contract_id := v_contract_id;
    kind := v_kind;
    ticket_number := v_ticket_number;
    subject := v_subject;
    delivery_mode := v_mode;
    devices := v_devices;
    return next;
  end loop;
end;
$$;

revoke all on function public.push_claim_outbox_v2(integer)
  from public, anon, authenticated;

grant execute on function public.push_claim_outbox_v2(integer) to service_role;

commit;
