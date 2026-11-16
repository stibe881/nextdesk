-- Überwachung, Etappe 2:
--   1. SNMP-Sensoren: Laufzeit, Port-Traffic (ein/aus in bit/s, Port-Status)
--      und frei wählbare OID mit Faktor, Einheit und Schwellen nach oben und
--      unten. Die SNMP-Zugangsdaten bleiben in der config.json der Sonde.
--   2. Zweiter Messwert je Messung (ausgehender Traffic).
--   3. Auftrag «snmp_interfaces»: Die Sonde liest die Ports eines Geräts aus,
--      damit Traffic-Sensoren ohne Abtippen der Port-Nummern angelegt werden.
--   4. Wächter: Meldet sich eine Sonde mit Sensoren fünf Minuten nicht, öffnet
--      nextDesk eine Störung (über die Edge Function ipam-agent, damit die
--      gleiche Störungslogik gilt).

alter table public.monitoring_sensors
  drop constraint if exists monitoring_sensors_kind_check,
  drop constraint if exists monitoring_sensors_kind_fields;

alter table public.monitoring_sensors
  add column if not exists snmp_metric text
    check (snmp_metric is null or snmp_metric in ('uptime', 'traffic', 'value')),
  add column if not exists snmp_oid text
    check (snmp_oid is null or snmp_oid ~ '^1(\.[0-9]{1,10}){2,60}$'),
  add column if not exists snmp_index integer
    check (snmp_index is null or snmp_index between 1 and 2147483647),
  add column if not exists scale double precision not null default 1
    check (scale > 0 and scale <= 1e12),
  add column if not exists unit text
    check (unit is null or char_length(unit) between 1 and 12),
  add column if not exists warning_below double precision,
  add column if not exists down_above double precision,
  add column if not exists down_below double precision;

alter table public.monitoring_sensors
  add constraint monitoring_sensors_kind_check
    check (kind in ('ping', 'tcp', 'http', 'snmp')),
  add constraint monitoring_sensors_kind_fields check (
    (kind = 'ping' and port is null and url is null and snmp_metric is null)
    or (kind = 'tcp' and port is not null and url is null and snmp_metric is null)
    or (kind = 'http' and url is not null and port is null and snmp_metric is null)
    or (kind = 'snmp' and port is null and url is null and (
      (snmp_metric = 'uptime' and snmp_oid is null and snmp_index is null)
      or (snmp_metric = 'traffic' and snmp_oid is null and snmp_index is not null)
      or (snmp_metric = 'value' and snmp_oid is not null and snmp_index is null)
    ))
  );

alter table public.monitoring_sensor_status
  add column if not exists last_value2 double precision;
alter table public.monitoring_samples
  add column if not exists value2 real;
alter table public.monitoring_samples_hourly
  add column if not exists value2_avg real,
  add column if not exists value2_min real,
  add column if not exists value2_max real;
alter table public.monitoring_samples_daily
  add column if not exists value2_avg real,
  add column if not exists value2_min real,
  add column if not exists value2_max real;

-- ---------------------------------------------------------------------------
-- Prüfaufträge inkl. SNMP-Angaben.

create or replace function public.monitoring_agent_checks(p_tenant_id uuid, p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sensor.id,
    'kind', sensor.kind,
    'host', coalesce(
      nullif(btrim(sensor.target), ''),
      nullif(btrim(infra.ip_address), ''),
      nullif(btrim(infra.hostname), '')
    ),
    'port', sensor.port,
    'url', sensor.url,
    'snmpMetric', sensor.snmp_metric,
    'snmpOid', sensor.snmp_oid,
    'snmpIndex', sensor.snmp_index,
    'scale', sensor.scale,
    'intervalSeconds', sensor.interval_seconds,
    'timeoutMs', sensor.timeout_ms
  ) order by sensor.id), '[]'::jsonb)
  from public.monitoring_sensors sensor
  left join public.asset_infrastructure infra
    on infra.asset_id = sensor.asset_id and infra.tenant_id = sensor.tenant_id
  where sensor.tenant_id = p_tenant_id
    and sensor.agent_id = p_agent_id
    and not sensor.paused;
