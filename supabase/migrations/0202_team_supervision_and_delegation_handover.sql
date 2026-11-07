-- Team supervision ("Vorgesetzter Agent") and delegation handover.
--
-- * New permission team.supervise and the department role "Vorgesetzter
--   Agent": the role assignment's department defines which team the person
--   supervises.
-- * New assignments to an absent agent go to the stand-in.
-- * Handover notifications at the start and end of a delegation.
-- * Early warnings to supervisors (SLA at risk, no first response).
-- * Quality reviews of resolved tickets.

insert into public.permissions (code, description, is_sensitive)
values ('team.supervise', 'Team einer Abteilung führen (Übersicht, Umverteilen, Qualität, Berichte)', true)
on conflict (code) do nothing;

-- Role "Vorgesetzter Agent": the permissions of a support agent plus
-- team.supervise, scoped to the department of the assignment.
create or replace function public.supervisor_agent_role_permissions()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'event.spaces.manage', 'event.spaces.request', 'service_tasks.execute',
    'service_tasks.read', 'shop.fulfill', 'shop.manage', 'shop.order',
    'ticket.assign', 'ticket.close', 'ticket.comment.external',
    'ticket.internal_notes.read', 'ticket.internal_notes.write',
    'ticket.read.assigned', 'ticket.read.department', 'ticket.update',
    'report.read', 'team.supervise'
  ]::text[];
$$;

