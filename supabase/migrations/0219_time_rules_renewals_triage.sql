begin;

set local search_path = pg_catalog, public;

-- Automations:
-- 1. Time-based ticket rules («X Stunden ohne Antwort», «X Stunden im Status»,
--    «SLA läuft in X Minuten ab», «X Stunden nicht zugewiesen») with the
--    actions priority, team, person and notification.
-- 2. Warranty and vendor support renewals: 60 days ahead a procurement ticket
--    with the device data is created once per date.
-- 3. AI triage on intake: new tickets from the portal, e-mail and other
--    channels are queued; the ticket-triage function suggests or applies
--    category, priority, team and the affected device.

-- 1. Time-based rules ----------------------------------------------------------

alter table public.tickets add column if not exists status_changed_at timestamptz;

create or replace function public.tickets_track_status_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, new.created_at, timezone('utc', now()));
  elsif new.status_id is distinct from old.status_id then
    new.status_changed_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

create or replace trigger tickets_track_status_change
  before insert or update of status_id on public.tickets
  for each row execute function public.tickets_track_status_change();

-- Rules with conditions.trigger = 'time' are evaluated by the scheduler only,
-- never when a ticket is created.
create or replace function public.ticket_rule_matches(
  p_conditions jsonb,
  p_department_id uuid,
  p_category_id uuid,
  p_priority_id uuid,
  p_source text,
  p_subject text,
  p_description text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_ids uuid[];
  v_sources text[];
  v_keyword text;
  v_text text := lower(coalesce(p_subject, '') || ' ' || coalesce(p_description, ''));
  v_has_keywords boolean := false;
  v_keyword_hit boolean := false;
begin
  if p_conditions ->> 'trigger' = 'time' then return false; end if;
  v_ids := public.ticket_rule_uuid_list(p_conditions -> 'departmentIds');
  if cardinality(v_ids) > 0 and not (p_department_id = any(v_ids)) then return false; end if;
  v_ids := public.ticket_rule_uuid_list(p_conditions -> 'categoryIds');
  if cardinality(v_ids) > 0 and (p_category_id is null or not (p_category_id = any(v_ids))) then
    return false;
  end if;
  v_ids := public.ticket_rule_uuid_list(p_conditions -> 'priorityIds');
  if cardinality(v_ids) > 0 and not (p_priority_id = any(v_ids)) then return false; end if;
  if jsonb_typeof(p_conditions -> 'sources') = 'array'
    and jsonb_array_length(p_conditions -> 'sources') > 0 then
    select array_agg(value) into v_sources
    from jsonb_array_elements_text(p_conditions -> 'sources') as value;
    if not (coalesce(p_source, 'portal') = any(v_sources)) then return false; end if;
  end if;
  if jsonb_typeof(p_conditions -> 'keywords') = 'array' then
    for v_keyword in select lower(btrim(value)) from jsonb_array_elements_text(p_conditions -> 'keywords') as value
    loop
      continue when v_keyword = '';
      v_has_keywords := true;
      if position(v_keyword in v_text) > 0 then
        v_keyword_hit := true;
        exit;
      end if;
    end loop;
    if v_has_keywords and not v_keyword_hit then return false; end if;
  end if;
  return true;
end;
$$;

create table if not exists public.ticket_rule_time_runs (
  rule_id uuid not null references public.ticket_rules(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  applied_at timestamptz not null default timezone('utc', now()),
  primary key (rule_id, ticket_id)
);
alter table public.ticket_rule_time_runs enable row level security;
revoke all on table public.ticket_rule_time_runs from public, anon, authenticated;
grant all on table public.ticket_rule_time_runs to service_role;

-- Does the ticket meet the time condition of a rule right now?
create or replace function public.ticket_time_condition_holds(
  p_time jsonb,
  p_ticket public.tickets,
  p_status_key text
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_kind text := p_time ->> 'kind';
  v_hours numeric := least(greatest(coalesce((p_time ->> 'hours')::numeric, 0), 0), 24 * 90);
  v_minutes numeric := least(greatest(coalesce((p_time ->> 'minutes')::numeric, 0), 0), 24 * 60 * 30);
  v_now timestamptz := timezone('utc', now());
  v_last_activity timestamptz;
begin
  if v_kind = 'no_reply' then
    if v_hours <= 0 or p_status_key like 'waiting%' then return false; end if;
    select greatest(p_ticket.created_at, max(comment.created_at))
    into v_last_activity
    from public.ticket_comments comment
    where comment.ticket_id = p_ticket.id and comment.visibility = 'external';
    return coalesce(v_last_activity, p_ticket.created_at) < v_now - make_interval(mins => (v_hours * 60)::integer);
  elsif v_kind = 'in_status' then
    if v_hours <= 0 or jsonb_typeof(p_time -> 'statusKeys') <> 'array'
      or not exists (
        select 1 from jsonb_array_elements_text(p_time -> 'statusKeys') key where key = p_status_key
      ) then
      return false;
    end if;
    return coalesce(p_ticket.status_changed_at, p_ticket.updated_at, p_ticket.created_at)
      < v_now - make_interval(mins => (v_hours * 60)::integer);
  elsif v_kind = 'sla_due' then
    return v_minutes > 0
      and p_ticket.resolved_at is null
      and p_ticket.resolution_due_at is not null
      and p_ticket.resolution_due_at > v_now
      and p_ticket.resolution_due_at <= v_now + make_interval(mins => v_minutes::integer);
  elsif v_kind = 'unassigned' then
    return v_hours > 0
      and p_ticket.assigned_agent_id is null
      and p_ticket.created_at < v_now - make_interval(mins => (v_hours * 60)::integer);
  end if;
  return false;
end;
$$;
revoke all on function public.ticket_time_condition_holds(jsonb, public.tickets, text)
  from public, anon, authenticated;

-- Applies due time rules once per ticket and rule (every ten minutes).
create or replace function public.ticket_time_rules_run()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rule record;
  v_row record;
  v_ticket public.tickets;
  v_status_key text;
  v_base jsonb;
  v_agent_id uuid;
  v_team_id uuid;
  v_priority_id uuid;
  v_recipient uuid;
  v_applied integer := 0;
  v_rule_applied integer;
begin
  for v_rule in
    select rule.* from public.ticket_rules rule
    where rule.active and rule.conditions ->> 'trigger' = 'time'
      and jsonb_typeof(rule.conditions -> 'time') = 'object'
    order by rule.tenant_id, rule.position, rule.created_at
  loop
    v_base := v_rule.conditions - 'trigger' - 'time';
    v_rule_applied := 0;
    for v_row in
      select ticket as ticket_row, status.key as status_key
      from public.tickets ticket
      join public.ticket_statuses status on status.id = ticket.status_id and not status.is_closed
      where ticket.tenant_id = v_rule.tenant_id
        and ticket.merged_into_ticket_id is null
        and not exists (
          select 1 from public.ticket_rule_time_runs run
          where run.rule_id = v_rule.id and run.ticket_id = ticket.id
        )
      order by ticket.created_at
      limit 2000
    loop
      v_ticket := v_row.ticket_row;
      v_status_key := v_row.status_key;
      continue when not public.ticket_rule_matches(v_base, v_ticket.department_id,
        v_ticket.category_id, v_ticket.priority_id, v_ticket.source, v_ticket.subject,
        v_ticket.description);
      continue when not public.ticket_time_condition_holds(v_rule.conditions -> 'time',
        v_ticket, v_status_key);

      insert into public.ticket_rule_time_runs (rule_id, ticket_id) values (v_rule.id, v_ticket.id)
      on conflict do nothing;

      v_team_id := null;
      v_agent_id := null;
      v_priority_id := null;
      if (v_rule.actions ->> 'priorityId') ~* '^[0-9a-f-]{36}$' then
        select priority.id into v_priority_id from public.ticket_priorities priority
        where priority.id = (v_rule.actions ->> 'priorityId')::uuid
          and priority.tenant_id = v_ticket.tenant_id;
      end if;
      if (v_rule.actions ->> 'teamId') ~* '^[0-9a-f-]{36}$' then
        select team.id into v_team_id from public.teams team
        where team.id = (v_rule.actions ->> 'teamId')::uuid
          and team.tenant_id = v_ticket.tenant_id and team.active
          and team.department_id = v_ticket.department_id;
      end if;
      if (v_rule.actions ->> 'agentId') ~* '^[0-9a-f-]{36}$' then
        v_agent_id := (v_rule.actions ->> 'agentId')::uuid;
        if not (
          exists (
            select 1 from public.department_memberships membership
            join public.tenant_memberships tenant_membership
              on tenant_membership.tenant_id = v_ticket.tenant_id
             and tenant_membership.user_id = membership.user_id
             and tenant_membership.status = 'active'
            where membership.department_id = v_ticket.department_id
              and membership.user_id = v_agent_id and membership.status = 'active')
          and (public.user_has_ticket_permission_for(v_agent_id, v_ticket.tenant_id, v_ticket.department_id, 'ticket.read.assigned')
            or public.user_has_ticket_permission_for(v_agent_id, v_ticket.tenant_id, v_ticket.department_id, 'ticket.read.department'))
        ) then
          v_agent_id := null;
        end if;
      end if;
      begin
        if v_priority_id is not null or v_team_id is not null or v_agent_id is not null then
          update public.tickets set
            priority_id = coalesce(v_priority_id, priority_id),
            assigned_team_id = coalesce(v_team_id, assigned_team_id),
            assigned_agent_id = coalesce(v_agent_id, assigned_agent_id)
          where id = v_ticket.id;
        end if;
      exception when others then
        -- A rejected change (e.g. team and person do not fit) skips the
        -- field changes; the notification below still goes out.
        null;
      end;

      if jsonb_typeof(v_rule.actions -> 'notify') = 'array' then
        for v_recipient in
          select distinct recipient from (
            select v_ticket.assigned_agent_id as recipient
            where v_rule.actions -> 'notify' ? 'assignee'
            union all
            select watcher.user_id from public.ticket_watchers watcher
            where watcher.ticket_id = v_ticket.id and v_rule.actions -> 'notify' ? 'watchers'
            union all
            select supervisor from unnest(
              case when v_rule.actions -> 'notify' ? 'supervisors'
                then public.department_supervisor_ids(v_ticket.tenant_id, v_ticket.department_id)
                else '{}'::uuid[] end
            ) supervisor
          ) recipients
          where recipient is not null
        loop
          insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
          values (v_ticket.tenant_id, v_recipient, v_ticket.id, 'ticket.rule_reminder',
            jsonb_build_object('ruleName', v_rule.name, 'ticketNumber', v_ticket.ticket_number,
              'condition', v_rule.conditions -> 'time'));
        end loop;
      end if;

      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, null, 'ticket.time_rule_applied',
        jsonb_build_object('ruleId', v_rule.id, 'ruleName', v_rule.name));
      v_rule_applied := v_rule_applied + 1;
    end loop;
    if v_rule_applied > 0 then
      update public.ticket_rules
      set applied_count = applied_count + v_rule_applied,
          last_applied_at = timezone('utc', now())
      where id = v_rule.id;
      v_applied := v_applied + v_rule_applied;
    end if;
  end loop;
  return v_applied;
end;
$$;
revoke all on function public.ticket_time_rules_run() from public, anon, authenticated;

-- The rule editor also needs the statuses for «X Stunden im Status».
create or replace function public.list_ticket_rule_statuses(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.has_tenant_permission(p_tenant_id, 'automation.manage') then
    raise exception 'automation_manage_required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', status.key, 'label', status.label)
      order by status.sort_order)
    from public.ticket_statuses status
    where status.tenant_id = p_tenant_id and not status.is_closed
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_ticket_rule_statuses(uuid) from public, anon;
grant execute on function public.list_ticket_rule_statuses(uuid) to authenticated;

-- 2. Warranty and support renewals -------------------------------------------

create table if not exists public.infrastructure_renewal_tickets (
  asset_id uuid not null references public.assets(id) on delete cascade,
  reason text not null check (reason in ('warranty', 'support')),
  due_on date not null,
  ticket_id uuid references public.tickets(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (asset_id, reason, due_on)
);
alter table public.infrastructure_renewal_tickets enable row level security;
revoke all on table public.infrastructure_renewal_tickets from public, anon, authenticated;
grant all on table public.infrastructure_renewal_tickets to service_role;

create or replace function public.infrastructure_create_renewal_tickets()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_due record;
  v_requester uuid;
  v_ticket_id uuid;
  v_count integer := 0;
  v_today date := timezone('Europe/Zurich', now())::date;
begin
  for v_due in
    with dates as (
      select infra.tenant_id, infra.asset_id, 'warranty'::text as reason,
             infra.warranty_until as due_on
      from public.asset_infrastructure infra
      union all
      select infra.tenant_id, infra.asset_id, 'support', infra.support_until
      from public.asset_infrastructure infra
    )
    select dates.*, asset.name, asset.manufacturer, asset.model, asset.serial_number,
           asset.inventory_number, asset.department_id, location.name as location_name,
           infra.hostname, infra.supplier, infra.purchase_date, infra.purchase_price,
           infra.criticality
    from dates
    join public.assets asset on asset.id = dates.asset_id
    join public.asset_infrastructure infra on infra.asset_id = dates.asset_id
    left join public.asset_locations location on location.id = asset.location_id
    where dates.due_on is not null
      and dates.due_on between v_today and v_today + 60
      and asset.lifecycle_state in ('stock', 'active', 'repair')
      and exists (
        select 1 from public.tenant_feature_flags flag
        where flag.tenant_id = dates.tenant_id
          and flag.feature_key = 'assets.management'
          and flag.enabled
      )
      and not exists (
        select 1 from public.infrastructure_renewal_tickets done
        where done.asset_id = dates.asset_id and done.reason = dates.reason
          and done.due_on = dates.due_on
      )
    order by dates.due_on
    limit 100
  loop
    -- Requester: a person who manages assets in the tenant.
    select assignment.user_id into v_requester
    from public.user_role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id and role.active
    join public.role_permissions permission
      on permission.role_id = role.id and permission.permission_code = 'asset.manage'
    join public.tenant_memberships membership
      on membership.tenant_id = assignment.tenant_id and membership.user_id = assignment.user_id
     and membership.status = 'active'
    where assignment.tenant_id = v_due.tenant_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    order by assignment.starts_at
    limit 1;
    if v_requester is null then
      continue;
    end if;

    v_ticket_id := public.create_expiry_reminder_ticket(
      v_due.tenant_id,
      v_requester,
      format('%s läuft ab: %s (%s) – Verlängerung oder Ersatz beschaffen',
        case when v_due.reason = 'warranty' then 'Garantie' else 'Herstellersupport' end,
        v_due.name, to_char(v_due.due_on, 'DD.MM.YYYY')),
      format(
        E'%s für «%s» endet am %s.\n\nGerät\n- Hersteller / Modell: %s\n- Seriennummer: %s\n- Inventarnummer: %s\n- Hostname: %s\n- Standort: %s\n- Kritikalität: %s\n\nBeschaffung\n- Lieferant: %s\n- Kaufdatum: %s\n- Kaufpreis: %s\n\nBitte Verlängerung offerieren lassen oder Ersatz planen.',
        case when v_due.reason = 'warranty' then 'Die Garantie' else 'Der Herstellersupport' end,
        v_due.name,
        to_char(v_due.due_on, 'DD.MM.YYYY'),
        coalesce(nullif(btrim(concat_ws(' ', v_due.manufacturer, v_due.model)), ''), '–'),
        coalesce(v_due.serial_number, '–'),
        coalesce(v_due.inventory_number, '–'),
        coalesce(v_due.hostname, '–'),
        coalesce(v_due.location_name, '–'),
        coalesce(v_due.criticality, '–'),
        coalesce(v_due.supplier, '–'),
        coalesce(to_char(v_due.purchase_date, 'DD.MM.YYYY'), '–'),
        coalesce('CHF ' || to_char(v_due.purchase_price, 'FM999G999G990D00'), '–')
      ),
      v_due.department_id
    );
    insert into public.infrastructure_renewal_tickets (asset_id, reason, due_on, ticket_id)
    values (v_due.asset_id, v_due.reason, v_due.due_on, v_ticket_id)
    on conflict do nothing;
    if v_ticket_id is not null then
      insert into public.ticket_assets (tenant_id, ticket_id, asset_id, linked_by)
      values (v_due.tenant_id, v_ticket_id, v_due.asset_id, v_requester)
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.infrastructure_create_renewal_tickets() from public, anon, authenticated;

-- 3. AI triage on intake -------------------------------------------------------

create table if not exists public.ticket_triage_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  -- From this confidence on, suggestions are applied without a person.
  apply_threshold numeric(3, 2) not null default 0.80
    check (apply_threshold between 0.50 and 1.00),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ticket_ai_triage (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'suggested', 'applied', 'accepted', 'dismissed', 'failed')),
  suggestion jsonb,
  confidence numeric(3, 2),
  attempts integer not null default 0,
  error_code text,
  decided_by uuid references public.user_profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ticket_ai_triage_queue_idx
  on public.ticket_ai_triage (state, created_at)
  where state in ('queued', 'processing');

alter table public.ticket_triage_settings enable row level security;
alter table public.ticket_ai_triage enable row level security;
revoke all on table public.ticket_triage_settings, public.ticket_ai_triage
  from public, anon, authenticated;
grant all on table public.ticket_triage_settings, public.ticket_ai_triage to service_role;

-- Queue new tickets of tenants that switched triage on. Tickets an agent
-- creates with category and team already set are skipped.
create or replace function public.ticket_triage_enqueue()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (
      select 1 from public.ticket_triage_settings settings
      where settings.tenant_id = new.tenant_id and settings.enabled
    )
    and not (new.category_id is not null and new.assigned_team_id is not null)
    and coalesce(new.source, 'portal') <> 'automation' then
    insert into public.ticket_ai_triage (ticket_id, tenant_id)
    values (new.id, new.tenant_id)
    on conflict do nothing;
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.ticket_triage_enqueue() from public, anon, authenticated;

create or replace trigger tickets_zz_ai_triage_enqueue
  after insert on public.tickets
  for each row execute function public.ticket_triage_enqueue();

-- The ticket-triage function is woken every minute when work is queued.
create schema if not exists ticket_triage_private;
revoke all on schema ticket_triage_private from public, anon, authenticated;

create table if not exists ticket_triage_private.dispatch_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  dispatch_secret text not null check (char_length(dispatch_secret) >= 32)
);
revoke all on ticket_triage_private.dispatch_config from public, anon, authenticated;

