begin;

set local search_path = pg_catalog, public;

-- Statusmeldungen kommen aus den Störungen: Setzt die Überwachung den Status
-- eines Dienstes (gestört, wieder betriebsbereit), geht keine eigene
-- Statusmail an die Abonnenten der Statusseite. Die Abonnenten erfahren es
-- über die Meldung der Störung (Banner, Statusseite, Mail).

create or replace function public.monitoring_set_service_status(
  p_tenant_id uuid,
  p_service_id uuid,
  p_status text,
  p_from text[]
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  perform set_config('nextdesk.suppress_status_mail', 'on', true);
  update public.services
     set status = p_status
   where tenant_id = p_tenant_id
     and id = p_service_id
     and status = any (p_from);
  get diagnostics v_count = row_count;
  perform set_config('nextdesk.suppress_status_mail', '', true);
  return v_count > 0;
end;
$$;

revoke all on function public.monitoring_set_service_status(uuid, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.monitoring_set_service_status(uuid, uuid, text, text[])
  to service_role;

-- Ist eine Störung behoben, setzt 0333 die Dienste ihrer Meldung wieder auf
-- betriebsbereit. Die Abonnenten erhalten dazu das Update «Behoben» der
-- Meldung, keine zusätzliche Statusmail.
do $migration$
declare
  v_definition text;
  v_old text := E'    update public.services service\n       set status = ''operational''';
  v_new text := E'    perform set_config(''nextdesk.suppress_status_mail'', ''on'', true);\n    update public.services service\n       set status = ''operational''';
begin
  v_definition := pg_get_functiondef('public.monitoring_incident_resolve_notices()'::regprocedure);
  if position(v_old in v_definition) > 0
     and position('suppress_status_mail' in v_definition) = 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

commit;
