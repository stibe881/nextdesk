begin;

set local search_path = pg_catalog, public;

-- Requester-facing ticket progress and one-click answers to waiting reminders.
--
-- Extends the ticket lifecycle automation from 0205 instead of adding a second
-- reminder flow:
--   * reminders can repeat (every N days, at most M times per waiting period);
--   * each reminder is recorded and reaches the requester by push
--     (kind «ticket.requester_reminder») and by e-mail (the existing external
--     reply); the e-mail carries signed single-use links «Problem ist gelöst» /
--     «Ich brauche noch Hilfe», handled by the Edge Function
--     requester-reminder-action;
--   * the requester can answer the same way in the portal or the app.
-- Also adds the historical median resolution time used for the expected
-- resolution time in the requester's progress tracker.

-- 1. Settings --------------------------------------------------------------

alter table public.ticket_lifecycle_settings
  add column if not exists waiting_reminder_max_count integer not null default 1,
  add column if not exists waiting_reminder_actions_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ticket_lifecycle_settings_reminder_max_count_check'
      and conrelid = 'public.ticket_lifecycle_settings'::regclass
  ) then
    alter table public.ticket_lifecycle_settings
      add constraint ticket_lifecycle_settings_reminder_max_count_check
      check (waiting_reminder_max_count between 1 and 5);
  end if;
end;
$$;

alter table public.tickets
  add column if not exists waiting_reminder_count integer not null default 0;

create or replace function public.get_ticket_lifecycle_settings(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.ticket_lifecycle_settings%rowtype;
begin
  if not public.has_tenant_permission(p_tenant_id, 'automation.manage') then
    raise exception 'automation_manage_required' using errcode = '42501';
  end if;
  select * into v_row from public.ticket_lifecycle_settings where tenant_id = p_tenant_id;
  return jsonb_build_object(
    'waitingReminderEnabled', coalesce(v_row.waiting_reminder_enabled, false),
    'waitingReminderDays', coalesce(v_row.waiting_reminder_days, 3),
    'waitingReminderMaxCount', coalesce(v_row.waiting_reminder_max_count, 1),
    'waitingReminderActionsEnabled', coalesce(v_row.waiting_reminder_actions_enabled, true),
    'waitingResolveEnabled', coalesce(v_row.waiting_resolve_enabled, false),
    'waitingResolveDays', coalesce(v_row.waiting_resolve_days, 7),
    'resolvedCloseEnabled', coalesce(v_row.resolved_close_enabled, false),
    'resolvedCloseDays', coalesce(v_row.resolved_close_days, 5),
    'updatedAt', v_row.updated_at
  );
end;
$$;
revoke all on function public.get_ticket_lifecycle_settings(uuid) from public, anon;
grant execute on function public.get_ticket_lifecycle_settings(uuid) to authenticated;

create or replace function public.save_ticket_lifecycle_settings(p_tenant_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reminder_days integer := coalesce((p_settings ->> 'waitingReminderDays')::integer, 3);
  v_max_count integer := coalesce((p_settings ->> 'waitingReminderMaxCount')::integer, 1);
  v_resolve_days integer := coalesce((p_settings ->> 'waitingResolveDays')::integer, 7);
  v_close_days integer := coalesce((p_settings ->> 'resolvedCloseDays')::integer, 5);
  v_reminder boolean := coalesce((p_settings ->> 'waitingReminderEnabled')::boolean, false);
  v_actions boolean := coalesce((p_settings ->> 'waitingReminderActionsEnabled')::boolean, true);
  v_resolve boolean := coalesce((p_settings ->> 'waitingResolveEnabled')::boolean, false);
begin
  if not public.has_tenant_permission(p_tenant_id, 'automation.manage') then
    raise exception 'automation_manage_required' using errcode = '42501';
  end if;
  if v_reminder and v_resolve and v_resolve_days <= v_reminder_days then
    raise exception 'resolve_after_reminder' using errcode = '22023',
      hint = 'Das automatische Lösen muss nach der Erinnerung folgen.';
  end if;
  insert into public.ticket_lifecycle_settings (
    tenant_id, waiting_reminder_enabled, waiting_reminder_days,
    waiting_reminder_max_count, waiting_reminder_actions_enabled,
    waiting_resolve_enabled, waiting_resolve_days,
    resolved_close_enabled, resolved_close_days, updated_by, updated_at
  ) values (
    p_tenant_id, v_reminder, v_reminder_days, v_max_count, v_actions,
    v_resolve, v_resolve_days,
    coalesce((p_settings ->> 'resolvedCloseEnabled')::boolean, false), v_close_days,
    auth.uid(), timezone('utc', now())
  )
  on conflict (tenant_id) do update set
    waiting_reminder_enabled = excluded.waiting_reminder_enabled,
    waiting_reminder_days = excluded.waiting_reminder_days,
    waiting_reminder_max_count = excluded.waiting_reminder_max_count,
    waiting_reminder_actions_enabled = excluded.waiting_reminder_actions_enabled,
    waiting_resolve_enabled = excluded.waiting_resolve_enabled,
    waiting_resolve_days = excluded.waiting_resolve_days,
    resolved_close_enabled = excluded.resolved_close_enabled,
    resolved_close_days = excluded.resolved_close_days,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, severity, metadata)
  values (p_tenant_id, auth.uid(), 'automation.lifecycle.updated', 'ticket_lifecycle_settings',
    'info', p_settings);
  return public.get_ticket_lifecycle_settings(p_tenant_id);
end;
$$;
revoke all on function public.save_ticket_lifecycle_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_ticket_lifecycle_settings(uuid, jsonb) to authenticated;

-- 2. Reminder records and signing secret ----------------------------------

create table if not exists public.ticket_requester_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  comment_id uuid references public.ticket_comments(id) on delete set null,
  recipient_id uuid not null references public.user_profiles(id) on delete cascade,
  reminder_number integer not null check (reminder_number between 1 and 5),
  actions_enabled boolean not null default true,
  sent_at timestamptz not null default timezone('utc', now()),
  actions_expire_at timestamptz not null,
  action_used_at timestamptz,
  action_used text check (action_used in ('resolved', 'need_help')),
  action_channel text check (action_channel in ('email', 'portal', 'app')),
  constraint ticket_requester_reminders_used_check
    check ((action_used_at is null) = (action_used is null))
);
create index if not exists ticket_requester_reminders_ticket_idx
  on public.ticket_requester_reminders (ticket_id, sent_at desc);
