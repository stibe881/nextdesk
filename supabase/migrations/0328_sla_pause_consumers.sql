-- SLA-Pause: remaining consumers (follow-up of 0324_sla_pause)
--
-- A ticket with tickets.sla_paused_at (waiting status) never counts as
-- kritisch, warnung or breached because of its frozen due date:
--
-- * ticket_resolution_sla_breached(due, resolved, closed, sla_paused_at):
--   new overload (the 3-argument version stays for existing callers). An
--   open ticket whose SLA is paused is not breached; resolved/closed tickets
--   are judged against their stored (pause-extended) due date as before.
--   Used by the report drilldown filter p_sla_breached of
--   list_authorized_ticket_list_page_v2.
-- * Ticket list search sla:/risiko: in list_authorized_ticket_list_page,
--   list_authorized_ticket_list_page_by_level and
--   list_authorized_ticket_list_page_v2 (signatures unchanged): kritisch,
--   warnung and ok only match tickets whose SLA runs; the new value
--   «pausiert» matches tickets with a paused SLA.
-- * First response during a pause: 0324 moves response_due_at at resume only
--   while there is no first response. A reply written while the ticket waits
--   left the frozen response target in place, so reports and the breach
--   reason gate saw a late first response. Trigger tickets_sla_pause_response
--   now moves response_due_at by the paused service time up to the first
--   response (same rules as 0324: targets breached before the pause stay).
--   Backfill for first responses inside a pause since 0324.

begin;
set local search_path = pg_catalog, public;

