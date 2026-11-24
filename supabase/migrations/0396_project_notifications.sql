begin;

set local search_path = pg_catalog, public;

-- Projekte: Mitteilung, wenn jemand einem Projekt hinzugefügt wird
-- (project.member_added) oder eine Projektaufgabe zugewiesen bekommt
-- (project.task_assigned). Beide laufen in der Kategorie «assigned» wie
-- zugewiesene Tickets und folgen damit den bestehenden persönlichen
-- Einstellungen für Push und E-Mail. Die Empfänger legt die Edge Function
-- "projects" beim Auslösen fest.

do $$
declare
  v_def text;
  v_new text;
begin
  -- Welche Kategorie ein Mitteilungstyp hat.
  select pg_get_functiondef('public.push_notification_category(text)'::regprocedure)
    into v_def;
  v_new := replace(
    v_def,
    E'    else null\n  end;',
    E'    when p_kind like ''project.%'' then ''assigned''\n    else null\n  end;'
  );
  if v_new = v_def then
    raise exception 'push_notification_category: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Mitteilungen ohne Ticket: die Empfänger stehen beim Auslösen fest.
  select pg_get_functiondef(
    'public.push_non_ticket_recipient_authorized(uuid, uuid, text)'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    E'or p_kind like ''monitoring.%'' then',
    E'or p_kind like ''monitoring.%'' or p_kind like ''project.%'' then'
  );
  if v_new = v_def then
    raise exception 'push_non_ticket_recipient_authorized: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
