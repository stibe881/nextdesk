begin;
set local search_path = pg_catalog, public;

-- Eine Vorschau darf keine dauerhafte oder übertragbare Berechtigung zur
-- Ticketmutation erzeugen. Die kurze, private Bestätigungsfreigabe ist immer
-- an exakt eine Person, einen Mandanten, die aktuelle Richtlinie und maximal
-- acht konkret erneut prüfbare Tickets gebunden.
create or replace function public.uuid_array_values_are_distinct(p_values uuid[])
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select cardinality(p_values) = (
    select count(distinct value)
    from unnest(p_values) as values_list(value)
  );
$$;

create table if not exists public.tenant_automation_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_key text not null check (policy_key = 'auto_close'),
  prepared_by uuid not null references public.user_profiles(id) on delete restrict,
  policy_updated_at timestamptz not null,
  after_days integer not null check (after_days between 1 and 365),
  ticket_ids uuid[] not null check (
    cardinality(ticket_ids) between 1 and 8
    and public.uuid_array_values_are_distinct(ticket_ids)
  ),
  state text not null default 'pending' check (state in ('pending', 'executed', 'expired', 'invalidated')),
  expires_at timestamptz not null,
  executed_at timestamptz,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint tenant_automation_confirmation_request_expiry_check check (expires_at > created_at),
  constraint tenant_automation_confirmation_request_execution_check check (
    (state = 'executed' and executed_at is not null)
    or (state <> 'executed' and executed_at is null)
  )
);

create index if not exists tenant_automation_confirmation_pending_idx
  on public.tenant_automation_confirmation_requests (tenant_id, prepared_by, expires_at)
  where state = 'pending';

-- A new preview supersedes the former server-side confirmation. The unique
-- index prevents two valid confirmation capabilities from existing at once if
-- requests race; the opaque row ID is never returned to a browser.
create unique index if not exists tenant_automation_confirmation_one_pending_idx
  on public.tenant_automation_confirmation_requests (tenant_id, prepared_by, policy_key)
  where state = 'pending';

alter table public.tenant_automation_confirmation_requests enable row level security;
alter table public.tenant_automation_confirmation_requests force row level security;
revoke all on table public.tenant_automation_confirmation_requests from public, anon, authenticated;

