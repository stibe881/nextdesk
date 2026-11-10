begin;

set local search_path = pg_catalog, public;

-- Tickets im Papierkorb lösen keine Automatik mehr aus: keine SLA-Alarme, keine
-- Erinnerungen an Vorgesetzte, kein automatisches Erinnern/Lösen/Schliessen und
-- kein automatisches Schliessen durch Regeln. Die Funktionen werden aus ihrer
-- bestehenden Definition angepasst; passt eine Stelle nicht, bricht die
-- Migration ab.
create or replace function pg_temp.patch_function(
  p_signature regprocedure,
  p_from text,
  p_to text,
  p_expected integer
) returns void
language plpgsql
as $patch$
declare
  v_def text := pg_get_functiondef(p_signature);
  v_found integer := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
begin
  if v_found <> p_expected then
    raise exception '% : % Treffer statt %', p_signature, v_found, p_expected;
  end if;
  execute replace(v_def, p_from, p_to);
end;
$patch$;

select pg_temp.patch_function(
  'public.list_pending_sla_breaches(text,integer)'::regprocedure,
  'where ticket.closed_at is null',
  E'where ticket.deleted_at is null\n    and ticket.closed_at is null', 1);

select pg_temp.patch_function(
  'public.supervisor_send_ticket_alerts()'::regprocedure,
  'where not status.is_closed',
  E'where ticket.deleted_at is null\n      and not status.is_closed', 1);

select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  'and ticket.closed_at is null',
  E'and ticket.deleted_at is null\n      and ticket.closed_at is null', 3);

select pg_temp.patch_function(
  'public.prepare_ticket_automation_auto_close(uuid,uuid,uuid[])'::regprocedure,
  'ticket.closed_at is null',
  E'ticket.deleted_at is null\n    and ticket.closed_at is null', 1);

select pg_temp.patch_function(
  'public.execute_ticket_automation_auto_close(uuid,uuid)'::regprocedure,
  'ticket.closed_at is null',
  E'ticket.deleted_at is null\n    and ticket.closed_at is null', 1);

commit;
