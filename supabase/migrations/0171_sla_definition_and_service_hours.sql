-- SLA profiles get a definition/impact text and their service hours now drive
-- the due dates. service_hours.mode:
--   "always"   – 24/7 or on-call: calendar minutes (previous behaviour)
--   "business" – business hours: minutes count only inside the weekly window
--   "extended" – partly extended business hours: same arithmetic, own window
-- Profiles without a mode keep calendar-minute targets.

alter table public.ticket_sla_profiles
  add column if not exists description text
    check (description is null or char_length(description) <= 2000);

create or replace function public.sla_add_service_minutes(
  p_start timestamptz,
  p_minutes integer,
  p_service_hours jsonb,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mode text := coalesce(p_service_hours ->> 'mode', 'always');
  v_timezone text := coalesce(nullif(p_timezone, ''), 'Europe/Zurich');
  v_weekdays integer[];
  v_start time;
  v_end time;
  v_local timestamp;
  v_day date;
  v_window_start timestamp;
  v_window_end timestamp;
  v_cursor timestamp;
  v_available numeric;
  v_remaining numeric := p_minutes;
  v_guard integer := 0;
begin
  if p_start is null or p_minutes is null then
    return null;
  end if;
  if v_mode not in ('business', 'extended')
     or jsonb_typeof(p_service_hours -> 'weekdays') <> 'array' then
    return p_start + make_interval(mins => p_minutes);
  end if;

  begin
    select coalesce(array_agg(value::integer), '{}')
      into v_weekdays
      from jsonb_array_elements_text(p_service_hours -> 'weekdays') as value
     where value ~ '^[1-7]$';
    v_start := (p_service_hours ->> 'start')::time;
    v_end := (p_service_hours ->> 'end')::time;
    perform now() at time zone v_timezone;
  exception when others then
    return p_start + make_interval(mins => p_minutes);
  end;
  if cardinality(v_weekdays) = 0 or v_start is null or v_end is null
     or v_end <= v_start then
    return p_start + make_interval(mins => p_minutes);
  end if;

  v_local := p_start at time zone v_timezone;
  while v_guard < 1000 loop
    v_day := v_local::date;
    if extract(isodow from v_day)::integer = any (v_weekdays) then
      v_window_start := v_day + v_start;
      v_window_end := v_day + v_end;
      v_cursor := greatest(v_local, v_window_start);
      if v_cursor < v_window_end then
        v_available := extract(epoch from (v_window_end - v_cursor)) / 60;
        if v_remaining <= v_available then
          return (v_cursor + make_interval(secs => v_remaining * 60))
            at time zone v_timezone;
        end if;
        v_remaining := v_remaining - v_available;
      end if;
    end if;
    v_local := (v_day + 1)::timestamp;
    v_guard := v_guard + 1;
  end loop;

  return p_start + make_interval(mins => p_minutes);
end;
$function$;

create or replace function public.apply_ticket_sla_on_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  selected_rule_id uuid;
  selected_profile_id uuid;
  selected_profile_name text;
  selected_profile_department_id uuid;
  selected_priority_key text;
  selected_response_minutes integer;
  selected_resolution_minutes integer;
  selected_service_hours jsonb;
  selected_timezone text;
  calculation text;
begin
  /*
   * service_hours.department_id is the profile scope; service_hours.mode
   * decides whether targets are calendar minutes or service-hour minutes.
   * An absent department_id is tenant-wide; malformed scopes are ignored.
   */
  select
    rule.id,
    profile.id,
    profile.name,
    profile_scope.department_id,
    rule.priority_key,
    rule.response_minutes,
    rule.resolution_minutes,
    profile.service_hours,
    profile.timezone
  into
    selected_rule_id,
    selected_profile_id,
    selected_profile_name,
    selected_profile_department_id,
    selected_priority_key,
    selected_response_minutes,
    selected_resolution_minutes,
    selected_service_hours,
    selected_timezone
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

  new.response_due_at := public.sla_add_service_minutes(
    new.created_at, selected_response_minutes, selected_service_hours,
    selected_timezone);
  new.resolution_due_at := public.sla_add_service_minutes(
    new.created_at, selected_resolution_minutes, selected_service_hours,
    selected_timezone);
  calculation := case
    when coalesce(selected_service_hours ->> 'mode', 'always')
      in ('business', 'extended')
    then 'service_hours'
    else 'calendar_minutes'
  end;

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
        'calculation', calculation
      )
    )
  );

  return new;
end;
$function$;

notify pgrst, 'reload schema';
