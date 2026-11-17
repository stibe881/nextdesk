begin;

set local search_path = pg_catalog, public;

-- «Meine Tickets» zeigt nur noch offene Tickets: gelöste und geschlossene
-- (Status mit is_closed) fallen aus der Liste und aus der Zahl der Kachel.
-- Nur der betroffene Ausdruck wird in der aktuellen Definition ersetzt, damit
-- spätere Änderungen an den Funktionen erhalten bleiben.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_old text := 'p_scope = ''mine'' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()))';
  v_new text := 'p_scope = ''mine'' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()) and not status.is_closed)';
begin
  foreach v_function in array array[
    'public.list_authorized_ticket_list_page(uuid,uuid[],uuid[],uuid[],uuid,boolean,text,text,integer,integer,text,text,text[],text[],text[],text[],text[],text,text[],uuid[],uuid[])'::regprocedure,
    'public.list_authorized_ticket_list_page_v2(uuid,uuid[],uuid[],uuid[],uuid,boolean,text,text,integer,integer,text,text,text[],text[],text[],text[],text[],text,text[],uuid[],uuid[],uuid[],uuid[],timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,boolean,smallint)'::regprocedure,
    'public.list_authorized_ticket_list_page_by_level(uuid,uuid[],uuid[],uuid[],uuid,boolean,text,text,integer,integer,text,text,text[],text[],text[],text[],text[],text,text[],uuid[],uuid[],smallint)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if position(v_old in v_definition) > 0 then
      execute replace(v_definition, v_old, v_new);
    end if;
  end loop;

  v_definition := pg_get_functiondef('public.ticket_level_counts(uuid,smallint)'::regprocedure);
  if position('count(*) filter (where ticket.assigned_agent_id = auth.uid()) as mine' in v_definition) > 0 then
    execute replace(
      v_definition,
      'count(*) filter (where ticket.assigned_agent_id = auth.uid()) as mine',
      'count(*) filter (where ticket.assigned_agent_id = auth.uid() and not status.is_closed) as mine'
    );
  end if;
end;
$migration$;

commit;