create index if not exists ticket_requester_reminders_comment_idx
  on public.ticket_requester_reminders (comment_id) where comment_id is not null;
alter table public.ticket_requester_reminders enable row level security;
revoke all on table public.ticket_requester_reminders from public, anon, authenticated;
comment on table public.ticket_requester_reminders is
  'Automatische Erinnerungen an meldende Personen (Ticket-Ablauf). Nur Service-Rolle; Antworten über requester-reminder-action bzw. requester-portal.';

-- HMAC secret for the one-click links. Never leaves the database except to the
-- service role (Edge Functions).
create schema if not exists ticket_requester_private;
revoke all on schema ticket_requester_private from public, anon, authenticated;

create table if not exists ticket_requester_private.action_secret (
  singleton boolean primary key default true check (singleton),
  secret text not null check (char_length(secret) >= 64),
  created_at timestamptz not null default timezone('utc', now())
);
revoke all on ticket_requester_private.action_secret from public, anon, authenticated;

insert into ticket_requester_private.action_secret (singleton, secret)
values (
  true,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '')
)
on conflict (singleton) do nothing;

create or replace function public.ticket_requester_action_secret()
returns text
language sql
stable
security definer
set search_path = pg_catalog, ticket_requester_private, pg_temp
as $$
  select secret from ticket_requester_private.action_secret where singleton;
$$;
revoke all on function public.ticket_requester_action_secret() from public, anon, authenticated;
grant execute on function public.ticket_requester_action_secret() to service_role;

-- 3. Push: the reminder comment does not additionally create a
--    «ticket.support_reply» push; the dedicated reminder push replaces it.
create or replace function public.push_notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
begin
  if new.visibility <> 'external' then
    return new;
  end if;
  if coalesce(current_setting('nextdesk.requester_reminder_comment', true), '') = 'on' then
    return new;
  end if;

  select ticket.tenant_id, ticket.id, ticket.ticket_number, ticket.requester_id,
         ticket.affected_user_id, ticket.assigned_agent_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id;
  if not found then
    return new;
  end if;

  if new.author_id is null
     or new.author_id = v_ticket.requester_id
     or new.author_id is not distinct from v_ticket.affected_user_id then
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      v_ticket.assigned_agent_id,
      v_ticket.id,
      'ticket.requester_reply',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'commentId', new.id),
      new.author_id
    );
  elsif new.author_id is not null then
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      v_ticket.requester_id,
      v_ticket.id,
      'ticket.support_reply',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'commentId', new.id),
      new.author_id
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_ticket_comment() from public, anon, authenticated;

