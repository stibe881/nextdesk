begin;

-- E-mail-originated requests can be incomplete on arrival. They are retained as
-- non-reserving clarification cases instead of guessing a room, time or owner.
alter table public.event_space_requests
  alter column space_id drop not null,
  alter column starts_at drop not null,
  alter column ends_at drop not null,
  alter column responsible_user_id drop not null,
  alter column created_by drop not null,
  add column if not exists intake_source text not null default 'manual'
    check (intake_source in ('manual', 'email_ticket')),
  add column if not exists source_ticket_id uuid,
  add column if not exists source_order_number text
    check (source_order_number is null or char_length(btrim(source_order_number)) between 1 and 80),
  add column if not exists requested_space_text text
    check (requested_space_text is null or char_length(btrim(requested_space_text)) between 2 and 160),
  add column if not exists requested_starts_at timestamptz,
  add column if not exists requested_ends_at timestamptz,
  add column if not exists requested_equipment_keys text[] not null default array[]::text[],
  add column if not exists clarification_reasons text[] not null default array[]::text[],
  add column if not exists room_reservation_requested boolean not null default false,
  add column if not exists ict_material_requested boolean not null default false,
  add column if not exists internet_access_requested boolean not null default false,
  add column if not exists sobe_network_access_requested boolean not null default false,
  add column if not exists reception_laptop_requested boolean not null default false,
  add column if not exists remarks text
    check (remarks is null or char_length(remarks) <= 4000),
  add column if not exists sharepoint_url text
    check (sharepoint_url is null or sharepoint_url ~ '^https://[^[:space:]]+$'),
  add column if not exists phone_number text
    check (phone_number is null or char_length(btrim(phone_number)) between 3 and 80);

alter table public.event_space_requests
  drop constraint if exists event_space_requests_status_check,
  add constraint event_space_requests_status_check
    check (status in (
      'planned', 'in_preparation', 'ready', 'conducted', 'completed',
      'clarification_required'
    )),
  add constraint event_space_requests_source_ticket_tenant_fk
    foreign key (source_ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete restrict,
  add constraint event_space_requests_materialized_time_valid
    check (
      status = 'clarification_required'
      or (
        space_id is not null
        and starts_at is not null
        and ends_at is not null
        and ends_at > starts_at
      )
    ),
  add constraint event_space_requests_manual_identity_valid
    check (
      intake_source = 'email_ticket'
      or (responsible_user_id is not null and created_by is not null)
    );

create unique index if not exists event_space_requests_source_ticket_unique_idx
  on public.event_space_requests (source_ticket_id)
  where source_ticket_id is not null;

create index if not exists event_space_requests_attention_idx
  on public.event_space_requests (tenant_id, created_at desc)
  where status <> 'completed'
    and (responsible_user_id is null or status = 'clarification_required');

alter table public.event_space_request_equipment
  drop constraint if exists event_space_request_equipment_equipment_key_check,
  add constraint event_space_request_equipment_equipment_key_check
    check (equipment_key in (
      'projector', 'connections', 'display', 'audio', 'videocall', 'microphones',
      'screen', 'reception_laptop'
    ));

-- The trigger is an atomic delivery record shared by both existing e-mail
-- ingress paths. It does not parse text, reserve a resource or start a job.
create table if not exists public.event_space_ticket_intake_outbox (
  ticket_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'ignored', 'failed', 'retrying')),
  last_error_code text,
  manual_retry_count integer not null default 0
    check (manual_retry_count between 0 and 3),
  last_retry_at timestamptz,
  retry_lease_expires_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_space_ticket_intake_outbox_retry_lease_valid check (
    (status = 'retrying' and retry_lease_expires_at is not null)
    or (status <> 'retrying' and retry_lease_expires_at is null)
  ),
  constraint event_space_ticket_intake_outbox_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete cascade
);

create index if not exists event_space_ticket_intake_outbox_pending_idx
  on public.event_space_ticket_intake_outbox (tenant_id, created_at)
  where status in ('pending', 'failed', 'retrying');

