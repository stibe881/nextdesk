begin;

set local search_path = pg_catalog, public;

-- No-code ticket rules: "if department X and keyword Y, then team Z, person P,
-- priority Q and watchers W". Rules apply when a ticket is created, in their
-- order; a field already set by an earlier rule (or by the creator, for team
-- and person) is not overwritten. Invalid targets are skipped so ticket
-- creation never fails because of a rule.

create table if not exists public.ticket_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  position integer not null default 100 check (position between 1 and 10000),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  actions jsonb not null default '{}'::jsonb check (jsonb_typeof(actions) = 'object'),
  applied_count integer not null default 0,
  last_applied_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ticket_rules_tenant_idx on public.ticket_rules (tenant_id, active, position);
alter table public.ticket_rules enable row level security;
revoke all on table public.ticket_rules from public, anon, authenticated;

create or replace function public.ticket_rule_uuid_list(p_value jsonb)
returns uuid[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
  ) as value
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

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

create or replace function public.ticket_rules_apply_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rule record;
  v_team_id uuid;
  v_agent_id uuid;
  v_priority_id uuid;
  v_team_set boolean := new.assigned_team_id is not null;
  v_agent_set boolean := new.assigned_agent_id is not null;
  v_priority_set boolean := false;
begin
  for v_rule in
    select rule.id, rule.actions
    from public.ticket_rules rule
    where rule.tenant_id = new.tenant_id and rule.active
      and public.ticket_rule_matches(rule.conditions, new.department_id, new.category_id,
        new.priority_id, new.source, new.subject, new.description)
    order by rule.position, rule.created_at
  loop
    if not v_team_set and (v_rule.actions ->> 'teamId') ~* '^[0-9a-f-]{36}$' then
      select team.id into v_team_id from public.teams team
      where team.id = (v_rule.actions ->> 'teamId')::uuid
        and team.tenant_id = new.tenant_id and team.active
        and team.department_id = new.department_id;
      if v_team_id is not null then
        new.assigned_team_id := v_team_id;
        v_team_set := true;
      end if;
    end if;
    if not v_agent_set and (v_rule.actions ->> 'agentId') ~* '^[0-9a-f-]{36}$' then
      v_agent_id := (v_rule.actions ->> 'agentId')::uuid;
      if exists (
          select 1 from public.department_memberships membership
          join public.tenant_memberships tenant_membership
            on tenant_membership.tenant_id = new.tenant_id
           and tenant_membership.user_id = membership.user_id
           and tenant_membership.status = 'active'
          where membership.department_id = new.department_id
            and membership.user_id = v_agent_id and membership.status = 'active')
        and (public.user_has_ticket_permission_for(v_agent_id, new.tenant_id, new.department_id, 'ticket.read.assigned')
          or public.user_has_ticket_permission_for(v_agent_id, new.tenant_id, new.department_id, 'ticket.read.department'))
        and (new.assigned_team_id is null or exists (
          select 1 from public.team_memberships team_membership
          where team_membership.team_id = new.assigned_team_id
            and team_membership.user_id = v_agent_id)) then
        new.assigned_agent_id := v_agent_id;
        v_agent_set := true;
      end if;
    end if;
    if not v_priority_set and (v_rule.actions ->> 'priorityId') ~* '^[0-9a-f-]{36}$' then
      select priority.id into v_priority_id from public.ticket_priorities priority
      where priority.id = (v_rule.actions ->> 'priorityId')::uuid
        and priority.tenant_id = new.tenant_id;
      if v_priority_id is not null then
        new.priority_id := v_priority_id;
        v_priority_set := true;
      end if;
    end if;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.ticket_rules_apply_before_insert() from public, anon, authenticated;

-- Named to run before the other BEFORE INSERT triggers (SLA, delegation,
-- integrity checks), which then see the rule's choices.
drop trigger if exists tickets_000_apply_rules on public.tickets;
create trigger tickets_000_apply_rules
  before insert on public.tickets
  for each row execute function public.ticket_rules_apply_before_insert();

create or replace function public.ticket_rules_apply_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rule record;
  v_watcher uuid;
  v_names text[] := '{}'::text[];
begin
  for v_rule in
    select rule.id, rule.name, rule.actions
    from public.ticket_rules rule
    where rule.tenant_id = new.tenant_id and rule.active
      and public.ticket_rule_matches(rule.conditions, new.department_id, new.category_id,
        new.priority_id, new.source, new.subject, new.description)
    order by rule.position, rule.created_at
  loop
    v_names := v_names || v_rule.name;
    update public.ticket_rules
    set applied_count = applied_count + 1, last_applied_at = timezone('utc', now())
    where id = v_rule.id;
    foreach v_watcher in array public.ticket_rule_uuid_list(v_rule.actions -> 'watcherIds')
    loop
      if public.ticket_notification_recipient_authorized(new.tenant_id, new.id, v_watcher) then
        insert into public.ticket_watchers (ticket_id, user_id)
        values (new.id, v_watcher)
        on conflict do nothing;
      end if;
    end loop;
  end loop;
  if cardinality(v_names) > 0 then
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (new.id, null, 'ticket.rules_applied', jsonb_build_object('rules', to_jsonb(v_names)));
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.ticket_rules_apply_after_insert() from public, anon, authenticated;

