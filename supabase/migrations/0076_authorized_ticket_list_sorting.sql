begin;
set local search_path = pg_catalog, public;

-- Die Listen-RPC liefert ausschliesslich Tickets, die derselben Leseprüfung wie
-- die Ticket-RLS genügen. Alle Filter und die Sortierung erfolgen vor der
-- Pagination. Profilinformationen werden nie aus der SECURITY DEFINER-Funktion
-- zurückgegeben; die Agentensortierung verwendet ausschliesslich eine vom
-- separat berechtigten Agentenverzeichnis gelieferte ID-Reihenfolge.
create or replace function public.list_authorized_ticket_list_page(
  p_tenant_id uuid,
  p_status_ids uuid[] default null,
  p_priority_ids uuid[] default null,
  p_department_ids uuid[] default null,
  p_assigned_agent_id uuid default null,
  p_only_unassigned boolean default false,
  p_sort_by text default 'updated',
  p_sort_direction text default 'desc',
  p_limit integer default 51,
  p_offset integer default 0,
  p_scope text default 'all',
  p_queue_key text default null,
  p_search_ticket_numbers text[] default null,
  p_search_statuses text[] default null,
  p_search_priorities text[] default null,
  p_search_queues text[] default null,
  p_search_risks text[] default null,
  p_search_assignment text default null,
  p_search_free_text text[] default null,
  p_metric_ticket_ids uuid[] default null,
  p_agent_sort_order uuid[] default null
)
returns table (
  id uuid,
  ticket_number text,
  subject text,
  department_id uuid,
  department_key text,
  department_name text,
  status_id uuid,
  status_label text,
  status_is_closed boolean,
  status_sort_order smallint,
  priority_id uuid,
  priority_label text,
  priority_sort_order smallint,
  resolution_due_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  requester_id uuid,
  assigned_agent_id uuid,
  matching_ticket_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if p_tenant_id is null
    or p_sort_by not in ('updated', 'agent', 'status', 'department', 'priority')
    or p_sort_direction not in ('asc', 'desc')
    or p_scope not in ('all', 'mine', 'unassigned', 'open', 'closed')
    or p_search_assignment not in ('mine', 'unassigned')
    or (p_queue_key is not null and p_queue_key !~ '^[a-z][a-z0-9_-]{0,63}$')
    or p_limit < 1
    or p_limit > 100
    or p_offset < 0
    or coalesce(cardinality(p_metric_ticket_ids), 0) > 500
    or coalesce(cardinality(p_agent_sort_order), 0) > 1000
    or exists (
      select 1
      from unnest(coalesce(p_search_ticket_numbers, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) not between 1 and 120
    )
    or exists (
      select 1
      from unnest(coalesce(p_search_statuses, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) not between 1 and 120
    )
    or exists (
      select 1
      from unnest(coalesce(p_search_priorities, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) not between 1 and 120
    )
    or exists (
      select 1
      from unnest(coalesce(p_search_queues, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) not between 1 and 120
    )
    or exists (
      select 1
      from unnest(coalesce(p_search_risks, '{}'::text[])) as term(value)
      where term.value not in ('ok', 'warnung', 'kritisch')
    )
    or exists (
      select 1
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) not between 1 and 120
    ) then
    raise exception 'Invalid authorized ticket list request' using errcode = '22023';
  end if;

  return query
  with readable_tickets as (
    select
      ticket.id,
      ticket.ticket_number,
      ticket.subject,
      ticket.department_id,
      department.key as department_key,
      department.name as department_name,
      ticket.status_id,
      status.label as status_label,
      status.is_closed as status_is_closed,
      status.sort_order as status_sort_order,
      ticket.priority_id,
      priority.label as priority_label,
      priority.sort_order as priority_sort_order,
      ticket.resolution_due_at,
      ticket.created_at,
      ticket.updated_at,
      ticket.requester_id,
      ticket.assigned_agent_id
    from public.tickets ticket
    join public.departments department
      on department.id = ticket.department_id
      and department.tenant_id = ticket.tenant_id
    join public.ticket_statuses status
      on status.id = ticket.status_id
      and status.tenant_id = ticket.tenant_id
    join public.ticket_priorities priority
      on priority.id = ticket.priority_id
      and priority.tenant_id = ticket.tenant_id
    where ticket.tenant_id = p_tenant_id
      and public.can_read_ticket(ticket.id)
      and (p_status_ids is null or ticket.status_id = any(p_status_ids))
      and (p_priority_ids is null or ticket.priority_id = any(p_priority_ids))
      and (p_department_ids is null or ticket.department_id = any(p_department_ids))
      and (p_assigned_agent_id is null or ticket.assigned_agent_id = p_assigned_agent_id)
      and (not p_only_unassigned or ticket.assigned_agent_id is null)
      and (p_metric_ticket_ids is null or ticket.id = any(p_metric_ticket_ids))
      and (p_queue_key is null or department.key = p_queue_key)
      and (
        p_scope = 'all'
        or (p_scope = 'mine' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()))
        or (p_scope = 'unassigned' and ticket.assigned_agent_id is null)
        or (p_scope = 'open' and not status.is_closed)
        or (p_scope = 'closed' and status.is_closed)
      )
      and (
        p_search_assignment is null
        or (p_search_assignment = 'mine' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()))
        or (p_search_assignment = 'unassigned' and ticket.assigned_agent_id is null)
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_ticket_numbers, '{}'::text[])) as term(value)
        where ticket.ticket_number not ilike '%' || btrim(term.value) || '%'
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_statuses, '{}'::text[])) as term(value)
        where not (
          (lower(btrim(term.value)) in ('offen', 'open') and not status.is_closed)
          or (lower(btrim(term.value)) in ('geloest', 'gelöst', 'geschlossen', 'closed') and status.is_closed)
          or lower(status.label) like '%' || lower(btrim(term.value)) || '%'
        )
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_priorities, '{}'::text[])) as term(value)
        where lower(priority.label) not like '%' || lower(btrim(term.value)) || '%'
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_queues, '{}'::text[])) as term(value)
        where lower(department.key) not like '%' || lower(btrim(term.value)) || '%'
          and lower(department.name) not like '%' || lower(btrim(term.value)) || '%'
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_risks, '{}'::text[])) as term(value)
        where not (
          (term.value = 'kritisch' and ticket.resolution_due_at is not null and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour')
          or (term.value = 'warnung' and ticket.resolution_due_at > timezone('utc', now()) + interval '1 hour' and ticket.resolution_due_at <= timezone('utc', now()) + interval '4 hours')
          or (term.value = 'ok' and (ticket.resolution_due_at is null or ticket.resolution_due_at > timezone('utc', now()) + interval '4 hours'))
        )
      )
      and not exists (
        select 1
        from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
        where concat_ws(
          ' ',
          ticket.ticket_number,
          ticket.subject,
          department.key,
          department.name,
          status.label,
          priority.label
        ) not ilike '%' || btrim(term.value) || '%'
      )
  )
  select
    readable_tickets.id,
    readable_tickets.ticket_number,
    readable_tickets.subject,
    readable_tickets.department_id,
    readable_tickets.department_key,
    readable_tickets.department_name,
    readable_tickets.status_id,
    readable_tickets.status_label,
    readable_tickets.status_is_closed,
    readable_tickets.status_sort_order,
    readable_tickets.priority_id,
    readable_tickets.priority_label,
    readable_tickets.priority_sort_order,
    readable_tickets.resolution_due_at,
    readable_tickets.created_at,
    readable_tickets.updated_at,
    readable_tickets.requester_id,
    readable_tickets.assigned_agent_id,
    count(*) over () as matching_ticket_count
  from readable_tickets
  order by
    case when p_sort_by = 'agent' and readable_tickets.assigned_agent_id is null then 1 else 0 end asc,
    case when p_sort_by = 'updated' and p_sort_direction = 'asc' then readable_tickets.updated_at end asc nulls last,
    case when p_sort_by = 'updated' and p_sort_direction = 'desc' then readable_tickets.updated_at end desc nulls last,
    case when p_sort_by = 'agent' and p_sort_direction = 'asc' then coalesce(array_position(p_agent_sort_order, readable_tickets.assigned_agent_id), 2147483647) end asc,
    case when p_sort_by = 'agent' and p_sort_direction = 'desc' then coalesce(array_position(p_agent_sort_order, readable_tickets.assigned_agent_id), -1) end desc,
    case when p_sort_by = 'status' and p_sort_direction = 'asc' then readable_tickets.status_sort_order end asc nulls last,
    case when p_sort_by = 'status' and p_sort_direction = 'desc' then readable_tickets.status_sort_order end desc nulls last,
    case when p_sort_by = 'department' and p_sort_direction = 'asc' then lower(readable_tickets.department_name) end asc nulls last,
    case when p_sort_by = 'department' and p_sort_direction = 'desc' then lower(readable_tickets.department_name) end desc nulls last,
    case when p_sort_by = 'priority' and p_sort_direction = 'asc' then readable_tickets.priority_sort_order end asc nulls last,
    case when p_sort_by = 'priority' and p_sort_direction = 'desc' then readable_tickets.priority_sort_order end desc nulls last,
    readable_tickets.id asc
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function public.list_authorized_ticket_list_page(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[]) from public, anon;
grant execute on function public.list_authorized_ticket_list_page(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[]) to authenticated;

commit;
