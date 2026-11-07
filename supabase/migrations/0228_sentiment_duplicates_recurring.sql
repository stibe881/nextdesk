begin;

set local search_path = pg_catalog, public;

-- 1. AI triage: sentiment detection and duplicate handling can be switched
--    per tenant. Duplicates are merged automatically only when the tenant
--    opts in; otherwise they are offered as a suggestion in the ticket.
alter table public.ticket_triage_settings
  add column if not exists sentiment_enabled boolean not null default true,
  add column if not exists auto_merge_duplicates boolean not null default false;

-- 2. Recurring monitoring outages: when the same device raised three or more
--    PRTG alerts within 30 days, a problem is opened once and the alert
--    tickets are linked to it.
create table if not exists public.monitoring_recurring_problems (
  asset_id uuid not null references public.assets(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (asset_id, problem_id)
);
create index if not exists monitoring_recurring_problems_recent_idx
  on public.monitoring_recurring_problems (asset_id, created_at desc);
alter table public.monitoring_recurring_problems enable row level security;
revoke all on table public.monitoring_recurring_problems from public, anon, authenticated;
grant all on table public.monitoring_recurring_problems to service_role;

create or replace function public.monitoring_detect_recurring_problems()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_creator uuid;
  v_problem_id uuid;
  v_count integer := 0;
begin
  for v_row in
    select alert.tenant_id, alert.asset_id, asset.name as asset_name, asset.department_id,
           count(*) as alert_count,
           string_agg(distinct coalesce(alert.sensor_name, 'Sensor'), ', ') as sensors,
           array_agg(alert.ticket_id) filter (where alert.ticket_id is not null) as ticket_ids
    from public.monitoring_alerts alert
    join public.assets asset on asset.id = alert.asset_id
    where alert.asset_id is not null
      and alert.opened_at > timezone('utc', now()) - interval '30 days'
    group by alert.tenant_id, alert.asset_id, asset.name, asset.department_id
    having count(*) >= 3
  loop
    -- One open problem per device and 30 days.
    if exists (
      select 1 from public.monitoring_recurring_problems recurring
      join public.problems problem on problem.id = recurring.problem_id
      where recurring.asset_id = v_row.asset_id
        and (problem.status <> 'resolved'
          or recurring.created_at > timezone('utc', now()) - interval '30 days')
    ) then
      continue;
    end if;

    select assignment.user_id into v_creator
    from public.user_role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id and role.active
    join public.role_permissions permission
      on permission.role_id = role.id and permission.permission_code = 'asset.manage'
    join public.tenant_memberships membership
      on membership.tenant_id = assignment.tenant_id and membership.user_id = assignment.user_id
     and membership.status = 'active'
    where assignment.tenant_id = v_row.tenant_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    order by assignment.starts_at
    limit 1;
    if v_creator is null then
      continue;
    end if;

    insert into public.problems (tenant_id, title, description, status, created_by,
      department_id, analysis)
    values (
      v_row.tenant_id,
      left('Wiederkehrende Störung: ' || v_row.asset_name, 240),
      format(
        E'Das Monitoring (PRTG) hat für «%s» in den letzten 30 Tagen %s Störungen gemeldet.\n\nBetroffene Sensoren: %s\n\nBitte Ursache analysieren (Hardware, Firmware, Stromversorgung, Uplink).',
        v_row.asset_name, v_row.alert_count, coalesce(v_row.sensors, '–')
      ),
      'open',
      v_creator,
      v_row.department_id,
      jsonb_build_object('source', 'monitoring', 'assetId', v_row.asset_id,
        'alertCount', v_row.alert_count)
    )
    returning id into v_problem_id;

    insert into public.monitoring_recurring_problems (asset_id, problem_id, tenant_id)
    values (v_row.asset_id, v_problem_id, v_row.tenant_id);

    insert into public.problem_tickets (tenant_id, problem_id, ticket_id, linked_by)
    select v_row.tenant_id, v_problem_id, ticket_id, v_creator
    from unnest(coalesce(v_row.ticket_ids, '{}'::uuid[])) as ticket_id
    on conflict do nothing;

    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select v_row.tenant_id, assignment.user_id, null, 'problem.recurring_detected',
      jsonb_build_object('problemId', v_problem_id, 'assetName', v_row.asset_name,
        'alertCount', v_row.alert_count)
    from (
      select distinct assignment.user_id
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id and role.active
      join public.role_permissions permission
        on permission.role_id = role.id and permission.permission_code = 'asset.manage'
      where assignment.tenant_id = v_row.tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    ) assignment;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_detect_recurring_problems() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-recurring-outages'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('nextdesk-recurring-outages', '13 6 * * *',
    'select public.monitoring_detect_recurring_problems();');
exception when others then
  null;
end;
$$;

commit;
