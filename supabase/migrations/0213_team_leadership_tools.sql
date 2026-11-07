begin;

set local search_path = pg_catalog, public;

-- Team leadership tools: skill matrix, documentation criterion for quality
-- reviews and an early warning when an agent is overloaded.

alter table public.ticket_supervisor_reviews
  add column if not exists documentation_ok boolean;

create table if not exists public.team_skills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, tenant_id)
);
create unique index if not exists team_skills_name_idx
  on public.team_skills (tenant_id, lower(btrim(name)));

create table if not exists public.agent_skill_levels (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  skill_id uuid not null,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  level smallint not null check (level between 1 and 3),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.user_profiles(id) on delete set null,
  primary key (skill_id, user_id),
  constraint agent_skill_levels_skill_fk foreign key (skill_id, tenant_id)
    references public.team_skills (id, tenant_id) on delete cascade
);
create index if not exists agent_skill_levels_user_idx
  on public.agent_skill_levels (tenant_id, user_id);

-- One overload warning per agent and department every three days.
create table if not exists public.team_overload_notices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null,
  agent_id uuid not null,
  sent_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, department_id, agent_id, sent_at)
);
create index if not exists team_overload_notices_recent_idx
  on public.team_overload_notices (tenant_id, department_id, agent_id, sent_at desc);

alter table public.team_skills enable row level security;
alter table public.agent_skill_levels enable row level security;
alter table public.team_overload_notices enable row level security;
revoke all on table public.team_skills, public.agent_skill_levels,
  public.team_overload_notices from public, anon, authenticated;
grant all on table public.team_skills, public.agent_skill_levels,
  public.team_overload_notices to service_role;

-- An agent counts as overloaded in a department when they hold at least six
-- open tickets there and 50 % more than the average of the department's
-- members, when they hold twelve or more, or when three or more of their tickets are past due.
create or replace function public.team_overload_warnings_run()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_supervisor uuid;
  v_count integer := 0;
begin
  for v_row in
    with open_tickets as (
      select ticket.tenant_id, ticket.department_id, ticket.assigned_agent_id as agent_id,
             count(*) as open_count,
             count(*) filter (
               where ticket.resolution_due_at is not null
                 and ticket.resolution_due_at < timezone('utc', now())
             ) as overdue_count
      from public.tickets ticket
      join public.ticket_statuses status
        on status.id = ticket.status_id and not status.is_closed
      where ticket.assigned_agent_id is not null
        and ticket.department_id is not null
        and ticket.merged_into_ticket_id is null
      group by ticket.tenant_id, ticket.department_id, ticket.assigned_agent_id
    ),
    -- Average over everyone in the department, including people without
    -- tickets, so a single person carrying the whole queue is recognised.
    averages as (
      select open_tickets.tenant_id, open_tickets.department_id,
             sum(open_tickets.open_count)::numeric / greatest(
               count(*),
               (
                 select count(*) from public.department_memberships member
                 where member.department_id = open_tickets.department_id
                   and member.status = 'active'
               )
             ) as average_open
      from open_tickets
      group by open_tickets.tenant_id, open_tickets.department_id
    )
    select open_tickets.*, round(averages.average_open, 1) as average_open,
           coalesce(nullif(btrim(profile.display_name), ''), 'Ein Teammitglied') as agent_name,
           department.name as department_name
    from open_tickets
    join averages using (tenant_id, department_id)
    join public.departments department
      on department.id = open_tickets.department_id and department.active
    left join public.user_profiles profile on profile.id = open_tickets.agent_id
    where (
        open_tickets.open_count >= 6
        and open_tickets.open_count >= averages.average_open * 1.5
      )
      or open_tickets.open_count >= 12
      or open_tickets.overdue_count >= 3
    limit 500
  loop
    if exists (
      select 1 from public.team_overload_notices notice
      where notice.tenant_id = v_row.tenant_id
        and notice.department_id = v_row.department_id
        and notice.agent_id = v_row.agent_id
        and notice.sent_at > timezone('utc', now()) - interval '3 days'
    ) then
      continue;
    end if;
    insert into public.team_overload_notices (tenant_id, department_id, agent_id)
    values (v_row.tenant_id, v_row.department_id, v_row.agent_id);
    foreach v_supervisor in array
      public.department_supervisor_ids(v_row.tenant_id, v_row.department_id)
    loop
      if v_supervisor = v_row.agent_id then
        continue;
      end if;
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_row.tenant_id, v_supervisor, null, 'team.overload',
        jsonb_build_object(
          'agentId', v_row.agent_id,
          'agentName', v_row.agent_name,
          'departmentId', v_row.department_id,
          'departmentName', v_row.department_name,
          'openTickets', v_row.open_count,
          'overdueTickets', v_row.overdue_count,
          'averageOpen', v_row.average_open
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.team_overload_warnings_run() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-team-overload'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  -- Twice a day on working days (07:40 and 12:40 UTC).
  perform cron.schedule(
    'nextdesk-team-overload',
    '40 7,12 * * 1-5',
    'select public.team_overload_warnings_run();'
  );
exception when others then
  null;
end;
$$;

commit;
