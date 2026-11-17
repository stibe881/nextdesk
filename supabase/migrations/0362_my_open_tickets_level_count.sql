begin;

set local search_path = pg_catalog, public;

-- Kachel «Meine offenen Tickets» bei gewählter Supportstufe: dieselbe Regel
-- wie die Liste dahinter (mir zugewiesen oder von mir angefragt, nicht gelöst
-- oder geschlossen). Nur der Ausdruck der Zahl «mine» wird ersetzt.
do $migration$
declare
  v_definition text;
  v_old text := 'count(*) filter (where ticket.assigned_agent_id = auth.uid() and not status.is_closed) as mine';
  v_new text := 'count(*) filter (where (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()) and not status.is_closed) as mine';
begin
  v_definition := pg_get_functiondef('public.ticket_level_counts(uuid,smallint)'::regprocedure);
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

commit;
