begin;

set local search_path = pg_catalog, public;

-- Eskalationsstufen (1st/2nd/3rd Level Support).
-- Levels build on the existing teams: a team of a department may carry a
-- support level 1-3. A ticket's current level is derived from its assigned
-- team; every level change is recorded in ticket_support_level_changes
-- (history for the report: first-level resolution, time per level). A level
-- handover ("An nächste Stufe übergeben" / "Zurück an Stufe X") stores a
-- mandatory note as an internal comment and links it to the change.
-- This is independent of ticket_escalations (management escalation to
-- supervisors, event ticket.escalation_opened).

alter table public.teams
  add column if not exists support_level smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'teams_support_level_check'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_support_level_check
      check (support_level is null or support_level between 1 and 3);
  end if;
end;
$$;

create index if not exists teams_tenant_department_support_level_idx
  on public.teams (tenant_id, department_id, support_level)
  where support_level is not null;

create table if not exists public.ticket_support_level_changes (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  department_id uuid not null,
  from_level smallint check (from_level is null or from_level between 1 and 3),
  to_level smallint check (to_level is null or to_level between 1 and 3),
  from_team_id uuid references public.teams(id) on delete set null,
  to_team_id uuid references public.teams(id) on delete set null,
  kind text not null check (kind in ('initial', 'escalated', 'returned', 'cleared')),
  handover_note text check (
    handover_note is null or char_length(btrim(handover_note)) between 10 and 4000
  ),
  comment_id uuid references public.ticket_comments(id) on delete set null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint ticket_support_level_changes_level_differs
    check (from_level is distinct from to_level)
);

create index if not exists ticket_support_level_changes_ticket_seq_idx
  on public.ticket_support_level_changes (ticket_id, seq);
create index if not exists ticket_support_level_changes_tenant_created_idx
  on public.ticket_support_level_changes (tenant_id, created_at);

alter table public.ticket_support_level_changes enable row level security;
alter table public.ticket_support_level_changes force row level security;
revoke all on table public.ticket_support_level_changes from public, anon, authenticated;
grant all on table public.ticket_support_level_changes to service_role;

-- Level of a team (null: team without level or no team).
create or replace function public.team_support_level(p_team_id uuid)
returns smallint
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select team.support_level from public.teams team where team.id = p_team_id;
$$;

revoke all on function public.team_support_level(uuid) from public, anon, authenticated;
grant execute on function public.team_support_level(uuid) to service_role;

-- Records every change of the derived level. A handover RPC passes its note
-- through the transaction-local setting nextdesk.support_level_handover.
create or replace function public.record_ticket_support_level_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_level smallint;
  v_new_level smallint;
  v_kind text;
  v_context jsonb;
  v_actor uuid;
  v_header_actor text;
begin
  if tg_op = 'UPDATE' and new.assigned_team_id is not distinct from old.assigned_team_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- The last recorded level wins over the old team's current level, so a
    -- later change of the team configuration does not rewrite history.
    select change.to_level into v_old_level
    from public.ticket_support_level_changes change
    where change.ticket_id = new.id
    order by change.seq desc
    limit 1;
    if not found then
      v_old_level := public.team_support_level(old.assigned_team_id);
    end if;
  end if;
  v_new_level := public.team_support_level(new.assigned_team_id);

  if v_old_level is not distinct from v_new_level then
    return new;
  end if;

  v_kind := case
    when v_old_level is null then 'initial'
    when v_new_level is null then 'cleared'
    when v_new_level > v_old_level then 'escalated'
    else 'returned'
  end;

  begin
    v_context := nullif(current_setting('nextdesk.support_level_handover', true), '')::jsonb;
  exception when others then
    v_context := null;
  end;
  if v_context is not null and v_context ->> 'ticketId' is distinct from new.id::text then
    v_context := null;
  end if;

  begin
    v_header_actor := nullif(current_setting('request.headers', true), '')::jsonb
      ->> 'x-nextdesk-actor-id';
  exception when others then
    v_header_actor := null;
  end;
  v_actor := coalesce(
    nullif(v_context ->> 'actorId', '')::uuid,
    case when v_header_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then v_header_actor::uuid end,
    auth.uid()
  );
  if v_actor is not null
    and not exists (select 1 from public.user_profiles where id = v_actor) then
    v_actor := null;
  end if;

  insert into public.ticket_support_level_changes (
    tenant_id, ticket_id, department_id, from_level, to_level,
    from_team_id, to_team_id, kind, handover_note, comment_id, actor_id
  )
  values (
    new.tenant_id,
    new.id,
    new.department_id,
    v_old_level,
    v_new_level,
    case when tg_op = 'UPDATE' then old.assigned_team_id end,
    new.assigned_team_id,
    v_kind,
    nullif(btrim(v_context ->> 'note'), ''),
    nullif(v_context ->> 'commentId', '')::uuid,
    v_actor
  );
  return new;
end;
$$;

revoke all on function public.record_ticket_support_level_change() from public, anon, authenticated;

create or replace trigger tickets_record_support_level_change
after insert or update of assigned_team_id on public.tickets
for each row execute function public.record_ticket_support_level_change();

