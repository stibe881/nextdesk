begin;

set local search_path = pg_catalog, public;

-- 0232: Bericht-Drilldown, «Zuletzt angesehen», geräteübergreifende
-- Antwortentwürfe.

-- ---------------------------------------------------------------------------
-- 1. Drilldown: ticket list with the additional report dimensions.
--    A separate name keeps the existing list function (and its callers)
--    unambiguous; an overload with extra defaulted parameters would make
--    calls with the old argument set ambiguous.
-- ---------------------------------------------------------------------------

-- Resolution SLA breached: a due date exists and the ticket was resolved after
-- it, or is still unresolved past it. Same basis as the report SLA compliance.
create or replace function public.ticket_resolution_sla_breached(
  p_resolution_due_at timestamptz,
  p_resolved_at timestamptz,
  p_closed_at timestamptz
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_resolution_due_at is not null
    and coalesce(p_resolved_at, p_closed_at, timezone('utc', now())) > p_resolution_due_at;
$$;
revoke all on function public.ticket_resolution_sla_breached(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.ticket_resolution_sla_breached(timestamptz, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.list_authorized_ticket_list_page_v2(
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
  p_category_ids uuid[] default null,
  p_team_ids uuid[] default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_resolved_from timestamptz default null,
  p_resolved_to timestamptz default null,
  p_sla_breached boolean default null,
  p_support_level smallint default null
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
      -- Report drilldown dimensions (0232).
      and (
        p_category_ids is null
        or ticket.category_id = any(p_category_ids)
        or ticket.subcategory_id = any(p_category_ids)
      )
      and (p_team_ids is null or ticket.assigned_team_id = any(p_team_ids))
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
        or public.ticket_resolution_sla_breached(ticket.resolution_due_at, ticket.resolved_at, ticket.closed_at) = p_sla_breached
      )
      -- Support level queue (0230): the level comes from the assigned team.
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

revoke all on function public.list_authorized_ticket_list_page_v2(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], uuid[], uuid[], timestamptz, timestamptz, timestamptz, timestamptz, boolean, smallint) from public, anon;
grant execute on function public.list_authorized_ticket_list_page_v2(uuid, uuid[], uuid[], uuid[], uuid, boolean, text, text, integer, integer, text, text, text[], text[], text[], text[], text[], text, text[], uuid[], uuid[], uuid[], uuid[], timestamptz, timestamptz, timestamptz, timestamptz, boolean, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. «Zuletzt angesehen»: per-user list of recently opened tickets, assets and
--    knowledge articles, shared between web and mobile. Only the
--    recent-items edge function writes and reads it (service_role); it checks
--    read access with the caller's own RLS before returning an entry.
-- ---------------------------------------------------------------------------
create table if not exists public.user_recent_items (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  viewed_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, tenant_id, item_type, item_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recent_items'::regclass
      and conname = 'user_recent_items_item_type_check'
  ) then
    alter table public.user_recent_items
      add constraint user_recent_items_item_type_check
      check (item_type in ('ticket', 'asset', 'knowledge_article'));
  end if;
end;
$$;

create index if not exists user_recent_items_user_viewed_idx
  on public.user_recent_items (user_id, tenant_id, viewed_at desc);

alter table public.user_recent_items enable row level security;
revoke all on table public.user_recent_items from public, anon, authenticated;
grant select, insert, update, delete on table public.user_recent_items to service_role;

-- Records a view and keeps at most p_keep entries per user and tenant.
create or replace function public.record_user_recent_item(
  p_user_id uuid,
  p_tenant_id uuid,
  p_item_type text,
  p_item_id uuid,
  p_keep integer default 30
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null or p_tenant_id is null or p_item_id is null
    or p_item_type not in ('ticket', 'asset', 'knowledge_article')
    or p_keep < 1 or p_keep > 100 then
    raise exception 'Invalid recent item' using errcode = '22023';
  end if;

  insert into public.user_recent_items (user_id, tenant_id, item_type, item_id, viewed_at)
  values (p_user_id, p_tenant_id, p_item_type, p_item_id, clock_timestamp())
  on conflict (user_id, tenant_id, item_type, item_id)
  do update set viewed_at = excluded.viewed_at;

  delete from public.user_recent_items item
  where item.user_id = p_user_id
    and item.tenant_id = p_tenant_id
    and (item.item_type, item.item_id) not in (
      select kept.item_type, kept.item_id
      from public.user_recent_items kept
      where kept.user_id = p_user_id
        and kept.tenant_id = p_tenant_id
      order by kept.viewed_at desc, kept.item_id
      limit p_keep
    );
end;
$$;
revoke all on function public.record_user_recent_item(uuid, uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.record_user_recent_item(uuid, uuid, text, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Antwortentwürfe: ticket_drafts (0014) already stores one draft per
--    ticket, author and visibility. A posted comment removes the author's
--    matching draft on every device; old drafts expire after 30 days.
-- ---------------------------------------------------------------------------
create index if not exists ticket_drafts_updated_idx
  on public.ticket_drafts (updated_at);

create or replace function public.clear_ticket_draft_after_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.ticket_drafts draft
  where draft.ticket_id = new.ticket_id
    and draft.author_id = new.author_id
    and draft.visibility = new.visibility;
  return new;
end;
$$;
revoke all on function public.clear_ticket_draft_after_comment() from public, anon, authenticated;

create or replace trigger ticket_comments_clear_author_draft
  after insert on public.ticket_comments
  for each row execute function public.clear_ticket_draft_after_comment();

-- Runtime retention (called by cron): drafts untouched for 30 days or empty,
-- and recent-item entries older than 180 days.
create or replace function public.purge_stale_personal_workspace_state()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_drafts integer := 0;
  v_recent integer := 0;
begin
  delete from public.ticket_drafts draft
  where draft.updated_at < timezone('utc', now()) - interval '30 days'
    or btrim(draft.body) = '';
  get diagnostics v_drafts = row_count;

  delete from public.user_recent_items item
  where item.viewed_at < timezone('utc', now()) - interval '180 days';
  get diagnostics v_recent = row_count;

  return v_drafts + v_recent;
end;
$$;
revoke all on function public.purge_stale_personal_workspace_state() from public, anon, authenticated;
grant execute on function public.purge_stale_personal_workspace_state() to service_role;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-personal-state-retention'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('nextdesk-personal-state-retention', '41 3 * * *',
    'select public.purge_stale_personal_workspace_state();');
exception when others then
  null;
end;
$$;

commit;
