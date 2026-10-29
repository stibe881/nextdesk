begin;

set local search_path = pg_catalog, public;

-- The requester and the internal operational assignment are distinct facts. A
-- manually entered request retains its selected responsible_user_id as the
-- requesting person; E-mail requests retain their free-text organizer. Only
-- assigned_agent_id drives operational assignment and attention counts.
alter table public.event_space_requests
  add column if not exists assigned_agent_id uuid;

alter table public.event_space_requests
  drop constraint if exists event_space_requests_assigned_agent_tenant_fk,
  add constraint event_space_requests_assigned_agent_tenant_fk
    foreign key (tenant_id, assigned_agent_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (assigned_agent_id);

create index if not exists event_space_requests_assigned_agent_time_idx
  on public.event_space_requests (tenant_id, assigned_agent_id, starts_at)
  where assigned_agent_id is not null;

-- Earlier E-mail intake versions stored an internal agent in the generic
-- responsible_user_id column. Preserve that operational assignment while
-- clearing the requester-only field so the organizer from "Erstellt von" is
-- never rendered as an agent.
update public.event_space_requests
set assigned_agent_id = responsible_user_id,
    responsible_user_id = null
where intake_source = 'email_ticket'
  and responsible_user_id is not null
  and assigned_agent_id is null;

-- A tenant administrator or a current internal ticket agent may be assigned.
-- This mirrors the Function's check and keeps the boundary valid even for
-- service-role writes.
create or replace function public.is_active_event_space_agent(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
      and exists (
        select 1
        from public.user_role_assignments assignment
        join public.roles role
          on role.id = assignment.role_id
          and role.tenant_id = assignment.tenant_id
          and role.active
          and role.scope in ('tenant', 'department')
        join public.role_permissions permission
          on permission.role_id = role.id
        where assignment.tenant_id = p_tenant_id
          and assignment.user_id = p_user_id
          and assignment.starts_at <= timezone('utc', now())
          and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
          and permission.permission_code in (
            'ticket.read.assigned',
            'ticket.update',
            'tenant.settings.manage'
          )
          and (
            role.scope = 'tenant'
            or exists (
              select 1
              from public.department_memberships department_membership
              where department_membership.tenant_id = p_tenant_id
                and department_membership.user_id = p_user_id
                and department_membership.department_id = assignment.department_id
                and department_membership.status = 'active'
            )
          )
      )
  );
$$;

revoke all on function public.is_active_event_space_agent(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.validate_event_space_assigned_agent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.assigned_agent_id is not null
    and not public.is_active_event_space_agent(new.tenant_id, new.assigned_agent_id) then
    raise exception using
      errcode = '23514',
      message = 'invalid_event_space_assigned_agent';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_event_space_assigned_agent()
  from public, anon, authenticated;

drop trigger if exists event_space_requests_validate_assigned_agent
  on public.event_space_requests;
create trigger event_space_requests_validate_assigned_agent
  before insert or update of tenant_id, assigned_agent_id
  on public.event_space_requests
  for each row
  execute function public.validate_event_space_assigned_agent();

-- The navigation count represents unassigned operational work, not whether a
-- requester was captured. The clarification state remains visible regardless
-- of an optional early agent assignment.
drop index if exists public.event_space_requests_attention_idx;
create index event_space_requests_attention_idx
  on public.event_space_requests (tenant_id, created_at desc)
  where status <> 'completed'
    and (assigned_agent_id is null or status = 'clarification_required');

-- This service-only mutation updates one materialized room request after stable
-- room/equipment locks. It never reveals competing request details and refuses
-- conflicts rather than accepting them implicitly.
create or replace function public.update_event_space_request_details(
  p_tenant_id uuid,
  p_request_id uuid,
  p_space_id uuid,
  p_responsible_user_id uuid,
  p_organizer text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_actor_id uuid
)
returns table(updated boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.event_space_requests%rowtype;
  v_equipment_key text;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
  v_organizer text := nullif(btrim(coalesce(p_organizer, '')), '');
begin
  select request.* into v_request
  from public.event_space_requests request
  where request.id = p_request_id
    and request.tenant_id = p_tenant_id
    and request.status not in ('completed', 'clarification_required')
  for update;
  if not found then
    raise exception 'Event-space request is unavailable' using errcode = 'P0002';
  end if;

  if p_starts_at is null or p_ends_at is null
    or p_ends_at <= p_starts_at
    or p_ends_at - p_starts_at not between interval '15 minutes' and interval '24 hours' then
    raise exception 'Invalid event-space request time' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'The actor is not an active tenant member' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    raise exception 'The selected event space is unavailable' using errcode = '23503';
  end if;
  if v_request.intake_source = 'manual' and (
    p_responsible_user_id is null
    or not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.user_id = p_responsible_user_id
        and membership.status = 'active'
    )
  ) then
    raise exception 'The responsible requester is unavailable' using errcode = '23503';
  end if;
  if v_request.intake_source = 'email_ticket'
    and (v_organizer is null or char_length(v_organizer) not between 2 and 160) then
    raise exception 'The e-mail requester is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nextdesk:event-space:room:' || p_tenant_id::text || ':' || p_space_id::text, 0)
  );
  for v_equipment_key in
    select distinct equipment_key
    from public.event_space_request_equipment equipment
    where equipment.tenant_id = p_tenant_id
      and equipment.request_id = p_request_id
    order by equipment_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:event-space:equipment:' || p_tenant_id::text || ':' || v_equipment_key, 0)
    );
  end loop;

  select count(distinct request.id) into v_room_conflicts
  from public.event_space_requests request
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.space_id = p_space_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at;

  select count(distinct request.id) into v_equipment_conflicts
  from public.event_space_requests request
  join public.event_space_request_equipment equipment
    on equipment.request_id = request.id
   and equipment.tenant_id = request.tenant_id
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at
    and equipment.equipment_key in (
      select current_equipment.equipment_key
      from public.event_space_request_equipment current_equipment
      where current_equipment.tenant_id = p_tenant_id
        and current_equipment.request_id = p_request_id
    );
  if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
    return query select false;
    return;
  end if;

  update public.event_space_requests
  set space_id = p_space_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      responsible_user_id = case
        when v_request.intake_source = 'manual' then p_responsible_user_id
        else null
      end,
      organizer = case
        when v_request.intake_source = 'email_ticket' then v_organizer
        else organizer
      end,
      requested_starts_at = case
        when v_request.intake_source = 'email_ticket' then p_starts_at
        else requested_starts_at
      end,
      requested_ends_at = case
        when v_request.intake_source = 'email_ticket' then p_ends_at
        else requested_ends_at
      end
  where id = p_request_id
    and tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.request.details_updated',
    'event_space_request', p_request_id, 'info',
    jsonb_build_object(
      'intakeSource', v_request.intake_source,
      'timeChanged', p_starts_at is distinct from v_request.starts_at
        or p_ends_at is distinct from v_request.ends_at,
      'roomChanged', p_space_id is distinct from v_request.space_id,
      'requesterChanged', (
        v_request.intake_source = 'manual'
        and p_responsible_user_id is distinct from v_request.responsible_user_id
      ) or (
        v_request.intake_source = 'email_ticket'
        and v_organizer is distinct from v_request.organizer
      )
    )
  );
  return query select true;