create or replace function public.ticket_resolution_sla_breached(
  p_resolution_due_at timestamptz,
  p_resolved_at timestamptz,
  p_closed_at timestamptz,
  p_sla_paused_at timestamptz
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_resolution_due_at is not null
    and (
      p_resolved_at is not null
      or p_closed_at is not null
      or p_sla_paused_at is null
    )
    and coalesce(p_resolved_at, p_closed_at, timezone('utc', now())) > p_resolution_due_at;
$$;
revoke all on function public.ticket_resolution_sla_breached(timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.ticket_resolution_sla_breached(timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

-- First response while the SLA is paused: the response target was still
-- running at the pause start, so it moves by the paused time up to the reply.
-- Uses old.sla_paused_at, so it also works when the same update ends the
-- pause (tickets_sla_pause runs first and leaves a responded target alone).
create or replace function public.tickets_sla_pause_first_response()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_until timestamptz;
  v_service_hours jsonb;
  v_timezone text;
  v_minutes numeric;
begin
  if old.sla_paused_at is null
     or old.first_responded_at is not null
     or new.first_responded_at is null
     or new.response_due_at is null
     or new.response_due_at <= old.sla_paused_at
     or exists (
       select 1 from public.ticket_sla_events event
        where event.ticket_id = new.id and event.event_type = 'response_breached'
     ) then
    return new;
  end if;

  v_until := least(
    greatest(new.first_responded_at, old.sla_paused_at),
    timezone('utc', now()));
  select window_row.service_hours, window_row.timezone
    into v_service_hours, v_timezone
    from public.ticket_sla_service_window(new.id, new.tenant_id, new.department_id) window_row;
  v_minutes := greatest(
    public.sla_service_minutes_between(old.sla_paused_at, v_until, v_service_hours, v_timezone),
    0);
  new.response_due_at := public.sla_extend_due_by_pause(
    new.response_due_at, old.sla_paused_at, v_until, v_minutes,
    v_service_hours, v_timezone);
  return new;
end;
$$;
revoke all on function public.tickets_sla_pause_first_response() from public, anon, authenticated;

create or replace trigger tickets_sla_pause_response
  before update of first_responded_at on public.tickets
  for each row
  when (old.sla_paused_at is not null
        and old.first_responded_at is null
        and new.first_responded_at is not null)
  execute function public.tickets_sla_pause_first_response();

-- Backfill: first responses given inside a pause (running, or ended and
-- logged by 0324 as a 'resumed' event with metadata.pause) whose response
-- target was still running at the pause start. tickets.updated_at is kept.
alter table public.tickets disable trigger tickets_updated_at;
do $$
declare
  v_row record;
  v_service_hours jsonb;
  v_timezone text;
  v_minutes numeric;
begin
  for v_row in
    select ticket.id, ticket.tenant_id, ticket.department_id,
           ticket.response_due_at, ticket.first_responded_at, pause.paused_at
      from public.tickets ticket
      cross join lateral (
        select ticket.sla_paused_at as paused_at
         where ticket.sla_paused_at is not null
           and ticket.first_responded_at >= ticket.sla_paused_at
        union all
        select (event.metadata ->> 'pausedAt')::timestamptz
          from public.ticket_sla_events event
         where event.ticket_id = ticket.id
           and event.event_type = 'resumed'
           and event.metadata ->> 'pause' = 'true'
           and event.metadata ->> 'pausedAt' is not null
           and ticket.first_responded_at >= (event.metadata ->> 'pausedAt')::timestamptz
           and ticket.first_responded_at <= event.occurred_at
      ) pause
     where ticket.first_responded_at is not null
       and ticket.response_due_at is not null
       and ticket.response_due_at > pause.paused_at
       and not exists (
         select 1 from public.ticket_sla_events event
          where event.ticket_id = ticket.id and event.event_type = 'response_breached'
       )
  loop
    select window_row.service_hours, window_row.timezone
      into v_service_hours, v_timezone
      from public.ticket_sla_service_window(v_row.id, v_row.tenant_id, v_row.department_id) window_row;
    v_minutes := greatest(
      public.sla_service_minutes_between(
        v_row.paused_at, v_row.first_responded_at, v_service_hours, v_timezone),
      0);
    update public.tickets ticket
       set response_due_at = public.sla_extend_due_by_pause(
             v_row.response_due_at, v_row.paused_at, v_row.first_responded_at,
             v_minutes, v_service_hours, v_timezone)
     where ticket.id = v_row.id;
  end loop;
end;
$$;
alter table public.tickets enable trigger tickets_updated_at;

-- Ticket lists: SLA search terms are pause-aware, new term «pausiert».
create or replace function public.list_authorized_ticket_list_page(p_tenant_id uuid, p_status_ids uuid[] DEFAULT NULL::uuid[], p_priority_ids uuid[] DEFAULT NULL::uuid[], p_department_ids uuid[] DEFAULT NULL::uuid[], p_assigned_agent_id uuid DEFAULT NULL::uuid, p_only_unassigned boolean DEFAULT false, p_sort_by text DEFAULT 'updated'::text, p_sort_direction text DEFAULT 'desc'::text, p_limit integer DEFAULT 51, p_offset integer DEFAULT 0, p_scope text DEFAULT 'all'::text, p_queue_key text DEFAULT NULL::text, p_search_ticket_numbers text[] DEFAULT NULL::text[], p_search_statuses text[] DEFAULT NULL::text[], p_search_priorities text[] DEFAULT NULL::text[], p_search_queues text[] DEFAULT NULL::text[], p_search_risks text[] DEFAULT NULL::text[], p_search_assignment text DEFAULT NULL::text, p_search_free_text text[] DEFAULT NULL::text[], p_metric_ticket_ids uuid[] DEFAULT NULL::uuid[], p_agent_sort_order uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, ticket_number text, subject text, department_id uuid, department_key text, department_name text, status_id uuid, status_label text, status_is_closed boolean, status_sort_order smallint, priority_id uuid, priority_label text, priority_sort_order smallint, resolution_due_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, requester_id uuid, assigned_agent_id uuid, matching_ticket_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_free_text_query text;
begin
  if p_tenant_id is null
    or p_sort_by not in ('updated', 'agent', 'status', 'department', 'priority')
    or p_sort_direction not in ('asc', 'desc')
    or p_scope not in ('all', 'mine', 'unassigned', 'open', 'closed', 'delegated')
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
      where term.value not in ('ok', 'warnung', 'kritisch', 'pausiert')
    )
    or coalesce(cardinality(p_search_free_text), 0) > 12
    or exists (
      select 1
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) > 120
    ) then
    raise exception 'Invalid authorized ticket list request' using errcode = '22023';
  end if;

  select array_to_string(
    array(
      select btrim(term.value)
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) >= 2
    ),
    ' '
  )
  into v_free_text_query;

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
        or (
          p_scope = 'delegated'
          and ticket.assigned_agent_id = any(public.my_delegators(p_tenant_id))
        )
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
          -- SLA pause (0325): a paused ticket is only «pausiert», never
          -- kritisch/warnung/ok by its frozen due date.
          (term.value = 'kritisch' and ticket.sla_paused_at is null and ticket.resolution_due_at is not null and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour')
          or (term.value = 'warnung' and ticket.sla_paused_at is null and ticket.resolution_due_at > timezone('utc', now()) + interval '1 hour' and ticket.resolution_due_at <= timezone('utc', now()) + interval '4 hours')
          or (term.value = 'ok' and ticket.sla_paused_at is null and (ticket.resolution_due_at is null or ticket.resolution_due_at > timezone('utc', now()) + interval '4 hours'))
          or (term.value = 'pausiert' and ticket.sla_paused_at is not null)
        )
      )
      -- The global search migration already provides the matching German GIN
      -- expression index. This list-specific path keeps that same index and
      -- never evaluates text outside the existing can_read_ticket scope.
      and (
        coalesce(v_free_text_query, '') = ''
        or (
          setweight(to_tsvector('german'::regconfig, coalesce(ticket.ticket_number, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.subject, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.description, '')), 'B')
        ) @@ websearch_to_tsquery(
          'german'::regconfig,
          v_free_text_query
        )
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
$function$;
revoke all on function public.list_authorized_ticket_list_page(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[]) from public, anon;
grant execute on function public.list_authorized_ticket_list_page(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[]) to authenticated;

create or replace function public.list_authorized_ticket_list_page_by_level(p_tenant_id uuid, p_status_ids uuid[] DEFAULT NULL::uuid[], p_priority_ids uuid[] DEFAULT NULL::uuid[], p_department_ids uuid[] DEFAULT NULL::uuid[], p_assigned_agent_id uuid DEFAULT NULL::uuid, p_only_unassigned boolean DEFAULT false, p_sort_by text DEFAULT 'updated'::text, p_sort_direction text DEFAULT 'desc'::text, p_limit integer DEFAULT 51, p_offset integer DEFAULT 0, p_scope text DEFAULT 'all'::text, p_queue_key text DEFAULT NULL::text, p_search_ticket_numbers text[] DEFAULT NULL::text[], p_search_statuses text[] DEFAULT NULL::text[], p_search_priorities text[] DEFAULT NULL::text[], p_search_queues text[] DEFAULT NULL::text[], p_search_risks text[] DEFAULT NULL::text[], p_search_assignment text DEFAULT NULL::text, p_search_free_text text[] DEFAULT NULL::text[], p_metric_ticket_ids uuid[] DEFAULT NULL::uuid[], p_agent_sort_order uuid[] DEFAULT NULL::uuid[], p_support_level smallint DEFAULT 1)
 RETURNS TABLE(id uuid, ticket_number text, subject text, department_id uuid, department_key text, department_name text, status_id uuid, status_label text, status_is_closed boolean, status_sort_order smallint, priority_id uuid, priority_label text, priority_sort_order smallint, resolution_due_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, requester_id uuid, assigned_agent_id uuid, matching_ticket_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_free_text_query text;
begin
  if p_tenant_id is null
    or p_sort_by not in ('updated', 'agent', 'status', 'department', 'priority')
    or p_sort_direction not in ('asc', 'desc')
    or p_scope not in ('all', 'mine', 'unassigned', 'open', 'closed', 'delegated')
    or p_search_assignment not in ('mine', 'unassigned')
    or (p_queue_key is not null and p_queue_key !~ '^[a-z][a-z0-9_-]{0,63}$')
    or p_support_level is null
    or p_support_level not between 1 and 3
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
      where term.value not in ('ok', 'warnung', 'kritisch', 'pausiert')
    )
    or coalesce(cardinality(p_search_free_text), 0) > 12
    or exists (
      select 1
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) > 120
    ) then
    raise exception 'Invalid authorized ticket list request' using errcode = '22023';
  end if;

  select array_to_string(
    array(
      select btrim(term.value)
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) >= 2
    ),
    ' '
  )
  into v_free_text_query;

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
      -- Support level queue: the level comes from the assigned team.
      and exists (
        select 1
        from public.teams level_team
        where level_team.id = ticket.assigned_team_id
          and level_team.tenant_id = ticket.tenant_id
          and level_team.support_level = p_support_level
      )
      and (
        p_scope = 'all'
        or (p_scope = 'mine' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()))
        or (p_scope = 'unassigned' and ticket.assigned_agent_id is null)
        or (p_scope = 'open' and not status.is_closed)
        or (p_scope = 'closed' and status.is_closed)
        or (
          p_scope = 'delegated'
          and ticket.assigned_agent_id = any(public.my_delegators(p_tenant_id))
        )
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
          -- SLA pause (0325): a paused ticket is only «pausiert», never
          -- kritisch/warnung/ok by its frozen due date.
          (term.value = 'kritisch' and ticket.sla_paused_at is null and ticket.resolution_due_at is not null and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour')
          or (term.value = 'warnung' and ticket.sla_paused_at is null and ticket.resolution_due_at > timezone('utc', now()) + interval '1 hour' and ticket.resolution_due_at <= timezone('utc', now()) + interval '4 hours')
          or (term.value = 'ok' and ticket.sla_paused_at is null and (ticket.resolution_due_at is null or ticket.resolution_due_at > timezone('utc', now()) + interval '4 hours'))
          or (term.value = 'pausiert' and ticket.sla_paused_at is not null)
        )
      )
      -- The global search migration already provides the matching German GIN
      -- expression index. This list-specific path keeps that same index and
      -- never evaluates text outside the existing can_read_ticket scope.
      and (
        coalesce(v_free_text_query, '') = ''
        or (
          setweight(to_tsvector('german'::regconfig, coalesce(ticket.ticket_number, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.subject, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.description, '')), 'B')
        ) @@ websearch_to_tsquery(
          'german'::regconfig,
          v_free_text_query
        )
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
$function$;
revoke all on function public.list_authorized_ticket_list_page_by_level(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], smallint) from public, anon;
grant execute on function public.list_authorized_ticket_list_page_by_level(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], smallint) to authenticated;