-- Atomic level handover: internal comment with the note, team (and optional
-- agent) change, history row and ticket event. Permissions are checked by
-- the Edge Function ticket-support-levels; only service_role may call this.
create or replace function public.ticket_support_level_handover(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_target_team_id uuid,
  p_target_agent_id uuid,
  p_note text,
  p_expected_level smallint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_closed boolean;
  v_current_level smallint;
  v_target public.teams%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_direction text;
  v_comment_id uuid;
  v_change_id uuid;
  v_level_label text;
begin
  if p_actor_id is null or p_target_team_id is null
    or char_length(v_note) not between 10 and 4000 then
    raise exception 'support_level_handover_invalid'
      using errcode = '22023', hint = 'support_level_handover_invalid';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002', hint = 'ticket_not_found';
  end if;
  select is_closed into v_closed from public.ticket_statuses where id = v_ticket.status_id;
  if coalesce(v_closed, false) or v_ticket.merged_into_ticket_id is not null then
    raise exception 'support_level_ticket_closed'
      using errcode = '22023', hint = 'support_level_ticket_closed';
  end if;

  v_current_level := public.team_support_level(v_ticket.assigned_team_id);
  if v_current_level is null then
    raise exception 'support_level_current_missing'
      using errcode = '22023', hint = 'support_level_current_missing';
  end if;
  if p_expected_level is not null and p_expected_level is distinct from v_current_level then
    raise exception 'support_level_changed'
      using errcode = '40001', hint = 'support_level_changed';
  end if;

  select * into v_target
  from public.teams
  where id = p_target_team_id
    and tenant_id = p_tenant_id
    and department_id = v_ticket.department_id
    and active
  for share;
  if not found or v_target.support_level is null then
    raise exception 'support_level_target_invalid'
      using errcode = '22023', hint = 'support_level_target_invalid';
  end if;
  if v_target.support_level = v_current_level + 1 then
    v_direction := 'escalated';
  elsif v_target.support_level < v_current_level then
    v_direction := 'returned';
  else
    raise exception 'support_level_target_invalid'
      using errcode = '22023', hint = 'support_level_target_invalid';
  end if;

  v_level_label := case v_target.support_level
    when 1 then '1st Level' when 2 then '2nd Level' else '3rd Level' end;
  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
  values (
    v_ticket.id,
    p_actor_id,
    'internal',
    case when v_direction = 'escalated'
      then 'Übergabe an ' || v_level_label || ' (' || v_target.name || ')'
      else 'Zurück an ' || v_level_label || ' (' || v_target.name || ')'
    end || E'\n\n' || v_note
  )
  returning id into v_comment_id;

  perform set_config(
    'nextdesk.support_level_handover',
    jsonb_build_object(
      'ticketId', v_ticket.id,
      'actorId', p_actor_id,
      'note', v_note,
      'commentId', v_comment_id
    )::text,
    true
  );
  update public.tickets
  set assigned_team_id = v_target.id,
      assigned_agent_id = p_target_agent_id
  where id = v_ticket.id;
  perform set_config('nextdesk.support_level_handover', '', true);

  select change.id into v_change_id
  from public.ticket_support_level_changes change
  where change.ticket_id = v_ticket.id and change.comment_id = v_comment_id
  order by change.seq desc
  limit 1;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    p_actor_id,
    'ticket.support_level_changed',
    jsonb_build_object(
      'direction', v_direction,
      'fromLevel', v_current_level,
      'toLevel', v_target.support_level,
      'fromTeamId', v_ticket.assigned_team_id,
      'toTeamId', v_target.id,
      'toTeamName', v_target.name,
      'toAgentId', p_target_agent_id,
      'commentId', v_comment_id,
      'changeId', v_change_id
    )
  );

  return jsonb_build_object(
    'direction', v_direction,
    'fromLevel', v_current_level,
    'toLevel', v_target.support_level,
    'teamId', v_target.id,
    'commentId', v_comment_id,
    'changeId', v_change_id
  );
end;
$$;

revoke all on function public.ticket_support_level_handover(uuid, uuid, uuid, uuid, uuid, text, smallint)
  from public, anon, authenticated;
grant execute on function public.ticket_support_level_handover(uuid, uuid, uuid, uuid, uuid, text, smallint)
  to service_role;

-- Ticket list for one support level queue (e.g. «2nd Level Warteschlange»).
-- Same rules as list_authorized_ticket_list_page (0201) plus the level of the
-- assigned team. A separate function keeps the existing signature untouched.
create or replace function public.list_authorized_ticket_list_page_by_level(
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
  p_agent_sort_order uuid[] default null,
  p_support_level smallint default 1
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
      where term.value not in ('ok', 'warnung', 'kritisch')
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
          (term.value = 'kritisch' and ticket.resolution_due_at is not null and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour')
          or (term.value = 'warnung' and ticket.resolution_due_at > timezone('utc', now()) + interval '1 hour' and ticket.resolution_due_at <= timezone('utc', now()) + interval '4 hours')
          or (term.value = 'ok' and (ticket.resolution_due_at is null or ticket.resolution_due_at > timezone('utc', now()) + interval '4 hours'))
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
$$;

revoke all on function public.list_authorized_ticket_list_page_by_level(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], smallint) from public, anon;
grant execute on function public.list_authorized_ticket_list_page_by_level(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], smallint) to authenticated;

commit;
