begin;

-- Anlässe aus Mails: Bisher wurde immer ein 30-Minuten-Termin ab Beginn
-- geplant. Bestellungen der Anlässe-App nennen auch das Ende; dann gilt die
-- ganze Dauer. Erlaubt ist jedes Ende nach dem Beginn, höchstens 24 Stunden
-- später. Mails ohne Ende planen weiterhin 30 Minuten.
do $$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(
    'public.create_event_space_email_ticket_request(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,text[],boolean,boolean,boolean,boolean,boolean,text,text,text,text[])'::regprocedure
  );
  v_updated := replace(
    v_definition,
    'or p_ends_at - p_starts_at <> interval ''30 minutes'' then',
    'or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval ''24 hours'' then'
  );
  if v_updated = v_definition then
    raise exception 'create_event_space_email_ticket_request: Dauerprüfung nicht gefunden';
  end if;
  execute v_updated;

  v_definition := pg_get_functiondef(
    'public.resolve_event_space_email_ticket_request(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    'or p_ends_at - p_starts_at <> interval ''30 minutes'' then',
    'or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval ''24 hours'' then'
  );
  if v_updated = v_definition then
    raise exception 'resolve_event_space_email_ticket_request: Dauerprüfung nicht gefunden';
  end if;
  execute v_updated;
end;
$$;

commit;
