-- «Störungen»: PRTG messages become incidents instead of tickets.
--
-- * monitoring_incidents: one incident per device (all sensors of a device),
--   active → resolved (PRTG back to OK) → closed (by an agent, with cause).
--   Devices behind a failed device (uplinks in the infrastructure) become
--   follow-up incidents of it (parent_incident_id) and do not alert.
-- * monitoring_incident_events: history (PRTG messages, acknowledged, notes …).
-- * monitoring_alerts (one per sensor) now point to their incident; no tickets.
-- * Notifications: kind 'monitoring.incident' in the new category 'incident'
--   (push and e-mail), switched on for agents; repeated while nobody has
--   acknowledged the incident (monitoring_integrations.realert_minutes).
-- Access goes through the edge functions (service role).

create table if not exists public.monitoring_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null check (char_length(number) between 3 and 40),
  incident_key text not null check (char_length(incident_key) between 1 and 300),
  asset_id uuid references public.assets(id) on delete set null,
  device_name text check (device_name is null or char_length(device_name) <= 300),
  title text not null check (char_length(title) between 1 and 300),
  severity text not null default 'down' check (severity in ('down', 'warning')),
  state text not null default 'active' check (state in ('active', 'resolved', 'closed')),
  parent_incident_id uuid references public.monitoring_incidents(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  service_ids uuid[] not null default '{}'::uuid[],
  maintenance boolean not null default false,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.user_profiles(id) on delete set null,
  assigned_agent_id uuid references public.user_profiles(id) on delete set null,
  opened_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.user_profiles(id) on delete set null,
  cause text check (cause is null or cause in (
    'power', 'network', 'hardware', 'software', 'maintenance', 'external', 'unknown'
  )),
  closing_note text check (closing_note is null or char_length(closing_note) <= 4000),
  last_event_at timestamptz not null default timezone('utc', now()),
  event_count integer not null default 1 check (event_count >= 1),
  last_alerted_at timestamptz,
  realert_count integer not null default 0 check (realert_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_incidents_number_unique unique (tenant_id, number)
);

-- At most one active incident per device and tenant.
create unique index if not exists monitoring_incidents_active_key_idx
  on public.monitoring_incidents (tenant_id, incident_key)
  where state = 'active';
create index if not exists monitoring_incidents_tenant_state_idx
  on public.monitoring_incidents (tenant_id, state, opened_at desc);
create index if not exists monitoring_incidents_asset_idx
  on public.monitoring_incidents (tenant_id, asset_id, opened_at desc)
  where asset_id is not null;

create table if not exists public.monitoring_incident_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.monitoring_incidents(id) on delete cascade,
  kind text not null check (kind in (
    'prtg', 'opened', 'reopened', 'resolved', 'closed', 'acknowledged',
    'assigned', 'note', 'realert', 'child', 'maintenance'
  )),
  status text check (status is null or char_length(status) <= 120),
  sensor_name text check (sensor_name is null or char_length(sensor_name) <= 300),
  message text check (message is null or char_length(message) <= 4000),
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists monitoring_incident_events_incident_idx
  on public.monitoring_incident_events (incident_id, created_at);

create table if not exists public.monitoring_incident_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  year integer not null,
  last_value integer not null default 0
);

alter table public.monitoring_alerts
  add column if not exists incident_id uuid
    references public.monitoring_incidents(id) on delete set null;
create index if not exists monitoring_alerts_incident_idx
  on public.monitoring_alerts (incident_id)
  where incident_id is not null;

alter table public.monitoring_integrations
  add column if not exists realert_minutes integer not null default 15
    check (realert_minutes between 0 and 1440),
  add column if not exists group_dependencies boolean not null default true,
  add column if not exists suppress_in_maintenance boolean not null default true;

alter table public.monitoring_incidents enable row level security;
alter table public.monitoring_incident_events enable row level security;
alter table public.monitoring_incident_counters enable row level security;
revoke all on public.monitoring_incidents, public.monitoring_incident_events,
  public.monitoring_incident_counters from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_incidents,
  public.monitoring_incident_events, public.monitoring_incident_counters
  to service_role;

create or replace trigger monitoring_incidents_updated_at
  before update on public.monitoring_incidents
  for each row execute function public.set_updated_at();

