-- Überwachung: Dienste je Sensor und automatische öffentliche Meldung.
--
-- 1. Ein Sensor kann eigene Dienste tragen. Dann wirkt er nur auf diese
--    Dienste statt auf alle Dienste seines Geräts (z. B. «Port 443» → Abacus).
-- 2. Ist es in der Alarmierung eingeschaltet, veröffentlicht eine Störung aus
--    der Überwachung (eigene Sensoren und PRTG) mit betroffenen Diensten ohne
--    Zutun eine Meldung: Banner und Statusseite. Geschlossen wird sie wie jede
--    Meldung einer Störung, sobald die Störung behoben ist (0333).

alter table public.monitoring_sensors
  add column if not exists service_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(service_ids) <= 20);

alter table public.monitoring_integrations
  add column if not exists publish_incidents boolean not null default false,
  -- Wer die automatische Veröffentlichung eingeschaltet hat; in dessen Namen
  -- entstehen die Meldungen (eine Meldung braucht ein Mitglied des Mandanten).
  add column if not exists publish_actor_id uuid references auth.users(id) on delete set null;

comment on column public.monitoring_sensors.service_ids is
  'Services this sensor affects instead of all services of its device. Empty = services of the device.';
comment on column public.monitoring_integrations.publish_incidents is
  'Publish a notice (banner, status page) for incidents from monitoring that affect services.';

-- Veröffentlicht die Meldung zu einer aktiven Störung aus der Überwachung
-- oder ergänzt die bestehende um weitere Dienste. Gibt die Meldung zurück,
-- sonst null (ausgeschaltet, keine Dienste, Wartung, bereits behoben).
create or replace function public.monitoring_incident_publish(
  p_incident_id uuid,
  p_service_ids uuid[],
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_incident record;
  v_settings record;
  v_notice record;
  v_services uuid[];
  v_body text;
begin
  select incident.id, incident.tenant_id, incident.title, incident.maintenance
    into v_incident
    from public.monitoring_incidents incident
   where incident.id = p_incident_id
     and incident.source <> 'external'
     and incident.state = 'active';
  if not found or v_incident.maintenance then
    return null;
  end if;

  select settings.publish_incidents, settings.publish_actor_id
    into v_settings
    from public.monitoring_integrations settings
   where settings.tenant_id = v_incident.tenant_id;
  if not found or not v_settings.publish_incidents or v_settings.publish_actor_id is null then
    return null;
  end if;

  -- Nur noch vorhandene, aktive Dienste des Mandanten.
  select coalesce(array_agg(service.id), '{}')
    into v_services
    from public.services service
   where service.tenant_id = v_incident.tenant_id
     and service.active
     and service.id = any(coalesce(p_service_ids, '{}'::uuid[]));
  if cardinality(v_services) = 0 then
    return null;
  end if;

  select notice.id, notice.status
    into v_notice
    from public.service_incident_notices notice
   where notice.tenant_id = v_incident.tenant_id
     and notice.monitoring_incident_id = v_incident.id
   order by notice.created_at desc
   limit 1;
  if found then
    -- Bestehende Meldung (auch von Hand veröffentlicht): Text bleibt, weitere
    -- betroffene Dienste kommen dazu.
    if v_notice.status <> 'resolved' then
      insert into public.service_incident_notice_services (tenant_id, notice_id, service_id)
      select v_incident.tenant_id, v_notice.id, service_id
        from unnest(v_services) as service_id
      on conflict do nothing;
    end if;
    return v_notice.id;
  end if;

  v_body := left(coalesce(nullif(btrim(p_message), ''), 'Die Überwachung meldet eine Störung.'), 10000);
  if char_length(v_body) < 3 then
    v_body := 'Die Überwachung meldet eine Störung.';
  end if;
  return public.save_service_incident_notice(
    v_settings.publish_actor_id, v_incident.tenant_id, null,
    left(rpad(v_incident.title, 3, '.'), 240),
    v_body, 'investigating', true, v_services, v_incident.id
  );
exception when others then
  -- Die Statusseite darf die Störungserfassung nie verhindern.
  return null;
end;
$$;

revoke all on function public.monitoring_incident_publish(uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.monitoring_incident_publish(uuid, uuid[], text) to service_role;
