-- nextDesk-eigene Überwachung (Etappe 1): Sensoren je Gerät, gemessen von der
-- Sonde vor Ort (tools/ipam-agent: Ping, TCP-Port, HTTP). Die Sonde meldet
-- Messresultate an die Edge Function ipam-agent; ein Zustandswechsel läuft
-- durch dieselbe Störungslogik wie eine PRTG-Meldung (monitoring-webhook
-- processEvent), also Störung je Gerät, Alarmteam, Wiederalarmierung,
-- Folgestörungen und Wartungsunterdrückung.
--
-- Messwerte: roh in monitoring_samples (Standard 7 Tage), verdichtet je
-- Stunde (Standard 90 Tage) und je Tag (unbegrenzt). Ohne Verdichtung wüchse
-- die Tabelle bei einem Sensor im Minutentakt um 1440 Zeilen pro Tag.

insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'monitoring.native',
  'Überwachung',
  'Geräte mit eigenen Sensoren überwachen (Ping, Port, HTTP) und bei Ausfall eine Störung öffnen.',
  'assets',
  false
)
on conflict (key) do nothing;

-- Aufbewahrung je Mandant (bei den bestehenden Monitoring-Einstellungen).
alter table public.monitoring_integrations
  add column if not exists sample_retention_days integer not null default 7
    check (sample_retention_days between 1 and 90),
  add column if not exists hourly_retention_days integer not null default 90
    check (hourly_retention_days between 7 and 730);

-- Verlaufseintrag eines eigenen Sensors (neben «prtg»).
alter table public.monitoring_incident_events
  drop constraint if exists monitoring_incident_events_kind_check;
alter table public.monitoring_incident_events
  add constraint monitoring_incident_events_kind_check check (kind = any (array[
    'prtg', 'opened', 'reopened', 'resolved', 'closed', 'acknowledged',
    'assigned', 'note', 'realert', 'child', 'maintenance', 'external', 'sensor'
  ]));

create table if not exists public.monitoring_sensors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  -- Sonde, die misst. Ohne Sonde wird der Sensor nicht gemessen.
  agent_id uuid references public.ipam_agents(id) on delete set null,
  kind text not null check (kind in ('ping', 'tcp', 'http')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Abweichendes Ziel; sonst IP-Adresse bzw. Hostname des Geräts.
  target text check (target is null or char_length(target) between 1 and 253),
  port integer check (port is null or port between 1 and 65535),
  url text check (url is null or (char_length(url) <= 500 and url ~* '^https?://')),
  interval_seconds integer not null default 60 check (interval_seconds between 30 and 86400),
  timeout_ms integer not null default 5000 check (timeout_ms between 500 and 30000),
  -- Warnung, wenn der Messwert (Antwortzeit in ms) darüber liegt.
  warning_above double precision check (warning_above is null or warning_above > 0),
  -- Ausfall erst nach so vielen Fehlversuchen in Folge.
  failures_to_down integer not null default 2 check (failures_to_down between 1 and 10),
  paused boolean not null default false,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_sensors_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint monitoring_sensors_kind_fields check (
    (kind = 'ping' and port is null and url is null)
    or (kind = 'tcp' and port is not null and url is null)
    or (kind = 'http' and url is not null and port is null)
  )
);
create index if not exists monitoring_sensors_tenant_asset_idx
  on public.monitoring_sensors (tenant_id, asset_id);
create index if not exists monitoring_sensors_agent_idx
  on public.monitoring_sensors (agent_id) where agent_id is not null;

