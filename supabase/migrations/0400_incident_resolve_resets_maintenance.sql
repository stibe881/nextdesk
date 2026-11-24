begin;

set local search_path = pg_catalog, public;

-- Schliesst die Überwachung eine Störung ab, setzt nextDesk die betroffenen
-- Dienste wieder auf «verfügbar». Bisher nur aus «beeinträchtigt» und
-- «Ausfall»: Eine Meldung mit dem Status «Wartung» (z. B. ein Hotfix) blieb
-- dadurch dauerhaft in Wartung, und die Statusanzeige für Mitarbeitende
-- zeigte «Dienste werden gewartet». Jetzt auch aus «Wartung», ausser ein
-- geplantes Wartungsfenster für den Dienst läuft gerade.

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.monitoring_incident_resolve_notices()'::regprocedure)
    into v_def;
  v_new := replace(
    v_def,
    E'       and service.status in (''degraded'', ''partial_outage'', ''major_outage'')\n',
    E'       and (\n' ||
    E'         service.status in (''degraded'', ''partial_outage'', ''major_outage'')\n' ||
    E'         or (\n' ||
    E'           service.status = ''maintenance''\n' ||
    E'           and not exists (\n' ||
    E'             select 1\n' ||
    E'             from public.service_status_maintenance_services window_service\n' ||
    E'             join public.service_status_maintenances maintenance\n' ||
    E'               on maintenance.id = window_service.maintenance_id\n' ||
    E'             where window_service.service_id = service.id\n' ||
    E'               and maintenance.tenant_id = new.tenant_id\n' ||
    E'               and maintenance.state in (''scheduled'', ''active'')\n' ||
    E'               and maintenance.starts_at <= timezone(''utc'', now())\n' ||
    E'               and maintenance.ends_at > timezone(''utc'', now())\n' ||
    E'           )\n' ||
    E'         )\n' ||
    E'       )\n'
  );
  if v_new = v_def then
    raise exception 'monitoring_incident_resolve_notices: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
