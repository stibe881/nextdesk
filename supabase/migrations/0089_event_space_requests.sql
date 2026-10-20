begin;

-- Planned room set-ups are operational work, not tickets. The two explicit
-- permissions make request and operational management independently auditable.
insert into public.permissions (code, description, is_sensitive) values
  ('event.spaces.request', 'Veranstaltungsräume anfragen', false),
  ('event.spaces.manage', 'Veranstaltungsräume und Raumaufträge verwalten', false)
on conflict (code) do update
  set description = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- Existing roles keep their current least-privilege intent: ticket creators may
-- request a room; ticket editors and tenant administrators manage the schedule.
insert into public.role_permissions (role_id, permission_code)
select distinct role.id, 'event.spaces.request'
from public.roles as role
join public.role_permissions as permission
  on permission.role_id = role.id
 and permission.permission_code = 'ticket.create'
where role.active
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select distinct role.id, 'event.spaces.manage'
from public.roles as role
join public.role_permissions as permission
  on permission.role_id = role.id
 and permission.permission_code in ('ticket.update', 'tenant.settings.manage')
where role.active
on conflict do nothing;

-- Planning is part of operational management as well: an active ICT role may
-- both manage a request and create one for a room setup.
insert into public.role_permissions (role_id, permission_code)
select distinct role.id, 'event.spaces.request'
from public.roles as role
join public.role_permissions as permission
  on permission.role_id = role.id
 and permission.permission_code in ('ticket.update', 'tenant.settings.manage')
where role.active
on conflict do nothing;

-- The tenant provisioner creates role permissions after the roles themselves.
-- Keep that established baseline future-safe: a new requester inherits the
-- room-request right and a new support/admin role inherits management.
create or replace function public.grant_default_event_space_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.permission_code = 'ticket.create' then
    insert into public.role_permissions (role_id, permission_code)
    values (new.role_id, 'event.spaces.request')
    on conflict (role_id, permission_code) do nothing;
  elsif new.permission_code in ('ticket.update', 'tenant.settings.manage') then
    insert into public.role_permissions (role_id, permission_code)
    values (new.role_id, 'event.spaces.manage')
    on conflict (role_id, permission_code) do nothing;
    insert into public.role_permissions (role_id, permission_code)
    values (new.role_id, 'event.spaces.request')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_event_space_permission() from public, anon, authenticated;

drop trigger if exists role_permissions_grant_default_event_space_permission on public.role_permissions;
create trigger role_permissions_grant_default_event_space_permission
  after insert on public.role_permissions
  for each row execute function public.grant_default_event_space_permission();

create or replace function public.has_event_space_permission(
  p_tenant_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
      join public.role_permissions role_permission
        on role_permission.role_id = role.id
        and role_permission.permission_code = p_permission_code
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and (
          role.scope = 'tenant'
          or exists (
            select 1
            from public.department_memberships department_membership
            where department_membership.tenant_id = assignment.tenant_id
              and department_membership.department_id = assignment.department_id
              and department_membership.user_id = auth.uid()
              and department_membership.status = 'active'
          )
        )
    );
$$;

revoke all on function public.has_event_space_permission(uuid, text) from public, anon;
grant execute on function public.has_event_space_permission(uuid, text) to authenticated, service_role;

create table if not exists public.event_spaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  kind text not null default 'meeting_room'
    check (kind in ('meeting_room', 'event_room', 'other')),
  location text check (location is null or char_length(btrim(location)) between 2 and 240),
  capacity integer check (capacity is null or capacity between 1 and 10000),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_spaces_id_tenant_unique unique (id, tenant_id),
  constraint event_spaces_tenant_name_unique unique (tenant_id, name),
  constraint event_spaces_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id)
);

create table if not exists public.event_space_task_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default 'Standard Raumauftrag'
    check (char_length(btrim(name)) between 2 and 120),
  task_label text not null check (char_length(btrim(task_label)) between 2 and 240),
  position integer not null check (position between 1 and 100),
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_space_task_templates_id_tenant_unique unique (id, tenant_id),
  constraint event_space_task_templates_position_unique unique (tenant_id, name, position)
);

