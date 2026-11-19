begin;

set local search_path = pg_catalog, public;

-- Mitteilung «Wiederkehrende Ausfälle» (problem.recurring_detected): auch die
-- ID des Geräts mitgeben, damit die App das Gerät in der Überwachung öffnet.
do $migration$
declare
  v_definition text;
  v_old text := E'jsonb_build_object(''problemId'', v_problem_id, ''assetName'', v_row.asset_name,';
  v_new text := E'jsonb_build_object(''problemId'', v_problem_id, ''assetId'', v_row.asset_id, ''assetName'', v_row.asset_name,';
begin
  v_definition := pg_get_functiondef('public.monitoring_detect_recurring_problems()'::regprocedure);
  if position('''assetId'', v_row.asset_id, ''assetName''' in v_definition) = 0
     and position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

-- Bestehende Mitteilungen ergänzen (Gerät aus der Analyse des Falls).
update public.ticket_notifications notification
   set payload = notification.payload
     || jsonb_build_object('assetId', problem.analysis ->> 'assetId')
  from public.problems problem
 where notification.kind = 'problem.recurring_detected'
   and not (notification.payload ? 'assetId')
   and problem.id::text = notification.payload ->> 'problemId'
   and problem.tenant_id = notification.tenant_id
   and problem.analysis ->> 'assetId' is not null;

commit;
