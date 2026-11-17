begin;

set local search_path = pg_catalog, public;

-- Zusammenspiel Überwachung → Störung → Statusmeldung → Banner/Statusseite/Mail
-- und Wartung mit eigener Meldung.
--
-- 1. Statusmeldung einer Störung: Meldet die Überwachung wieder OK, wird sie
--    «Wird beobachtet»; «Behoben» (mit Ursache) erst, wenn ein Agent die
--    Störung abschliesst. Fällt das Gerät erneut aus, wieder «Wird untersucht».
-- 2. Veröffentlicht wird ein Ausfall erst, wenn ein Agent die Störung
--    bestätigt oder sie 10 Minuten aktiv ist (kein Fehlalarm öffentlich).
-- 4. Endet eine Wartung und das Gerät ist weiterhin gestört, wird die stille
--    Störung normal: Team alarmiert, Dienststatus gesetzt, veröffentlicht.
-- 5. Öffentliche Wartungen werden den Abonnenten 24 Stunden vorher per Mail
--    angekündigt (kurzfristig geplante sofort).

-- ---------------------------------------------------------------------------
-- 1. Meldung folgt dem Zustand der Störung.

create or replace function public.monitoring_incident_resolve_notices()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_notice record;
  v_cause text;
  v_text text;
begin
  if new.state = old.state then
    return null;
  end if;

  -- Erneut gestört: eine beobachtete Meldung wird wieder untersucht.
  if new.state = 'active' then
    update public.service_incident_notices
       set status = 'investigating',
           description = 'Die Überwachung meldet erneut eine Störung. Wir untersuchen die Ursache.'
     where tenant_id = new.tenant_id
       and monitoring_incident_id = new.id
       and status = 'monitoring';
    return null;
  end if;

  -- Wieder OK, aber noch nicht abgeschlossen: beobachten.
  if new.state = 'resolved' then
    update public.service_incident_notices
       set status = 'monitoring',
           description = 'Die Überwachung meldet wieder OK. Wir beobachten die Lage und melden uns, sobald die Störung abgeschlossen ist.'
     where tenant_id = new.tenant_id
       and monitoring_incident_id = new.id
       and status in ('investigating', 'identified');
    return null;
  end if;

  -- Abgeschlossen: behoben, mit Ursache.
  v_cause := case new.cause
    when 'power' then 'Strom'
    when 'network' then 'Netzwerk'
    when 'hardware' then 'Hardware'
    when 'software' then 'Software'
    when 'maintenance' then 'Wartung'
    when 'external' then 'Extern (Provider, Lieferant)'
    else null
  end;
  v_text := 'Die Störung ist behoben.'
    || case when v_cause is not null then ' Ursache: ' || v_cause || '.' else '' end;
  for v_notice in
    select notice.id
    from public.service_incident_notices notice
    where notice.tenant_id = new.tenant_id
      and notice.monitoring_incident_id = new.id
      and notice.status <> 'resolved'
  loop
    update public.service_incident_notices
       set status = 'resolved',
           description = v_text
     where id = v_notice.id;

    perform set_config('nextdesk.suppress_status_mail', 'on', true);
    update public.services service
       set status = 'operational'
     where service.tenant_id = new.tenant_id
       and service.status in ('degraded', 'partial_outage', 'major_outage')
       and service.id in (
         select link.service_id
         from public.service_incident_notice_services link
         where link.notice_id = v_notice.id
       )
       and not exists (
         select 1
         from public.service_incident_notice_services other_link
         join public.service_incident_notices other
           on other.id = other_link.notice_id
         where other_link.service_id = service.id
           and other.tenant_id = new.tenant_id
           and other.id <> v_notice.id
           and other.status <> 'resolved'
       );
  end loop;
  return null;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Verzögert veröffentlichen: bestätigt oder 10 Minuten aktiv.