create table if not exists public.event_space_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  space_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  organizer text check (organizer is null or char_length(btrim(organizer)) between 2 and 160),
  expected_participants integer check (expected_participants is null or expected_participants between 0 and 10000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  responsible_user_id uuid not null,
  status text not null default 'planned'
    check (status in ('planned', 'in_preparation', 'ready', 'conducted', 'completed')),
  recurrence_kind text not null default 'none'
    check (recurrence_kind in ('none', 'weekly', 'monthly')),
  series_id uuid,
  series_index integer not null default 1 check (series_index between 1 and 52),
  conflicts_acknowledged boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_space_requests_id_tenant_unique unique (id, tenant_id),
  constraint event_space_requests_time_valid check (ends_at > starts_at),
  constraint event_space_requests_singleton_valid check (
    (recurrence_kind = 'none' and series_id is null and series_index = 1)
    or (recurrence_kind in ('weekly', 'monthly') and series_id is not null)
  ),
  constraint event_space_requests_series_position_unique unique (tenant_id, series_id, series_index),
  constraint event_space_requests_space_tenant_fk
    foreign key (space_id, tenant_id)
    references public.event_spaces (id, tenant_id),
  constraint event_space_requests_responsible_tenant_fk
    foreign key (tenant_id, responsible_user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint event_space_requests_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id)
);

create table if not exists public.event_space_request_equipment (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  equipment_key text not null check (
    equipment_key in ('projector', 'connections', 'display', 'audio', 'videocall', 'microphones')
  ),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (request_id, equipment_key),
  constraint event_space_request_equipment_request_tenant_fk
    foreign key (request_id, tenant_id)
    references public.event_space_requests (id, tenant_id) on delete cascade
);

create table if not exists public.event_space_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  template_id uuid,
  title text not null check (char_length(btrim(title)) between 2 and 240),
  position integer not null check (position between 1 and 100),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_space_tasks_request_position_unique unique (request_id, position),
  constraint event_space_tasks_request_tenant_fk
    foreign key (request_id, tenant_id)
    references public.event_space_requests (id, tenant_id) on delete cascade,
  constraint event_space_tasks_template_tenant_fk
    foreign key (template_id, tenant_id)
    references public.event_space_task_templates (id, tenant_id)
    on delete set null (template_id),
  constraint event_space_tasks_completed_at_valid check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists event_spaces_tenant_active_name_idx
  on public.event_spaces (tenant_id, active, name);
create unique index if not exists event_space_task_templates_one_default_idx
  on public.event_space_task_templates (tenant_id)
  where active and is_default;
create index if not exists event_space_requests_tenant_time_idx
  on public.event_space_requests (tenant_id, starts_at, ends_at);
create index if not exists event_space_requests_space_time_idx
  on public.event_space_requests (space_id, tenant_id, starts_at, ends_at)
  where status <> 'completed';
create index if not exists event_space_requests_responsible_time_idx
  on public.event_space_requests (responsible_user_id, tenant_id, starts_at)
  where responsible_user_id is not null;
create index if not exists event_space_request_equipment_tenant_key_idx
  on public.event_space_request_equipment (tenant_id, equipment_key, request_id);
create index if not exists event_space_tasks_request_position_idx
  on public.event_space_tasks (request_id, position);

create or replace function public.seed_event_space_task_templates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_space_task_templates (
    tenant_id, name, task_label, position, active, is_default
  ) values
    (new.id, 'Standard Raumauftrag', 'Technik prüfen', 10, true, true),
    (new.id, 'Standard Raumauftrag', 'Raum einrichten', 20, true, false),
    (new.id, 'Standard Raumauftrag', 'Videocall vorbereiten', 30, true, false),
    (new.id, 'Standard Raumauftrag', 'Vor-Ort-Test', 40, true, false),
    (new.id, 'Standard Raumauftrag', 'Nach dem Anlass zurückbauen', 50, true, false)
  on conflict (tenant_id, name, position) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_event_space_task_templates() from public, anon, authenticated;

drop trigger if exists event_space_task_templates_seed on public.tenants;
create trigger event_space_task_templates_seed
  after insert on public.tenants
  for each row execute function public.seed_event_space_task_templates();

