begin;

set local search_path = pg_catalog, public;

-- Phishing reports get a notification category of their own ("Phishing-
-- Meldungen"). Until now they were delivered under "Eskalationen". Like
-- infrastructure reminders the category lives in the delivery modes
-- (push) and in email_categories (e-mail); the stored enabled_categories list
-- stays as it is.

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
    when p_kind = 'ticket.requester_reminder' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind like 'ticket.watch.%' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.kudos' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.rule_reminder' then 'follow_up'
    when p_kind in ('ticket.vendor_reminder', 'ticket.children_done') then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind = 'ticket.security_report' then 'security_report'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    else null
  end;
$function$;

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
          'contract_deadline', 'inventory_low_stock', 'shop', 'infrastructure',
          'security_report'
        )
        or delivery_mode not in ('immediate', 'summary', 'off')
    );
$function$;

create or replace function public.push_enqueue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline', 'shop',
    'service_task'
  ]::text[]);
  -- Service task reminders are always offered, even for users whose stored
  -- preferences predate the category.
  if not v_category = any(v_categories)
     and v_category not in ('service_task', 'infrastructure', 'security_report') then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  return new;
end;
$function$;

create or replace function public.push_claim_outbox_v2(p_limit integer default 50)
returns table(outbox_id uuid, tenant_id uuid, user_id uuid, notification_id uuid, source_type text, ticket_id uuid, contract_id uuid, kind text, ticket_number text, subject text, delivery_mode text, devices jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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
        -- Shop orders and service task reminders have no ticket; active
        -- membership was checked above.
        if v_kind like 'shop.order.%' or v_kind like 'service_task.%' then
          null;
        elsif v_kind = 'infrastructure.due' then
          -- Only people who may manage assets get these reminders.
          if not public.user_has_tenant_permission(
            v_row.user_id, v_row.tenant_id, 'asset.manage'
          ) then
            update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
            where id = v_row.id;
            continue;
          end if;
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
      'shop', 'service_task'
    ]::text[]);
    -- Older stored preferences do not know the category yet: deliver it.
    if v_category = 'service_task'
       and not 'service_task' = any(v_enabled_categories)
       and not (v_modes ? 'service_task') then
      v_enabled_categories := v_enabled_categories || 'service_task'::text;
    end if;
    if v_category = 'infrastructure'
       and not 'infrastructure' = any(v_enabled_categories)
       and not (v_modes ? 'infrastructure') then
      v_enabled_categories := v_enabled_categories || 'infrastructure'::text;
    end if;
    -- Phishing reports are a category of their own (mode-only like
    -- infrastructure): delivered unless switched off through the modes.
    if v_category = 'security_report'
       and not 'security_report' = any(v_enabled_categories)
       and not (v_modes ? 'security_report') then
      v_enabled_categories := v_enabled_categories || 'security_report'::text;
    end if;
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
$function$;

alter table public.push_preferences
  drop constraint if exists push_preferences_email_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_email_categories_valid check (
    email_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'inventory_low_stock', 'shop', 'service_task', 'infrastructure',
      'security_report'
    ]::text[]
    and cardinality(email_categories) <= 20
  );

-- New agents: phishing reports by push and e-mail like everything else.
create or replace function public.agent_notification_defaults_all(
  p_tenant_id uuid,
  p_user_id uuid,
  p_overwrite boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_push text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop'
  ]::text[];
  v_email text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop', 'service_task', 'infrastructure',
    'security_report'
  ]::text[];
  v_modes jsonb := (
    select jsonb_object_agg(category, 'immediate')
      from unnest(array[
        'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
        'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
        'inventory_low_stock', 'shop', 'infrastructure', 'security_report'
      ]::text[]) as category
  );
begin
  if p_overwrite then
    insert into public.push_preferences (
      tenant_id, user_id, enabled_categories, email_categories,
      category_modes, global_enabled
    ) values (p_tenant_id, p_user_id, v_push, v_email, v_modes, true)
    on conflict (tenant_id, user_id) do update
      set enabled_categories = excluded.enabled_categories,
          email_categories = excluded.email_categories,
          category_modes = excluded.category_modes,
          global_enabled = true,
          updated_at = timezone('utc', now());
  else
    insert into public.push_preferences (
      tenant_id, user_id, enabled_categories, email_categories,
      category_modes, global_enabled
    ) values (p_tenant_id, p_user_id, v_push, v_email, v_modes, true)
    on conflict (tenant_id, user_id) do nothing;
  end if;
end;
$$;

-- Keep every person's current choice: phishing reports follow what the person
-- had set for "Eskalationen" so far.
update public.push_preferences preference
   set email_categories = array_append(preference.email_categories, 'security_report')
 where 'escalation' = any(preference.email_categories)
   and not 'security_report' = any(preference.email_categories);

update public.push_preferences preference
   set category_modes = coalesce(preference.category_modes, '{}'::jsonb)
     || jsonb_build_object(
          'security_report',
          coalesce(
            preference.category_modes ->> 'escalation',
            case when 'escalation' = any(preference.enabled_categories)
                 then 'immediate' else 'off' end
          )
        )
 where not (coalesce(preference.category_modes, '{}'::jsonb) ? 'security_report');

commit;
