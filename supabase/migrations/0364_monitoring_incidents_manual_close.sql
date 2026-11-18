begin;

set local search_path = pg_catalog, public;

-- Störungen der Überwachung werden nicht mehr automatisch abgeschlossen.
-- Melden alle Sensoren wieder OK, geht die Störung auf «Wieder OK»
-- (state resolved) und bleibt offen, bis ein Agent sie mit der Ursache
-- abschliesst. Rückgängig macht das den Schritt von 0322.

-- Sicherheitsnetz: setzt auf «Wieder OK» statt abzuschliessen.
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
      and incident.source = 'prtg'
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
       set state = 'resolved',
           resolved_at = coalesce(resolved_at, timezone('utc', now()))
     where id = v_incident.id and state = 'active';
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'resolved',
            'Alle Sensoren sind wieder OK. Die Störung bleibt offen, bis sie abgeschlossen wird.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_reconcile_incidents() from public, anon, authenticated;

-- Liste «Aktiv»: auch Störungen, die wieder OK, aber nicht abgeschlossen sind.
create or replace function public.monitoring_incident_matches(
  p_state text,
  p_acknowledged_at timestamptz,
  p_service_ids uuid[],
  p_resolved_at timestamptz,
  p_filter text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select coalesce(case p_filter
    when 'active' then p_state in ('active', 'resolved')
    when 'unacknowledged' then p_state = 'active' and p_acknowledged_at is null
    when 'services' then p_state = 'active' and cardinality(coalesce(p_service_ids, '{}'::uuid[])) > 0
    when 'recent' then p_resolved_at >= timezone('utc', now()) - interval '30 days'
    when 'resolved' then p_state = 'resolved'
    when 'closed' then p_state = 'closed'
    else true
  end, false);
$function$;

-- Menü-Zahl der offenen Störungen: auch «Wieder OK», bis abgeschlossen.
do $migration$
declare
  v_definition text;
  v_old text := 'select count(*) into v_incidents_active
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = ''active''';
  v_new text := 'select count(*) into v_incidents_active
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state in (''active'', ''resolved'')';
  v_function regprocedure;
begin
  select p.oid::regprocedure into v_function
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'navigation_ticket_attention'
  limit 1;
  v_definition := pg_get_functiondef(v_function);
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

commit;