create or replace function public.seed_supervisor_agent_role(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id uuid;
begin
  insert into public.roles (tenant_id, name, scope, is_system, active)
  values (p_tenant_id, 'Vorgesetzter Agent', 'department', true, true)
  on conflict (tenant_id, name) do update
    set scope = 'department', is_system = true, active = true
  returning id into v_role_id;
  insert into public.role_permissions (role_id, permission_code)
  select v_role_id, code
  from unnest(public.supervisor_agent_role_permissions()) as code
  where exists (select 1 from public.permissions permission where permission.code = code)
  on conflict (role_id, permission_code) do nothing;
  return v_role_id;
end;
$$;
revoke all on function public.seed_supervisor_agent_role(uuid)
  from public, anon, authenticated;

create or replace function public.seed_supervisor_agent_role_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_supervisor_agent_role(new.id);
  return new;
end;
$$;
revoke all on function public.seed_supervisor_agent_role_for_tenant()
  from public, anon, authenticated;
create or replace trigger tenants_seed_supervisor_agent_role
  after insert on public.tenants
  for each row execute function public.seed_supervisor_agent_role_for_tenant();

select public.seed_supervisor_agent_role(tenant.id) from public.tenants tenant;

-- People who supervise a department (team.supervise in that department).
create or replace function public.department_supervisor_ids(
  p_tenant_id uuid,
  p_department_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(distinct membership.user_id), '{}'::uuid[])
  from public.tenant_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.status = 'active'
    and public.user_has_ticket_permission_for(
      membership.user_id, p_tenant_id, p_department_id, 'team.supervise'
    );
$$;
revoke all on function public.department_supervisor_ids(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.department_supervisor_ids(uuid, uuid)
  to service_role;

-- Departments the user supervises.
create or replace function public.supervised_department_ids(
  p_tenant_id uuid,
  p_user_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(department.id), '{}'::uuid[])
  from public.departments department
  where department.tenant_id = p_tenant_id
    and department.active
    and public.user_has_ticket_permission_for(
      p_user_id, p_tenant_id, department.id, 'team.supervise'
    );
$$;
revoke all on function public.supervised_department_ids(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supervised_department_ids(uuid, uuid)
  to service_role;

create or replace function public.my_supervised_department_ids(p_tenant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select case
    when auth.uid() is null then '{}'::uuid[]
    else public.supervised_department_ids(p_tenant_id, auth.uid())
  end;
$$;
revoke all on function public.my_supervised_department_ids(uuid) from public, anon;
grant execute on function public.my_supervised_department_ids(uuid)
  to authenticated, service_role;

-- Active absences of the tenant for the agent pickers ("abwesend bis …").
create or replace function public.list_active_delegations(p_tenant_id uuid)
returns table (agent_id uuid, delegate_id uuid, ends_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select distinct on (delegation.agent_id)
    delegation.agent_id, delegation.delegate_id, delegation.ends_at
  from public.agent_delegations delegation
  where delegation.tenant_id = p_tenant_id
    and public.is_active_tenant_member(p_tenant_id)
    and delegation.ended_at is null
    and delegation.starts_at <= timezone('utc', now())
    and delegation.ends_at > timezone('utc', now())
  order by delegation.agent_id, delegation.starts_at desc;
$$;
revoke all on function public.list_active_delegations(uuid) from public, anon;
grant execute on function public.list_active_delegations(uuid)
  to authenticated, service_role;

-- New assignments to an absent agent go to the stand-in, provided the
-- stand-in may work the ticket (department permission and team).
create or replace function public.redirect_assignment_to_delegate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delegate uuid;
begin
  if new.assigned_agent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_agent_id is not distinct from old.assigned_agent_id then
    return new;
  end if;
  select delegation.delegate_id into v_delegate
  from public.agent_delegations delegation
  where delegation.tenant_id = new.tenant_id
    and delegation.agent_id = new.assigned_agent_id
    and delegation.ended_at is null
    and delegation.starts_at <= timezone('utc', now())
    and delegation.ends_at > timezone('utc', now())
  order by delegation.starts_at desc
  limit 1;
  if v_delegate is null or v_delegate = new.assigned_agent_id then
    return new;
  end if;
  if not (
    public.user_has_ticket_permission_for(v_delegate, new.tenant_id, new.department_id, 'ticket.read.assigned')
    or public.user_has_ticket_permission_for(v_delegate, new.tenant_id, new.department_id, 'ticket.read.department')
  ) then
    return new;
  end if;
  if new.assigned_team_id is not null and not exists (
    select 1 from public.team_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.team_id = new.assigned_team_id
      and membership.user_id = v_delegate
  ) then
    return new;
  end if;
  new.assigned_agent_id := v_delegate;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.redirect_assignment_to_delegate()
  from public, anon, authenticated;
create or replace trigger tickets_redirect_assignment_to_delegate
  before insert or update of assigned_agent_id on public.tickets
  for each row execute function public.redirect_assignment_to_delegate();

-- Handover notifications.
alter table public.agent_delegations
  add column if not exists handover_started_at timestamptz,
  add column if not exists handover_ended_at timestamptz;

create or replace function public.delegation_send_handover_notifications()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delegation record;
  v_sent integer := 0;
  v_agent_name text;
  v_delegate_name text;
  v_open_tickets integer;
  v_follow_ups integer;
  v_service_tasks integer;
  v_handled integer;
  v_resolved integer;
  v_period_end timestamptz;
begin
  -- Start: overview for the stand-in.
  for v_delegation in
    select * from public.agent_delegations delegation
    where delegation.handover_started_at is null
      and delegation.ended_at is null
      and delegation.starts_at <= timezone('utc', now())
      and delegation.ends_at > timezone('utc', now())
    for update skip locked
  loop
    select coalesce(nullif(btrim(display_name), ''), 'Kolleg:in') into v_agent_name
    from public.user_profiles where id = v_delegation.agent_id;
    select count(*) into v_open_tickets
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.tenant_id = v_delegation.tenant_id
      and ticket.assigned_agent_id = v_delegation.agent_id
      and not status.is_closed;
    select count(*) into v_follow_ups
    from public.experience_follow_ups follow_up
    where follow_up.tenant_id = v_delegation.tenant_id
      and follow_up.owner_id = v_delegation.agent_id
      and follow_up.resolved_at is null;
    select count(*) into v_service_tasks
    from public.service_task_occurrences occurrence
    where occurrence.tenant_id = v_delegation.tenant_id
      and occurrence.assignee_id = v_delegation.agent_id
      and occurrence.status = 'open'
      and occurrence.due_on <= (v_delegation.ends_at at time zone 'Europe/Zurich')::date;
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    values (
      v_delegation.tenant_id, v_delegation.delegate_id, null, 'delegation.started',
      jsonb_build_object(
        'delegationId', v_delegation.id,
        'agentId', v_delegation.agent_id,
        'agentName', v_agent_name,
        'endsAt', v_delegation.ends_at,
        'note', v_delegation.note,
        'openTickets', v_open_tickets,
        'openFollowUps', v_follow_ups,
        'openServiceTasks', v_service_tasks
      )
    );
    update public.agent_delegations set handover_started_at = timezone('utc', now())
    where id = v_delegation.id;
    v_sent := v_sent + 1;
  end loop;

  -- End: summary for the returning agent.
  for v_delegation in
    select * from public.agent_delegations delegation
    where delegation.handover_started_at is not null
      and delegation.handover_ended_at is null
      and (
        delegation.ended_at is not null
        or delegation.ends_at <= timezone('utc', now())
      )
    for update skip locked
  loop
    v_period_end := least(
      coalesce(v_delegation.ended_at, v_delegation.ends_at),
      v_delegation.ends_at
    );
    select coalesce(nullif(btrim(display_name), ''), 'Kolleg:in') into v_delegate_name
    from public.user_profiles where id = v_delegation.delegate_id;
    -- Tickets of the absent agent the stand-in worked on.
    select count(distinct comment.ticket_id) into v_handled
    from public.ticket_comments comment
    join public.tickets ticket on ticket.id = comment.ticket_id
    where ticket.tenant_id = v_delegation.tenant_id
      and comment.author_id = v_delegation.delegate_id
      and comment.created_at >= v_delegation.starts_at
      and comment.created_at < v_period_end
      and ticket.assigned_agent_id in (v_delegation.agent_id, v_delegation.delegate_id);
    select count(*) into v_resolved
    from public.tickets ticket
    where ticket.tenant_id = v_delegation.tenant_id
      and ticket.assigned_agent_id = v_delegation.agent_id
      and ticket.resolved_at >= v_delegation.starts_at
      and ticket.resolved_at < v_period_end;
    select count(*) into v_open_tickets
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.tenant_id = v_delegation.tenant_id
      and ticket.assigned_agent_id = v_delegation.agent_id
      and not status.is_closed;
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    values (
      v_delegation.tenant_id, v_delegation.agent_id, null, 'delegation.ended',
      jsonb_build_object(
        'delegationId', v_delegation.id,
        'delegateId', v_delegation.delegate_id,
        'delegateName', v_delegate_name,
        'startedAt', v_delegation.starts_at,
        'endedAt', v_period_end,
        'handledTickets', v_handled,
        'resolvedTickets', v_resolved,
        'openTickets', v_open_tickets
      )
    );
    update public.agent_delegations set handover_ended_at = timezone('utc', now())
    where id = v_delegation.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.delegation_send_handover_notifications()
  from public, anon, authenticated;
grant execute on function public.delegation_send_handover_notifications()
  to service_role;

-- Early warnings to supervisors.
create table if not exists public.supervisor_ticket_alerts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('sla_risk', 'no_first_response')),
  sent_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, kind)
);
alter table public.supervisor_ticket_alerts enable row level security;
revoke all on public.supervisor_ticket_alerts from anon, authenticated;
grant all on public.supervisor_ticket_alerts to service_role;

create or replace function public.supervisor_send_ticket_alerts()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_supervisor uuid;
  v_sent integer := 0;
  v_agent_name text;
begin
  for v_ticket in
    select ticket.id, ticket.tenant_id, ticket.department_id, ticket.ticket_number,
      ticket.subject, ticket.assigned_agent_id, ticket.resolution_due_at,
      case
        when ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
          then 'sla_risk'
        else 'no_first_response'
      end as alert_kind
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where not status.is_closed
      and ticket.merged_into_ticket_id is null
      and (
        (
          ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
        )
        or (
          ticket.first_responded_at is null
          and ticket.created_at <= timezone('utc', now()) - interval '24 hours'
          and ticket.created_at > timezone('utc', now()) - interval '14 days'
        )
      )
  loop
    insert into public.supervisor_ticket_alerts (tenant_id, ticket_id, kind)
    values (v_ticket.tenant_id, v_ticket.id, v_ticket.alert_kind)
    on conflict do nothing;
    if not found then
      continue;
    end if;
    v_agent_name := null;
    if v_ticket.assigned_agent_id is not null then
      select nullif(btrim(display_name), '') into v_agent_name
      from public.user_profiles where id = v_ticket.assigned_agent_id;
    end if;
    foreach v_supervisor in array public.department_supervisor_ids(v_ticket.tenant_id, v_ticket.department_id)
    loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_ticket.tenant_id, v_supervisor, v_ticket.id,
        case v_ticket.alert_kind
          when 'sla_risk' then 'ticket.sla.supervisor_risk'
          else 'ticket.sla.supervisor_no_response'
        end,
        jsonb_build_object(
          'ticketNumber', v_ticket.ticket_number,
          'subject', v_ticket.subject,
          'agentName', v_agent_name,
          'resolutionDueAt', v_ticket.resolution_due_at,
          'supervisorAlert', true
        )
      );
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.supervisor_send_ticket_alerts()
  from public, anon, authenticated;
grant execute on function public.supervisor_send_ticket_alerts()
  to service_role;

-- Quality reviews of resolved tickets.
create table if not exists public.ticket_supervisor_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  agent_id uuid references public.user_profiles(id) on delete set null,
  reviewer_id uuid references public.user_profiles(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  solution_correct boolean not null,
  tone_appropriate boolean not null,
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id)
);
create index if not exists ticket_supervisor_reviews_agent_idx
  on public.ticket_supervisor_reviews (tenant_id, agent_id, created_at desc);
alter table public.ticket_supervisor_reviews enable row level security;
revoke all on public.ticket_supervisor_reviews from anon, authenticated;
grant all on public.ticket_supervisor_reviews to service_role;

-- Schedules (every five minutes).
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in
    select jobid from cron.job
    where jobname in ('nextdesk-delegation-handover', 'nextdesk-supervisor-alerts')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-delegation-handover',
    '*/5 * * * *',
    'select public.delegation_send_handover_notifications();'
  );
  perform cron.schedule(
    'nextdesk-supervisor-alerts',
    '*/5 * * * *',
    'select public.supervisor_send_ticket_alerts();'
  );
exception when others then
  null;
end;
$$;