create or replace function public.monitoring_publish_pending(p_incident_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_incident record;
  v_count integer := 0;
begin
  for v_incident in
    select incident.id,
      (
        select coalesce(array_agg(distinct affected.id), '{}'::uuid[])
        from public.monitoring_alerts alert
        cross join lateral unnest(
          case when cardinality(coalesce(alert.service_ids, '{}'::uuid[])) > 0
            then alert.service_ids
            else array_remove(array[alert.service_id], null)
          end
        ) as affected(id)
        where alert.incident_id = incident.id
          and alert.state = 'open'
          and alert.was_down
      ) as service_ids,
      (
        select concat_ws(' – ', alert.device_name, alert.sensor_name)
          || coalesce('. ' || nullif(btrim(alert.last_message), ''), '')
        from public.monitoring_alerts alert
        where alert.incident_id = incident.id and alert.was_down
        order by alert.opened_at
        limit 1
      ) as subject
    from public.monitoring_incidents incident
    join public.monitoring_integrations settings
      on settings.tenant_id = incident.tenant_id
    where incident.state = 'active'
      and not incident.maintenance
      and incident.source <> 'external'
      and incident.severity = 'down'
      and settings.publish_incidents
      and (p_incident_id is null or incident.id = p_incident_id)
      and (
        incident.acknowledged_at is not null
        or incident.opened_at <= timezone('utc', now()) - interval '10 minutes'
      )
    order by incident.opened_at
    limit 100
  loop
    -- Nothing new: no services, or all already in the open message.
    continue when cardinality(v_incident.service_ids) = 0;
    continue when exists (
      select 1 from public.service_incident_notices notice
      where notice.monitoring_incident_id = v_incident.id
        and notice.status <> 'resolved'
        and not exists (
          select 1 from unnest(v_incident.service_ids) as wanted(service_id)
          where not exists (
            select 1 from public.service_incident_notice_services link
            where link.notice_id = notice.id and link.service_id = wanted.service_id
          )
        )
    );
    -- An agent-closed or resolved message is not reopened automatically.
    continue when exists (
      select 1 from public.service_incident_notices notice
      where notice.monitoring_incident_id = v_incident.id
        and notice.status = 'resolved'
    );
    if public.monitoring_incident_publish(
         v_incident.id,
         v_incident.service_ids,
         left('Die Überwachung meldet einen Ausfall'
           || coalesce(': ' || nullif(v_incident.subject, ''), '') || '.', 2000)
       ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.monitoring_publish_pending(uuid) from public, anon, authenticated;
grant execute on function public.monitoring_publish_pending(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Nach der Wartung: stille Störungen von weiterhin gestörten Geräten
--    werden normal.

create or replace function public.monitoring_unmute_after_maintenance()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_incident record;
  v_alert record;
  v_service uuid;
  v_count integer := 0;
begin
  for v_incident in
    select incident.id, incident.tenant_id, settings.set_service_status
    from public.monitoring_incidents incident
    join public.monitoring_integrations settings
      on settings.tenant_id = incident.tenant_id
    where incident.state = 'active'
      and incident.maintenance
      and incident.source <> 'external'
      and not exists (
        select 1
        from public.service_status_maintenance_assets link
        join public.service_status_maintenances maintenance
          on maintenance.id = link.maintenance_id
        where link.tenant_id = incident.tenant_id
          and link.asset_id = incident.asset_id
          and maintenance.state in ('scheduled', 'active')
          and maintenance.starts_at <= timezone('utc', now())
          and maintenance.ends_at > timezone('utc', now())
      )
      and not exists (
        select 1 from public.services service
        where service.tenant_id = incident.tenant_id
          and service.id = any(coalesce(incident.service_ids, '{}'::uuid[]))
          and service.status = 'maintenance'
      )
      and exists (
        select 1 from public.monitoring_alerts alert
        where alert.incident_id = incident.id and alert.state = 'open'
      )
    limit 50
  loop
    update public.monitoring_incidents
       set maintenance = false,
           last_event_at = timezone('utc', now())
     where id = v_incident.id and maintenance;
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'maintenance',
            'Die Wartung ist vorbei, das Gerät ist weiterhin gestört. Das Team wird alarmiert.');
    perform public.monitoring_incident_notify(v_incident.id, 'opened');

    if v_incident.set_service_status then
      for v_alert in
        select alert.id, alert.service_ids, alert.service_id, alert.service_statuses
        from public.monitoring_alerts alert
        where alert.incident_id = v_incident.id and alert.state = 'open' and alert.was_down
      loop
        foreach v_service in array (
          case when cardinality(coalesce(v_alert.service_ids, '{}'::uuid[])) > 0
            then v_alert.service_ids
            else array_remove(array[v_alert.service_id], null)
          end
        ) loop
          if public.monitoring_set_service_status(
               v_incident.tenant_id, v_service, 'partial_outage',
               array['operational', 'degraded']) then
            update public.monitoring_alerts
               set service_statuses = coalesce(service_statuses, '{}'::jsonb)
                     || jsonb_build_object(v_service::text, 'partial_outage')
             where id = v_alert.id;
          end if;
        end loop;
      end loop;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.monitoring_unmute_after_maintenance() from public, anon, authenticated;
grant execute on function public.monitoring_unmute_after_maintenance() to service_role;

create or replace function public.monitoring_incidents_tick()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.monitoring_unmute_after_maintenance();
  perform public.monitoring_publish_pending(null);
end;
$$;

revoke all on function public.monitoring_incidents_tick() from public, anon, authenticated;

select cron.schedule(
  'nextdesk-monitoring-incidents-tick',
  '* * * * *',
  'select public.monitoring_incidents_tick();'
);

-- ---------------------------------------------------------------------------
-- 5. Ankündigung öffentlicher Wartungen per Mail.

alter table public.mail_messages
  drop constraint if exists mail_messages_maintenance_phase_check;
alter table public.mail_messages
  add constraint mail_messages_maintenance_phase_check
  check (maintenance_phase is null or maintenance_phase in ('announce', 'start', 'end'));

do $migration$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef('public.service_status_enqueue_maintenance_mail(uuid,uuid,text)'::regprocedure);
  if position('p_phase not in (''start'', ''end'')' in v_definition) > 0 then
    execute replace(v_definition,
      'p_phase not in (''start'', ''end'')',
      'p_phase not in (''announce'', ''start'', ''end'')');
  end if;

  v_definition := pg_get_functiondef('public.maintenance_announce_run()'::regprocedure);
  if position('service_status_enqueue_maintenance_mail' in v_definition) = 0 then
    execute replace(v_definition,
      E'    update public.service_status_maintenances\n    set announced_at = timezone(''utc'', now())\n    where id = v_window.id;\n',
      E'    update public.service_status_maintenances\n    set announced_at = timezone(''utc'', now())\n    where id = v_window.id;\n\n    -- Abonnenten der Statusseite: Ankündigung einer öffentlichen Wartung.\n    if v_window.public_enabled then\n      perform public.service_status_enqueue_maintenance_mail(v_window.tenant_id, v_window.id, ''announce'');\n    end if;\n');
  end if;
end;
$migration$;

-- Kurzfristig geplante Wartungen werden vor Beginn angekündigt.
select cron.schedule(
  'nextdesk-maintenance-announce',
  '*/5 * * * *',
  'select public.maintenance_announce_run();'
);

commit;