drop trigger if exists tickets_zz_rules_after_insert on public.tickets;
create trigger tickets_zz_rules_after_insert
  after insert on public.tickets
  for each row execute function public.ticket_rules_apply_after_insert();

-- Management (automation.manage).
create or replace function public.list_ticket_rules(p_tenant_id uuid)
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
  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rule.id, 'name', rule.name, 'active', rule.active, 'position', rule.position,
        'conditions', rule.conditions, 'actions', rule.actions,
        'appliedCount', rule.applied_count, 'lastAppliedAt', rule.last_applied_at
      ) order by rule.position, rule.created_at)
      from public.ticket_rules rule where rule.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', department.id, 'name', department.name)
        order by department.name)
      from public.departments department
      where department.tenant_id = p_tenant_id and department.active
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', category.id, 'name', category.name,
        'departmentId', category.department_id) order by category.name)
      from public.ticket_categories category
      where category.tenant_id = p_tenant_id and category.active
    ), '[]'::jsonb),
    'priorities', coalesce((
      select jsonb_agg(jsonb_build_object('id', priority.id, 'name', priority.label)
        order by priority.label)
      from public.ticket_priorities priority where priority.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', team.id, 'name', team.name,
        'departmentId', team.department_id) order by team.name)
      from public.teams team where team.tenant_id = p_tenant_id and team.active
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id,
        'name', coalesce(profile.display_name, 'Person')) order by profile.display_name)
      from public.tenant_memberships membership
      join public.user_profiles profile on profile.id = membership.user_id
      where membership.tenant_id = p_tenant_id and membership.status = 'active'
        and exists (
          select 1
          from public.user_role_assignments assignment
          join public.roles role
            on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id
           and role.active and role.scope in ('tenant', 'department')
          join public.role_permissions permission on permission.role_id = role.id
          where assignment.user_id = membership.user_id
            and assignment.tenant_id = p_tenant_id
            and assignment.starts_at <= timezone('utc', now())
            and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
            and permission.permission_code in ('ticket.read.department', 'ticket.read.assigned', 'ticket.update')
        )
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.list_ticket_rules(uuid) from public, anon;
grant execute on function public.list_ticket_rules(uuid) to authenticated;

create or replace function public.save_ticket_rule(p_tenant_id uuid, p_rule jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_rule ->> 'name', ''));
begin
  if not public.has_tenant_permission(p_tenant_id, 'automation.manage') then
    raise exception 'automation_manage_required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120
    or jsonb_typeof(coalesce(p_rule -> 'conditions', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_rule -> 'actions', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_ticket_rule' using errcode = '22023';
  end if;
  if (p_rule ->> 'id') ~* '^[0-9a-f-]{36}$' then
    update public.ticket_rules set
      name = v_name,
      active = coalesce((p_rule ->> 'active')::boolean, true),
      position = coalesce((p_rule ->> 'position')::integer, position),
      conditions = coalesce(p_rule -> 'conditions', '{}'::jsonb),
      actions = coalesce(p_rule -> 'actions', '{}'::jsonb),
      updated_at = timezone('utc', now())
    where id = (p_rule ->> 'id')::uuid and tenant_id = p_tenant_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ticket_rule_not_found' using errcode = 'P0002';
    end if;
  else
    insert into public.ticket_rules (tenant_id, name, active, position, conditions, actions, created_by)
    values (
      p_tenant_id, v_name, coalesce((p_rule ->> 'active')::boolean, true),
      coalesce((p_rule ->> 'position')::integer,
        (select coalesce(max(position), 0) + 10 from public.ticket_rules where tenant_id = p_tenant_id)),
      coalesce(p_rule -> 'conditions', '{}'::jsonb),
      coalesce(p_rule -> 'actions', '{}'::jsonb),
      auth.uid()
    )
    returning id into v_id;
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, auth.uid(), 'automation.ticket_rule.saved', 'ticket_rule', v_id, 'info',
    jsonb_build_object('name', v_name));
  return v_id;
end;
$$;
revoke all on function public.save_ticket_rule(uuid, jsonb) from public, anon;
grant execute on function public.save_ticket_rule(uuid, jsonb) to authenticated;

create or replace function public.delete_ticket_rule(p_tenant_id uuid, p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.has_tenant_permission(p_tenant_id, 'automation.manage') then
    raise exception 'automation_manage_required' using errcode = '42501';
  end if;
  delete from public.ticket_rules where id = p_rule_id and tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, auth.uid(), 'automation.ticket_rule.deleted', 'ticket_rule', p_rule_id, 'info', '{}'::jsonb);
end;
$$;
revoke all on function public.delete_ticket_rule(uuid, uuid) from public, anon;
grant execute on function public.delete_ticket_rule(uuid, uuid) to authenticated;

commit;