-- A manual execution is deliberately governed by the same active tenant
-- membership, automation permission and feature gate as the Edge API. Keeping
-- this check inside the service-only RPC prevents any browser payload from
-- extending an expired or changed preview.
create or replace function public.assert_ticket_automation_execution_allowed(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Ticket automation execution is service-role only' using errcode = '42501';
  end if;

  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'automation.manage'
  );

  -- Automation previews can include tickets from the complete tenant. A
  -- department-scoped assignment therefore must never be sufficient to create
  -- a tenant-wide confirmation or to execute a ticket close.
  if not exists (
    select 1
    from public.user_role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = assignment.tenant_id
    join public.role_permissions permission
      on permission.role_id = role.id
    where assignment.tenant_id = p_tenant_id
      and assignment.user_id = p_actor_id
      and role.active
      and role.scope = 'tenant'
      and permission.permission_code = 'automation.manage'
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
  ) then
    raise exception 'Ticket automation requires a tenant-scoped permission' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tenant_feature_flags feature
    where feature.tenant_id = p_tenant_id
      and feature.feature_key = 'automation.sla'
      and feature.enabled
      and (feature.pilot_ends_at is null or feature.pilot_ends_at > timezone('utc', now()))
  ) then
    raise exception 'Ticket automation feature is inactive' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.prepare_ticket_automation_auto_close(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[]
)
returns table (
  confirmation_id uuid,
  candidate_count integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_policy public.tenant_automation_policies%rowtype;
  v_after_days integer;
  v_requested integer;
  v_matching integer;
  v_confirmation_id uuid;
  v_expires_at timestamptz := timezone('utc', now()) + interval '15 minutes';
begin
  perform public.assert_ticket_automation_execution_allowed(p_actor_id, p_tenant_id);

  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if v_requested < 1
    or v_requested > 8
    or cardinality(array(select distinct unnest(p_ticket_ids))) <> v_requested then
    raise exception 'Invalid controlled automation candidate set' using errcode = '22023';
  end if;

  select *
  into v_policy
  from public.tenant_automation_policies policy
  where policy.tenant_id = p_tenant_id
    and policy.policy_key = 'auto_close'
  for update;

  if not found or not v_policy.enabled then
    raise exception 'Automatic close policy is inactive' using errcode = 'P0001';
  end if;

  if coalesce(v_policy.configuration ->> 'requirePreview', 'true') <> 'true' then
    raise exception 'Automatic close requires an explicit preview' using errcode = 'P0001';
  end if;

  v_after_days := case
    when coalesce(v_policy.configuration ->> 'afterDays', '') ~ '^[0-9]{1,3}$'
      then (v_policy.configuration ->> 'afterDays')::integer
    else 0
  end;
  if v_after_days not between 1 and 365 then
    raise exception 'Invalid automatic close policy configuration' using errcode = '22023';
  end if;

  -- Lock before validating so a concurrent ticket transition cannot be
  -- confused with the reviewed state in this short preparation transaction.
  perform 1
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids)
  for update;

  select count(*)
  into v_matching
  from public.tickets ticket
  join public.ticket_statuses status
    on status.id = ticket.status_id
    and status.tenant_id = ticket.tenant_id
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids)
    and ticket.closed_at is null
    and status.key = 'resolved'
    and status.is_closed = false
    and ticket.resolved_at is not null
    and ticket.resolved_at <= timezone('utc', now()) - make_interval(days => v_after_days);

  if v_matching <> v_requested then
    raise exception 'Automatic close candidates changed' using errcode = 'P0001';
  end if;

  update public.tenant_automation_confirmation_requests request
  set state = case
        when request.expires_at <= timezone('utc', now()) then 'expired'
        else 'invalidated'
      end,
      result = jsonb_build_object(
        'reason', case
          when request.expires_at <= timezone('utc', now()) then 'expired'
          else 'superseded'
        end
      )
  where request.tenant_id = p_tenant_id
    and request.prepared_by = p_actor_id
    and request.policy_key = 'auto_close'
    and request.state = 'pending';

  insert into public.tenant_automation_confirmation_requests (
    tenant_id,
    policy_key,
    prepared_by,
    policy_updated_at,
    after_days,
    ticket_ids,
    expires_at
  )
  values (
    p_tenant_id,
    'auto_close',
    p_actor_id,
    v_policy.updated_at,
    v_after_days,
    p_ticket_ids,
    v_expires_at
  )
  returning id into v_confirmation_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'automation.auto_close.prepared',
    'tenant_automation_confirmation_request',
    null,
    'info',
    jsonb_build_object(
      'candidateCount', v_requested,
      'expiresAt', v_expires_at
    )
  );

  return query select v_confirmation_id, v_requested, v_expires_at;
end;
$$;