-- Push categories: all existing rows (0223) plus the requester reminder, which
-- follows the person's «Antworten vom Support» preference.
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
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    else null
  end;
$function$;

-- 4. Lifecycle run (replaces 0205): repeated reminders with push and actions.
create or replace function public.ticket_lifecycle_run()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_ticket record;
  v_resolved_status uuid;
  v_closed_status uuid;
  v_reminders integer := 0;
  v_resolved integer := 0;
  v_closed integer := 0;
  v_number integer;
  v_comment_id uuid;
  v_reminder_id uuid;
  v_remaining integer;
begin
  -- 1. Reminders for tickets waiting for the requester. The first reminder
  --    follows N days after the waiting started, further ones every N days,
  --    at most M per waiting period.
  for v_ticket in
    select ticket.id, ticket.tenant_id, ticket.ticket_number, ticket.assigned_agent_id,
           ticket.requester_id, ticket.waiting_since, ticket.waiting_reminder_sent_at,
           ticket.waiting_reminder_count,
           settings.waiting_reminder_days, settings.waiting_reminder_max_count,
           settings.waiting_reminder_actions_enabled,
           settings.waiting_resolve_enabled, settings.waiting_resolve_days
    from public.tickets ticket
    join public.ticket_lifecycle_settings settings
      on settings.tenant_id = ticket.tenant_id and settings.waiting_reminder_enabled
    join public.ticket_statuses status on status.id = ticket.status_id
    where status.key in ('waiting', 'waiting_customer')
      and ticket.closed_at is null
      and ticket.merged_into_ticket_id is null
      and ticket.assigned_agent_id is not null
      and ticket.waiting_since is not null
      and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_reminder_days)
      and (
        ticket.waiting_reminder_sent_at is null
        or ticket.waiting_reminder_sent_at < ticket.waiting_since
        or (
          ticket.waiting_reminder_count < settings.waiting_reminder_max_count
          and ticket.waiting_reminder_sent_at
            <= v_now - make_interval(days => settings.waiting_reminder_days)
        )
      )
    limit 500
  loop
    begin
      v_number := case
        when v_ticket.waiting_reminder_sent_at is null
          or v_ticket.waiting_reminder_sent_at < v_ticket.waiting_since then 1
        else least(v_ticket.waiting_reminder_count + 1, 5)
      end;
      v_remaining := case when v_ticket.waiting_resolve_enabled then
        greatest(1, v_ticket.waiting_resolve_days
          - floor(extract(epoch from (v_now - v_ticket.waiting_since)) / 86400)::integer)
      else null end;
      perform set_config('nextdesk.requester_reminder_comment', 'on', true);
      insert into public.ticket_comments (ticket_id, author_id, visibility, body)
      values (
        v_ticket.id,
        v_ticket.assigned_agent_id,
        'external',
        'Guten Tag' || E'\n\n' ||
        'Wir warten noch auf Ihre Rückmeldung zu Ticket ' || v_ticket.ticket_number ||
        '. Bitte antworten Sie direkt auf diese Nachricht, damit wir weiterarbeiten können.' ||
        case when v_ticket.waiting_reminder_actions_enabled then
          E'\n\n' || 'Ist Ihr Problem inzwischen gelöst? Dann genügt ein Klick auf «Problem ist gelöst» '
            || 'in dieser E-Mail, im Portal oder in der App.'
        else '' end ||
        case when v_remaining is not null then
          E'\n\n' || 'Ohne Rückmeldung wird das Ticket nach ' || v_remaining::text ||
          ' weiteren Tagen als gelöst markiert.'
        else '' end ||
        E'\n\n' || '(Automatische Erinnerung)'
      )
      returning id into v_comment_id;
      perform set_config('nextdesk.requester_reminder_comment', '', true);

      insert into public.ticket_requester_reminders (
        tenant_id, ticket_id, comment_id, recipient_id, reminder_number,
        actions_enabled, sent_at, actions_expire_at
      ) values (
        v_ticket.tenant_id, v_ticket.id, v_comment_id, v_ticket.requester_id, v_number,
        v_ticket.waiting_reminder_actions_enabled, v_now, v_now + interval '14 days'
      )
      returning id into v_reminder_id;

      update public.tickets
      set waiting_reminder_sent_at = v_now,
          waiting_reminder_count = v_number
      where id = v_ticket.id;
      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, null, 'ticket.lifecycle.waiting_reminder',
        jsonb_build_object('reminderNumber', v_number, 'reminderId', v_reminder_id));

      perform public.push_insert_ticket_notification(
        v_ticket.tenant_id,
        v_ticket.requester_id,
        v_ticket.id,
        'ticket.requester_reminder',
        jsonb_build_object(
          'ticketNumber', v_ticket.ticket_number,
          'commentId', v_comment_id,
          'reminderId', v_reminder_id,
          'reminderNumber', v_number,
          'actionsEnabled', v_ticket.waiting_reminder_actions_enabled
        ),
        v_ticket.assigned_agent_id
      );
      v_reminders := v_reminders + 1;
    exception when others then
      perform set_config('nextdesk.requester_reminder_comment', '', true);
    end;
  end loop;

  -- 2. Solve tickets still waiting after the configured time.
  for v_ticket in
    select ticket.id, ticket.tenant_id
    from public.tickets ticket
    join public.ticket_lifecycle_settings settings
      on settings.tenant_id = ticket.tenant_id and settings.waiting_resolve_enabled
    join public.ticket_statuses status on status.id = ticket.status_id
    where status.key in ('waiting', 'waiting_customer')
      and ticket.closed_at is null
      and ticket.assigned_agent_id is not null
      and ticket.waiting_since is not null
      and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_resolve_days)
    limit 500
  loop
    select id into v_resolved_status from public.ticket_statuses
    where tenant_id = v_ticket.tenant_id and key = 'resolved';
    continue when v_resolved_status is null;
    begin
      update public.tickets
      set status_id = v_resolved_status,
          resolved_at = v_now,
          waiting_since = null
      where id = v_ticket.id;
      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, null, 'ticket.lifecycle.auto_resolved',
        jsonb_build_object('changedFields', jsonb_build_array('status'), 'statusKey', 'resolved'));
      v_resolved := v_resolved + 1;
    exception when others then
      null;
    end;
  end loop;

  -- 3. Close solved tickets after the configured time.
  for v_ticket in
    select ticket.id, ticket.tenant_id
    from public.tickets ticket
    join public.ticket_lifecycle_settings settings
      on settings.tenant_id = ticket.tenant_id and settings.resolved_close_enabled
    join public.ticket_statuses status on status.id = ticket.status_id
    where status.key = 'resolved'
      and ticket.closed_at is null
      and ticket.resolved_at is not null
      and ticket.resolved_at <= v_now - make_interval(days => settings.resolved_close_days)
    limit 500
  loop
    select id into v_closed_status from public.ticket_statuses
    where tenant_id = v_ticket.tenant_id and key = 'closed';
    continue when v_closed_status is null;
    begin
      update public.tickets
      set status_id = v_closed_status,
          closed_at = v_now
      where id = v_ticket.id;
      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, null, 'ticket.lifecycle.auto_closed',
        jsonb_build_object('changedFields', jsonb_build_array('status'), 'statusKey', 'closed'));
      v_closed := v_closed + 1;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object('reminders', v_reminders, 'resolved', v_resolved, 'closed', v_closed);
