-- SLA-Pause («Hält die SLA an»)
--
-- Tickets in a status with ticket_statuses.pauses_sla stop their SLA clock.
-- Defaults: «Wartend» (waiting), «Wartend auf Kunde» (waiting_customer) and
-- «Wartend auf Drittanbieter» (waiting_vendor) pause the SLA for every tenant;
-- new tenants get the same defaults. Admins switch it per status in the SLA
-- settings (edge function sla-management, action setStatusPause).
--
-- Mechanics (trigger tickets_sla_pause, BEFORE insert/update of status_id,
-- sla_paused_at):
-- * entering a pausing, open status from a non-pausing one sets
--   tickets.sla_paused_at (ticket must have an SLA due date);
-- * moving between two pausing statuses keeps the pause;
-- * leaving the pause (other open status, closing, or the status no longer
--   pauses) adds the paused duration counted in SERVICE TIME of the ticket's
--   SLA profile (sla_service_minutes_between + sla_add_service_minutes) to
--   response_due_at (only without first response) and resolution_due_at.
--   Targets that were already breached when the pause started (due date
--   before the pause or a recorded *_breached event) are not moved.
--   Closing while paused also moves the due dates, so reports and the
--   breach-reason gate do not count the paused time; afterwards nothing runs.
-- * tickets.sla_paused_service_minutes accumulates the paused service time.
-- AFTER trigger tickets_sla_pause_log writes ticket_sla_events
-- ('paused'/'resumed', metadata.pause = true) and ticket_events
-- ('ticket.sla.paused'/'ticket.sla.resumed') for the ticket history.
--
-- Paused tickets are excluded from list_pending_sla_breaches,
-- apply_sla_breach, supervisor_send_ticket_alerts, the 'sla_due' time rule
-- condition and the overdue count of team_overload_warnings_run.
--
-- Backfill: open tickets that currently are in a pausing status get
-- sla_paused_at = the time they entered the status (tickets.status_changed_at,
-- else tickets.waiting_since, else now()). tickets.updated_at is kept.

begin;
set local search_path = pg_catalog, public;

alter table public.ticket_statuses
  add column if not exists pauses_sla boolean not null default false;

alter table public.tickets
  add column if not exists sla_paused_at timestamptz,
  add column if not exists sla_paused_service_minutes numeric not null default 0;

create index if not exists tickets_sla_paused_idx
  on public.tickets (tenant_id, sla_paused_at)
  where sla_paused_at is not null;

update public.ticket_statuses
   set pauses_sla = true
 where key in ('waiting', 'waiting_customer', 'waiting_vendor')
   and not is_closed
   and not pauses_sla;

-- New tenants: default statuses incl. the SLA pause flag.
create or replace function public.initialize_tenant_ticket_reference_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order, pauses_sla)
  values
    (new.id, 'new', 'Neu', false, 10, false),
    (new.id, 'in_progress', 'In Bearbeitung', false, 20, false),
    (new.id, 'waiting', 'Wartend', false, 30, true),
    (new.id, 'waiting_customer', 'Wartend auf Kunde', false, 31, true),
    (new.id, 'waiting_vendor', 'Wartend auf Drittanbieter', false, 32, true),
    (new.id, 'resolved', 'Gelöst', true, 40, false),
    (new.id, 'closed', 'Geschlossen', true, 50, false)
  on conflict (tenant_id, key) do nothing;

  insert into public.ticket_priorities (tenant_id, key, label, sort_order)
  values
    (new.id, 'low', 'Niedrig', 10),
    (new.id, 'normal', 'Normal', 20),
    (new.id, 'high', 'Hoch', 30),
    (new.id, 'urgent', 'Dringend', 40)
  on conflict (tenant_id, key) do nothing;
  return new;
end;
$$;