end;
$$;

revoke all on function public.update_event_space_request_details(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.update_event_space_request_details(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid
) to service_role;

-- Keep the existing service-role RPC signature so no external caller can use a
-- newly named parameter. Its former responsible-user parameter is now the
-- explicitly validated agent assignment only.
create or replace function public.resolve_event_space_email_ticket_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_space_id uuid,
  p_responsible_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_actor_id uuid
)
returns table(resolved boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.event_space_requests%rowtype;
  v_equipment_key text;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
begin
  select request.* into v_request
  from public.event_space_requests request
  where request.id = p_request_id
    and request.tenant_id = p_tenant_id
    and request.intake_source = 'email_ticket'
    and request.status = 'clarification_required'
  for update;
  if not found then
    raise exception 'Event-space clarification request is unavailable' using errcode = 'P0002';
  end if;
  if p_starts_at is null or p_ends_at is null
    or p_ends_at - p_starts_at <> interval '30 minutes' then
    raise exception 'Event-space clarification still lacks a valid 30-minute time' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    raise exception 'Event-space resolution target is unavailable' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nextdesk:event-space:room:' || p_tenant_id::text || ':' || p_space_id::text, 0)
  );
  for v_equipment_key in
    select distinct equipment_key
    from unnest(coalesce(v_request.requested_equipment_keys, array[]::text[])) as item(equipment_key)
    order by equipment_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('nextdesk:event-space:equipment:' || p_tenant_id::text || ':' || v_equipment_key, 0)
    );
  end loop;

  select count(distinct request.id) into v_room_conflicts
  from public.event_space_requests request
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.space_id = p_space_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at;
  select count(distinct request.id) into v_equipment_conflicts
  from public.event_space_requests request
  join public.event_space_request_equipment equipment
    on equipment.request_id = request.id
   and equipment.tenant_id = request.tenant_id
   and equipment.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < p_ends_at
    and request.ends_at > p_starts_at;
  if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
    return query select false;
    return;
  end if;

  update public.event_space_requests
  set space_id = p_space_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      requested_starts_at = p_starts_at,
      requested_ends_at = p_ends_at,
      responsible_user_id = null,
      assigned_agent_id = p_responsible_user_id,
      status = 'planned',
      clarification_reasons = array[]::text[]
  where id = p_request_id
    and tenant_id = p_tenant_id;

  insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key)
  select p_tenant_id, p_request_id, equipment_key
  from (
    select distinct equipment_key
    from unnest(coalesce(v_request.requested_equipment_keys, array[]::text[])) as item(equipment_key)
  ) as requested
  on conflict do nothing;

  insert into public.event_space_tasks (
    tenant_id, request_id, template_id, title, position
  )
  select p_tenant_id, p_request_id, null, requirement.task_label, requirement.position
  from (values
    ('ict_material'::text, 'ICT Material bereitstellen'::text, 10),
    ('internet_access'::text, 'Internetzugang prüfen'::text, 20),
    ('sobe_network_access'::text, 'SOBE-Netzwerkzugang prüfen'::text, 30),
    ('projector'::text, 'Beamer bereitstellen'::text, 40),
    ('screen'::text, 'Leinwand bereitstellen'::text, 50),
    ('microphones'::text, 'Mikrofon bereitstellen'::text, 60),
    ('reception_laptop'::text, 'Empfangslaptop bereitstellen'::text, 70)
  ) as requirement(equipment_key, task_label, position)
  where requirement.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  order by requirement.position
  on conflict (request_id, position) do nothing;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.email_ticket_intake.resolved',
    'event_space_request', p_request_id, 'info', jsonb_build_object('conflictFree', true)
  );
  return query select true;
end;
$$;

revoke all on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.resolve_event_space_email_ticket_request(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid
) to service_role;

commit;