-- STO-2026-0001, per tenant and year.
create or replace function public.monitoring_next_incident_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_year integer := extract(year from timezone('Europe/Zurich', now()))::integer;
  v_value integer;
begin
  insert into public.monitoring_incident_counters (tenant_id, year, last_value)
  values (p_tenant_id, v_year, 1)
  on conflict (tenant_id) do update
    set last_value = case
          when public.monitoring_incident_counters.year = v_year
            then public.monitoring_incident_counters.last_value + 1
          else 1
        end,
        year = v_year
  returning last_value into v_value;
  return 'STO-' || v_year || '-' || lpad(v_value::text, 4, '0');
end;
$$;
revoke all on function public.monitoring_next_incident_number(uuid) from public, anon, authenticated;
grant execute on function public.monitoring_next_incident_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Notification category 'incident' («Störungen»).

do $$
declare
  v_def text;
begin
  -- Category of the new kind.
  select pg_get_functiondef('public.push_notification_category(text)'::regprocedure) into v_def;
  if position('monitoring.incident' in v_def) = 0 and position('monitoring.%' in v_def) = 0 then
    v_def := replace(
      v_def,
      $a$when p_kind = 'infrastructure.due' then 'infrastructure'$a$,
      $a$when p_kind = 'infrastructure.due' then 'infrastructure'
    when p_kind like 'monitoring.%' then 'incident'$a$
    );
    if position('monitoring.%' in v_def) = 0 then
      raise exception 'push_notification_category: anchor not found';
    end if;
    execute v_def;
  end if;

  -- Delivery modes may name the category.
  select pg_get_functiondef('public.push_delivery_modes_valid(jsonb)'::regprocedure) into v_def;
  if position('''incident''' in v_def) = 0 then
    v_def := replace(v_def, $a$'security_report'$a$, $a$'security_report', 'incident'$a$);
    if position('''incident''' in v_def) = 0 then
      raise exception 'push_delivery_modes_valid: anchor not found';
    end if;
    execute v_def;
  end if;

  -- Queued like infrastructure reminders (mode-only category).
  select pg_get_functiondef('public.push_enqueue_ticket_notification()'::regprocedure) into v_def;
  if position('''incident''' in v_def) = 0 then
    v_def := replace(
      v_def,
      $a$('service_task', 'infrastructure', 'security_report')$a$,
      $a$('service_task', 'infrastructure', 'security_report', 'incident')$a$
    );
    if position('''incident''' in v_def) = 0 then
      raise exception 'push_enqueue_ticket_notification: anchor not found';
    end if;
    execute v_def;
  end if;

  -- Dispatch: incidents have no ticket; delivered unless switched off.
  select pg_get_functiondef('public.push_claim_outbox_v2(integer)'::regprocedure) into v_def;
  if position('monitoring.%' in v_def) = 0 then
    v_def := replace(
      v_def,
      $a$if v_kind like 'shop.order.%' or v_kind like 'service_task.%' then$a$,
      $a$if v_kind like 'shop.order.%' or v_kind like 'service_task.%'
           or v_kind like 'monitoring.%' then$a$
    );
    v_def := replace(
      v_def,
      $a$-- Older stored preferences do not know the category yet: deliver it.$a$,
      $a$-- Older stored preferences do not know the category yet: deliver it.
    if v_category = 'incident'
       and not 'incident' = any(v_enabled_categories)
       and not (v_modes ? 'incident') then
      v_enabled_categories := v_enabled_categories || 'incident'::text;
    end if;$a$
    );
    if position('monitoring.%' in v_def) = 0 or position('v_category = ''incident''' in v_def) = 0 then
      raise exception 'push_claim_outbox_v2: anchor not found';
    end if;
    execute v_def;
  end if;

  -- New agents start with incidents switched on (push and e-mail).
  select pg_get_functiondef('public.agent_notification_defaults_all(uuid,uuid,boolean)'::regprocedure) into v_def;
  if position('''incident''' in v_def) = 0 then
    v_def := replace(
      v_def,
      $a$'inventory_low_stock', 'shop', 'service_task', 'infrastructure'
  ]::text[];$a$,
      $a$'inventory_low_stock', 'shop', 'service_task', 'infrastructure', 'incident'
  ]::text[];$a$
    );
    v_def := replace(
      v_def,
      $a$'inventory_low_stock', 'shop', 'infrastructure'
      ]::text[]) as category$a$,
      $a$'inventory_low_stock', 'shop', 'infrastructure', 'incident'
      ]::text[]) as category$a$
    );
    if (length(v_def) - length(replace(v_def, '''incident''', ''))) / length('''incident''') < 2 then
      raise exception 'agent_notification_defaults_all: anchor not found';
    end if;
    execute v_def;
  end if;