-- Service minutes between two instants: the counterpart of
-- sla_add_service_minutes (same modes, weekly window and time zone).
create or replace function public.sla_service_minutes_between(
  p_start timestamptz,
  p_end timestamptz,
  p_service_hours jsonb,
  p_timezone text
)
returns numeric
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mode text := coalesce(p_service_hours ->> 'mode', 'always');
  v_timezone text := coalesce(nullif(p_timezone, ''), 'Europe/Zurich');
  v_weekdays integer[];
  v_start time;
  v_end time;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day date;
  v_from timestamp;
  v_to timestamp;
  v_total numeric := 0;
  v_guard integer := 0;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    return 0;
  end if;
  if v_mode not in ('business', 'extended')
     or jsonb_typeof(p_service_hours -> 'weekdays') is distinct from 'array' then
    return extract(epoch from (p_end - p_start)) / 60;
  end if;

  begin
    select coalesce(array_agg(value::integer), '{}')
      into v_weekdays
      from jsonb_array_elements_text(p_service_hours -> 'weekdays') as value
     where value ~ '^[1-7]$';
    v_start := (p_service_hours ->> 'start')::time;
    v_end := (p_service_hours ->> 'end')::time;
    perform now() at time zone v_timezone;
  exception when others then
    return extract(epoch from (p_end - p_start)) / 60;
  end;
  if cardinality(v_weekdays) = 0 or v_start is null or v_end is null
     or v_end <= v_start then
    return extract(epoch from (p_end - p_start)) / 60;
  end if;

  v_local_start := p_start at time zone v_timezone;
  v_local_end := p_end at time zone v_timezone;
  v_day := v_local_start::date;
  while v_day <= v_local_end::date and v_guard < 4000 loop
    if extract(isodow from v_day)::integer = any (v_weekdays) then
      v_from := greatest(v_local_start, v_day + v_start);
      v_to := least(v_local_end, v_day + v_end);
      if v_to > v_from then
        v_total := v_total + extract(epoch from (v_to - v_from)) / 60;
      end if;
    end if;
    v_day := v_day + 1;
    v_guard := v_guard + 1;
  end loop;
  return v_total;
end;
$function$;
revoke all on function public.sla_service_minutes_between(timestamptz, timestamptz, jsonb, text)
  from public, anon;
grant execute on function public.sla_service_minutes_between(timestamptz, timestamptz, jsonb, text)
  to authenticated, service_role;

