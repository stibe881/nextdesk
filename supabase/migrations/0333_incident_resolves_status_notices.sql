-- Ist eine Störung behoben (PRTG meldet OK, der Anbieter meldet sie als
-- behoben oder sie wird von Hand abgeschlossen), gelten ihre öffentlichen
-- Meldungen auf der Statusseite als behoben: sie verschwinden aus dem Banner
-- in Web und App, und Abonnenten erhalten das Update «Behoben». Dienste, die
-- nur wegen dieser Meldung gestört waren, sind wieder betriebsbereit.
create or replace function public.monitoring_incident_resolve_notices()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_notice record;
begin
  if old.state <> 'active' or new.state = 'active' then
    return null;
  end if;
  for v_notice in
    select notice.id
    from public.service_incident_notices notice
    where notice.tenant_id = new.tenant_id
      and notice.monitoring_incident_id = new.id
      and notice.status <> 'resolved'
  loop
    update public.service_incident_notices
       set status = 'resolved',
           description = 'Die Störung ist behoben.'
     where id = v_notice.id;

    update public.services service
       set status = 'operational'
     where service.tenant_id = new.tenant_id
       and service.status in ('degraded', 'partial_outage', 'major_outage')
       and service.id in (
         select link.service_id
         from public.service_incident_notice_services link
         where link.notice_id = v_notice.id
       )
       -- Still named in another open message: leave as it is.
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
  -- Die Statusseite darf das Schliessen der Störung nie verhindern.
  return null;
end;
$$;
revoke all on function public.monitoring_incident_resolve_notices()
  from public, anon, authenticated;

create or replace trigger monitoring_incidents_resolve_notices
  after update of state on public.monitoring_incidents
  for each row execute function public.monitoring_incident_resolve_notices();

-- Bereits behobene Störungen mit noch offener Meldung nachziehen.
update public.service_incident_notices notice
   set status = 'resolved',
       description = 'Die Störung ist behoben.'
  from public.monitoring_incidents incident
 where incident.id = notice.monitoring_incident_id
   and incident.tenant_id = notice.tenant_id
   and incident.state <> 'active'
   and notice.status <> 'resolved';
