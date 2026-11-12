-- Störungen close automatically again once PRTG reports every sensor OK
-- (decision of the tenant owner, reverting the «resolved → close with cause»
-- step of 0311). The cause can still be added afterwards. The safety net
-- closes, too; incidents left «resolved» by an «Up» are closed now.

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

update public.monitoring_incidents
   set state = 'closed',
       closed_at = coalesce(resolved_at, timezone('utc', now())),
       closing_note = coalesce(closing_note, 'Automatisch abgeschlossen: PRTG meldet wieder OK.')
 where state = 'resolved'
   and closed_by is null;