create or replace function public.enqueue_event_space_ticket_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'email' then
    insert into public.event_space_ticket_intake_outbox (ticket_id, tenant_id)
    values (new.id, new.tenant_id)
    on conflict (ticket_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_event_space_ticket_intake() from public, anon, authenticated;
drop trigger if exists event_space_ticket_intake_enqueue on public.tickets;
create trigger event_space_ticket_intake_enqueue
  after insert on public.tickets
  for each row execute function public.enqueue_event_space_ticket_intake();

-- Only the server-side e-mail parser may call this operation. It locks both the
-- delivery record and relevant resource keys, then records either a planned,
-- unassigned request or a non-reserving clarification case atomically.
create or replace function public.create_event_space_email_ticket_request(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_order_number text,
  p_title text,
  p_organizer text,
  p_space_id uuid,
  p_requested_space_text text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_equipment_keys text[],
  p_room_reservation_requested boolean,
  p_ict_material_requested boolean,
  p_internet_access_requested boolean,
  p_sobe_network_access_requested boolean,
  p_reception_laptop_requested boolean,
  p_remarks text,
  p_sharepoint_url text,
  p_phone_number text,
  p_clarification_reasons text[]
)
returns table(request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
  v_existing_status text;
  v_status text := 'planned';
  v_request_id uuid;
  v_template_name text;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
  v_equipment_key text;
  v_reasons text[] := coalesce(p_clarification_reasons, array[]::text[]);
begin
  if p_tenant_id is null or p_ticket_id is null
    or p_title is null or char_length(btrim(p_title)) not between 3 and 240 then
    raise exception 'Invalid event-space e-mail intake' using errcode = '22023';
  end if;

  perform 1
  from public.event_space_ticket_intake_outbox outbox
  where outbox.ticket_id = p_ticket_id
    and outbox.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Event-space ticket intake is unavailable' using errcode = '23503';
  end if;

  select request.id, request.status into v_existing_id, v_existing_status
  from public.event_space_requests request
  where request.tenant_id = p_tenant_id
    and request.source_ticket_id = p_ticket_id;
  if v_existing_id is not null then
    -- A response may be lost after the transaction committed. Converge a
    -- manually claimed outbox record to its terminal state on this idempotent
    -- path rather than leaving a visible retry lease behind.
    update public.event_space_ticket_intake_outbox
    set status = 'processed', last_error_code = null,
        processed_at = timezone('utc', now()), retry_lease_expires_at = null,
        updated_at = timezone('utc', now())
    where ticket_id = p_ticket_id and tenant_id = p_tenant_id;
    return query select v_existing_id, v_existing_status;
    return;
  end if;

  if not exists (
    select 1 from public.tickets ticket
    where ticket.id = p_ticket_id
      and ticket.tenant_id = p_tenant_id
      and ticket.source = 'email'
  ) then
    raise exception 'Event-space source ticket is unavailable' using errcode = '23503';
  end if;

  if p_space_id is null then
    v_reasons := array_append(v_reasons, 'room_not_matched');
  elsif not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id
      and space.tenant_id = p_tenant_id
      and space.active
  ) then
    v_reasons := array_append(v_reasons, 'room_unavailable');
  end if;

  if p_starts_at is null or p_ends_at is null
    or p_ends_at - p_starts_at <> interval '30 minutes' then
    v_reasons := array_append(v_reasons, 'start_time_invalid');
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_equipment_keys, array[]::text[])) as equipment(equipment_key)
    where equipment.equipment_key not in (
      'projector', 'connections', 'display', 'audio', 'videocall', 'microphones',
      'screen', 'reception_laptop'
    )
  ) then
    v_reasons := array_append(v_reasons, 'equipment_invalid');
  end if;

  v_reasons := array(select distinct reason from unnest(v_reasons) as reason where reason <> '');
  if coalesce(cardinality(v_reasons), 0) > 0 then
    v_status := 'clarification_required';
  else
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

    select count(distinct request.id) into v_room_conflicts
    from public.event_space_requests request
    where request.tenant_id = p_tenant_id
      and request.space_id = p_space_id
      and request.status not in ('completed', 'clarification_required')
      and request.starts_at < p_ends_at
      and request.ends_at > p_starts_at;

    select count(distinct request.id) into v_equipment_conflicts
    from public.event_space_requests request
    join public.event_space_request_equipment equipment
      on equipment.request_id = request.id
     and equipment.tenant_id = request.tenant_id
     and equipment.equipment_key = any(coalesce(p_equipment_keys, array[]::text[]))
    where request.tenant_id = p_tenant_id
      and request.status not in ('completed', 'clarification_required')
      and request.starts_at < p_ends_at
      and request.ends_at > p_starts_at;

    if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
      v_reasons := array_remove(array[
        case when v_room_conflicts > 0 then 'room_conflict' end,
        case when v_equipment_conflicts > 0 then 'equipment_conflict' end
      ], null);
      v_status := 'clarification_required';
    else
      select template.name into v_template_name
      from public.event_space_task_templates template
      where template.tenant_id = p_tenant_id
        and template.active
        and template.is_default
      order by template.name
      limit 1;
      if v_template_name is null then
        v_reasons := array['task_template_unavailable'];
        v_status := 'clarification_required';
      end if;
    end if;
  end if;

  insert into public.event_space_requests (
    tenant_id, space_id, title, organizer, starts_at, ends_at,
    status, recurrence_kind, series_id, series_index, conflicts_acknowledged,
    intake_source, source_ticket_id, source_order_number, requested_space_text,
    requested_starts_at, requested_ends_at, requested_equipment_keys,
    clarification_reasons, room_reservation_requested, ict_material_requested,
    internet_access_requested, sobe_network_access_requested,
    reception_laptop_requested, remarks, sharepoint_url, phone_number
  ) values (
    p_tenant_id,
    case when v_status = 'planned' then p_space_id else null end,
    btrim(p_title), case when v_status = 'planned' then nullif(btrim(p_organizer), '') else null end,
    case when v_status = 'planned' then p_starts_at else null end,
    case when v_status = 'planned' then p_ends_at else null end,
    v_status, 'none', null, 1, false,
    'email_ticket', p_ticket_id, nullif(btrim(p_order_number), ''),
    nullif(btrim(p_requested_space_text), ''), p_starts_at, p_ends_at,
    coalesce(p_equipment_keys, array[]::text[]), v_reasons,
    coalesce(p_room_reservation_requested, false),
    coalesce(p_ict_material_requested, false),
    coalesce(p_internet_access_requested, false),
    coalesce(p_sobe_network_access_requested, false),
    coalesce(p_reception_laptop_requested, false),
    case when v_status = 'planned' then nullif(p_remarks, '') else null end,
    case when v_status = 'planned' then nullif(p_sharepoint_url, '') else null end,
    case when v_status = 'planned' then nullif(btrim(p_phone_number), '') else null end
  ) returning id into v_request_id;

  if v_status = 'planned' then
    insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key)
    select p_tenant_id, v_request_id, equipment_key
    from unnest(coalesce(p_equipment_keys, array[]::text[])) as item(equipment_key);

    insert into public.event_space_tasks (tenant_id, request_id, template_id, title, position)
    select p_tenant_id, v_request_id, template.id, template.task_label, template.position
    from public.event_space_task_templates template
    where template.tenant_id = p_tenant_id
      and template.name = v_template_name
      and template.active
    order by template.position;
  end if;

  update public.event_space_ticket_intake_outbox
  set status = 'processed', last_error_code = null,
      processed_at = timezone('utc', now()), retry_lease_expires_at = null,
      updated_at = timezone('utc', now())
  where ticket_id = p_ticket_id and tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, null, 'event_spaces.email_ticket_intake.created',
    'event_space_request', v_request_id, 'info',
    jsonb_build_object(
      'hasClarification', v_status = 'clarification_required',
      'hasEquipment', coalesce(cardinality(p_equipment_keys), 0) > 0,
      'source', 'email_ticket'
    )
  );

  return query select v_request_id, v_status;
