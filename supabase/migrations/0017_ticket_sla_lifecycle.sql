begin;

-- A started event is written from the required BEFORE INSERT trigger.  Its
-- ticket FK must therefore be checked at transaction end, after the ticket
-- row itself has been inserted.  The constraint remains fully enforced.
alter table public.ticket_sla_events
  alter constraint ticket_sla_events_ticket_id_fkey
  deferrable initially deferred;

create or replace function public.apply_ticket_sla_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_rule_id uuid;
  selected_profile_id uuid;
  selected_profile_name text;
  selected_profile_department_id uuid;
  selected_priority_key text;
  selected_response_minutes integer;
  selected_resolution_minutes integer;
begin
  /*
   * service_hours.department_id is profile scope, not working-time
   * arithmetic.  Targets below are deliberately calendar-minute offsets.
   * An absent department_id is tenant-wide; malformed scopes are ignored.
   */
  select
    rule.id,
    profile.id,
    profile.name,
    profile_scope.department_id,
    rule.priority_key,
    rule.response_minutes,
    rule.resolution_minutes
  into
    selected_rule_id,
    selected_profile_id,
    selected_profile_name,
    selected_profile_department_id,
    selected_priority_key,
    selected_response_minutes,
    selected_resolution_minutes
  from public.ticket_sla_rules as rule
  join public.ticket_sla_profiles as profile
    on profile.id = rule.sla_profile_id
   and profile.tenant_id = new.tenant_id
   and profile.active
  join public.ticket_priorities as priority
    on priority.id = new.priority_id
   and priority.tenant_id = new.tenant_id
   and priority.key = rule.priority_key
  cross join lateral (
    select
      case
        when jsonb_typeof(profile.service_hours) = 'object'
          and jsonb_typeof(profile.service_hours -> 'department_id') = 'string'
          and profile.service_hours ->> 'department_id' ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
        then (profile.service_hours ->> 'department_id')::uuid
        else null
      end as department_id,
      case
        when jsonb_typeof(profile.service_hours) = 'object'
          and not (profile.service_hours ? 'department_id')
        then true
        else false
      end as tenant_wide
  ) as profile_scope
  where profile_scope.department_id = new.department_id
     or profile_scope.tenant_wide
  order by
    case when profile_scope.department_id = new.department_id then 0 else 1 end,
    profile.updated_at desc,
    profile.id,
    rule.id
  limit 1;

  if selected_rule_id is null then
    new.response_due_at := null;
    new.resolution_due_at := null;
    return new;
  end if;

  new.response_due_at := new.created_at
    + make_interval(mins => selected_response_minutes);
  new.resolution_due_at := new.created_at
    + make_interval(mins => selected_resolution_minutes);

  insert into public.ticket_sla_events (
    ticket_id,
    event_type,
    occurred_at,
    metadata
  )
  values (
    new.id,
    'started',
    new.created_at,
    jsonb_build_object(
      'rule', jsonb_build_object(
        'id', selected_rule_id,
        'priority_key', selected_priority_key,
        'response_minutes', selected_response_minutes,
        'resolution_minutes', selected_resolution_minutes
      ),
      'profile', jsonb_build_object(
        'id', selected_profile_id,
        'name', selected_profile_name,
        'department_id', selected_profile_department_id
      ),
      'targets', jsonb_build_object(
        'response_due_at', new.response_due_at,
        'resolution_due_at', new.resolution_due_at,
        'calculation', 'calendar_minutes'
      )
    )
  );

  return new;
end;
$$;

create or replace function public.maintain_ticket_sla_resolution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_status_is_closed boolean := false;
  new_status_is_closed boolean := false;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;

  select status.is_closed
  into old_status_is_closed
  from public.ticket_statuses as status
  where status.id = old.status_id
    and status.tenant_id = old.tenant_id;

  select status.is_closed
  into new_status_is_closed
  from public.ticket_statuses as status
  where status.id = new.status_id
    and status.tenant_id = new.tenant_id;

  old_status_is_closed := coalesce(old_status_is_closed, false);
  new_status_is_closed := coalesce(new_status_is_closed, false);

  if not old_status_is_closed and new_status_is_closed then
    if new.resolved_at is null then
      new.resolved_at := timezone('utc', now());
    end if;

    insert into public.ticket_sla_events (
      ticket_id,
      event_type,
      occurred_at,
      metadata
    )
    values (
      new.id,
      'resolved',
      timezone('utc', now()),
      jsonb_build_object(
        'previous_status_id', old.status_id,
        'status_id', new.status_id,
        'resolved_at', new.resolved_at
      )
    );
  elsif old_status_is_closed and not new_status_is_closed then
    new.resolved_at := null;

    if exists (
      select 1
      from public.ticket_sla_events as event
      where event.ticket_id = new.id
        and event.event_type = 'resolved'
    ) then
      insert into public.ticket_sla_events (
        ticket_id,
        event_type,
        occurred_at,
        metadata
      )
      values (
        new.id,
        'resumed',
        timezone('utc', now()),
        jsonb_build_object(
          'previous_status_id', old.status_id,
          'status_id', new.status_id
        )
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_apply_sla_on_insert on public.tickets;
create trigger tickets_apply_sla_on_insert
before insert on public.tickets
for each row
execute function public.apply_ticket_sla_on_insert();

drop trigger if exists tickets_maintain_sla_resolution on public.tickets;
create trigger tickets_maintain_sla_resolution
before update on public.tickets
for each row
execute function public.maintain_ticket_sla_resolution();

revoke all on function public.apply_ticket_sla_on_insert() from public, anon, authenticated;
revoke all on function public.maintain_ticket_sla_resolution() from public, anon, authenticated;

commit;