$$;

-- ---------------------------------------------------------------------------
-- Resultate übernehmen: zweiter Messwert, Schwellen nach oben und unten.
-- Ein Wert jenseits der Ausfall-Schwelle zählt wie ein Fehlversuch.

create or replace function public.monitoring_ingest_results(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item record;
  v_status public.monitoring_sensor_status%rowtype;
  v_state text;
  v_failures integer;
  v_failed boolean;
  v_message text;
  v_now timestamptz := timezone('utc', now());
  v_transitions jsonb := '[]'::jsonb;
  v_accepted integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    return jsonb_build_object('accepted', 0, 'transitions', v_transitions);
  end if;
  for v_item in
    select sensor.id, sensor.name, sensor.asset_id, sensor.kind, sensor.unit,
           sensor.warning_above, sensor.warning_below, sensor.down_above, sensor.down_below,
           sensor.failures_to_down,
           item.at, item.ok, item.value, item.value2, left(item.message, 500) as message
    from jsonb_to_recordset(p_results)
      as item(id uuid, at timestamptz, ok boolean, value double precision,
              value2 double precision, message text)
    join public.monitoring_sensors sensor
      on sensor.id = item.id
     and sensor.tenant_id = p_tenant_id
     and sensor.agent_id = p_agent_id
     and not sensor.paused
    where item.at is not null
      and item.ok is not null
      and item.at <= v_now + interval '5 minutes'
      and item.at > v_now - interval '1 day'
    order by item.at
  loop
    select * into v_status
      from public.monitoring_sensor_status
     where sensor_id = v_item.id
       for update;
    -- Ältere oder doppelte Meldungen ändern den Zustand nicht.
    if found and v_status.last_check_at is not null and v_item.at <= v_status.last_check_at then
      continue;
    end if;

    insert into public.monitoring_samples (sensor_id, at, ok, value, value2)
    values (v_item.id, v_item.at, v_item.ok, v_item.value, v_item.value2)
    on conflict do nothing;
    v_accepted := v_accepted + 1;

    v_message := v_item.message;
    v_failed := not v_item.ok;
    if v_item.ok and v_item.value is not null then
      if v_item.down_above is not null and v_item.value > v_item.down_above then
        v_failed := true;
        v_message := 'Wert über der Ausfall-Schwelle';
      elsif v_item.down_below is not null and v_item.value < v_item.down_below then
        v_failed := true;
        v_message := 'Wert unter der Ausfall-Schwelle';
      end if;
    end if;

    if v_failed then
      v_failures := coalesce(v_status.consecutive_failures, 0) + 1;
      v_state := case
        when v_failures >= v_item.failures_to_down then 'down'
        else coalesce(v_status.state, 'unknown') end;
    else
      v_failures := 0;
      v_state := 'up';
      if v_item.value is not null then
        if v_item.warning_above is not null and v_item.value > v_item.warning_above then
          v_state := 'warning';
          v_message := coalesce(v_message, 'Wert über der Warnschwelle');
        elsif v_item.warning_below is not null and v_item.value < v_item.warning_below then
          v_state := 'warning';
          v_message := coalesce(v_message, 'Wert unter der Warnschwelle');
        end if;
      end if;
    end if;

    insert into public.monitoring_sensor_status as status (
      sensor_id, tenant_id, state, since, last_check_at, last_ok, last_value, last_value2,
      last_message, consecutive_failures
    )
    values (
      v_item.id, p_tenant_id, v_state, v_item.at, v_item.at, not v_failed, v_item.value,
      v_item.value2, v_message, v_failures
    )
    on conflict (sensor_id) do update
      set state = excluded.state,
          since = case when status.state is distinct from excluded.state
                       then excluded.since else status.since end,
          last_check_at = excluded.last_check_at,
          last_ok = excluded.last_ok,
          last_value = excluded.last_value,
          last_value2 = excluded.last_value2,
          last_message = excluded.last_message,
          consecutive_failures = excluded.consecutive_failures;

    if v_state is distinct from coalesce(v_status.state, 'unknown') then
      v_transitions := v_transitions || jsonb_build_object(
        'sensorId', v_item.id,
        'sensorName', v_item.name,
        'assetId', v_item.asset_id,
        'kind', v_item.kind,
        'unit', v_item.unit,
        'from', coalesce(v_status.state, 'unknown'),
        'to', v_state,
        'at', v_item.at,
        'value', v_item.value,
        'message', v_message
      );
    end if;
  end loop;
  return jsonb_build_object('accepted', v_accepted, 'transitions', v_transitions);
end;
$$;

-- ---------------------------------------------------------------------------
-- Verdichtung mit zweitem Messwert.

create or replace function public.monitoring_rollup_samples()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hour timestamptz := date_trunc('hour', timezone('utc', now()));
  v_day date := (timezone('utc', now()))::date;
  v_tenant record;
  v_hourly integer := 0;
  v_daily integer := 0;
  v_deleted integer := 0;
  v_rows integer;
begin
  insert into public.monitoring_samples_hourly as hourly (
    sensor_id, bucket, checks, checks_ok, value_avg, value_min, value_max,
    value2_avg, value2_min, value2_max
  )
  select sample.sensor_id,
         date_trunc('hour', sample.at at time zone 'utc') at time zone 'utc',
         count(*),
         count(*) filter (where sample.ok),
         avg(sample.value), min(sample.value), max(sample.value),
         avg(sample.value2), min(sample.value2), max(sample.value2)
    from public.monitoring_sensors sensor
    join public.monitoring_samples sample
      on sample.sensor_id = sensor.id
     and sample.at >= v_hour - interval '6 hours'
     and sample.at < v_hour
   group by 1, 2
  on conflict (sensor_id, bucket) do update
    set checks = excluded.checks,
        checks_ok = excluded.checks_ok,
        value_avg = excluded.value_avg,
        value_min = excluded.value_min,
        value_max = excluded.value_max,
        value2_avg = excluded.value2_avg,
        value2_min = excluded.value2_min,
        value2_max = excluded.value2_max;
  get diagnostics v_hourly = row_count;

  insert into public.monitoring_samples_daily as daily (
    sensor_id, bucket, checks, checks_ok, value_avg, value_min, value_max,
    value2_avg, value2_min, value2_max
  )
  select hourly.sensor_id,
         (hourly.bucket at time zone 'utc')::date,
         sum(hourly.checks),
         sum(hourly.checks_ok),
         sum(hourly.value_avg * hourly.checks) filter (where hourly.value_avg is not null)
           / nullif(sum(hourly.checks) filter (where hourly.value_avg is not null), 0),
         min(hourly.value_min),
         max(hourly.value_max),
         sum(hourly.value2_avg * hourly.checks) filter (where hourly.value2_avg is not null)
           / nullif(sum(hourly.checks) filter (where hourly.value2_avg is not null), 0),
         min(hourly.value2_min),
         max(hourly.value2_max)
    from public.monitoring_samples_hourly hourly
   where hourly.bucket >= (v_day - 3)::timestamp at time zone 'utc'
     and hourly.bucket < v_day::timestamp at time zone 'utc'
   group by 1, 2
  on conflict (sensor_id, bucket) do update
    set checks = excluded.checks,
        checks_ok = excluded.checks_ok,
        value_avg = excluded.value_avg,
        value_min = excluded.value_min,
        value_max = excluded.value_max,
        value2_avg = excluded.value2_avg,
        value2_min = excluded.value2_min,
        value2_max = excluded.value2_max;
  get diagnostics v_daily = row_count;

  for v_tenant in
    select sensor.tenant_id,
           coalesce(max(integration.sample_retention_days), 7) as raw_days,
           coalesce(max(integration.hourly_retention_days), 90) as hourly_days
      from public.monitoring_sensors sensor
      left join public.monitoring_integrations integration
        on integration.tenant_id = sensor.tenant_id
     group by sensor.tenant_id
  loop
    delete from public.monitoring_samples sample
     using public.monitoring_sensors sensor
     where sensor.tenant_id = v_tenant.tenant_id
       and sample.sensor_id = sensor.id
       and sample.at < v_hour - make_interval(days => v_tenant.raw_days);
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;
    delete from public.monitoring_samples_hourly hourly
     using public.monitoring_sensors sensor
     where sensor.tenant_id = v_tenant.tenant_id
       and hourly.sensor_id = sensor.id
       and hourly.bucket < v_hour - make_interval(days => v_tenant.hourly_days);
  end loop;

  return jsonb_build_object('hourly', v_hourly, 'daily', v_daily, 'deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Auftrag «snmp_interfaces» (nur lesend, braucht keine Freigabe).

alter table public.ipam_agent_jobs
  drop constraint if exists ipam_agent_jobs_kind_check,
  drop constraint if exists ipam_agent_jobs_write_approved;
alter table public.ipam_agent_jobs
  add constraint ipam_agent_jobs_kind_check check (kind in (
    'scan_now', 'dhcp_reserve', 'dhcp_release', 'dns_upsert_a', 'dns_upsert_ptr', 'dns_delete',
    'snmp_interfaces'
  )),
  add constraint ipam_agent_jobs_write_approved check (
    kind in ('scan_now', 'snmp_interfaces')
    or status in ('pending_approval', 'cancelled')
    or approved_at is not null
  );

-- ---------------------------------------------------------------------------
-- Wächter für Sonden.
--
-- «down»: aktive Sonde mit Sensoren, seit fünf Minuten keine Meldung (bzw.
-- nie gemeldet und vor über 15 Minuten angelegt), noch kein offener Alarm.
-- «up»: offener Alarm, die Sonde meldet sich wieder (oder hat keine Sensoren
-- mehr, ist deaktiviert oder widerrufen).

create or replace function public.monitoring_probe_watchdog_due()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with probe as (
    select agent.id, agent.tenant_id, agent.name, agent.last_seen_at,
           (select count(*) from public.monitoring_sensors sensor
             where sensor.agent_id = agent.id and not sensor.paused) as sensors,
           agent.status = 'active' and (
             agent.last_seen_at < timezone('utc', now()) - interval '5 minutes'
             or (agent.last_seen_at is null
                 and agent.created_at < timezone('utc', now()) - interval '15 minutes')
           ) as silent,
           exists (
             select 1 from public.monitoring_alerts alert
              where alert.tenant_id = agent.tenant_id
                and alert.external_key = 'nd:probe:' || agent.id::text
                and alert.state = 'open'
           ) as alarmed
      from public.ipam_agents agent
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'agentId', probe.id,
    'tenantId', probe.tenant_id,
    'name', probe.name,
    'lastSeenAt', probe.last_seen_at,
    'sensors', probe.sensors,
    'action', case when probe.alarmed then 'up' else 'down' end
  )), '[]'::jsonb)
  from probe
  where (probe.silent and probe.sensors > 0 and not probe.alarmed)
     or (probe.alarmed and not (probe.silent and probe.sensors > 0));
$$;
revoke all on function public.monitoring_probe_watchdog_due() from public, anon, authenticated;
grant execute on function public.monitoring_probe_watchdog_due() to service_role;

-- Weckt die Edge Function nur, wenn es etwas zu tun gibt.
create or replace function public.monitoring_probe_watchdog_wake()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, monitoring_automation_private, pg_temp
as $$
declare
  v_base text;
  v_secret text;
begin
  if jsonb_array_length(public.monitoring_probe_watchdog_due()) = 0 then
    return;
  end if;
  select config.functions_base_url, config.dispatch_secret into v_base, v_secret
    from monitoring_automation_private.dispatch_config config where config.singleton;
  if v_base is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using rtrim(v_base, '/') || '/ipam-agent',
          jsonb_build_object('type', 'cron', 'task', 'probeWatchdog'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          30000;
exception when others then
  return;
end;
$$;
revoke all on function public.monitoring_probe_watchdog_wake() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-monitoring-probe-watchdog');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-monitoring-probe-watchdog',
    '* * * * *',
    'select public.monitoring_probe_watchdog_wake();'
  );
exception when others then
  null;
end;
$$;
