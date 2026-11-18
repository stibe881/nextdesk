begin;

set local search_path = pg_catalog, public;

-- 0315 IP-Adressen & Querschnitt
--
-- 1. Notification categories for all new kinds (one place), new category
--    «ipam» (IP-Adressverwaltung), security notifications always reach the
--    configured phishing team, one recipient rule for notifications without
--    a ticket (enqueue trigger, outbox sweep and claim use one function).
-- 2. IPAM automation: reservation reminders and expiry, full subnets and
--    DHCP scopes, offline agents, PRTG coverage gaps (finding kind
--    «coverage»), an hourly job and the daily job.
-- 3. Clean-up: foreign keys for ipam_addresses.service_id and
--    ipam_findings.ticket_id, device IP (asset_infrastructure.ip_address)
--    validated and kept in sync with ipam_addresses, trigram indexes for the
--    ticket search by IP/hostname.
-- 4. One ticket grouping (ticket_similarity_clusters) for the incident hint
--    in the ticket list and the case candidates of problem management.
-- 5. Retention: per-tenant periods for monitoring, IPAM and phishing data,
--    daily prune (phishing reports are anonymized, not deleted).

-- ---------------------------------------------------------------------------
-- 1. Notifications

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
    -- Security cases: overdue, «clicked», campaign.
    when p_kind in ('security.case_overdue', 'security.case_clicked', 'security.campaign')
      then 'security_report'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind in ('inventory.low_stock', 'inventory.reorder', 'inventory.count_due')
      then 'inventory_low_stock'
    -- Includes loan_due, loan_overdue and approval_reminder.
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    -- IP address management; monitoring.ipam_finding is the older kind.
    when p_kind in ('ipam.finding', 'ipam.agent_offline', 'ipam.reservation_expiring',
                    'monitoring.ipam_finding') then 'ipam'
    -- monitoring.incident and later monitoring.incident.* kinds.
    when p_kind like 'monitoring.%' then 'incident'
    else null
  end;
$function$;

create or replace function public.push_delivery_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select jsonb_typeof(p_modes) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(p_modes) as mode(category, delivery_mode)
      where category not in (
          'assigned', 'requester_reply', 'support_reply', 'mention',
          'resolved', 'sla', 'escalation', 'approval', 'follow_up',
          'contract_deadline', 'inventory_low_stock', 'shop', 'infrastructure',
          'security_report', 'incident', 'ipam'
        )
        or delivery_mode not in ('immediate', 'summary', 'off')
    );
$function$;

-- E-mail may name the new category as well (replaces the list of 0278).
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_preferences'::regclass
       and conname = 'push_preferences_email_categories_valid'
       and position('''ipam''' in pg_get_constraintdef(oid)) = 0
  ) then
    alter table public.push_preferences
      drop constraint push_preferences_email_categories_valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_preferences'::regclass
       and conname = 'push_preferences_email_categories_valid'
  ) then
    alter table public.push_preferences
      add constraint push_preferences_email_categories_valid check (
        email_categories <@ array[
          'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
          'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
          'inventory_low_stock', 'shop', 'service_task', 'infrastructure',
          'security_report', 'incident', 'ipam'
        ]::text[]
        and cardinality(email_categories) <= 20
      );
  end if;
end;
$$;