-- Service hours of the SLA profile a ticket was started with ('started'
-- event), else the tenant/department profile; null = calendar time.
create or replace function public.ticket_sla_service_window(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  out service_hours jsonb,
  out timezone text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_id text;
begin
  select event.metadata #>> '{profile,id}'
    into v_profile_id
    from public.ticket_sla_events event
   where event.ticket_id = p_ticket_id
     and event.event_type = 'started'
   order by event.occurred_at desc
   limit 1;

  if v_profile_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select profile.service_hours, profile.timezone
      into service_hours, timezone
      from public.ticket_sla_profiles profile
     where profile.id = v_profile_id::uuid
       and profile.tenant_id = p_tenant_id;
    if found then
      return;
    end if;
  end if;

  select profile.service_hours, profile.timezone
    into service_hours, timezone
    from public.ticket_sla_profiles profile
   where profile.tenant_id = p_tenant_id
     and profile.active
     and (
       profile.service_hours ->> 'department_id' is null
       or profile.service_hours ->> 'department_id' = p_department_id::text
     )
   order by (profile.service_hours ->> 'department_id' is null), profile.updated_at desc
   limit 1;
end;
$$;
revoke all on function public.ticket_sla_service_window(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ticket_sla_service_window(uuid, uuid, uuid) to service_role;

-- Moves a due date by a paused duration: calendar profiles by the exact
-- elapsed time, service-hour profiles by the paused service minutes.
create or replace function public.sla_extend_due_by_pause(
  p_due timestamptz,
  p_paused_at timestamptz,
  p_resumed_at timestamptz,
  p_service_minutes numeric,
  p_service_hours jsonb,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if p_due is null or p_paused_at is null or p_resumed_at is null
     or p_resumed_at <= p_paused_at then
    return p_due;
  end if;
  if coalesce(p_service_hours ->> 'mode', 'always') not in ('business', 'extended') then
    return p_due + (p_resumed_at - p_paused_at);
  end if;
  if coalesce(round(p_service_minutes), 0) <= 0 then
    return p_due;
  end if;
  return public.sla_add_service_minutes(
    p_due, round(p_service_minutes)::integer, p_service_hours, p_timezone);
end;
$$;
revoke all on function public.sla_extend_due_by_pause(timestamptz, timestamptz, timestamptz, numeric, jsonb, text)
  from public, anon;
grant execute on function public.sla_extend_due_by_pause(timestamptz, timestamptz, timestamptz, numeric, jsonb, text)
  to authenticated, service_role;

create or replace function public.tickets_sla_pause_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_pauses boolean := false;
  v_closed boolean := false;
  v_service_hours jsonb;
  v_timezone text;
  v_minutes numeric;
begin
  select coalesce(status.pauses_sla, false), coalesce(status.is_closed, false)
    into v_pauses, v_closed
    from public.ticket_statuses status
   where status.id = new.status_id
     and status.tenant_id = new.tenant_id;
  v_pauses := coalesce(v_pauses, false)
    and not coalesce(v_closed, false)
    and (new.response_due_at is not null or new.resolution_due_at is not null);

  if tg_op = 'INSERT' then
    new.sla_paused_at := case
      when v_pauses then coalesce(new.created_at, v_now)
      else null
    end;
    return new;
  end if;

  if old.sla_paused_at is null then
    if v_pauses then
      -- An explicit earlier start (backfill) is kept; otherwise now.
      new.sla_paused_at := case
        when new.sla_paused_at is not null and new.sla_paused_at <= v_now
          then new.sla_paused_at
        else v_now
      end;
    else
      new.sla_paused_at := null;
    end if;
    return new;
  end if;

  if v_pauses then
    -- waiting -> waiting: the pause keeps running.
    new.sla_paused_at := old.sla_paused_at;
    return new;
  end if;

  -- Pause ends: move the targets that were still running by the paused time.
  select window_row.service_hours, window_row.timezone
    into v_service_hours, v_timezone
    from public.ticket_sla_service_window(new.id, new.tenant_id, new.department_id) window_row;
  v_minutes := greatest(
    public.sla_service_minutes_between(old.sla_paused_at, v_now, v_service_hours, v_timezone),
    0);

  if new.first_responded_at is null
     and new.response_due_at is not null
     and new.response_due_at > old.sla_paused_at
     and not exists (
       select 1 from public.ticket_sla_events event
        where event.ticket_id = new.id and event.event_type = 'response_breached'
     ) then
    new.response_due_at := public.sla_extend_due_by_pause(
      new.response_due_at, old.sla_paused_at, v_now, v_minutes,
      v_service_hours, v_timezone);
  end if;

  if new.resolution_due_at is not null
     and new.resolution_due_at > old.sla_paused_at
     and not exists (
       select 1 from public.ticket_sla_events event
        where event.ticket_id = new.id and event.event_type = 'resolution_breached'
     ) then
    new.resolution_due_at := public.sla_extend_due_by_pause(
      new.resolution_due_at, old.sla_paused_at, v_now, v_minutes,
      v_service_hours, v_timezone);
  end if;

  new.sla_paused_service_minutes :=
    coalesce(old.sla_paused_service_minutes, 0) + round(v_minutes, 2);
  new.sla_paused_at := null;
  return new;
end;
$$;
revoke all on function public.tickets_sla_pause_state() from public, anon, authenticated;

create or replace function public.tickets_sla_pause_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_status_label text;
  v_closed boolean := false;
  v_source text := coalesce(nullif(current_setting('nextdesk.sla_pause_source', true), ''), '');
  v_reason text;
  v_payload jsonb;
begin
  if tg_op = 'UPDATE'
     and old.sla_paused_at is not distinct from new.sla_paused_at then
    return null;
  end if;
  if tg_op = 'INSERT' and new.sla_paused_at is null then
    return null;
  end if;

  select status.label, status.is_closed
    into v_status_label, v_closed
    from public.ticket_statuses status
   where status.id = new.status_id;

  if new.sla_paused_at is not null then
    v_reason := case
      when v_source = 'backfill' then 'backfill'
      when tg_op = 'INSERT' or new.status_id is distinct from old.status_id then 'status'
      else 'setting'
    end;
    v_payload := jsonb_build_object(
      'pause', true,
      'reason', v_reason,
      'statusId', new.status_id,
      'statusLabel', v_status_label,
      'pausedAt', new.sla_paused_at,
      'responseDueAt', new.response_due_at,
      'resolutionDueAt', new.resolution_due_at
    );
    insert into public.ticket_sla_events (ticket_id, event_type, occurred_at, metadata)
    values (new.id, 'paused', new.sla_paused_at, v_payload);
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload, created_at)
    values (new.id, null, 'ticket.sla.paused', v_payload,
      case when v_reason = 'backfill' then v_now else new.sla_paused_at end);
    return null;
  end if;

  v_reason := case
    when coalesce(v_closed, false) then 'closed'
    when new.status_id is distinct from old.status_id then 'status'
    else 'setting'
  end;
  v_payload := jsonb_build_object(
    'pause', true,
    'reason', v_reason,
    'statusId', new.status_id,
    'statusLabel', v_status_label,
    'pausedAt', old.sla_paused_at,
    'resumedAt', v_now,
    'pausedServiceMinutes',
      round(coalesce(new.sla_paused_service_minutes, 0)
        - coalesce(old.sla_paused_service_minutes, 0), 2),
    'previousResponseDueAt', old.response_due_at,
    'responseDueAt', new.response_due_at,
    'previousResolutionDueAt', old.resolution_due_at,
    'resolutionDueAt', new.resolution_due_at
  );
  insert into public.ticket_sla_events (ticket_id, event_type, occurred_at, metadata)
  values (new.id, 'resumed', v_now, v_payload);
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (new.id, null, 'ticket.sla.resumed', v_payload);
  return null;
end;
$$;
revoke all on function public.tickets_sla_pause_log() from public, anon, authenticated;

create or replace trigger tickets_sla_pause
  before insert or update of status_id, sla_paused_at on public.tickets
  for each row execute function public.tickets_sla_pause_state();

create or replace trigger tickets_sla_pause_log
  after insert or update of status_id, sla_paused_at on public.tickets
  for each row execute function public.tickets_sla_pause_log();

-- Backfill (see header); keeps tickets.updated_at.
alter table public.tickets disable trigger tickets_updated_at;
select set_config('nextdesk.sla_pause_source', 'backfill', true);
update public.tickets ticket
   set sla_paused_at = least(
         coalesce(ticket.status_changed_at, ticket.waiting_since, timezone('utc', now())),
         timezone('utc', now()))
  from public.ticket_statuses status
 where status.id = ticket.status_id
   and status.pauses_sla
   and not status.is_closed
   and ticket.sla_paused_at is null
   and ticket.closed_at is null
   and (ticket.response_due_at is not null or ticket.resolution_due_at is not null);
select set_config('nextdesk.sla_pause_source', '', true);
alter table public.tickets enable trigger tickets_updated_at;

-- Switching a status' flag (or closing it) pauses/resumes its open tickets.
create or replace function public.ticket_statuses_sla_pause_changed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.tickets ticket
     set sla_paused_at = ticket.sla_paused_at
   where ticket.status_id = new.id
     and ticket.tenant_id = new.tenant_id
     and (
       ticket.sla_paused_at is not null
       or ticket.response_due_at is not null
       or ticket.resolution_due_at is not null
     );
  return null;
end;
$$;
revoke all on function public.ticket_statuses_sla_pause_changed() from public, anon, authenticated;

create or replace trigger ticket_statuses_sla_pause_changed
  after update of pauses_sla, is_closed on public.ticket_statuses
  for each row
  when (old.pauses_sla is distinct from new.pauses_sla
        or old.is_closed is distinct from new.is_closed)
  execute function public.ticket_statuses_sla_pause_changed();

-- SLA automation: paused tickets are never breached while paused.
create or replace function public.list_pending_sla_breaches(
  p_kind text,
  p_limit integer
)
returns table(
  id uuid,
  tenant_id uuid,
  department_id uuid,
  ticket_number text,
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  assigned_agent_id uuid,
  escalation_level smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_kind is null or p_kind not in ('response', 'resolution') then
    raise exception 'unsupported SLA breach kind' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'SLA breach limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  select
    ticket.id,
    ticket.tenant_id,
    ticket.department_id,
    ticket.ticket_number,
    ticket.response_due_at,
    ticket.resolution_due_at,
    ticket.first_responded_at,
    ticket.assigned_agent_id,
    ticket.escalation_level
  from public.tickets as ticket
  join public.tenant_feature_flags as feature
   on feature.tenant_id = ticket.tenant_id
   and feature.feature_key = 'automation.sla'
   and feature.enabled
   and (feature.pilot_ends_at is null or feature.pilot_ends_at > v_now)
  where ticket.closed_at is null
    and ticket.sla_paused_at is null
    and (
      (p_kind = 'response'
        and ticket.first_responded_at is null
        and ticket.response_due_at is not null
        and ticket.response_due_at <= v_now
        and not exists (
          select 1
          from public.ticket_sla_events as event
          where event.ticket_id = ticket.id
            and event.event_type = 'response_breached'
        ))
      or
      (p_kind = 'resolution'
        and ticket.resolution_due_at is not null
        and ticket.resolution_due_at <= v_now
        and not exists (
          select 1
          from public.ticket_sla_events as event
          where event.ticket_id = ticket.id
            and event.event_type = 'resolution_breached'
        ))
    )
  order by
    case when p_kind = 'response' then ticket.response_due_at else ticket.resolution_due_at end asc,
    ticket.id asc
  limit p_limit;
end;
$$;

create or replace function public.apply_sla_breach(
  p_ticket_id uuid,
  p_event_type text,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_occurred_at timestamptz;
  v_feature_enabled boolean;
  v_next_level smallint;
  v_due_at timestamptz;
begin
  if p_event_type is null
     or p_event_type not in ('response_breached', 'resolution_breached') then
    raise exception 'unsupported SLA breach event type';
  end if;

  select *
  into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found or v_ticket.closed_at is not null then
    return false;
  end if;

  -- A paused SLA (waiting status) cannot be breached until it resumes.
  if v_ticket.sla_paused_at is not null then
    return false;
  end if;

  -- Lock the tenant feature row until the breach transaction commits. A feature
  -- disable or pilot expiry can therefore never race the subsequent writes.
  v_occurred_at := clock_timestamp();
  select feature.enabled
    and (feature.pilot_ends_at is null or feature.pilot_ends_at > v_occurred_at)
  into v_feature_enabled
  from public.tenant_feature_flags as feature
  where feature.tenant_id = v_ticket.tenant_id
    and feature.feature_key = 'automation.sla'
  for share;

  if coalesce(v_feature_enabled, false) is not true then
    return false;
  end if;

  if p_event_type = 'response_breached' then
    if v_ticket.first_responded_at is not null
       or v_ticket.response_due_at is null
       or v_ticket.response_due_at > v_occurred_at then
      return false;
    end if;
    v_due_at := v_ticket.response_due_at;
  else
    if v_ticket.resolution_due_at is null
       or v_ticket.resolution_due_at > v_occurred_at then
      return false;
    end if;
    v_due_at := v_ticket.resolution_due_at;
  end if;

  insert into public.ticket_sla_events (
    ticket_id,
    event_type,
    occurred_at,
    metadata
  )
  values (
    v_ticket.id,
    p_event_type,
    v_occurred_at,
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'dueAt', v_due_at
    )
  )
  on conflict do nothing;

  if not found then
    return false;
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    null,
    'ticket.sla.' || p_event_type,
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'dueAt', v_due_at
    )
  );

  if p_event_type = 'resolution_breached' then
    v_next_level := least(v_ticket.escalation_level + 1, 4);

    update public.tickets
    set escalation_level = v_next_level,
        updated_at = v_occurred_at
    where id = v_ticket.id;

    insert into public.ticket_escalations (
      ticket_id,
      level,
      kind,
      reason,
      opened_by,
      opened_at
    )
    values (
      v_ticket.id,
      v_next_level,
      'sla',
      'SLA-Lösungsziel überschritten.',
      null,
      v_occurred_at
    );
  end if;

  if v_ticket.assigned_agent_id is not null then
    insert into public.ticket_notifications (
      tenant_id,
      user_id,
      ticket_id,
      kind,
      payload
    )
    values (
      v_ticket.tenant_id,
      v_ticket.assigned_agent_id,
      v_ticket.id,
      'ticket.sla.' || p_event_type,
      jsonb_build_object(
        'ticketNumber', v_ticket.ticket_number,
        'dueAt', v_due_at,
        'source', 'sla_automation'
      )
    );
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    v_ticket.tenant_id,
    null,
    'ticket.sla.' || p_event_type,
    'ticket',
    v_ticket.id,
    'security',
    jsonb_build_object(
      'source', 'sla_automation',
      'requestId', p_request_id,
      'departmentId', v_ticket.department_id
    )
  );

  return true;