-- Existing tenants receive exactly the same template. New tenants are covered
-- by the trigger above; no scheduler or provider is involved.
insert into public.event_space_task_templates (
  tenant_id, name, task_label, position, active, is_default
)
select tenant.id, template.name, template.task_label, template.position, true, template.is_default
from public.tenants as tenant
cross join (
  values
    ('Standard Raumauftrag'::text, 'Technik prüfen'::text, 10, true),
    ('Standard Raumauftrag'::text, 'Raum einrichten'::text, 20, false),
    ('Standard Raumauftrag'::text, 'Videocall vorbereiten'::text, 30, false),
    ('Standard Raumauftrag'::text, 'Vor-Ort-Test'::text, 40, false),
    ('Standard Raumauftrag'::text, 'Nach dem Anlass zurückbauen'::text, 50, false)
) as template(name, task_label, position, is_default)
on conflict (tenant_id, name, position) do nothing;

create or replace function public.validate_event_space_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name not in (
    'event_spaces', 'event_space_task_templates', 'event_space_requests',
    'event_space_request_equipment', 'event_space_tasks'
  ) then
    raise exception 'Unsupported event space trigger target' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Event-space tenant is immutable' using errcode = '23514';
    end if;
    if tg_table_name in ('event_spaces', 'event_space_task_templates', 'event_space_requests', 'event_space_tasks')
      and new.created_at is distinct from old.created_at then
      raise exception 'Event-space creation timestamp is immutable' using errcode = '23514';
    end if;
    if tg_table_name = 'event_spaces' and new.created_by is distinct from old.created_by then
      raise exception 'Event-space creator is immutable' using errcode = '23514';
    end if;
    if tg_table_name = 'event_space_requests' and (
      new.created_by is distinct from old.created_by
      or new.series_id is distinct from old.series_id
      or new.series_index is distinct from old.series_index
      or new.recurrence_kind is distinct from old.recurrence_kind
    ) then
      raise exception 'Event-space request provenance is immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_event_space_identity() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'event_spaces', 'event_space_task_templates', 'event_space_requests',
    'event_space_request_equipment', 'event_space_tasks'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_validate_identity', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_event_space_identity()', table_name || '_validate_identity', table_name);
  end loop;

  foreach table_name in array array[
    'event_spaces', 'event_space_task_templates', 'event_space_requests', 'event_space_tasks'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_updated_at', table_name);
  end loop;
end;
$$;

-- This service-only operation performs the final conflict check after
-- resource-specific transaction locks. A confirmation is bound to the exact
-- opaque conflict snapshot that was shown, so a stale preview can never
-- silently create a room or equipment collision.
create or replace function public.create_event_space_request_series(
  p_tenant_id uuid,
  p_space_id uuid,
  p_title text,
  p_organizer text,
  p_expected_participants integer,
  p_responsible_user_id uuid,
  p_recurrence_kind text,
  p_starts_at timestamptz[],
  p_ends_at timestamptz[],
  p_equipment_keys text[],
  p_conflicts_acknowledged boolean,
  p_conflict_snapshot text,
  p_actor_id uuid
)
returns table(
  created_count integer,
  room_conflict_count integer,
  equipment_conflict_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occurrence_count integer := coalesce(cardinality(p_starts_at), 0);
  v_index integer;
  v_previous_end timestamptz;
  v_first_start_local timestamp;
  v_current_start_local timestamp;
  v_first_duration interval;
  v_expected_month_start date;
  v_expected_day integer;
  v_request_id uuid;
  v_first_request_id uuid;
  v_series_id uuid;
  v_template_name text;
  v_template_count integer;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
  v_room_conflict_signature text := encode(digest('', 'sha256'), 'hex');
  v_equipment_conflict_signature text := encode(digest('', 'sha256'), 'hex');
  v_conflict_snapshot text;
  v_equipment_key text;
begin
  if v_occurrence_count not between 1 and 52
    or coalesce(cardinality(p_ends_at), 0) <> v_occurrence_count
    or p_recurrence_kind not in ('none', 'weekly', 'monthly')
    or (p_recurrence_kind = 'none' and v_occurrence_count <> 1)
    or (p_recurrence_kind <> 'none' and v_occurrence_count < 2)
    -- The workspace deliberately loads a complete planning year. Monthly
    -- series therefore remain actionable instead of silently leaving it.
    or (p_recurrence_kind = 'monthly' and v_occurrence_count > 12) then
    raise exception 'Invalid event-space occurrence series' using errcode = '22023';
  end if;
  if p_responsible_user_id is null then
    raise exception 'A responsible event-space member is required' using errcode = '23502';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'The actor is not an active tenant member' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    raise exception 'The selected event space is unavailable' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_responsible_user_id
      and membership.status = 'active'
  ) then
    raise exception 'The responsible event-space member is unavailable' using errcode = '23503';
  end if;

  -- Lock in a stable order to prevent both room and shared-equipment races.
  perform pg_advisory_xact_lock(
    hashtextextended('nextdesk:event-space:room:' || p_tenant_id::text || ':' || p_space_id::text, 0)
  );
  for v_equipment_key in
    select distinct equipment_key
    from unnest(coalesce(p_equipment_keys, array[]::text[])) as item(equipment_key)
    order by equipment_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:event-space:equipment:' || p_tenant_id::text || ':' || v_equipment_key, 0)
    );
  end loop;

  for v_index in 1..v_occurrence_count loop
    if p_ends_at[v_index] <= p_starts_at[v_index]
      or p_ends_at[v_index] - p_starts_at[v_index] not between interval '15 minutes' and interval '24 hours'
      or (v_previous_end is not null and p_starts_at[v_index] < v_previous_end) then
      raise exception 'Invalid event-space occurrence time' using errcode = '22023';
    end if;
    v_current_start_local := p_starts_at[v_index] at time zone 'Europe/Zurich';
    if v_index = 1 then
      v_first_start_local := v_current_start_local;
      v_first_duration := p_ends_at[v_index] - p_starts_at[v_index];
    elsif p_recurrence_kind <> 'none' and (
      p_ends_at[v_index] - p_starts_at[v_index] <> v_first_duration
      or v_current_start_local::time <> v_first_start_local::time
      or (
        p_recurrence_kind = 'weekly'
        and v_current_start_local::date - v_first_start_local::date <> (v_index - 1) * 7
      )
    ) then
      raise exception 'Invalid event-space recurrence series' using errcode = '22023';
    elsif p_recurrence_kind = 'monthly' and v_index > 1 then
      v_expected_month_start := (
        date_trunc('month', v_first_start_local)::date
        + ((v_index - 1) * interval '1 month')
      )::date;
      v_expected_day := least(
        extract(day from v_first_start_local)::integer,
        extract(day from (v_expected_month_start + interval '1 month - 1 day'))::integer
      );
      if v_current_start_local::date <> v_expected_month_start + (v_expected_day - 1) then
        raise exception 'Invalid event-space recurrence series' using errcode = '22023';
      end if;
    end if;
    v_previous_end := p_ends_at[v_index];
  end loop;

  select template.name into v_template_name
  from public.event_space_task_templates template
  where template.tenant_id = p_tenant_id
    and template.active
    and template.is_default
  order by template.name
  limit 1;

  select count(*) into v_template_count
  from public.event_space_task_templates template
  where template.tenant_id = p_tenant_id
    and template.name = v_template_name
    and template.active;
  if v_template_name is null or v_template_count < 1 then
    raise exception 'Event-space templates are unavailable' using errcode = 'P0001';
  end if;

  select
    count(distinct request.id),
    coalesce(
      encode(
        digest(
          string_agg(distinct request.id::text, ',' order by request.id::text),
          'sha256'
        ),
        'hex'
      ),
      encode(digest('', 'sha256'), 'hex')
    )
    into v_room_conflicts, v_room_conflict_signature
  from public.event_space_requests request
  join generate_subscripts(p_starts_at, 1) as occurrence(index)
    on request.starts_at < p_ends_at[occurrence.index]
   and request.ends_at > p_starts_at[occurrence.index]
  where request.tenant_id = p_tenant_id
    and request.space_id = p_space_id
    and request.status <> 'completed';

  if coalesce(cardinality(p_equipment_keys), 0) > 0 then
    select
      count(distinct request.id),
      coalesce(
        encode(
          digest(
            string_agg(distinct request.id::text, ',' order by request.id::text),
            'sha256'
          ),
          'hex'
        ),
        encode(digest('', 'sha256'), 'hex')
      )
      into v_equipment_conflicts, v_equipment_conflict_signature
    from public.event_space_requests request
    join public.event_space_request_equipment equipment
      on equipment.request_id = request.id
     and equipment.tenant_id = request.tenant_id
     and equipment.equipment_key = any(p_equipment_keys)
    join generate_subscripts(p_starts_at, 1) as occurrence(index)
      on request.starts_at < p_ends_at[occurrence.index]
     and request.ends_at > p_starts_at[occurrence.index]
    where request.tenant_id = p_tenant_id
      and request.status <> 'completed';
  end if;

  v_conflict_snapshot := v_room_conflict_signature || '.' || v_equipment_conflict_signature;
  if (v_room_conflicts > 0 or v_equipment_conflicts > 0) and (
    not p_conflicts_acknowledged
    or p_conflict_snapshot is null
    or p_conflict_snapshot <> v_conflict_snapshot
  ) then
    return query select 0, v_room_conflicts, v_equipment_conflicts;
    return;
  end if;

  if p_recurrence_kind = 'none' then
    v_series_id := null;
  else
    v_series_id := gen_random_uuid();
  end if;

  for v_index in 1..v_occurrence_count loop
    insert into public.event_space_requests (
      tenant_id, space_id, title, organizer, expected_participants,
      starts_at, ends_at, responsible_user_id, recurrence_kind, series_id,
      series_index, conflicts_acknowledged, created_by
    ) values (
      p_tenant_id, p_space_id, p_title, p_organizer, p_expected_participants,
      p_starts_at[v_index], p_ends_at[v_index], p_responsible_user_id,
      p_recurrence_kind, v_series_id, v_index,
      p_conflicts_acknowledged and p_conflict_snapshot = v_conflict_snapshot
        and (v_room_conflicts > 0 or v_equipment_conflicts > 0),
      p_actor_id
    ) returning id into v_request_id;
    v_first_request_id := coalesce(v_first_request_id, v_request_id);

    insert into public.event_space_request_equipment (
      tenant_id, request_id, equipment_key
    )
    select p_tenant_id, v_request_id, equipment_key
    from unnest(coalesce(p_equipment_keys, array[]::text[])) as item(equipment_key);

    insert into public.event_space_tasks (
      tenant_id, request_id, template_id, title, position
    )
    select p_tenant_id, v_request_id, template.id, template.task_label, template.position
    from public.event_space_task_templates template
    where template.tenant_id = p_tenant_id
      and template.name = v_template_name
      and template.active
    order by template.position;
  end loop;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.request.created',
    'event_space_request_series', coalesce(v_series_id, v_first_request_id), 'info',
    jsonb_build_object(
      'conflictAcknowledged', p_conflicts_acknowledged and p_conflict_snapshot = v_conflict_snapshot
        and (v_room_conflicts > 0 or v_equipment_conflicts > 0),
      'equipmentCount', coalesce(cardinality(p_equipment_keys), 0),
      'occurrenceCount', v_occurrence_count,
      'recurrence', p_recurrence_kind,
      'taskCount', v_occurrence_count * v_template_count
    )
  );

  return query select v_occurrence_count, v_room_conflicts, v_equipment_conflicts;
end;
$$;

revoke all on function public.create_event_space_request_series(
  uuid, uuid, text, text, integer, uuid, text, timestamptz[], timestamptz[], text[], boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_event_space_request_series(
  uuid, uuid, text, text, integer, uuid, text, timestamptz[], timestamptz[], text[], boolean, text, uuid
) to service_role;

alter table public.event_spaces enable row level security;
alter table public.event_space_task_templates enable row level security;
alter table public.event_space_requests enable row level security;
alter table public.event_space_request_equipment enable row level security;
alter table public.event_space_tasks enable row level security;

-- Every browser read and mutation goes through the JWT-protected event-spaces
-- Function. The tables are not PostgREST resources for authenticated users.
revoke all on table public.event_spaces, public.event_space_task_templates,
  public.event_space_requests, public.event_space_request_equipment,
  public.event_space_tasks from public, anon, authenticated;
grant select, insert, update, delete on table public.event_spaces,
  public.event_space_task_templates, public.event_space_requests,
  public.event_space_request_equipment, public.event_space_tasks to service_role;

commit;
