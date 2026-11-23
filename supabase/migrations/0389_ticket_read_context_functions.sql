begin;

-- Ticketliste, Navigationszahlen, Suche und Personenübersicht prüften die
-- Leseberechtigung pro Ticket mit can_read_ticket(). Neu nutzen diese den einmal
-- pro Abfrage berechneten Kontext (0388). Ersetzt wird genau der Aufruf
-- über den Alias «ticket» der Tabelle public.tickets; die übrige Logik der
-- Funktionen bleibt unverändert.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_updated text;
  v_expected integer;
  v_found integer;
begin
  for v_function, v_expected in
    select candidate.oid::regprocedure, candidate.expected
      from (values
        ('list_authorized_ticket_list_page', 1),
        ('list_authorized_ticket_list_page_by_level', 1),
        ('list_authorized_ticket_list_page_v2', 1),
        ('navigation_ticket_attention', 3),
        ('person_overview', 1),
        ('search_directory_people', 1),
        ('search_global_workspace', 1),
        ('similar_tickets', 1),
        ('ticket_level_counts', 1),
        ('ticket_requester_names', 1)
      ) as wanted(name, expected)
      join lateral (
        select p.oid, wanted.expected
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = wanted.name
      ) candidate on true
  loop
    v_definition := pg_get_functiondef(v_function);
    v_updated := replace(
      v_definition,
      'public.can_read_ticket(ticket.id)',
      'public.ticket_readable(ticket, (select public.ticket_read_context()))'
    );
    -- navigation_ticket_attention: Phishing-Fälle sind mit «ticket» verbunden.
    if v_function::text like 'navigation_ticket_attention(%' then
      v_updated := replace(
        v_updated,
        'public.can_read_ticket(security_case.ticket_id)',
        'public.ticket_readable(ticket, (select public.ticket_read_context()))'
      );
    end if;
    v_found := (length(v_updated) - length(replace(v_updated, 'public.ticket_readable(ticket, (select public.ticket_read_context()))', '')))
      / length('public.ticket_readable(ticket, (select public.ticket_read_context()))');
    if v_found <> v_expected then
      raise exception 'ticket_read_context: % ersetzt %, erwartet %', v_function, v_found, v_expected;
    end if;
    execute v_updated;
  end loop;
end;
$$;

commit;
