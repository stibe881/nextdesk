-- Überwachung: Verfügbarkeit aus den Alarmen.
--
-- Die Verfügbarkeit in der Übersicht rechnet mit den Ausfallzeiten der Alarme
-- eigener Sensoren. Dafür merkt sich ein Alarm, ob er je ein Ausfall war
-- (nicht nur eine Warnung) und ob er aus einer Simulation stammt; simulierte
-- Ausfälle zählen nicht zur Verfügbarkeit.

alter table public.monitoring_alerts
  add column if not exists was_down boolean not null default false,
  add column if not exists simulated boolean not null default false;

-- Bisherige Alarme eigener Sensoren: als Ausfall werten, ausser die letzte
-- Meldung war eine Warnung; Simulationen an ihrer Meldung erkennen.
update public.monitoring_alerts
   set was_down = true
 where external_key like 'nd:sensor:%'
   and coalesce(last_status, '') !~* 'warn';
update public.monitoring_alerts alert
   set simulated = true
 where alert.external_key like 'nd:sensor:%'
   and exists (
     select 1 from public.monitoring_incident_events event
      where event.incident_id = alert.incident_id
        and event.message = 'Simulierter Ausfall (Test)'
        and event.sensor_name is not distinct from alert.sensor_name
   );

create index if not exists monitoring_alerts_sensor_outages_idx
  on public.monitoring_alerts (tenant_id, opened_at desc)
  where was_down and not simulated and external_key like 'nd:sensor:%';

comment on column public.monitoring_alerts.was_down is
  'The alert was an outage at some point (not only a warning). Counts for the availability.';
comment on column public.monitoring_alerts.simulated is
  'Opened by a simulated outage (test). Does not count for the availability.';