end;
$$;

-- Team-lead alerts: no «SLA in Gefahr» / «ohne Antwort» while paused.
create or replace function public.supervisor_send_ticket_alerts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_ticket record;
  v_supervisor uuid;
  v_sent integer := 0;
  v_agent_name text;
begin
  for v_ticket in
    select ticket.id, ticket.tenant_id, ticket.department_id, ticket.ticket_number,
      ticket.subject, ticket.assigned_agent_id, ticket.resolution_due_at,
      case
        when ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
          then 'sla_risk'
        else 'no_first_response'
      end as alert_kind
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.deleted_at is null
      and not status.is_closed
      and ticket.merged_into_ticket_id is null
      and ticket.sla_paused_at is null
      and (
        (
          ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
        )
        or (
          ticket.first_responded_at is null
          and ticket.created_at > timezone('utc', now()) - interval '14 days'
          and coalesce(
                ticket.response_due_at,
                public.sla_department_due_at(
                  ticket.tenant_id, ticket.department_id, ticket.created_at, 24 * 60
                )
              ) <= timezone('utc', now())
        )
      )
  loop
    insert into public.supervisor_ticket_alerts (tenant_id, ticket_id, kind)
    values (v_ticket.tenant_id, v_ticket.id, v_ticket.alert_kind)
    on conflict do nothing;
    if not found then
      continue;
    end if;
    v_agent_name := null;
    if v_ticket.assigned_agent_id is not null then
      select nullif(btrim(display_name), '') into v_agent_name
      from public.user_profiles where id = v_ticket.assigned_agent_id;
    end if;
    foreach v_supervisor in array public.department_supervisor_ids(v_ticket.tenant_id, v_ticket.department_id)
    loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_ticket.tenant_id, v_supervisor, v_ticket.id,
        case v_ticket.alert_kind
          when 'sla_risk' then 'ticket.sla.supervisor_risk'
          else 'ticket.sla.supervisor_no_response'
        end,
        jsonb_build_object(
          'ticketNumber', v_ticket.ticket_number,
          'subject', v_ticket.subject,
          'agentName', v_agent_name,
          'resolutionDueAt', v_ticket.resolution_due_at,
          'supervisorAlert', true
        )
      );
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$function$;

