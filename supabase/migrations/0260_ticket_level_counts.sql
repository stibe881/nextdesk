-- Numbers of the four ticket list tiles for one support level queue
-- (tickets whose assigned team has that level). Counts only tickets the
-- caller may read, like the unfiltered tile counts under RLS.
create or replace function public.ticket_level_counts(
  p_tenant_id uuid,
  p_support_level smallint
)
returns table (total bigint, closed bigint, mine bigint, unassigned bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    count(*) as total,
    count(*) filter (where status.is_closed) as closed,
    count(*) filter (where ticket.assigned_agent_id = auth.uid()) as mine,
    count(*) filter (where ticket.assigned_agent_id is null) as unassigned
  from public.tickets ticket
  join public.teams team
    on team.id = ticket.assigned_team_id
   and team.tenant_id = ticket.tenant_id
   and team.support_level = p_support_level
  join public.ticket_statuses status
    on status.id = ticket.status_id
  where ticket.tenant_id = p_tenant_id
    and public.is_active_tenant_member(p_tenant_id)
    and public.can_read_ticket(ticket.id);
$$;

revoke all on function public.ticket_level_counts(uuid, smallint) from public, anon;
grant execute on function public.ticket_level_counts(uuid, smallint) to authenticated;