-- Aktueller Zustand je Sensor (eine Zeile, laufend überschrieben).
create table if not exists public.monitoring_sensor_status (
  sensor_id uuid primary key references public.monitoring_sensors(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null default 'unknown' check (state in ('unknown', 'up', 'warning', 'down')),
  since timestamptz,
  last_check_at timestamptz,
  last_ok boolean,
  last_value double precision,
  last_message text check (last_message is null or char_length(last_message) <= 500),
  consecutive_failures integer not null default 0
);
create index if not exists monitoring_sensor_status_tenant_idx
  on public.monitoring_sensor_status (tenant_id, state);

-- Rohmesswerte. Bewusst schmal (kein tenant_id, ein Index): das ist die
-- Tabelle mit den meisten Zeilen.
create table if not exists public.monitoring_samples (
  sensor_id uuid not null references public.monitoring_sensors(id) on delete cascade,
  at timestamptz not null,
  ok boolean not null,
  value real,
  primary key (sensor_id, at)
);
create index if not exists monitoring_samples_at_brin
  on public.monitoring_samples using brin (at);

create table if not exists public.monitoring_samples_hourly (
  sensor_id uuid not null references public.monitoring_sensors(id) on delete cascade,
  bucket timestamptz not null,
  checks integer not null,
  checks_ok integer not null,
  value_avg real,
  value_min real,
  value_max real,
  primary key (sensor_id, bucket)
);

create table if not exists public.monitoring_samples_daily (
  sensor_id uuid not null references public.monitoring_sensors(id) on delete cascade,
  bucket date not null,
  checks integer not null,
  checks_ok integer not null,
  value_avg real,
  value_min real,
  value_max real,
  primary key (sensor_id, bucket)
);

alter table public.monitoring_sensors enable row level security;
alter table public.monitoring_sensor_status enable row level security;
alter table public.monitoring_samples enable row level security;
alter table public.monitoring_samples_hourly enable row level security;
alter table public.monitoring_samples_daily enable row level security;
revoke all on public.monitoring_sensors from public, anon, authenticated;
revoke all on public.monitoring_sensor_status from public, anon, authenticated;
revoke all on public.monitoring_samples from public, anon, authenticated;
revoke all on public.monitoring_samples_hourly from public, anon, authenticated;
revoke all on public.monitoring_samples_daily from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_sensors to service_role;
grant select, insert, update, delete on public.monitoring_sensor_status to service_role;
grant select, insert, update, delete on public.monitoring_samples to service_role;
grant select, insert, update, delete on public.monitoring_samples_hourly to service_role;
grant select, insert, update, delete on public.monitoring_samples_daily to service_role;

-- ---------------------------------------------------------------------------
-- Gerät eines Sensors im Format von monitoring_resolve_device (das Asset ist
-- bekannt, es muss nicht über Host oder Name gesucht werden).

create or replace function public.monitoring_resolve_asset(p_tenant_id uuid, p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'assetId', asset.id,
    'name', asset.name,
    'hostname', infra.hostname,
    'ipAddress', infra.ip_address,
    'prtgObjectId', infra.prtg_object_id,
    'serviceIds', to_jsonb(public.monitoring_asset_service_ids(p_tenant_id, asset.id)),
    'uplinks', to_jsonb(public.monitoring_uplink_chain(p_tenant_id, asset.id, 20))
  )
  from public.assets asset
  left join public.asset_infrastructure infra
    on infra.asset_id = asset.id and infra.tenant_id = asset.tenant_id
  where asset.id = p_asset_id and asset.tenant_id = p_tenant_id;
$$;
revoke all on function public.monitoring_resolve_asset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_resolve_asset(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Prüfaufträge einer Sonde (Antwort auf «hello»). Ziel ist das abweichende
-- Ziel des Sensors, sonst IP-Adresse bzw. Hostname des Geräts.

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
revoke all on function public.monitoring_agent_checks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_agent_checks(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Messresultate einer Sonde übernehmen: Rohwert speichern, Zustand je Sensor
-- nachführen und die Zustandswechsel zurückgeben (die Edge Function öffnet
-- bzw. beendet daraus die Störung).
--
-- p_results: [{ "id": uuid, "at": timestamptz, "ok": bool, "value": number|null,
--               "message": text|null }]

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
  v_now timestamptz := timezone('utc', now());
  v_transitions jsonb := '[]'::jsonb;
  v_accepted integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    return jsonb_build_object('accepted', 0, 'transitions', v_transitions);
  end if;
  for v_item in
    select sensor.id, sensor.name, sensor.asset_id, sensor.kind,
           sensor.warning_above, sensor.failures_to_down,
           item.at, item.ok, item.value, left(item.message, 500) as message
    from jsonb_to_recordset(p_results)
      as item(id uuid, at timestamptz, ok boolean, value double precision, message text)
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

    insert into public.monitoring_samples (sensor_id, at, ok, value)
    values (v_item.id, v_item.at, v_item.ok, v_item.value)
    on conflict do nothing;
    v_accepted := v_accepted + 1;

    if v_item.ok then
      v_failures := 0;
      v_state := case
        when v_item.warning_above is not null
          and v_item.value is not null
          and v_item.value > v_item.warning_above then 'warning'
        else 'up' end;
    else
      v_failures := coalesce(v_status.consecutive_failures, 0) + 1;
      v_state := case
        when v_failures >= v_item.failures_to_down then 'down'
        else coalesce(v_status.state, 'unknown') end;
    end if;

    insert into public.monitoring_sensor_status as status (
      sensor_id, tenant_id, state, since, last_check_at, last_ok, last_value,
      last_message, consecutive_failures
    )
    values (
      v_item.id, p_tenant_id, v_state, v_item.at, v_item.at, v_item.ok, v_item.value,
      v_item.message, v_failures
    )
    on conflict (sensor_id) do update
      set state = excluded.state,
          since = case when status.state is distinct from excluded.state
                       then excluded.since else status.since end,
          last_check_at = excluded.last_check_at,
          last_ok = excluded.last_ok,
          last_value = excluded.last_value,
          last_message = excluded.last_message,
          consecutive_failures = excluded.consecutive_failures;

    if v_state is distinct from coalesce(v_status.state, 'unknown') then
      v_transitions := v_transitions || jsonb_build_object(
        'sensorId', v_item.id,
        'sensorName', v_item.name,
        'assetId', v_item.asset_id,
        'kind', v_item.kind,
        'from', coalesce(v_status.state, 'unknown'),
        'to', v_state,
        'at', v_item.at,
        'value', v_item.value,
        'message', v_item.message
      );
    end if;
  end loop;
  return jsonb_build_object('accepted', v_accepted, 'transitions', v_transitions);
end;
$$;
revoke all on function public.monitoring_ingest_results(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.monitoring_ingest_results(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Verdichten und Aufräumen (stündlich). Die letzten sechs vollen Stunden und
-- drei vollen Tage werden jedes Mal neu gerechnet, damit verspätete Meldungen
-- einer Sonde noch einfliessen.

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
    sensor_id, bucket, checks, checks_ok, value_avg, value_min, value_max
  )
  select sample.sensor_id,
         date_trunc('hour', sample.at at time zone 'utc') at time zone 'utc',
         count(*),
         count(*) filter (where sample.ok),
         avg(sample.value),
         min(sample.value),
         max(sample.value)
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
        value_max = excluded.value_max;
  get diagnostics v_hourly = row_count;

  insert into public.monitoring_samples_daily as daily (
    sensor_id, bucket, checks, checks_ok, value_avg, value_min, value_max
  )
  select hourly.sensor_id,
         (hourly.bucket at time zone 'utc')::date,
         sum(hourly.checks),
         sum(hourly.checks_ok),
         sum(hourly.value_avg * hourly.checks) filter (where hourly.value_avg is not null)
           / nullif(sum(hourly.checks) filter (where hourly.value_avg is not null), 0),
         min(hourly.value_min),
         max(hourly.value_max)
    from public.monitoring_samples_hourly hourly
   where hourly.bucket >= (v_day - 3)::timestamp at time zone 'utc'
     and hourly.bucket < v_day::timestamp at time zone 'utc'
   group by 1, 2
  on conflict (sensor_id, bucket) do update
    set checks = excluded.checks,
        checks_ok = excluded.checks_ok,
        value_avg = excluded.value_avg,
        value_min = excluded.value_min,
        value_max = excluded.value_max;
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
revoke all on function public.monitoring_rollup_samples() from public, anon, authenticated;
grant execute on function public.monitoring_rollup_samples() to service_role;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-monitoring-rollup');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-monitoring-rollup',
    '7 * * * *',
    'select public.monitoring_rollup_samples();'
  );
exception when others then
  null;
end;
$$;