create or replace function public.execute_ticket_automation_auto_close(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns table (
  outcome text,
  requested integer,
  updated integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.tenant_automation_confirmation_requests%rowtype;
  v_policy public.tenant_automation_policies%rowtype;
  v_after_days integer;
  v_matching integer;
  v_bulk_result jsonb;
  v_updated integer;
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Ticket automation execution is service-role only' using errcode = '42501';
  end if;

  select *
  into v_request
  from public.tenant_automation_confirmation_requests request
  where request.tenant_id = p_tenant_id
    and request.prepared_by = p_actor_id
    and request.policy_key = 'auto_close'
    and request.state = 'pending'
  for update;

  if not found then
    return query select 'unavailable'::text, 0, 0;
    return;
  end if;

  perform public.assert_ticket_automation_execution_allowed(p_actor_id, p_tenant_id);

  if v_request.state <> 'pending' then
    return query select 'unavailable'::text, cardinality(v_request.ticket_ids), 0;
    return;
  end if;
  if v_request.expires_at <= timezone('utc', now()) then
    update public.tenant_automation_confirmation_requests request
    set state = 'expired'
    where request.id = v_request.id;
    return query select 'expired'::text, cardinality(v_request.ticket_ids), 0;
    return;
  end if;

  select *
  into v_policy
  from public.tenant_automation_policies policy
  where policy.tenant_id = p_tenant_id
    and policy.policy_key = 'auto_close'
  for update;

  v_after_days := case
    when found and coalesce(v_policy.configuration ->> 'afterDays', '') ~ '^[0-9]{1,3}$'
      then (v_policy.configuration ->> 'afterDays')::integer
    else 0
  end;

  if not found
    or not v_policy.enabled
    or coalesce(v_policy.configuration ->> 'requirePreview', 'true') <> 'true'
    or v_after_days not between 1 and 365
    or v_policy.updated_at is distinct from v_request.policy_updated_at
    or v_after_days <> v_request.after_days then
    update public.tenant_automation_confirmation_requests request
    set state = 'invalidated',
        result = jsonb_build_object('reason', 'policy_changed')
    where request.id = v_request.id;
    return query select 'invalidated'::text, cardinality(v_request.ticket_ids), 0;
    return;
  end if;

  perform 1
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(v_request.ticket_ids)
  for update;

  select count(*)
  into v_matching
  from public.tickets ticket
  join public.ticket_statuses status
    on status.id = ticket.status_id
    and status.tenant_id = ticket.tenant_id
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(v_request.ticket_ids)
    and ticket.closed_at is null
    and status.key = 'resolved'
    and status.is_closed = false
    and ticket.resolved_at is not null
    and ticket.resolved_at <= timezone('utc', now()) - make_interval(days => v_after_days);

  if v_matching <> cardinality(v_request.ticket_ids) then
    update public.tenant_automation_confirmation_requests request
    set state = 'invalidated',
        result = jsonb_build_object('reason', 'candidates_changed')
    where request.id = v_request.id;
    return query select 'invalidated'::text, cardinality(v_request.ticket_ids), 0;
    return;
  end if;

  select public.bulk_update_ticket_statuses(
    p_actor_id,
    p_tenant_id,
    v_request.ticket_ids,
    'closed',
    true
  )
  into v_bulk_result;

  v_updated := case
    when coalesce(v_bulk_result ->> 'updated', '') ~ '^[0-9]+$'
      then (v_bulk_result ->> 'updated')::integer
    else 0
  end;

  update public.tenant_automation_confirmation_requests request
  set state = 'executed',
      executed_at = timezone('utc', now()),
      result = jsonb_build_object(
        'requested', cardinality(v_request.ticket_ids),
        'updated', v_updated
      )
  where request.id = v_request.id;

  insert into public.tenant_automation_runs (
    tenant_id,
    policy_key,
    initiated_by,
    mode,
    result
  )
  values (
    p_tenant_id,
    'auto_close',
    p_actor_id,
    'manual',
    jsonb_build_object(
      'requested', cardinality(v_request.ticket_ids),
      'updated', v_updated,
      'confirmationRequired', true
    )
  );

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'automation.auto_close.executed',
    'tenant_automation_confirmation_request',
    null,
    'warning',
    jsonb_build_object(
      'requested', cardinality(v_request.ticket_ids),
      'updated', v_updated,
      'confirmationRequired', true
    )
  );

  return query select 'executed'::text, cardinality(v_request.ticket_ids), v_updated;
end;
$$;

revoke all on function public.assert_ticket_automation_execution_allowed(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.uuid_array_values_are_distinct(uuid[])
  from public, anon, authenticated;
revoke all on function public.prepare_ticket_automation_auto_close(uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.execute_ticket_automation_auto_close(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_ticket_automation_execution_allowed(uuid, uuid)
  to service_role;
grant execute on function public.prepare_ticket_automation_auto_close(uuid, uuid, uuid[])
  to service_role;
grant execute on function public.execute_ticket_automation_auto_close(uuid, uuid)
  to service_role;

-- The former optional switch is now forcibly fail-safe. Historical rows are
-- normalised without enabling any policy or starting a scheduler.
update public.tenant_automation_policies policy
set configuration = jsonb_set(
  policy.configuration,
  '{requirePreview}',
  'true'::jsonb,
  true
),
updated_at = timezone('utc', now())
where policy.policy_key = 'auto_close'
  and coalesce(policy.configuration ->> 'requirePreview', 'true') <> 'true';

comment on table public.tenant_automation_confirmation_requests is
  'Private, short-lived and actor-bound confirmations for controlled ticket automation. Browser roles cannot read or invoke these rows.';
comment on function public.prepare_ticket_automation_auto_close(uuid, uuid, uuid[]) is
  'Service-role-only: validates up to eight currently resolved and eligible tickets and creates a 15-minute actor-bound confirmation.';
comment on function public.execute_ticket_automation_auto_close(uuid, uuid) is
  'Service-role-only: atomically revalidates and executes the single current actor-bound auto-close confirmation without exposing its ID to a browser.';

commit;
