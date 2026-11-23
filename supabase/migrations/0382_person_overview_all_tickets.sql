begin;

set local search_path = pg_catalog, public;

-- Personenübersicht: alle Tickets der Person zählen und anzeigen, auch die,
-- die einem anderen Team zugewiesen sind und die der/die Betrachtende nicht
-- öffnen darf. Solche Tickets kommen mit «readable: false» und dem Team, damit
-- die Oberfläche sie anzeigt, aber nicht öffnet. Gelöschte Tickets bleiben
-- draussen.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  v_definition := pg_get_functiondef('public.person_overview(uuid,uuid,uuid,uuid)'::regprocedure);

  v_next := replace(v_definition,
    E'     and public.can_read_ticket(ticket.id);',
    E'     and ticket.deleted_at is null;');
  if v_next = v_definition then
    raise exception 'person_overview: ticket filter not found';
  end if;
  v_definition := v_next;

  v_next := replace(v_definition,
    E'''closedAt'', coalesce(ticket.closed_at, ticket.resolved_at)\n          ) as value',
    E'''closedAt'', coalesce(ticket.closed_at, ticket.resolved_at),\n            ''teamName'', team.name,\n            ''readable'', public.can_read_ticket(ticket.id)\n          ) as value');
  if v_next = v_definition then
    raise exception 'person_overview: ticket object not found';
  end if;
  v_definition := v_next;

  v_next := replace(v_definition,
    E'left join public.user_profiles agent on agent.id = ticket.assigned_agent_id',
    E'left join public.user_profiles agent on agent.id = ticket.assigned_agent_id\n        left join public.teams team on team.id = ticket.assigned_team_id');
  if v_next = v_definition then
    raise exception 'person_overview: agent join not found';
  end if;

  execute v_next;
end;
$migration$;

commit;
