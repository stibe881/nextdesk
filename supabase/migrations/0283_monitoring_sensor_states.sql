-- PRTG sends bursts of messages (hundreds within minutes). The webhook
-- handles them in parallel, so an «OK» could be handled before the «Fehler»
-- it answers and got lost; incidents then stayed active and kept alarming.
--
-- * monitoring_sensor_states: the latest message per sensor, by the time it
--   was received. Older messages that are handled later are ignored, and a
--   «Fehler» checks afterwards whether an «OK» arrived in the meantime.
-- * monitoring_reconcile_incidents(): closes active incidents without open
--   sensors (safety net, runs every minute before the re-alerting).

create table if not exists public.monitoring_sensor_states (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_key text not null check (char_length(external_key) between 1 and 300),
  kind text not null check (kind in ('down', 'warning', 'up', 'paused')),
  status text check (status is null or char_length(status) <= 120),
  received_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, external_key)
);

alter table public.monitoring_sensor_states enable row level security;
revoke all on public.monitoring_sensor_states from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_sensor_states to service_role;

-- Records a message; returns true if it is the newest one for this sensor.
create or replace function public.monitoring_record_sensor_state(
  p_tenant_id uuid,
  p_external_key text,
  p_kind text,
  p_status text,
  p_received_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows integer;
begin
  insert into public.monitoring_sensor_states as state (
    tenant_id, external_key, kind, status, received_at
  )
  values (p_tenant_id, p_external_key, p_kind, left(p_status, 120), p_received_at)
  on conflict (tenant_id, external_key) do update
     set kind = excluded.kind,
         status = excluded.status,
         received_at = excluded.received_at,
         updated_at = timezone('utc', now())
   where state.received_at <= excluded.received_at;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.monitoring_record_sensor_state(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.monitoring_record_sensor_state(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.monitoring_reconcile_incidents()
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
    where incident.state = 'active'
      and incident.last_event_at < timezone('utc', now()) - interval '2 minutes'
      and not exists (
        select 1 from public.monitoring_alerts alert
        where alert.incident_id = incident.id and alert.state = 'open'
      )
      and not exists (
        select 1 from public.monitoring_incidents child
        where child.parent_incident_id = incident.id and child.state = 'active'
      )
    limit 200
  loop
    update public.monitoring_incidents
       set state = 'closed',
           resolved_at = coalesce(resolved_at, timezone('utc', now())),
           closed_at = timezone('utc', now()),
           closing_note = 'Automatisch abgeschlossen: PRTG meldet wieder OK.'
     where id = v_incident.id and state = 'active';
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'resolved',
            'Alle Sensoren sind wieder OK. Störung automatisch abgeschlossen.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_reconcile_incidents() from public, anon, authenticated;

-- Re-alerting first tidies up, so nobody is alarmed for a finished incident.
do $$
declare
  v_def text;
  v_old text := E'begin\n  for v_incident in';
begin
  select pg_get_functiondef('public.monitoring_realert_due()'::regprocedure) into v_def;
  if position('monitoring_reconcile_incidents' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'monitoring_realert_due: anchor not found';
  end if;
  execute replace(
    v_def,
    v_old,
    E'begin\n  perform public.monitoring_reconcile_incidents();\n  for v_incident in'
  );
end;
$$;