create or replace function public.list_authorized_ticket_list_page_v2(p_tenant_id uuid, p_status_ids uuid[] DEFAULT NULL::uuid[], p_priority_ids uuid[] DEFAULT NULL::uuid[], p_department_ids uuid[] DEFAULT NULL::uuid[], p_assigned_agent_id uuid DEFAULT NULL::uuid, p_only_unassigned boolean DEFAULT false, p_sort_by text DEFAULT 'updated'::text, p_sort_direction text DEFAULT 'desc'::text, p_limit integer DEFAULT 51, p_offset integer DEFAULT 0, p_scope text DEFAULT 'all'::text, p_queue_key text DEFAULT NULL::text, p_search_ticket_numbers text[] DEFAULT NULL::text[], p_search_statuses text[] DEFAULT NULL::text[], p_search_priorities text[] DEFAULT NULL::text[], p_search_queues text[] DEFAULT NULL::text[], p_search_risks text[] DEFAULT NULL::text[], p_search_assignment text DEFAULT NULL::text, p_search_free_text text[] DEFAULT NULL::text[], p_metric_ticket_ids uuid[] DEFAULT NULL::uuid[], p_agent_sort_order uuid[] DEFAULT NULL::uuid[], p_category_ids uuid[] DEFAULT NULL::uuid[], p_team_ids uuid[] DEFAULT NULL::uuid[], p_created_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_resolved_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_resolved_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_sla_breached boolean DEFAULT NULL::boolean, p_support_level smallint DEFAULT NULL::smallint)
 RETURNS TABLE(id uuid, ticket_number text, subject text, department_id uuid, department_key text, department_name text, status_id uuid, status_label text, status_is_closed boolean, status_sort_order smallint, priority_id uuid, priority_label text, priority_sort_order smallint, resolution_due_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, requester_id uuid, assigned_agent_id uuid, matching_ticket_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_free_text_query text;
begin
  if p_tenant_id is null
    or p_sort_by not in ('updated', 'agent', 'status', 'department', 'priority')
    or p_sort_direction not in ('asc', 'desc')
    or p_scope not in ('all', 'mine', 'unassigned', 'open', 'closed', 'delegated')
    or p_search_assignment not in ('mine', 'unassigned')
    or (p_queue_key is not null and p_queue_key !~ '^[a-z][a-z0-9_-]{0,63}$')
    or p_limit < 1
    or p_limit > 100
    or p_offset < 0
    or coalesce(cardinality(p_metric_ticket_ids), 0) > 500
    or coalesce(cardinality(p_agent_sort_order), 0) > 1000
    or coalesce(cardinality(p_category_ids), 0) > 200
    or coalesce(cardinality(p_team_ids), 0) > 200
    or (p_created_from is not null and p_created_to is not null and p_created_from > p_created_to)
    or (p_resolved_from is not null and p_resolved_to is not null and p_resolved_from > p_resolved_to)
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
      where term.value not in ('ok', 'warnung', 'kritisch', 'pausiert')
    )
    or coalesce(cardinality(p_search_free_text), 0) > 12
    or exists (
      select 1
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) > 120
    ) then
    raise exception 'Invalid authorized ticket list request' using errcode = '22023';
  end if;

  select array_to_string(
    array(
      select btrim(term.value)
      from unnest(coalesce(p_search_free_text, '{}'::text[])) as term(value)
      where char_length(btrim(term.value)) >= 2
    ),
    ' '
  )
  into v_free_text_query;

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
      -- Report drilldown dimensions (0232).
      and (
        p_category_ids is null
        or ticket.category_id = any(p_category_ids)
        or ticket.subcategory_id = any(p_category_ids)
      )
      and (p_team_ids is null or ticket.assigned_team_id = any(p_team_ids) or (ticket.assigned_team_id is null and '00000000-0000-0000-0000-000000000000'::uuid = any(p_team_ids)))
      and (p_created_from is null or ticket.created_at >= p_created_from)
      and (p_created_to is null or ticket.created_at <= p_created_to)
      and (
        (p_resolved_from is null and p_resolved_to is null)
        or (
          coalesce(ticket.resolved_at, ticket.closed_at) is not null
          and (p_resolved_from is null or coalesce(ticket.resolved_at, ticket.closed_at) >= p_resolved_from)
          and (p_resolved_to is null or coalesce(ticket.resolved_at, ticket.closed_at) <= p_resolved_to)
        )
      )
      and (
        p_sla_breached is null
        or public.ticket_resolution_sla_breached(ticket.resolution_due_at, ticket.resolved_at, ticket.closed_at, ticket.sla_paused_at) = p_sla_breached
      )
      -- Support level queue (0230): the level comes from the assigned team.
      and not ticket.is_security_case
      and (
        p_support_level is null
        or exists (
          select 1
          from public.teams level_team
          where level_team.id = ticket.assigned_team_id
            and level_team.tenant_id = ticket.tenant_id
            and level_team.support_level = p_support_level
        )
      )
      and (
        p_scope = 'all'
        or (p_scope = 'mine' and (ticket.assigned_agent_id = auth.uid() or ticket.requester_id = auth.uid()))
        or (p_scope = 'unassigned' and ticket.assigned_agent_id is null)
        or (p_scope = 'open' and not status.is_closed)
        or (p_scope = 'closed' and status.is_closed)
        or (
          p_scope = 'delegated'
          and ticket.assigned_agent_id = any(public.my_delegators(p_tenant_id))
        )
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
          -- SLA pause (0325): a paused ticket is only «pausiert», never
          -- kritisch/warnung/ok by its frozen due date.
          (term.value = 'kritisch' and ticket.sla_paused_at is null and ticket.resolution_due_at is not null and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour')
          or (term.value = 'warnung' and ticket.sla_paused_at is null and ticket.resolution_due_at > timezone('utc', now()) + interval '1 hour' and ticket.resolution_due_at <= timezone('utc', now()) + interval '4 hours')
          or (term.value = 'ok' and ticket.sla_paused_at is null and (ticket.resolution_due_at is null or ticket.resolution_due_at > timezone('utc', now()) + interval '4 hours'))
          or (term.value = 'pausiert' and ticket.sla_paused_at is not null)
        )
      )
      -- The global search migration already provides the matching German GIN
      -- expression index. This list-specific path keeps that same index and
      -- never evaluates text outside the existing can_read_ticket scope.
      and (
        coalesce(v_free_text_query, '') = ''
        or (
          setweight(to_tsvector('german'::regconfig, coalesce(ticket.ticket_number, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.subject, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(ticket.description, '')), 'B')
        ) @@ websearch_to_tsquery(
          'german'::regconfig,
          v_free_text_query
        )
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
$function$;
revoke all on function public.list_authorized_ticket_list_page_v2(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], uuid[], uuid[], timestamptz, timestamptz, timestamptz, timestamptz, boolean, smallint) from public, anon;
grant execute on function public.list_authorized_ticket_list_page_v2(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], uuid[], uuid[], timestamptz, timestamptz, timestamptz, timestamptz, boolean, smallint) to authenticated;

notify pgrst, 'reload schema';

commit;
