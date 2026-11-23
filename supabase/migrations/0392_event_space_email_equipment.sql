begin;

-- Anlässe aus Mails: Die Übernahme liess nur einen Teil der Technik zu.
-- «ICT Material», «Zugang Internet» und «Zugang SOBE Netzwerk» erlaubt die
-- Tabelle event_space_request_equipment längst; Bestellungen damit landeten
-- trotzdem mit «Technik ungültig» in der Klärung.
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
    '''projector'', ''connections'', ''display'', ''audio'', ''videocall'', ''microphones'',',
    '''ict_material'', ''internet_access'', ''sobe_network_access'', ''projector'', ''connections'', ''display'', ''audio'', ''videocall'', ''microphones'','
  );
  if v_updated = v_definition then
    raise exception 'create_event_space_email_ticket_request: Geräteliste nicht gefunden';
  end if;
  execute v_updated;
end;
$$;

commit;