insert into ticket_triage_private.dispatch_config (singleton, function_url, dispatch_secret)
values (
  true,
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/ticket-triage',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (singleton) do nothing;

create or replace function public.ticket_triage_verify_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ticket_triage_private, pg_temp
as $$
  select exists (
    select 1 from ticket_triage_private.dispatch_config config
    where config.singleton and p_secret is not null and config.dispatch_secret = p_secret
  );
$$;
revoke all on function public.ticket_triage_verify_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.ticket_triage_verify_dispatch_secret(text) to service_role;

create or replace function public.ticket_triage_wake()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, ticket_triage_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.ticket_ai_triage triage where triage.state in ('queued', 'processing')
  ) then
    return;
  end if;
  select config.function_url, config.dispatch_secret into v_url, v_secret
  from ticket_triage_private.dispatch_config config where config.singleton;
  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          jsonb_build_object('type', 'cron'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          20000;
exception when others then
  return;
end;
$$;
revoke all on function public.ticket_triage_wake() from public, anon, authenticated;

-- Schedules ------------------------------------------------------------------

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in
    select jobid from cron.job
    where jobname in ('nextdesk-ticket-time-rules', 'nextdesk-infrastructure-renewals',
      'nextdesk-ticket-triage')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('nextdesk-ticket-time-rules', '*/10 * * * *',
    'select public.ticket_time_rules_run();');
  perform cron.schedule('nextdesk-infrastructure-renewals', '43 4 * * *',
    'select public.infrastructure_create_renewal_tickets();');
  perform cron.schedule('nextdesk-ticket-triage', '* * * * *',
    'select public.ticket_triage_wake();');
exception when others then
  null;
end;
$$;

commit;
