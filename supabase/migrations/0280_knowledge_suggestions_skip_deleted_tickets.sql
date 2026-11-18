begin;

set local search_path = pg_catalog, public;

-- Wissensvorschläge aus gelösten Tickets berücksichtigen keine Tickets im
-- Papierkorb. Die Funktion wird aus ihrer bestehenden Definition angepasst.
do $$
declare
  v_sig regprocedure := 'public.knowledge_suggestion_source_tickets(uuid,timestamp with time zone,integer)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_from text := 'and ticket.merged_into_ticket_id is null';
  v_found integer := (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from);
begin
  if v_found <> 1 then
    raise exception 'knowledge_suggestion_source_tickets: % Treffer statt 1', v_found;
  end if;
  execute replace(v_def, v_from, E'and ticket.deleted_at is null\n    and ticket.merged_into_ticket_id is null');
end $$;

commit;