end;
$$;
revoke all on function public.ticket_lifecycle_run() from public, anon, authenticated;

-- 5. Actions for an e-mail: returns the reminder that a queued reply belongs
--    to while its links can still be used; otherwise null.
create or replace function public.ticket_requester_reminder_for_comment(p_comment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'reminderId', reminder.id,
    'ticketId', reminder.ticket_id,
    'tenantId', reminder.tenant_id,
    'expiresAt', reminder.actions_expire_at
  )
  from public.ticket_requester_reminders reminder
  join public.tickets ticket on ticket.id = reminder.ticket_id
  join public.ticket_statuses status on status.id = ticket.status_id
  join public.ticket_lifecycle_settings settings on settings.tenant_id = reminder.tenant_id
  where reminder.comment_id = p_comment_id
    and reminder.actions_enabled
    and settings.waiting_reminder_actions_enabled
    and reminder.action_used_at is null
    and reminder.actions_expire_at > timezone('utc', now())
    and status.key in ('waiting', 'waiting_customer')
    and ticket.closed_at is null
  limit 1;
$$;
revoke all on function public.ticket_requester_reminder_for_comment(uuid) from public, anon, authenticated;
grant execute on function public.ticket_requester_reminder_for_comment(uuid) to service_role;

-- What the one-click page may show before the person confirms. Only data the
-- e-mail already contained (number and subject).
create or replace function public.ticket_requester_reminder_preview(
  p_reminder_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reminder public.ticket_requester_reminders%rowtype;
  v_ticket record;
  v_state text;
begin
  select * into v_reminder from public.ticket_requester_reminders
  where id = p_reminder_id and ticket_id = p_ticket_id;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  select ticket.ticket_number, ticket.subject, ticket.closed_at, status.key
  into v_ticket
  from public.tickets ticket
  join public.ticket_statuses status on status.id = ticket.status_id
  where ticket.id = v_reminder.ticket_id;
  v_state := case
    when v_reminder.action_used_at is not null then 'used'
    when v_reminder.actions_expire_at <= timezone('utc', now()) then 'expired'
    when not v_reminder.actions_enabled or not coalesce((
      select settings.waiting_reminder_actions_enabled from public.ticket_lifecycle_settings settings
      where settings.tenant_id = v_reminder.tenant_id), false) then 'disabled'
    when v_ticket.closed_at is not null
      or v_ticket.key not in ('waiting', 'waiting_customer') then 'not_waiting'
    else 'open'
  end;
  return jsonb_build_object(
    'state', v_state,
    'ticketNumber', v_ticket.ticket_number,
    'subject', v_ticket.subject,
    'usedAction', v_reminder.action_used
  );
end;
$$;
revoke all on function public.ticket_requester_reminder_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_requester_reminder_preview(uuid, uuid) to service_role;

-- 6. The requester answers a waiting ticket: «Problem ist gelöst» (resolved)
--    or «Ich brauche noch Hilfe» (back to «In Bearbeitung»).
--    p_reminder_id set: one-click link from the e-mail (single use, expiring;
--    the actor is the reminder's recipient). Otherwise p_actor_id must be the
--    ticket's requester or affected person (portal / app).
create or replace function public.ticket_requester_respond(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_response text,
  p_channel text,
  p_reminder_id uuid default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_ticket public.tickets%rowtype;
  v_reminder public.ticket_requester_reminders%rowtype;
  v_key text;
  v_actor uuid := p_actor_id;
  v_target uuid;
  v_target_key text;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_event text;
  v_hint text;
begin
  if p_response not in ('resolved', 'need_help') then
    raise exception 'invalid_response' using errcode = '22023', hint = 'invalid_response';
  end if;
  if p_channel not in ('email', 'portal', 'app') then
    raise exception 'invalid_channel' using errcode = '22023', hint = 'invalid_channel';
  end if;
  if v_message is not null and char_length(v_message) > 5000 then
    raise exception 'message_too_long' using errcode = '22023', hint = 'message_too_long';
  end if;

  select * into v_ticket from public.tickets
  where id = p_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_available' using errcode = 'P0002', hint = 'ticket_not_available';
  end if;

  if p_reminder_id is not null then
    select * into v_reminder from public.ticket_requester_reminders
    where id = p_reminder_id and ticket_id = p_ticket_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'token_invalid' using errcode = '22023', hint = 'token_invalid';
    end if;
    if v_reminder.action_used_at is not null then
      raise exception 'token_used' using errcode = '22023', hint = 'token_used';
    end if;
    if v_reminder.actions_expire_at <= v_now then
      raise exception 'token_expired' using errcode = '22023', hint = 'token_expired';
    end if;
    if not v_reminder.actions_enabled or not coalesce((
      select settings.waiting_reminder_actions_enabled from public.ticket_lifecycle_settings settings
      where settings.tenant_id = p_tenant_id), false) then
      raise exception 'actions_disabled' using errcode = '22023', hint = 'actions_disabled';
    end if;
    v_actor := v_reminder.recipient_id;
  end if;

  if v_actor is null
     or (v_actor is distinct from v_ticket.requester_id
       and v_actor is distinct from v_ticket.affected_user_id) then
    raise exception 'ticket_not_available' using errcode = 'P0002', hint = 'ticket_not_available';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = v_actor
      and membership.status = 'active'
  ) then
    raise exception 'ticket_not_available' using errcode = 'P0002', hint = 'ticket_not_available';
  end if;

  select key into v_key from public.ticket_statuses where id = v_ticket.status_id;
  if v_ticket.closed_at is not null
     or v_ticket.merged_into_ticket_id is not null
     or v_key not in ('waiting', 'waiting_customer') then
    raise exception 'ticket_not_waiting' using errcode = '22023', hint = 'ticket_not_waiting';
  end if;

  v_target_key := case when p_response = 'resolved' then 'resolved' else 'in_progress' end;
  select id into v_target from public.ticket_statuses
  where tenant_id = p_tenant_id and key = v_target_key;
  if v_target is null then
    raise exception 'status_missing' using errcode = '22023', hint = 'status_missing';
  end if;

  -- Status changes by the requester: notification triggers must not tell the
  -- requester about their own action (see push_notify_ticket_change).
  perform set_config('request.headers',
    jsonb_build_object('x-nextdesk-actor-id', v_actor)::text, true);

  begin
    update public.tickets
    set status_id = v_target,
        waiting_since = null,
        resolved_at = case when p_response = 'resolved' then v_now else resolved_at end
    where id = p_ticket_id;
  exception when check_violation then
    get stacked diagnostics v_hint = pg_exception_hint;
    raise exception 'status_rule' using errcode = '23514',
      hint = coalesce(nullif(v_hint, ''), 'status_rule');
  end;

  v_event := case when p_response = 'resolved' then 'ticket.resolved_by_requester'
    else 'ticket.requester_needs_help' end;
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (p_ticket_id, v_actor, v_event, jsonb_build_object(
    'changedFields', jsonb_build_array('status'),
    'statusKey', v_target_key,
    'channel', p_channel,
    'reminderId', p_reminder_id,
    'statusTransition', jsonb_build_object(
      'fromStatusId', v_ticket.status_id,
      'toStatusKey', v_target_key,
      'isClosed', p_response = 'resolved',
      'occurredAt', v_now
    )
  ));

  -- Every open reminder of this waiting period is answered now.
  update public.ticket_requester_reminders
  set action_used_at = v_now,
      action_used = p_response,
      action_channel = p_channel
  where ticket_id = p_ticket_id and action_used_at is null;

  if p_response = 'need_help' then
    if v_message is not null then
      -- A normal requester reply: notifies the assigned agent and e-mail threads.
      insert into public.ticket_comments (ticket_id, author_id, visibility, body)
      values (p_ticket_id, v_actor, 'external', v_message);
    else
      perform public.push_insert_ticket_notification(
        p_tenant_id, v_ticket.assigned_agent_id, p_ticket_id, 'ticket.requester_reply',
        jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'needsHelp', true),
        v_actor
      );
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, v_actor, v_event, 'ticket', p_ticket_id, 'info',
    jsonb_build_object('channel', p_channel, 'reminderId', p_reminder_id));

  return jsonb_build_object(
    'ticketId', p_ticket_id,
    'ticketNumber', v_ticket.ticket_number,
    'statusKey', v_target_key,
    'response', p_response
  );
