-- Externe Störungen automatisch auf der Statusseite: pro Quelle legt die
-- Administration fest, welche Dienste der Statusseite betroffen sind. Meldet
-- der Anbieter eine Störung, entsteht sofort eine öffentliche Meldung (Banner
-- in Web und App, Statusseite, Mail an Abonnenten), die Dienste werden als
-- gestört markiert, und neue Texte des Anbieters ergänzen die Meldung. Ist die
-- Störung behoben, schliesst Migration 0333 die Meldung.
alter table public.monitoring_external_sources
  add column if not exists publish_service_ids uuid[] not null default '{}',
  -- Wer die Zuordnung gespeichert hat; erscheint als Autor der Meldungen.
  add column if not exists publish_actor_id uuid references auth.users(id) on delete set null;

alter table public.monitoring_external_sources
  drop constraint if exists monitoring_external_sources_publish_services_check;
alter table public.monitoring_external_sources
  add constraint monitoring_external_sources_publish_services_check
  check (cardinality(publish_service_ids) <= 100);

-- Legt die Meldung zu einer externen Störung an oder ergänzt sie um den neuen
-- Text des Anbieters. Ohne zugeordnete Dienste: nichts (null).
create or replace function public.monitoring_external_publish(
  p_incident_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_incident record;
  v_source record;
  v_notice record;
  v_services uuid[];
  v_body text;
  v_title text;
  v_target text;
  v_rank constant jsonb := '{"operational":0,"degraded":1,"partial_outage":2,"major_outage":3}';
  v_id uuid;
begin
  select incident.id, incident.tenant_id, incident.title, incident.severity,
         incident.incident_key, incident.external_provider
    into v_incident
    from public.monitoring_incidents incident
   where incident.id = p_incident_id
     and incident.source = 'external'
     and incident.state = 'active';
  if not found then
    return null;
  end if;

  select source.publish_service_ids, source.publish_actor_id
    into v_source
    from public.monitoring_external_sources source
   where source.tenant_id = v_incident.tenant_id
     and source.enabled
     and v_incident.incident_key like 'ext:' || source.source_key || ':%';
  if not found or v_source.publish_actor_id is null
     or cardinality(v_source.publish_service_ids) = 0 then
    return null;
  end if;

  -- Nur noch vorhandene, aktive Dienste des Mandanten.
  select coalesce(array_agg(service.id), '{}')
    into v_services
    from public.services service
   where service.tenant_id = v_incident.tenant_id
     and service.active
     and service.id = any(v_source.publish_service_ids);
  if cardinality(v_services) = 0 then
    return null;
  end if;

  v_body := left(coalesce(nullif(btrim(p_message), ''),
    coalesce(v_incident.external_provider, 'Der Anbieter') || ' meldet eine Störung.'), 10000);
  if char_length(v_body) < 3 then
    v_body := 'Der Anbieter meldet eine Störung.';
  end if;

  select notice.id, notice.status, notice.description
    into v_notice
    from public.service_incident_notices notice
   where notice.tenant_id = v_incident.tenant_id
     and notice.monitoring_incident_id = v_incident.id
   order by notice.created_at desc
   limit 1;

  if found then
    if v_notice.status = 'resolved' or v_notice.description = v_body then
      return v_notice.id;
    end if;
    v_id := public.save_service_incident_notice(
      v_source.publish_actor_id, v_incident.tenant_id, v_notice.id, null,
      v_body, v_notice.status, null, null, null
    );
  else
    v_title := left(
      case
        when v_incident.external_provider is null
          or v_incident.title ilike v_incident.external_provider || '%'
          then v_incident.title
        else v_incident.external_provider || ': ' || v_incident.title
      end, 240);
    v_id := public.save_service_incident_notice(
      v_source.publish_actor_id, v_incident.tenant_id, null, v_title,
      v_body, 'investigating', true, v_services, v_incident.id
    );
    -- Betriebszustand: Ausfall = teilweiser Ausfall, Warnung = beeinträchtigt;
    -- ein schlechterer Zustand und Wartungen bleiben.
    v_target := case when v_incident.severity = 'down' then 'partial_outage' else 'degraded' end;
    update public.services service
       set status = v_target
     where service.tenant_id = v_incident.tenant_id
       and service.id = any(v_services)
       and service.status <> 'maintenance'
       and coalesce((v_rank ->> service.status)::int, 0) < (v_rank ->> v_target)::int;
  end if;
  return v_id;
exception when others then
  -- Die Statusseite darf die Störungserfassung nie verhindern.
  return null;
end;
$$;
revoke all on function public.monitoring_external_publish(uuid, text)
  from public, anon, authenticated;
grant execute on function public.monitoring_external_publish(uuid, text) to service_role;
