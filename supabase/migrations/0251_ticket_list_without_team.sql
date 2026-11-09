-- Ticket list: the team filter can also select tickets without a team.
--
-- The nil UUID (00000000-0000-0000-0000-000000000000) in p_team_ids stands
-- for "no team". Used by the team queues in the agent workbench
-- («Ohne Teamzuordnung»). The function body is patched in place so the rest
-- of list_authorized_ticket_list_page_v2 stays exactly as it is.

do $migration$
declare
  v_definition text;
  v_old constant text :=
    'and (p_team_ids is null or ticket.assigned_team_id = any(p_team_ids))';
  v_new constant text :=
    'and (p_team_ids is null or ticket.assigned_team_id = any(p_team_ids) or (ticket.assigned_team_id is null and ''00000000-0000-0000-0000-000000000000''::uuid = any(p_team_ids)))';
begin
  v_definition := pg_get_functiondef(
    'public.list_authorized_ticket_list_page_v2'::regproc
  );
  if position(v_new in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'list_authorized_ticket_list_page_v2: team filter not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