end;
$$;

revoke all on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) to service_role;

-- Manual recovery is deliberately a single, short-lived claim. It validates
-- tenant, active actor and the e-mail ticket/outbox relationship in the
-- database, but returns the source body only to the service-role Edge Function
-- that immediately processes it. No scheduler or automatic retry consumes this
-- queue. A stale lease can only be reclaimed by another explicit user action.
create or replace function public.claim_event_space_email_ticket_intake_retry(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid
)
returns table(
  outcome text,
  ticket_subject text,
  ticket_description text,
  retry_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.event_space_ticket_intake_outbox%rowtype;
  v_subject text;
  v_description text;
  v_next_retry_count integer;
begin
  if p_tenant_id is null or p_ticket_id is null or p_actor_id is null then
    raise exception 'Invalid event-space intake recovery arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'The recovery actor is not an active tenant member' using errcode = '42501';
  end if;

  select outbox.* into v_outbox
  from public.event_space_ticket_intake_outbox outbox
  join public.tickets ticket
    on ticket.id = outbox.ticket_id
   and ticket.tenant_id = outbox.tenant_id
   and ticket.source = 'email'
  where outbox.ticket_id = p_ticket_id
    and outbox.tenant_id = p_tenant_id
  for update of outbox;
  if not found then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;
  select ticket.subject, ticket.description
  into v_subject, v_description
  from public.tickets ticket
  where ticket.id = p_ticket_id
    and ticket.tenant_id = p_tenant_id
    and ticket.source = 'email';
  if not found then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;
  if v_outbox.status in ('processed', 'ignored') then
    return query select 'not_retryable'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.status = 'retrying'
    and v_outbox.retry_lease_expires_at > now() then
    return query select 'busy'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.manual_retry_count >= 3 then
    return query select 'retry_limit_reached'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.status not in ('pending', 'failed', 'retrying') then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;

  update public.event_space_ticket_intake_outbox
  set status = 'retrying', manual_retry_count = manual_retry_count + 1,
      last_retry_at = now(),
      retry_lease_expires_at = now() + interval '5 minutes',
      last_error_code = null, updated_at = now()
  where ticket_id = p_ticket_id and tenant_id = p_tenant_id
  returning manual_retry_count into v_next_retry_count;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.email_ticket_intake.retry_started',
    'event_space_ticket_intake_outbox', p_ticket_id, 'info',
    jsonb_build_object(
      'retryCount', v_next_retry_count,
      'statusBefore', v_outbox.status
    )
  );
  return query select 'claimed'::text, v_subject, v_description, v_next_retry_count;