-- Member of the team configured in the phishing settings. Without a team
-- nobody is a member (the category stays opt-in for everybody).
create or replace function public.phishing_team_member(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_tenant_id is not null and p_user_id is not null and exists (
    select 1
      from public.phishing_report_settings settings
      join public.team_memberships member
        on member.team_id = settings.notify_team_id
       and member.user_id = p_user_id
     where settings.tenant_id = p_tenant_id
       and settings.notify_team_id is not null
  );
$$;
revoke all on function public.phishing_team_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.phishing_team_member(uuid, uuid) to service_role;

-- Security notifications that skip the personal opt-in (push and e-mail):
-- the rule of 0313 (security_notification_forced) when it exists, otherwise
-- membership of the phishing team.
create or replace function public.push_security_delivery_forced(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_forced boolean;
begin
  if p_kind is null
     or not (p_kind = 'ticket.security_report' or p_kind like 'security.%') then
    return false;
  end if;
  if to_regprocedure('public.security_notification_forced(uuid,uuid,text)') is not null then
    execute 'select public.security_notification_forced($1, $2, $3)'
      into v_forced using p_tenant_id, p_user_id, p_kind;
    return coalesce(v_forced, false);
  end if;
  return public.phishing_team_member(p_tenant_id, p_user_id);
end;
$$;
revoke all on function public.push_security_delivery_forced(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.push_security_delivery_forced(uuid, uuid, text) to service_role;

-- Who may receive a notification that has no ticket. Shared by the enqueue
-- trigger, the outbox sweep and the claim (before, the sweep skipped every
-- kind without a ticket except shop and low stock).
create or replace function public.push_non_ticket_recipient_authorized(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_tenant_id is null or p_user_id is null or p_kind is null
     or not exists (
       select 1 from public.tenant_memberships membership
        where membership.tenant_id = p_tenant_id
          and membership.user_id = p_user_id
          and membership.status = 'active'
     ) then
    return false;
  end if;
  if p_kind in ('ipam.finding', 'ipam.agent_offline', 'ipam.reservation_expiring',
                'monitoring.ipam_finding') then
    return public.ipam_feature_enabled(p_tenant_id)
      and (public.user_has_tenant_permission(p_user_id, p_tenant_id, 'ipam.read')
           or public.user_has_tenant_permission(p_user_id, p_tenant_id, 'ipam.manage'));
  elsif p_kind like 'shop.order.%' or p_kind like 'service_task.%'
     or p_kind like 'monitoring.%' then
    -- Recipients were chosen when the notification was raised.
    return true;
  elsif p_kind = 'infrastructure.due' then
    return public.user_has_tenant_permission(p_user_id, p_tenant_id, 'asset.manage');
  elsif p_kind in ('inventory.low_stock', 'inventory.reorder', 'inventory.count_due') then
    return public.inventory_low_stock_delivery_authorized(p_tenant_id, p_user_id);
  elsif p_kind in ('security.case_overdue', 'security.case_clicked', 'security.campaign') then
    return public.user_is_ticket_agent(p_tenant_id, p_user_id);
  end if;
  return false;
end;
$$;
revoke all on function public.push_non_ticket_recipient_authorized(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.push_non_ticket_recipient_authorized(uuid, uuid, text) to service_role;

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

  if new.kind in ('inventory.low_stock', 'inventory.reorder', 'inventory.count_due') then
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
  -- Mode-only categories are always queued; the claim decides with the
  -- delivery modes (and the phishing team rule).
  if not v_category = any(v_categories)
     and v_category not in ('service_task', 'infrastructure', 'security_report', 'incident', 'ipam') then
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

create or replace function public.push_skip_unauthorized_ticket_outbox()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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
        else public.push_non_ticket_recipient_authorized(
          outbox.tenant_id,
          outbox.user_id,
          notification.kind
        )
      end,
      false
    );
  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$function$;

-- Dispatch: same recipient rule for notifications without a ticket, IPAM
-- delivered unless switched off, security notifications always for the
-- phishing team.
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
        -- Notifications without a ticket (shop, service tasks, incidents,
        -- infrastructure, inventory, IP address management, security):
        -- one rule per kind, shared with the enqueue trigger and the sweep.
        if not public.push_non_ticket_recipient_authorized(
          v_row.tenant_id, v_row.user_id, v_kind
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
    if v_category = 'incident'
       and not 'incident' = any(v_enabled_categories)
       and not (v_modes ? 'incident') then
      v_enabled_categories := v_enabled_categories || 'incident'::text;
    end if;
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
    -- IP address management: mode-only category, delivered unless switched
    -- off (older stored preferences do not know it yet).
    if v_category = 'ipam'
       and not 'ipam' = any(v_enabled_categories)
       and not (v_modes ? 'ipam') then
      v_enabled_categories := v_enabled_categories || 'ipam'::text;
    end if;
    -- Phishing reports and security cases are opt-in: delivered only when
    -- the person switched the category on (mode "immediate" or "summary").
    -- Members of the configured phishing team always get them.
    if v_category = 'security_report'
       and public.push_security_delivery_forced(v_row.tenant_id, v_row.user_id, v_kind) then
      v_enabled_categories := array_remove(v_enabled_categories, 'security_report')
        || 'security_report'::text;
      if coalesce(v_modes ->> 'security_report', 'off') = 'off' then
        v_modes := v_modes || jsonb_build_object('security_report', 'immediate');
      end if;
    elsif v_category = 'security_report' then
      v_enabled_categories := array_remove(v_enabled_categories, 'security_report');
      if coalesce(v_modes ->> 'security_report', 'off') <> 'off' then
        v_enabled_categories := v_enabled_categories || 'security_report'::text;
      else
        v_modes := v_modes || jsonb_build_object('security_report', 'off');
      end if;
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

-- E-mail: same exception for security notifications of the phishing team.
create or replace function public.notification_email_enqueue()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_category text;
  v_categories text[];
  v_channel record;
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null then
    return new;
  end if;

  select preference.email_categories
    into v_categories
    from public.push_preferences preference
   where preference.tenant_id = new.tenant_id
     and preference.user_id = new.user_id;
  if (v_categories is null or not v_category = any(v_categories))
     and not public.push_security_delivery_forced(new.tenant_id, new.user_id, new.kind) then
    return new;
  end if;

  if not public.exchange_mail_feature_enabled(new.tenant_id)
     or not exists (
       select 1 from public.tenant_memberships membership
        where membership.tenant_id = new.tenant_id
          and membership.user_id = new.user_id
          and membership.status = 'active'
     ) then
    return new;
  end if;

  -- The ticket's own mailbox if it has one, otherwise the oldest active one.
  select channel.id, channel.mailbox_address, channel.configuration_version
    into v_channel
    from public.exchange_mail_channels channel
    left join public.tickets ticket
      on ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id
   where channel.tenant_id = new.tenant_id
     and channel.status = 'active'
     and channel.deleted_at is null
     and channel.access_mode = 'delegated'
   order by (channel.id = ticket.exchange_mail_channel_id) desc nulls last,
            channel.created_at
   limit 1;
  if not found then
    return new;
  end if;

  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    ticket_id, recipient_user_id, notification_id, from_address,
    to_addresses, subject
  ) values (
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'notification', new.ticket_id, new.user_id, new.id,
    v_channel.mailbox_address, array[]::text[], null
  ) on conflict do nothing;
  return new;
exception when others then
  -- E-mail is an extra channel: never block the notification itself.
  return new;
end;
$function$;

-- New agents: the IPAM category is on (push and e-mail), like incidents.
create or replace function public.agent_notification_defaults_all(
  p_tenant_id uuid,
  p_user_id uuid,
  p_overwrite boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_push text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop'
  ]::text[];
  v_email text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop', 'service_task', 'infrastructure', 'incident',
    'ipam'
  ]::text[];
  v_modes jsonb := (
    select jsonb_object_agg(category, 'immediate')
      from unnest(array[
        'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
        'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
        'inventory_low_stock', 'shop', 'infrastructure', 'incident', 'ipam'
      ]::text[]) as category
    ) || jsonb_build_object('security_report', 'off');
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
$function$;

-- One-off: IPAM findings used to arrive as «Störungen». Whoever gets
-- incidents by e-mail keeps getting IPAM notifications by e-mail.
update public.push_preferences preference
   set email_categories = preference.email_categories || 'ipam'::text,
       updated_at = timezone('utc', now())
 where 'incident' = any(preference.email_categories)
   and not 'ipam' = any(preference.email_categories);


-- ---------------------------------------------------------------------------
-- 2. IPAM automation

-- Finding kind «coverage»: device without PRTG monitoring (0303 view
-- ipam_prtg_coverage). Replaces the kind list of 0300.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.ipam_findings'::regclass
       and conname = 'ipam_findings_kind_check'
       and position('''coverage''' in pg_get_constraintdef(oid)) = 0
  ) then
    alter table public.ipam_findings drop constraint ipam_findings_kind_check;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ipam_findings'::regclass
       and conname = 'ipam_findings_kind_check'
  ) then
    alter table public.ipam_findings
      add constraint ipam_findings_kind_check check (kind in (
        'ghost', 'conflict', 'foreign_mac', 'dns_mismatch', 'stale', 'utilization',
        'outside_prefix', 'coverage'
      ));
  end if;
end;
$$;

-- Notify about IPAM: the person responsible and the team (if they may read
-- the IP address management), otherwise everybody with ipam.manage.
create or replace function public.ipam_notify(
  p_tenant_id uuid,
  p_kind text,
  p_payload jsonb,
  p_team_id uuid default null,
  p_owner_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if p_kind not in ('ipam.finding', 'ipam.agent_offline', 'ipam.reservation_expiring') then
    raise exception 'ipam_notify: unsupported kind %', p_kind using errcode = '22023';
  end if;
  if p_owner_id is not null or p_team_id is not null then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select distinct p_tenant_id, recipient.user_id, null::uuid, p_kind, p_payload
      from (
        select p_owner_id as user_id where p_owner_id is not null
        union
        select member.user_id
          from public.team_memberships member
          join public.teams team
            on team.id = member.team_id and team.tenant_id = p_tenant_id
         where member.team_id = p_team_id
      ) recipient
      join public.tenant_memberships membership
        on membership.tenant_id = p_tenant_id
       and membership.user_id = recipient.user_id
       and membership.status = 'active'
     where public.user_has_tenant_permission(recipient.user_id, p_tenant_id, 'ipam.read')
        or public.user_has_tenant_permission(recipient.user_id, p_tenant_id, 'ipam.manage');
    get diagnostics v_count = row_count;
  end if;
  if v_count = 0 then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, membership.user_id, null, p_kind, p_payload
      from public.tenant_memberships membership
     where membership.tenant_id = p_tenant_id
       and membership.status = 'active'
       and public.user_has_tenant_permission(membership.user_id, p_tenant_id, 'ipam.manage');
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
revoke all on function public.ipam_notify(uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ipam_notify(uuid, text, jsonb, uuid, uuid) to service_role;

-- Findings are announced as ipam.finding (before: monitoring.ipam_finding,
-- delivered as «Störungen»).
create or replace function public.ipam_findings_notify(p_tenant_id uuid, p_finding_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_finding record;
  v_count integer := 0;
  v_critical integer := 0;
  v_warning_ids uuid[] := '{}';
  v_payload jsonb;
  v_label text;
begin
  for v_finding in
    select finding.*, address.team_id, address.owner_user_id,
           prefix.prefix::text as prefix_text
    from public.ipam_findings finding
    left join public.ipam_addresses address on address.id = finding.address_id
    left join public.ipam_prefixes prefix on prefix.id = finding.prefix_id
    where finding.tenant_id = p_tenant_id
      and finding.id = any(p_finding_ids)
      and finding.status = 'open'
      and finding.severity in ('critical', 'warning')
    order by case finding.severity when 'critical' then 0 else 1 end, finding.address
  loop
    -- Full subnets and DHCP scopes are always announced on their own.
    if v_finding.kind <> 'utilization' then
      if v_finding.severity = 'warning' then
        v_warning_ids := v_warning_ids || v_finding.id;
        continue;
      end if;
      v_critical := v_critical + 1;
      if v_critical > 10 then
        v_warning_ids := v_warning_ids || v_finding.id;
        continue;
      end if;
    end if;
    v_label := case v_finding.kind
      when 'conflict' then 'IP-Konflikt: zwei MAC-Adressen'
      when 'foreign_mac' then 'Fremde MAC auf reservierter IP'
      when 'ghost' then 'Ghost-IP: aktiv, aber nicht dokumentiert'
      when 'dns_mismatch' then 'DNS stimmt nicht'
      when 'outside_prefix' then 'Adresse ausserhalb aller Subnetze'
      when 'stale' then 'Seit 90 Tagen nicht gesehen'
      when 'coverage' then 'Gerät ohne PRTG-Überwachung'
      when 'utilization' then case
        when v_finding.details ? 'dhcpPercent' and not (v_finding.details ? 'percent')
          then 'DHCP-Bereich zu ' || (v_finding.details ->> 'dhcpPercent') || ' % belegt'
        else 'Subnetz zu ' || coalesce(v_finding.details ->> 'percent', v_finding.details ->> 'dhcpPercent', '?')
             || ' % belegt' end
      else 'IPAM-Fund' end;
    v_payload := jsonb_build_object(
      'findingId', v_finding.id,
      'kind', v_finding.kind,
      'address', host(v_finding.address),
      'number', case when v_finding.kind = 'utilization'
                  then coalesce(v_finding.details ->> 'prefix', v_finding.prefix_text, host(v_finding.address))
                  else host(v_finding.address) end,
      'title', v_label,
      'severity', v_finding.severity,
      'reason', 'opened'
    ) || case when v_finding.prefix_id is null then '{}'::jsonb
              else jsonb_build_object('prefixId', v_finding.prefix_id) end;
    v_count := v_count + public.ipam_notify(
      p_tenant_id, 'ipam.finding', v_payload, v_finding.team_id, null
    );
  end loop;

  -- Warnings (ghost IPs, DNS …) bundled in one notification per report.
  if coalesce(array_length(v_warning_ids, 1), 0) > 0 then
    v_payload := jsonb_build_object(
      'findingIds', to_jsonb(v_warning_ids[1:50]),
      'count', array_length(v_warning_ids, 1),
      'number', 'IP-Adressen',
      'title', case when array_length(v_warning_ids, 1) = 1
        then '1 neuer Fund aus der Netzwerk-Discovery'
        else array_length(v_warning_ids, 1)::text || ' neue Funde aus der Netzwerk-Discovery' end,
      'severity', 'warning',
      'reason', 'opened'
    );
    v_count := v_count + public.ipam_notify(p_tenant_id, 'ipam.finding', v_payload, null, null);
  end if;
  return v_count;
end;
$function$;
revoke all on function public.ipam_findings_notify(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.ipam_findings_notify(uuid, uuid[]) to service_role;

-- 25: full subnets (over the warning threshold of the subnet) and DHCP
-- scopes over 90 %. One finding per network address; closed automatically
-- when the usage drops below the threshold again.
create or replace function public.ipam_utilization_findings(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_candidates jsonb;
  v_new uuid[];
  v_updated integer;
  v_resolved integer;
begin
  with usage as (
    select prefix.id as prefix_id, prefix.vrf_id, prefix.prefix,
           prefix.utilization_warning_percent as threshold,
           floor(least(100, 100.0 * (u.used + u.dhcp_size) / u.capacity))::integer as percent,
           (u.used + u.dhcp_size)::numeric as used, u.capacity
      from public.ipam_prefixes prefix
      join public.ipam_prefix_usage(p_tenant_id) u on u.prefix_id = prefix.id
     where prefix.tenant_id = p_tenant_id
       and prefix.status = 'active'
       and u.capacity > 0
  ), full_prefixes as (
    select vrf_id, prefix_id, prefix,
           set_masklen(network(prefix)::inet, case when family(prefix) = 4 then 32 else 128 end) as address,
           percent, threshold, used, capacity
      from usage
     where percent >= threshold
  ), scopes as (
    select scope.id, scope.prefix_id, prefix.vrf_id, prefix.prefix, scope.server, scope.name,
           scope.scope_id, coalesce(scope.addresses_in_use, 0) as in_use,
           coalesce(scope.addresses_free, 0) as free
      from public.ipam_dhcp_scopes scope
      left join public.ipam_prefixes prefix on prefix.id = scope.prefix_id
     where scope.tenant_id = p_tenant_id
       and coalesce(lower(scope.state), 'active') <> 'inactive'
       and coalesce(scope.addresses_in_use, 0) + coalesce(scope.addresses_free, 0) > 0
  ), full_scopes as (
    select vrf_id, prefix_id, prefix,
           case when prefix is not null
             then set_masklen(network(prefix)::inet, case when family(prefix) = 4 then 32 else 128 end)
             else set_masklen(scope_id, case when family(scope_id) = 4 then 32 else 128 end) end as address,
           floor(100.0 * in_use / (in_use + free))::integer as percent,
           jsonb_build_object('server', server, 'name', name, 'scope', host(scope_id),
                              'inUse', in_use, 'free', free,
                              'percent', floor(100.0 * in_use / (in_use + free))::integer) as scope
      from scopes
     where 100.0 * in_use / (in_use + free) > 90
  ), merged as (
    select coalesce(p.vrf_id, s.vrf_id) as vrf_id,
           coalesce(p.address, s.address) as address,
           coalesce(p.prefix_id, s.prefix_id) as prefix_id,
           p.percent, p.threshold, p.used, p.capacity,
           coalesce(p.prefix, s.prefix) as prefix,
           s.scopes, s.dhcp_percent
      from full_prefixes p
      full join (
        select vrf_id, address, min(prefix_id::text)::uuid as prefix_id, min(prefix::text)::cidr as prefix,
               jsonb_agg(scope order by scope ->> 'server', scope ->> 'scope') as scopes,
               max(percent) as dhcp_percent
          from full_scopes
         group by vrf_id, address
      ) s on s.address = p.address and s.vrf_id is not distinct from p.vrf_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vrf_id', vrf_id, 'address', host(address), 'prefix_id', prefix_id,
           'severity', case when greatest(coalesce(percent, 0), coalesce(dhcp_percent, 0)) >= 100
                            then 'critical' else 'warning' end,
           'details', jsonb_strip_nulls(jsonb_build_object(
             'prefix', prefix::text, 'percent', percent, 'threshold', threshold,
             'used', used, 'capacity', capacity,
             'dhcpPercent', dhcp_percent, 'dhcpScopes', scopes))
         )), '[]'::jsonb)
    into v_candidates
    from merged;

  -- Refresh what is still open.
  update public.ipam_findings finding
     set details = candidate.details, severity = candidate.severity,
         prefix_id = coalesce(candidate.prefix_id, finding.prefix_id), last_seen_at = v_now
    from jsonb_to_recordset(v_candidates)
         as candidate(vrf_id uuid, address inet, prefix_id uuid, severity text, details jsonb)
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'utilization'
     and finding.status = 'open'
     and finding.address = candidate.address
     and finding.vrf_id is not distinct from candidate.vrf_id;
  get diagnostics v_updated = row_count;

  -- New ones (an ignored finding for the same network stays ignored).
  with inserted as (
    insert into public.ipam_findings (tenant_id, vrf_id, address, prefix_id, kind, severity, details)
    select p_tenant_id, candidate.vrf_id, candidate.address, candidate.prefix_id,
           'utilization', candidate.severity, candidate.details
      from jsonb_to_recordset(v_candidates)
           as candidate(vrf_id uuid, address inet, prefix_id uuid, severity text, details jsonb)
     where not exists (
       select 1 from public.ipam_findings existing
        where existing.tenant_id = p_tenant_id
          and existing.kind = 'utilization'
          and existing.status in ('open', 'ignored')
          and existing.address = candidate.address
          and existing.vrf_id is not distinct from candidate.vrf_id
     )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_new from inserted;

  -- Below the threshold again: resolve.
  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'utilization'
     and finding.status = 'open'
     and not exists (
       select 1
         from jsonb_to_recordset(v_candidates) as candidate(vrf_id uuid, address inet)
        where candidate.address = finding.address
          and candidate.vrf_id is not distinct from finding.vrf_id
     );
  get diagnostics v_resolved = row_count;

  if cardinality(v_new) > 0 then
    perform public.ipam_findings_notify(p_tenant_id, v_new);
  end if;
  return jsonb_build_object('opened', cardinality(v_new), 'updated', v_updated,
                            'resolved', v_resolved);
end;
$$;
revoke all on function public.ipam_utilization_findings(uuid) from public, anon, authenticated;
grant execute on function public.ipam_utilization_findings(uuid) to service_role;

-- 27: important devices (servers, switches, firewalls, routers) without PRTG
-- monitoring become findings of the kind «coverage» (can be ignored).
create or replace function public.ipam_coverage_findings(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_opened integer;
  v_resolved integer;
begin
  insert into public.ipam_findings (tenant_id, vrf_id, address, address_id, prefix_id, kind, severity, details)
  select p_tenant_id, address.vrf_id, gap.address, gap.address_id, gap.prefix_id,
         'coverage', 'info',
         jsonb_strip_nulls(jsonb_build_object(
           'hostname', gap.hostname, 'deviceType', gap.device_type, 'assetId', gap.asset_id))
    from public.ipam_prtg_coverage(p_tenant_id) gap
    join public.ipam_addresses address on address.id = gap.address_id
   where not exists (
     select 1 from public.ipam_findings existing
      where existing.tenant_id = p_tenant_id
        and existing.kind = 'coverage'
        and existing.status in ('open', 'ignored')
        and (existing.address_id = gap.address_id
             or (existing.address = gap.address and existing.vrf_id is not distinct from address.vrf_id))
   )
  on conflict do nothing;
  get diagnostics v_opened = row_count;

  update public.ipam_findings finding
     set status = 'resolved', resolved_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'coverage'
     and finding.status = 'open'
     and not exists (
       select 1 from public.ipam_prtg_coverage(p_tenant_id) gap
        where gap.address_id = finding.address_id
     );
  get diagnostics v_resolved = row_count;

  update public.ipam_findings finding
     set last_seen_at = v_now
   where finding.tenant_id = p_tenant_id
     and finding.kind = 'coverage'
     and finding.status = 'open';
  return jsonb_build_object('opened', v_opened, 'resolved', v_resolved);
end;
$$;
revoke all on function public.ipam_coverage_findings(uuid) from public, anon, authenticated;
grant execute on function public.ipam_coverage_findings(uuid) to service_role;

-- 26: an agent that has not reported for two hours is announced once per
-- outage; the marker resets as soon as it reports again.
alter table public.ipam_agents
  add column if not exists offline_notified_at timestamptz;

create or replace function public.ipam_agents_reset_offline()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.offline_notified_at is not null
     and new.last_seen_at is not null
     and new.last_seen_at >= new.offline_notified_at then
    new.offline_notified_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger ipam_agents_reset_offline
  before update of last_seen_at on public.ipam_agents
  for each row execute function public.ipam_agents_reset_offline();

create or replace function public.ipam_agents_offline_check(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_agent record;
  v_now timestamptz := timezone('utc', now());
  v_count integer := 0;
begin
  for v_agent in
    select agent.*
      from public.ipam_agents agent
     where agent.tenant_id = p_tenant_id
       and agent.status = 'active'
       and agent.last_seen_at is not null
       and agent.last_seen_at < v_now - interval '2 hours'
       and agent.offline_notified_at is null
     order by agent.name
     for update skip locked
  loop
    update public.ipam_agents set offline_notified_at = v_now where id = v_agent.id;
    perform public.ipam_notify(
      p_tenant_id,
      'ipam.agent_offline',
      jsonb_build_object(
        'agentId', v_agent.id,
        'agentName', v_agent.name,
        'number', v_agent.name,
        'title', 'Netzwerkagent offline',
        'lastSeenAt', v_agent.last_seen_at,
        'severity', 'warning'
      ),
      null,
      null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.ipam_agents_offline_check(uuid) from public, anon, authenticated;
grant execute on function public.ipam_agents_offline_check(uuid) to service_role;

-- 24: reservations. Reminder up to three days before reserved_until to the
-- person and team responsible (once per date), afterwards the address is
-- released (status deprecated, address history, change log source system).
create table if not exists public.ipam_reservation_reminders (
  address_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reserved_until date not null,
  sent_at timestamptz not null default timezone('utc', now()),
  primary key (address_id, reserved_until),
  foreign key (address_id, tenant_id) references public.ipam_addresses(id, tenant_id) on delete cascade
);
alter table public.ipam_reservation_reminders enable row level security;
revoke all on table public.ipam_reservation_reminders from public, anon, authenticated;
grant select, insert, update, delete on table public.ipam_reservation_reminders to service_role;

create or replace function public.ipam_reservations_due(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := (timezone('Europe/Zurich', now()))::date;
  v_address record;
  v_reminded integer := 0;
  v_released integer := 0;
begin
  for v_address in
    select address.*
      from public.ipam_addresses address
     where address.tenant_id = p_tenant_id
       and address.status = 'reserved'
       and address.reserved_until is not null
       and address.reserved_until >= v_today
       and address.reserved_until <= v_today + 3
       and not exists (
         select 1 from public.ipam_reservation_reminders reminder
          where reminder.address_id = address.id
            and reminder.reserved_until = address.reserved_until
       )
  loop
    insert into public.ipam_reservation_reminders (address_id, tenant_id, reserved_until)
    values (v_address.id, p_tenant_id, v_address.reserved_until)
    on conflict do nothing;
    perform public.ipam_notify(
      p_tenant_id,
      'ipam.reservation_expiring',
      jsonb_strip_nulls(jsonb_build_object(
        'addressId', v_address.id,
        'address', host(v_address.address),
        'number', host(v_address.address),
        'title', coalesce(v_address.hostname, v_address.description),
        'reservedUntil', v_address.reserved_until,
        'assetId', v_address.asset_id,
        'prefixId', v_address.prefix_id
      )),
      v_address.team_id,
      v_address.owner_user_id
    );
    v_reminded := v_reminded + 1;
  end loop;

  for v_address in
    select address.*
      from public.ipam_addresses address
     where address.tenant_id = p_tenant_id
       and address.status = 'reserved'
       and address.reserved_until is not null
       and address.reserved_until < v_today
     for update skip locked
  loop
    update public.ipam_addresses
       set status = 'deprecated', change_source = 'system', change_actor = null
     where id = v_address.id;
    insert into public.ipam_address_events (tenant_id, address_id, actor_id, kind, details)
    values (p_tenant_id, v_address.id, null, 'released',
            jsonb_build_object('reason', 'reservation_expired', 'source', 'system',
                               'reservedUntil', v_address.reserved_until));
    v_released := v_released + 1;
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'released', v_released);
end;
$$;
revoke all on function public.ipam_reservations_due(uuid) from public, anon, authenticated;
grant execute on function public.ipam_reservations_due(uuid) to service_role;

-- Hourly: reservations, offline agents, full subnets / DHCP scopes.
create or replace function public.ipam_automation_hourly()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_count integer := 0;
begin
  for v_tenant in
    select tenant.id from public.tenants tenant
     where public.ipam_feature_enabled(tenant.id)
  loop
    begin
      perform public.ipam_reservations_due(v_tenant);
      perform public.ipam_agents_offline_check(v_tenant);
      perform public.ipam_utilization_findings(v_tenant);
      v_count := v_count + 1;
    exception when others then
      -- One tenant must not stop the others.
      raise warning 'ipam_automation_hourly failed for %: %', v_tenant, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.ipam_automation_hourly() from public, anon, authenticated;
grant execute on function public.ipam_automation_hourly() to service_role;

-- Daily (after the Intune/PRTG sync at 02:47): PRTG coverage gaps.
create or replace function public.ipam_automation_daily()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_count integer := 0;
begin
  for v_tenant in
    select tenant.id from public.tenants tenant
     where public.ipam_feature_enabled(tenant.id)
       and exists (select 1 from public.ipam_addresses address where address.tenant_id = tenant.id)
  loop
    begin
      perform public.ipam_coverage_findings(v_tenant);
      v_count := v_count + 1;
    exception when others then
      raise warning 'ipam_automation_daily failed for %: %', v_tenant, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.ipam_automation_daily() from public, anon, authenticated;
grant execute on function public.ipam_automation_daily() to service_role;


-- ---------------------------------------------------------------------------
-- 3. Clean-up

-- 40: foreign keys. Values without a matching row (or of another tenant)
-- are cleared first.
update public.ipam_addresses address
   set service_id = null
 where address.service_id is not null
   and not exists (
     select 1 from public.services service
      where service.id = address.service_id and service.tenant_id = address.tenant_id
   );
update public.ipam_findings finding
   set ticket_id = null
 where finding.ticket_id is not null
   and not exists (
     select 1 from public.tickets ticket
      where ticket.id = finding.ticket_id and ticket.tenant_id = finding.tenant_id
   );

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ipam_addresses'::regclass
       and conname = 'ipam_addresses_service_id_tenant_id_fkey'
  ) then
    alter table public.ipam_addresses
      add constraint ipam_addresses_service_id_tenant_id_fkey
      foreign key (service_id, tenant_id) references public.services(id, tenant_id)
      on delete set null (service_id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ipam_findings'::regclass
       and conname = 'ipam_findings_ticket_id_tenant_id_fkey'
  ) then
    alter table public.ipam_findings
      add constraint ipam_findings_ticket_id_tenant_id_fkey
      foreign key (ticket_id, tenant_id) references public.tickets(id, tenant_id)
      on delete set null (ticket_id);
  end if;
end;
$$;
create index if not exists ipam_addresses_service
  on public.ipam_addresses (tenant_id, service_id) where service_id is not null;
create index if not exists ipam_findings_ticket
  on public.ipam_findings (ticket_id) where ticket_id is not null;

-- 37: device IP. A valid address (optionally with prefix length, e.g.
-- 10.1.2.3/24) or nothing; compared as inet through ip_inet.
create or replace function public.asset_ip_inet(p_value text)
returns inet
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_value inet;
begin
  if p_value is null or btrim(p_value) = '' or char_length(p_value) > 64 then
    return null;
  end if;
  v_value := btrim(p_value)::inet;
  return set_masklen(v_value, case when family(v_value) = 4 then 32 else 128 end);
exception when others then
  return null;
end;
$$;

-- One-off: invalid values move into the notes so nothing is lost.
update public.asset_infrastructure infra
   set notes = left(concat_ws(E'\n', nullif(infra.notes, ''),
                              'Ungültige IP-Adresse entfernt: ' || left(infra.ip_address, 64)), 4000),
       ip_address = null
 where infra.ip_address is not null
   and (btrim(infra.ip_address) = '' or public.asset_ip_inet(infra.ip_address) is null);

alter table public.asset_infrastructure
  add column if not exists ip_inet inet
  generated always as (public.asset_ip_inet(ip_address)) stored;
create index if not exists asset_infrastructure_ip_inet
  on public.asset_infrastructure (tenant_id, ip_inet) where ip_inet is not null;

create or replace function public.asset_infrastructure_validate_ip()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.ip_address is not distinct from old.ip_address then
    return new;
  end if;
  new.ip_address := nullif(btrim(new.ip_address), '');
  if new.ip_address is not null and public.asset_ip_inet(new.ip_address) is null then
    raise exception 'invalid_ip_address' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace trigger asset_infrastructure_validate_ip
  before insert or update of ip_address on public.asset_infrastructure
  for each row execute function public.asset_infrastructure_validate_ip();

-- Device IP set → link the documented address (or document it inside a
-- known subnet). The flag keeps the two triggers from calling each other.
create or replace function public.asset_infrastructure_sync_ipam()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ip inet;
  v_existing public.ipam_addresses%rowtype;
  v_id uuid;
begin
  if coalesce(current_setting('nextdesk.ip_sync', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.ip_address is not distinct from old.ip_address then
    return null;
  end if;
  v_ip := public.asset_ip_inet(new.ip_address);
  if v_ip is null or not public.ipam_feature_enabled(new.tenant_id) then
    return null;
  end if;
  perform set_config('nextdesk.ip_sync', 'on', true);
  select * into v_existing
    from public.ipam_addresses address
   where address.tenant_id = new.tenant_id
     and address.address = v_ip
   order by (address.asset_id = new.asset_id) desc nulls last,
            (address.vrf_id is null) desc, address.created_at
   limit 1;
  if found then
    if v_existing.asset_id is null then
      update public.ipam_addresses
         set asset_id = new.asset_id,
             hostname = coalesce(hostname, left(new.hostname, 253)),
             change_source = 'system', change_actor = null
       where id = v_existing.id;
      insert into public.ipam_address_events (tenant_id, address_id, actor_id, kind, details)
      values (new.tenant_id, v_existing.id, null, 'linked',
              jsonb_build_object('source', 'asset', 'assetId', new.asset_id));
    end if;
  elsif public.ipam_containing_prefix(new.tenant_id, null, v_ip) is not null then
    insert into public.ipam_addresses (
      tenant_id, vrf_id, address, status, hostname, asset_id, change_source
    ) values (
      new.tenant_id, null, v_ip, 'active', left(new.hostname, 253), new.asset_id, 'system'
    )
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.ipam_address_events (tenant_id, address_id, actor_id, kind, details)
      values (new.tenant_id, v_id, null, 'linked',
              jsonb_build_object('source', 'asset', 'assetId', new.asset_id));
    end if;
  end if;
  perform set_config('nextdesk.ip_sync', 'off', true);
  return null;
end;
$$;

create or replace trigger asset_infrastructure_sync_ipam
  after insert or update of ip_address on public.asset_infrastructure
  for each row execute function public.asset_infrastructure_sync_ipam();

-- Address linked to a device → fill in the device IP when it is empty.
create or replace function public.ipam_addresses_sync_asset_ip()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(current_setting('nextdesk.ip_sync', true), '') = 'on'
     or new.asset_id is null
     or (tg_op = 'UPDATE' and new.asset_id is not distinct from old.asset_id) then
    return null;
  end if;
  perform set_config('nextdesk.ip_sync', 'on', true);
  update public.asset_infrastructure infra
     set ip_address = host(new.address)
   where infra.tenant_id = new.tenant_id
     and infra.asset_id = new.asset_id
     and infra.ip_address is null;
  perform set_config('nextdesk.ip_sync', 'off', true);
  return null;
end;
$$;

create or replace trigger ipam_addresses_sync_asset_ip
  after insert or update of asset_id on public.ipam_addresses
  for each row execute function public.ipam_addresses_sync_asset_ip();

revoke all on function public.asset_infrastructure_sync_ipam() from public, anon, authenticated;
revoke all on function public.ipam_addresses_sync_asset_ip() from public, anon, authenticated;

-- 33: ticket search by IP/hostname (IP address management) with trigram
-- indexes instead of sequential scans over subject and description.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    if to_regnamespace('extensions') is not null then
      create extension if not exists pg_trgm with schema extensions;
    else
      create extension if not exists pg_trgm;
    end if;
  end if;
end;
$$;

do $$
declare
  v_schema text;
begin
  select namespace.nspname into v_schema
    from pg_extension extension
    join pg_namespace namespace on namespace.oid = extension.extnamespace
   where extension.extname = 'pg_trgm';
  if v_schema is null then
    return;
  end if;
  execute format(
    'create index if not exists tickets_subject_trgm_idx on public.tickets using gin (subject %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index if not exists tickets_description_trgm_idx on public.tickets using gin (description %I.gin_trgm_ops)',
    v_schema);
end;
$$;

-- Tickets mentioning an IP address or hostname. Runs with the caller's
-- rights (row level security decides which tickets are visible).
create or replace function public.ipam_ticket_mentions(
  p_tenant_id uuid,
  p_ip text,
  p_hostname text,
  p_limit integer default 30
)
returns table(
  id uuid,
  ticket_number text,
  subject text,
  description text,
  updated_at timestamptz,
  matched text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with terms as (
    select
      case when char_length(coalesce(p_ip, '')) between 3 and 45
                and p_ip ~ '^[0-9A-Fa-f.:]+$'
           then '%' || p_ip || '%' end as ip_pattern,
      case when char_length(coalesce(p_hostname, '')) between 3 and 120
                and p_hostname ~ '^[A-Za-z0-9._-]+$'
           then '%' || replace(p_hostname, '_', '\_') || '%' end as host_pattern
  )
  select ticket.id, ticket.ticket_number, ticket.subject,
         left(coalesce(ticket.description, ''), 4000), ticket.updated_at,
         case when terms.ip_pattern is not null
                   and (ticket.subject ilike terms.ip_pattern or ticket.description ilike terms.ip_pattern)
              then 'ip' else 'hostname' end
    from public.tickets ticket, terms
   where ticket.tenant_id = p_tenant_id
     and ticket.deleted_at is null
     and (terms.ip_pattern is not null or terms.host_pattern is not null)
     and (
       (terms.ip_pattern is not null
        and (ticket.subject ilike terms.ip_pattern or ticket.description ilike terms.ip_pattern))
       or (terms.host_pattern is not null
        and (ticket.subject ilike terms.host_pattern or ticket.description ilike terms.host_pattern))
     )
   order by ticket.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;
revoke all on function public.ipam_ticket_mentions(uuid, text, text, integer) from public, anon;
grant execute on function public.ipam_ticket_mentions(uuid, text, text, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. One ticket grouping
--
-- Seeds are the newest readable tickets of the window; each seed collects
-- similar tickets through recent_similar_tickets (full text). Clusters that
-- mostly repeat an earlier one are dropped. p_open_unlinked limits seeds and
-- members to open tickets without a case (problem management); without it
-- every readable ticket counts (incident hint in the ticket list).
create or replace function public.ticket_similarity_clusters(
  p_tenant_id uuid,
  p_since timestamptz,
  p_min_size integer default 5,
  p_limit integer default 3,
  p_open_unlinked boolean default false
)
returns table(ticket_id uuid, subject text, ticket_count integer, ticket_ids uuid[], tickets jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
#variable_conflict use_column
declare
  v_open boolean := coalesce(p_open_unlinked, false);
  v_since timestamptz;
  v_min_size integer;
  v_limit integer;
  v_seed_limit integer;
  v_max_lookups integer;
  v_seed record;
  v_seeds jsonb;
  v_lookups integer := 0;
  v_clustered uuid[] := array[]::uuid[];
  v_member_ids uuid[];
  v_members jsonb;
  v_fresh integer;
  v_clusters jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null or auth.uid() is null
    or not public.is_active_tenant_member(p_tenant_id) then
    return;
  end if;
  v_since := greatest(
    coalesce(p_since, timezone('utc', now()) - interval '2 hours'),
    timezone('utc', now()) - case when v_open then interval '90 days' else interval '7 days' end
  );
  v_min_size := greatest(2, least(coalesce(p_min_size, 5), 50));
  v_limit := greatest(1, least(coalesce(p_limit, 3), 10));
  v_seed_limit := case when v_open then 60 else 30 end;
  v_max_lookups := case when v_open then 20 else 12 end;

  select coalesce(jsonb_agg(to_jsonb(seed) order by seed.created_at desc, seed.id), '[]'::jsonb)
    into v_seeds
  from (
    select ticket.id, ticket.ticket_number, ticket.subject,
      left(coalesce(ticket.description, ''), 1500) as description, ticket.created_at
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.created_at >= v_since
      and ticket.merged_into_ticket_id is null
      and (not v_open or (
        ticket.closed_at is null and ticket.resolved_at is null
        and not exists (
          select 1 from public.problem_tickets link
           where link.tenant_id = p_tenant_id and link.ticket_id = ticket.id
        )
      ))
      and public.can_read_ticket(ticket.id)
    order by ticket.created_at desc, ticket.id
    limit v_seed_limit
  ) seed;
  -- Fewer readable tickets in the window than a cluster needs: no lookups.
  if jsonb_array_length(v_seeds) < v_min_size then
    return;
  end if;

  for v_seed in
    select
      (item ->> 'id')::uuid as id,
      item ->> 'ticket_number' as ticket_number,
      item ->> 'subject' as subject,
      item ->> 'description' as description,
      (item ->> 'created_at')::timestamptz as created_at
    from jsonb_array_elements(v_seeds) with ordinality as seeds(item, pos)
    order by seeds.pos
  loop
    exit when v_lookups >= v_max_lookups or jsonb_array_length(v_clusters) >= v_limit;
    continue when v_seed.id = any(v_clustered);
    v_lookups := v_lookups + 1;

    select
      array_agg(member.id order by member.pos),
      jsonb_agg(
        jsonb_build_object(
          'id', member.id,
          'ticket_number', coalesce(member.ticket_number, ''),
          'subject', coalesce(member.subject, ''),
          'created_at', member.created_at
        )
        order by member.pos
      ),
      (count(*) filter (where not member.id = any(v_clustered)))::integer
      into v_member_ids, v_members, v_fresh
    from (
      select 0 as pos, v_seed.id, v_seed.ticket_number, v_seed.subject, v_seed.created_at
      union all
      select
        found.pos::integer,
        found.ticket_id,
        found.ticket_number,
        found.subject,
        found.created_at
      from public.recent_similar_tickets(
        p_tenant_id,
        coalesce(v_seed.subject, '') || E'\n' || left(coalesce(v_seed.description, ''), 1500),
        v_since,
        v_seed.id,
        50
      ) with ordinality as found(
        ticket_id, ticket_number, subject, status_label, is_closed,
        department_id, created_at, rank, matched_terms, pos
      )
      where found.ticket_id <> v_seed.id
        and (not v_open or (
          not found.is_closed
          and not exists (
            select 1 from public.tickets member_ticket
             where member_ticket.id = found.ticket_id
               and (member_ticket.resolved_at is not null or member_ticket.closed_at is not null)
          )
          and not exists (
            select 1 from public.problem_tickets link
             where link.tenant_id = p_tenant_id and link.ticket_id = found.ticket_id
          )
        ))
    ) member;

    -- A cluster that mostly repeats an earlier one is not reported twice.
    continue when cardinality(v_member_ids) < v_min_size or v_fresh < v_min_size;
    v_clustered := v_clustered || v_member_ids;
    v_clusters := v_clusters || jsonb_build_array(jsonb_build_object(
      'ordinal', jsonb_array_length(v_clusters),
      'ticket_id', v_seed.id,
      'subject', coalesce(v_seed.subject, ''),
      'ticket_count', cardinality(v_member_ids),
      'ticket_ids', to_jsonb(v_member_ids),
      'tickets', v_members
    ));
  end loop;

  return query
  select
    (item ->> 'ticket_id')::uuid,
    item ->> 'subject',
    (item ->> 'ticket_count')::integer,
    array(select jsonb_array_elements_text(item -> 'ticket_ids')::uuid),
    item -> 'tickets'
  from jsonb_array_elements(v_clusters) as clusters(item)
  order by (item ->> 'ticket_count')::integer desc, (item ->> 'ordinal')::integer;
end;
$function$;
revoke all on function public.ticket_similarity_clusters(uuid, timestamptz, integer, integer, boolean) from public, anon;
grant execute on function public.ticket_similarity_clusters(uuid, timestamptz, integer, integer, boolean) to authenticated, service_role;

-- The incident hint keeps its function name; it now uses the shared logic.
create or replace function public.recent_incident_clusters(
  p_tenant_id uuid,
  p_since timestamptz,
  p_min_size integer default 5,
  p_limit integer default 3
)
returns table(ticket_id uuid, subject text, ticket_count integer, ticket_ids uuid[], tickets jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select cluster.ticket_id, cluster.subject, cluster.ticket_count, cluster.ticket_ids, cluster.tickets
    from public.ticket_similarity_clusters(p_tenant_id, p_since, p_min_size, p_limit, false) cluster;
$$;

-- ---------------------------------------------------------------------------
-- 5. Retention of operational data

alter table public.tenant_data_retention_policies
  add column if not exists monitoring_retention_months smallint not null default 24,
  add column if not exists ipam_retention_months smallint not null default 24,
  add column if not exists phishing_retention_months smallint not null default 12;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_data_retention_policies'::regclass
       and conname = 'tenant_data_retention_operational_months_valid'
  ) then
    alter table public.tenant_data_retention_policies
      add constraint tenant_data_retention_operational_months_valid check (
        monitoring_retention_months between 1 and 120
        and ipam_retention_months between 1 and 120
        and phishing_retention_months between 1 and 120
      );
  end if;
end;
$$;

comment on column public.tenant_data_retention_policies.monitoring_retention_months is
  'Months PRTG alerts, incident histories and stale sensor states are kept (daily prune).';
comment on column public.tenant_data_retention_policies.ipam_retention_months is
  'Months IPAM observations, address histories and the change log are kept (daily prune).';
comment on column public.tenant_data_retention_policies.phishing_retention_months is
  'Months after which reporter data of phishing reports of closed cases is anonymized.';

alter table public.phishing_reports
  add column if not exists anonymized_at timestamptz;

-- Daily prune. A legal hold stops it for the tenant. Phishing reports of
-- closed cases lose the reporting person and the raw header analysis; the
-- indicators (sender, sending IP, subject, links) stay for the IOC list.
create or replace function public.operational_data_prune(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_policy record;
  v_now timestamptz := timezone('utc', now());
  v_monitoring timestamptz;
  v_ipam timestamptz;
  v_phishing timestamptz;
  v_rows integer;
  v_totals jsonb := '{}'::jsonb;
begin
  for v_policy in
    select tenant.id as tenant_id,
           coalesce(policy.legal_hold, false) as legal_hold,
           coalesce(policy.monitoring_retention_months, 24) as monitoring_months,
           coalesce(policy.ipam_retention_months, 24) as ipam_months,
           coalesce(policy.phishing_retention_months, 12) as phishing_months
      from public.tenants tenant
      left join public.tenant_data_retention_policies policy on policy.tenant_id = tenant.id
     where p_tenant_id is null or tenant.id = p_tenant_id
  loop
    continue when v_policy.legal_hold;
    v_monitoring := v_now - make_interval(months => v_policy.monitoring_months);
    v_ipam := v_now - make_interval(months => v_policy.ipam_months);
    v_phishing := v_now - make_interval(months => v_policy.phishing_months);

    delete from public.monitoring_alerts alert
     where alert.tenant_id = v_policy.tenant_id
       and alert.state = 'resolved'
       and coalesce(alert.resolved_at, alert.updated_at) < v_monitoring;
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('monitoring_alerts',
      coalesce((v_totals ->> 'monitoring_alerts')::integer, 0) + v_rows);

    delete from public.monitoring_incident_events event
     where event.tenant_id = v_policy.tenant_id
       and event.created_at < v_monitoring
       and exists (
         select 1 from public.monitoring_incidents incident
          where incident.id = event.incident_id and incident.state in ('resolved', 'closed')
       );
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('monitoring_incident_events',
      coalesce((v_totals ->> 'monitoring_incident_events')::integer, 0) + v_rows);

    delete from public.monitoring_sensor_states state
     where state.tenant_id = v_policy.tenant_id
       and state.updated_at < v_monitoring;
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('monitoring_sensor_states',
      coalesce((v_totals ->> 'monitoring_sensor_states')::integer, 0) + v_rows);

    update public.phishing_reports report
       set reporter_id = null,
           reporter_email = null,
           analysis = (report.analysis - 'headers')
             || jsonb_build_object('anonymized', true),
           anonymized_at = v_now
     where report.tenant_id = v_policy.tenant_id
       and report.anonymized_at is null
       and report.created_at < v_phishing
       and (
         report.ticket_id is null
         or exists (
           select 1 from public.security_cases security_case
            where security_case.ticket_id = report.ticket_id
              and security_case.state = 'closed'
         )
       );
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('phishing_reports_anonymized',
      coalesce((v_totals ->> 'phishing_reports_anonymized')::integer, 0) + v_rows);

    delete from public.ipam_observations observation
     where observation.tenant_id = v_policy.tenant_id
       and observation.seen_at < v_ipam;
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('ipam_observations',
      coalesce((v_totals ->> 'ipam_observations')::integer, 0) + v_rows);

    delete from public.ipam_address_events event
     where event.tenant_id = v_policy.tenant_id
       and event.created_at < v_ipam;
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('ipam_address_events',
      coalesce((v_totals ->> 'ipam_address_events')::integer, 0) + v_rows);

    delete from public.ipam_change_log entry
     where entry.tenant_id = v_policy.tenant_id
       and entry.at < v_ipam;
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('ipam_change_log',
      coalesce((v_totals ->> 'ipam_change_log')::integer, 0) + v_rows);

    -- Delivered webhook events are only kept for 30 days.
    delete from public.ipam_webhook_outbox outbox
     where outbox.tenant_id = v_policy.tenant_id
       and outbox.status = 'delivered'
       and coalesce(outbox.delivered_at, outbox.created_at) < v_now - interval '30 days';
    get diagnostics v_rows = row_count;
    v_totals := v_totals || jsonb_build_object('ipam_webhook_outbox',
      coalesce((v_totals ->> 'ipam_webhook_outbox')::integer, 0) + v_rows);
  end loop;
  return v_totals;
end;
$$;
revoke all on function public.operational_data_prune(uuid) from public, anon, authenticated;
grant execute on function public.operational_data_prune(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Jobs

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-ipam-automation-hourly');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('nextdesk-ipam-automation-daily');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('nextdesk-operational-data-prune');
  exception when others then
    null;
  end;
  perform cron.schedule('nextdesk-ipam-automation-hourly', '11 * * * *',
    $cron$select public.ipam_automation_hourly();$cron$);
  perform cron.schedule('nextdesk-ipam-automation-daily', '13 3 * * *',
    $cron$select public.ipam_automation_daily();$cron$);
  perform cron.schedule('nextdesk-operational-data-prune', '41 3 * * *',
    $cron$select public.operational_data_prune();$cron$);
exception when others then
  null;
end;
$$;

commit;
