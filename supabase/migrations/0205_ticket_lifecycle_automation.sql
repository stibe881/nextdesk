begin;

set local search_path = pg_catalog, public;

-- Ticket lifecycle automation per tenant:
--   * waiting for the requester: reminder after N days, solved after M days
--   * solved: closed after K days (a reply before that reopens as usual)
-- All switches start off; admins with automation.manage turn them on.

create table if not exists public.ticket_lifecycle_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  waiting_reminder_enabled boolean not null default false,
  waiting_reminder_days integer not null default 3 check (waiting_reminder_days between 1 and 60),
  waiting_resolve_enabled boolean not null default false,
  waiting_resolve_days integer not null default 7 check (waiting_resolve_days between 1 and 90),
  resolved_close_enabled boolean not null default false,
  resolved_close_days integer not null default 5 check (resolved_close_days between 1 and 90),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.ticket_lifecycle_settings enable row level security;
revoke all on table public.ticket_lifecycle_settings from anon, authenticated;

alter table public.tickets
  add column if not exists waiting_reminder_sent_at timestamptz;

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
  v_resolve_days integer := coalesce((p_settings ->> 'waitingResolveDays')::integer, 7);
  v_close_days integer := coalesce((p_settings ->> 'resolvedCloseDays')::integer, 5);
  v_reminder boolean := coalesce((p_settings ->> 'waitingReminderEnabled')::boolean, false);
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
    waiting_resolve_enabled, waiting_resolve_days,
    resolved_close_enabled, resolved_close_days, updated_by, updated_at
  ) values (
    p_tenant_id, v_reminder, v_reminder_days, v_resolve, v_resolve_days,
    coalesce((p_settings ->> 'resolvedCloseEnabled')::boolean, false), v_close_days,
    auth.uid(), timezone('utc', now())
  )
  on conflict (tenant_id) do update set
    waiting_reminder_enabled = excluded.waiting_reminder_enabled,
    waiting_reminder_days = excluded.waiting_reminder_days,
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

-- Runs every hour. Reminders are written as an external reply of the
-- assigned agent, so they reach the requester by e-mail and push like any
-- other reply.
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
begin
  -- 1. Reminders for tickets waiting for the requester.
  for v_ticket in
    select ticket.id, ticket.tenant_id, ticket.ticket_number, ticket.assigned_agent_id,
           settings.waiting_reminder_days, settings.waiting_resolve_enabled,
           settings.waiting_resolve_days
    from public.tickets ticket
    join public.ticket_lifecycle_settings settings
      on settings.tenant_id = ticket.tenant_id and settings.waiting_reminder_enabled
    join public.ticket_statuses status on status.id = ticket.status_id
    where status.key in ('waiting', 'waiting_customer')
      and ticket.closed_at is null
      and ticket.assigned_agent_id is not null
      and ticket.waiting_since is not null
      and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_reminder_days)
      and (ticket.waiting_reminder_sent_at is null
        or ticket.waiting_reminder_sent_at < ticket.waiting_since)
    limit 500
  loop
    begin
      insert into public.ticket_comments (ticket_id, author_id, visibility, body)
      values (
        v_ticket.id,
        v_ticket.assigned_agent_id,
        'external',
        'Guten Tag' || E'\n\n' ||
        'Wir warten noch auf Ihre Rückmeldung zu Ticket ' || v_ticket.ticket_number ||
        '. Bitte antworten Sie direkt auf diese Nachricht, damit wir weiterarbeiten können.' ||
        case when v_ticket.waiting_resolve_enabled then
          E'\n\n' || 'Ohne Rückmeldung wird das Ticket nach ' ||
          (v_ticket.waiting_resolve_days - v_ticket.waiting_reminder_days)::text ||
          ' weiteren Tagen als gelöst markiert.'
        else '' end ||
        E'\n\n' || '(Automatische Erinnerung)'
      );
      update public.tickets set waiting_reminder_sent_at = v_now where id = v_ticket.id;
      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, null, 'ticket.lifecycle.waiting_reminder', '{}'::jsonb);
      v_reminders := v_reminders + 1;
    exception when others then
      null;
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

-- A reply from the requester side ends the waiting time (back to «In
-- Bearbeitung») and reopens a solved ticket before it is closed. Replies by
-- people who work on tickets do not count. Only active for tenants that use
-- the lifecycle rules.
create or replace function public.ticket_lifecycle_requester_reply()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_settings public.ticket_lifecycle_settings%rowtype;
  v_key text;
  v_in_progress uuid;
begin
  if new.visibility <> 'external' then
    return new;
  end if;
  select ticket.id, ticket.tenant_id, ticket.department_id, ticket.status_id,
         ticket.requester_id, ticket.affected_user_id, ticket.closed_at
  into v_ticket
  from public.tickets ticket where ticket.id = new.ticket_id;
  if not found or v_ticket.closed_at is not null then
    return new;
  end if;
  select * into v_settings from public.ticket_lifecycle_settings
  where tenant_id = v_ticket.tenant_id;
  if not found or not (v_settings.waiting_reminder_enabled
      or v_settings.waiting_resolve_enabled or v_settings.resolved_close_enabled) then
    return new;
  end if;
  if new.author_id is distinct from v_ticket.requester_id
    and new.author_id is distinct from v_ticket.affected_user_id
    and public.user_has_ticket_permission_for(
      new.author_id, v_ticket.tenant_id, v_ticket.department_id, 'ticket.update') then
    return new;
  end if;
  select key into v_key from public.ticket_statuses where id = v_ticket.status_id;
  if v_key not in ('waiting', 'waiting_customer', 'resolved') then
    return new;
  end if;
  if v_key = 'resolved' and not v_settings.resolved_close_enabled then
    return new;
  end if;
  select id into v_in_progress from public.ticket_statuses
  where tenant_id = v_ticket.tenant_id and key = 'in_progress';
  if v_in_progress is null then
    return new;
  end if;
  update public.tickets
  set status_id = v_in_progress,
      waiting_since = null,
      resolved_at = case when v_key = 'resolved' then null else resolved_at end
  where id = v_ticket.id;
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (v_ticket.id, new.author_id,
    case when v_key = 'resolved' then 'ticket.lifecycle.reopened_by_reply'
      else 'ticket.lifecycle.waiting_answered' end,
    jsonb_build_object('changedFields', jsonb_build_array('status'), 'statusKey', 'in_progress'));
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.ticket_lifecycle_requester_reply() from public, anon, authenticated;

create or replace trigger ticket_lifecycle_requester_reply
  after insert on public.ticket_comments
  for each row execute function public.ticket_lifecycle_requester_reply();

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-ticket-lifecycle'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-ticket-lifecycle',
    '23 * * * *',
    'select public.ticket_lifecycle_run();'
  );
exception when others then
  null;
end;
$$;

commit;