end;
$$;

revoke all on function public.claim_event_space_email_ticket_intake_retry(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.claim_event_space_email_ticket_intake_retry(
  uuid, uuid, uuid
) to service_role;

-- A manager can complete a clarification case with an explicit 30-minute
-- Europe/Zurich time, room and responsible person only after a new locked
-- conflict check. Nothing is reserved until that conscious action succeeds.
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
  v_template_name text;
  v_equipment_key text;
  v_room_conflicts integer := 0;
  v_equipment_conflicts integer := 0;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
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
  v_starts_at := p_starts_at;
  v_ends_at := p_ends_at;
  if v_starts_at is null or v_ends_at is null
    or v_ends_at - v_starts_at <> interval '30 minutes' then
    raise exception 'Event-space clarification still lacks a valid 30-minute time' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_responsible_user_id
      and membership.status = 'active'
  ) or not exists (
    select 1 from public.event_spaces space
    where space.id = p_space_id and space.tenant_id = p_tenant_id and space.active
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
    and request.starts_at < v_ends_at
    and request.ends_at > v_starts_at;

  select count(distinct request.id) into v_equipment_conflicts
  from public.event_space_requests request
  join public.event_space_request_equipment equipment
    on equipment.request_id = request.id
   and equipment.tenant_id = request.tenant_id
   and equipment.equipment_key = any(coalesce(v_request.requested_equipment_keys, array[]::text[]))
  where request.tenant_id = p_tenant_id
    and request.id <> p_request_id
    and request.status not in ('completed', 'clarification_required')
    and request.starts_at < v_ends_at
    and request.ends_at > v_starts_at;
  if v_room_conflicts > 0 or v_equipment_conflicts > 0 then
    return query select false;
    return;
  end if;

  select template.name into v_template_name
  from public.event_space_task_templates template
  where template.tenant_id = p_tenant_id and template.active and template.is_default
  order by template.name
  limit 1;
  if v_template_name is null then
    raise exception 'Event-space templates are unavailable' using errcode = 'P0001';
  end if;

  update public.event_space_requests
  set space_id = p_space_id,
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      requested_starts_at = v_starts_at,
      requested_ends_at = v_ends_at,
      responsible_user_id = p_responsible_user_id,
      status = 'planned',
      clarification_reasons = array[]::text[]
  where id = p_request_id and tenant_id = p_tenant_id;

  insert into public.event_space_request_equipment (tenant_id, request_id, equipment_key)
  select p_tenant_id, p_request_id, equipment_key
  from unnest(coalesce(v_request.requested_equipment_keys, array[]::text[])) as item(equipment_key)
  on conflict do nothing;

  insert into public.event_space_tasks (tenant_id, request_id, template_id, title, position)
  select p_tenant_id, p_request_id, template.id, template.task_label, template.position
  from public.event_space_task_templates template
  where template.tenant_id = p_tenant_id
    and template.name = v_template_name
    and template.active
  order by template.position;

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

alter table public.event_space_ticket_intake_outbox enable row level security;
revoke all on table public.event_space_ticket_intake_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.event_space_ticket_intake_outbox to service_role;
create policy event_space_ticket_intake_outbox_service_role_only
  on public.event_space_ticket_intake_outbox
  for all to service_role using (true) with check (true);

commit;