end;
$$;

alter table public.push_preferences
  drop constraint if exists push_preferences_email_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_email_categories_valid check (
    email_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'inventory_low_stock', 'shop', 'service_task', 'infrastructure',
      'security_report', 'incident'
    ]::text[]
    and cardinality(email_categories) <= 20
  );

-- One-off: agents get incident alerts by push and e-mail.
update public.push_preferences preference
   set email_categories = case
         when 'incident' = any(preference.email_categories) then preference.email_categories
         else preference.email_categories || 'incident'::text
       end,
       category_modes = preference.category_modes || jsonb_build_object('incident', 'immediate'),
       updated_at = timezone('utc', now())
 where public.user_is_ticket_agent(preference.tenant_id, preference.user_id);

-- Who is alerted: members of the incident's team, otherwise every agent.
create or replace function public.monitoring_incident_notify(
  p_incident_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident public.monitoring_incidents%rowtype;
  v_count integer := 0;
  v_payload jsonb;
begin
  select * into v_incident from public.monitoring_incidents where id = p_incident_id;
  if not found then
    return 0;
  end if;
  v_payload := jsonb_build_object(
    'incidentId', v_incident.id,
    'number', v_incident.number,
    'title', v_incident.title,
    'deviceName', v_incident.device_name,
    'severity', v_incident.severity,
    'reason', p_reason
  );

  if v_incident.team_id is not null then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select v_incident.tenant_id, member.user_id, null, 'monitoring.incident', v_payload
    from public.team_memberships member
    join public.teams team
      on team.id = member.team_id and team.tenant_id = v_incident.tenant_id and team.active
    join public.tenant_memberships membership
      on membership.tenant_id = v_incident.tenant_id
     and membership.user_id = member.user_id and membership.status = 'active'
    where member.team_id = v_incident.team_id;
    get diagnostics v_count = row_count;
  end if;

  if v_count = 0 then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select v_incident.tenant_id, membership.user_id, null, 'monitoring.incident', v_payload
    from public.tenant_memberships membership
    where membership.tenant_id = v_incident.tenant_id
      and membership.status = 'active'
      and public.user_is_ticket_agent(v_incident.tenant_id, membership.user_id);
    get diagnostics v_count = row_count;
  end if;

  update public.monitoring_incidents
     set last_alerted_at = timezone('utc', now())
   where id = p_incident_id;
  return v_count;
end;
$$;
revoke all on function public.monitoring_incident_notify(uuid, text) from public, anon, authenticated;
grant execute on function public.monitoring_incident_notify(uuid, text) to service_role;

-- Repeat the alert while nobody acknowledged an active incident.
create or replace function public.monitoring_realert_due()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
  v_count integer := 0;
begin
  for v_incident in
    select incident.id, incident.tenant_id
    from public.monitoring_incidents incident
    join public.monitoring_integrations integration
      on integration.tenant_id = incident.tenant_id
    where incident.state = 'active'
      and incident.parent_incident_id is null
      and incident.acknowledged_at is null
      and not incident.maintenance
      and integration.enabled
      and integration.realert_minutes > 0
      and coalesce(incident.last_alerted_at, incident.opened_at)
          < timezone('utc', now()) - make_interval(mins => integration.realert_minutes)
    limit 100
  loop
    perform public.monitoring_incident_notify(v_incident.id, 'realert');
    update public.monitoring_incidents
       set realert_count = realert_count + 1
     where id = v_incident.id;
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'realert',
            'Noch nicht bestätigt: erneut alarmiert.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_realert_due() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('nextdesk-monitoring-realert')
  where exists (select 1 from cron.job where jobname = 'nextdesk-monitoring-realert');
  perform cron.schedule(
    'nextdesk-monitoring-realert',
    '* * * * *',
    'select public.monitoring_realert_due();'
  );
end;
$$;

-- Menu badge: active incidents nobody acknowledged (follow-ups excluded).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.navigation_ticket_attention(uuid)'::regprocedure) into v_def;
  if position('incidentsUnacknowledged' in v_def) > 0 then
    return;
  end if;
  v_def := replace(v_def, $a$  v_security integer := 0;$a$, $a$  v_security integer := 0;
  v_incidents integer := 0;$a$);
  v_def := replace(v_def, $a$  return jsonb_build_object(
    'unassignedTickets', v_unassigned,
    'securityTriage', v_security
  );$a$, $a$  select count(*) into v_incidents
  from public.monitoring_incidents incident
  where incident.tenant_id = p_tenant_id
    and incident.state = 'active'
    and incident.parent_incident_id is null
    and incident.acknowledged_at is null;

  return jsonb_build_object(
    'unassignedTickets', v_unassigned,
    'securityTriage', v_security,
    'incidentsUnacknowledged', v_incidents
  );$a$);
  v_def := replace(v_def, $a$return jsonb_build_object('unassignedTickets', 0, 'securityTriage', 0);$a$,
    $a$return jsonb_build_object('unassignedTickets', 0, 'securityTriage', 0, 'incidentsUnacknowledged', 0);$a$);
  if position('incidentsUnacknowledged'', v_incidents' in v_def) = 0 then
    raise exception 'navigation_ticket_attention: anchor not found';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing data.

-- German PRTG texts «Fehler beendet (jetzt: OK)» were read as a new failure.
update public.monitoring_alerts
   set state = 'resolved', resolved_at = coalesce(resolved_at, last_event_at)
 where state = 'open'
   and (last_status ~* 'beendet' or last_status ~* 'jetzt:\s*ok' or last_status ~* '^up\b');

-- Open alerts become incidents (grouped per device).
do $$
declare
  v_alert record;
  v_incident uuid;
  v_key text;
  v_team uuid;
begin
  for v_alert in
    select alert.*
    from public.monitoring_alerts alert
    where alert.state = 'open' and alert.incident_id is null
    order by alert.opened_at
  loop
    v_key := case
      when v_alert.asset_id is not null then 'asset:' || v_alert.asset_id
      else 'dev:' || lower(coalesce(v_alert.device_name, v_alert.external_key))
    end;
    select id into v_incident
    from public.monitoring_incidents
    where tenant_id = v_alert.tenant_id and incident_key = v_key and state = 'active';
    if v_incident is null then
      select team_id into v_team
      from public.monitoring_integrations where id = v_alert.integration_id;
      insert into public.monitoring_incidents (
        tenant_id, number, incident_key, asset_id, device_name, title, severity,
        team_id, service_ids, opened_at, last_event_at, event_count, last_alerted_at
      ) values (
        v_alert.tenant_id,
        public.monitoring_next_incident_number(v_alert.tenant_id),
        v_key,
        v_alert.asset_id,
        v_alert.device_name,
        left(coalesce(v_alert.device_name, 'Unbekanntes Gerät')
          || coalesce(' – ' || v_alert.sensor_name, ''), 300),
        case when coalesce(v_alert.last_status, '') ~* '^(warn|ungew)' then 'warning' else 'down' end,
        v_team,
        coalesce(v_alert.service_ids, '{}'::uuid[]),
        v_alert.opened_at,
        v_alert.last_event_at,
        v_alert.event_count,
        v_alert.opened_at
      ) returning id into v_incident;
      insert into public.monitoring_incident_events (tenant_id, incident_id, kind, status, sensor_name, message, created_at)
      values (v_alert.tenant_id, v_incident, 'opened', v_alert.last_status, v_alert.sensor_name,
              'Aus bestehender PRTG-Meldung übernommen.', v_alert.opened_at);
    end if;
    update public.monitoring_alerts set incident_id = v_incident where id = v_alert.id;
    v_incident := null;
  end loop;
end;
$$;