end;
$$;
revoke all on function public.ticket_requester_respond(uuid, uuid, uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ticket_requester_respond(uuid, uuid, uuid, text, text, uuid, text)
  to service_role;

-- 7. Expected resolution time: median of similar tickets (same priority and
--    category, solved in the last 90 days). Falls back to the priority alone.
--    At least five comparable tickets are required.
create index if not exists tickets_resolution_history_idx
  on public.tickets (tenant_id, priority_id, resolved_at)
  where resolved_at is not null;

create or replace function public.ticket_resolution_median(
  p_tenant_id uuid,
  p_priority_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_since timestamptz := timezone('utc', now()) - interval '90 days';
  v_seconds double precision;
  v_count integer;
begin
  if p_category_id is not null then
    select percentile_cont(0.5) within group (
             order by extract(epoch from (ticket.resolved_at - ticket.created_at))),
           count(*)
    into v_seconds, v_count
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.priority_id = p_priority_id
      and ticket.category_id = p_category_id
      and ticket.resolved_at is not null
      and ticket.resolved_at >= v_since
      and ticket.resolved_at > ticket.created_at
      and ticket.merged_into_ticket_id is null;
    if v_count >= 5 and v_seconds is not null then
      return jsonb_build_object('seconds', round(v_seconds), 'sampleSize', v_count,
        'basis', 'category_priority');
    end if;
  end if;
  select percentile_cont(0.5) within group (
           order by extract(epoch from (ticket.resolved_at - ticket.created_at))),
         count(*)
  into v_seconds, v_count
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.priority_id = p_priority_id
    and ticket.resolved_at is not null
    and ticket.resolved_at >= v_since
    and ticket.resolved_at > ticket.created_at
    and ticket.merged_into_ticket_id is null;
  if v_count >= 5 and v_seconds is not null then
    return jsonb_build_object('seconds', round(v_seconds), 'sampleSize', v_count,
      'basis', 'priority');
  end if;
  return null;
end;
$$;
revoke all on function public.ticket_resolution_median(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_resolution_median(uuid, uuid, uuid) to service_role;

commit;