-- Time rules: «SLA läuft bald ab» does not hold while the SLA is paused.
create or replace function public.ticket_time_condition_holds(
  p_time jsonb,
  p_ticket public.tickets,
  p_status_key text
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_kind text := p_time ->> 'kind';
  v_hours numeric := least(greatest(coalesce((p_time ->> 'hours')::numeric, 0), 0), 24 * 90);
  v_minutes numeric := least(greatest(coalesce((p_time ->> 'minutes')::numeric, 0), 0), 24 * 60 * 30);
  v_now timestamptz := timezone('utc', now());
  v_last_activity timestamptz;
begin
  if v_kind = 'no_reply' then
    if v_hours <= 0 or p_status_key like 'waiting%' then return false; end if;
    select greatest(p_ticket.created_at, max(comment.created_at))
    into v_last_activity
    from public.ticket_comments comment
    where comment.ticket_id = p_ticket.id and comment.visibility = 'external';
    return coalesce(v_last_activity, p_ticket.created_at) < v_now - make_interval(mins => (v_hours * 60)::integer);
  elsif v_kind = 'in_status' then
    if v_hours <= 0 or jsonb_typeof(p_time -> 'statusKeys') <> 'array'
      or not exists (
        select 1 from jsonb_array_elements_text(p_time -> 'statusKeys') key where key = p_status_key
      ) then
      return false;
    end if;
    return coalesce(p_ticket.status_changed_at, p_ticket.updated_at, p_ticket.created_at)
      < v_now - make_interval(mins => (v_hours * 60)::integer);
  elsif v_kind = 'sla_due' then
    return v_minutes > 0
      and p_ticket.resolved_at is null
      and p_ticket.sla_paused_at is null
      and p_ticket.resolution_due_at is not null
      and p_ticket.resolution_due_at > v_now
      and p_ticket.resolution_due_at <= v_now + make_interval(mins => v_minutes::integer);
  elsif v_kind = 'unassigned' then
    return v_hours > 0
      and p_ticket.assigned_agent_id is null
      and p_ticket.created_at < v_now - make_interval(mins => (v_hours * 60)::integer);
  end if;
  return false;
end;
$$;

-- Team overload: paused tickets do not count as past due.
create or replace function public.team_overload_warnings_run()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_supervisor uuid;
  v_count integer := 0;
begin
  for v_row in
    with open_tickets as (
      select ticket.tenant_id, ticket.department_id, ticket.assigned_agent_id as agent_id,
             count(*) as open_count,
             count(*) filter (
               where ticket.resolution_due_at is not null
                 and ticket.resolution_due_at < timezone('utc', now())
                 and ticket.sla_paused_at is null
             ) as overdue_count
      from public.tickets ticket
      join public.ticket_statuses status
        on status.id = ticket.status_id and not status.is_closed
      where ticket.assigned_agent_id is not null
        and ticket.department_id is not null
        and ticket.merged_into_ticket_id is null
      group by ticket.tenant_id, ticket.department_id, ticket.assigned_agent_id
    ),
    -- Average over everyone in the department, including people without
    -- tickets, so a single person carrying the whole queue is recognised.
    averages as (
      select open_tickets.tenant_id, open_tickets.department_id,
             sum(open_tickets.open_count)::numeric / greatest(
               count(*),
               (
                 select count(*) from public.department_memberships member
                 where member.department_id = open_tickets.department_id
                   and member.status = 'active'
               )
             ) as average_open
      from open_tickets
      group by open_tickets.tenant_id, open_tickets.department_id
    )
    select open_tickets.*, round(averages.average_open, 1) as average_open,
           coalesce(nullif(btrim(profile.display_name), ''), 'Ein Teammitglied') as agent_name,
           department.name as department_name
    from open_tickets
    join averages using (tenant_id, department_id)
    join public.departments department
      on department.id = open_tickets.department_id and department.active
    left join public.user_profiles profile on profile.id = open_tickets.agent_id
    where (
        open_tickets.open_count >= 6
        and open_tickets.open_count >= averages.average_open * 1.5
      )
      or open_tickets.open_count >= 12
      or open_tickets.overdue_count >= 3
    limit 500
  loop
    if exists (
      select 1 from public.team_overload_notices notice
      where notice.tenant_id = v_row.tenant_id
        and notice.department_id = v_row.department_id
        and notice.agent_id = v_row.agent_id
        and notice.sent_at > timezone('utc', now()) - interval '3 days'
    ) then
      continue;
    end if;
    insert into public.team_overload_notices (tenant_id, department_id, agent_id)
    values (v_row.tenant_id, v_row.department_id, v_row.agent_id);
    foreach v_supervisor in array
      public.department_supervisor_ids(v_row.tenant_id, v_row.department_id)
    loop
      if v_supervisor = v_row.agent_id then
        continue;
      end if;
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_row.tenant_id, v_supervisor, null, 'team.overload',
        jsonb_build_object(
          'agentId', v_row.agent_id,
          'agentName', v_row.agent_name,
          'departmentId', v_row.department_id,
          'departmentName', v_row.department_name,
          'openTickets', v_row.open_count,
          'overdueTickets', v_row.overdue_count,
          'averageOpen', v_row.average_open
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';

commit;
