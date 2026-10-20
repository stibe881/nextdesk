begin;

-- P1.5 deliberately adds a local control-plane preflight. It never fetches a
-- Graph token, calls Microsoft or mutates assets/devices. Existing provider
-- runs remain distinguishable as legacy/provider-contacting history.
alter table public.asset_intune_connections
  add column if not exists configuration_generation bigint not null default 1,
  add column if not exists last_preflight_at timestamptz,
  add column if not exists last_preflight_result_code text;

-- P1.5 intentionally has no provider-facing Intune operation. Disable every
-- legacy provider run switch before exposing the local-only control plane.
update public.asset_intune_connections
set sync_enabled = false
where sync_enabled is distinct from false;

alter table public.asset_intune_connections
  drop constraint if exists asset_intune_connections_last_preflight_result_code_check,
  add constraint asset_intune_connections_last_preflight_result_code_check
    check (
      last_preflight_result_code is null
      or last_preflight_result_code in (
        'preflight_ready',
        'connection_disabled',
        'sso_binding_required',
        'configuration_rebinding_required'
      )
    );

alter table public.asset_intune_sync_runs
  add column if not exists trigger_kind text not null default 'legacy',
  add column if not exists execution_scope text not null default 'legacy_provider',
  add column if not exists provider_contacted boolean not null default true,
  add column if not exists result_code text,
  add column if not exists configuration_generation bigint,
  add column if not exists retry_of_run_id uuid,
  add column if not exists root_run_id uuid,
  add column if not exists attempt_no integer,
  add column if not exists client_request_id uuid;

alter table public.asset_intune_sync_runs
  add constraint asset_intune_sync_runs_id_tenant_unique unique (id, tenant_id);

alter table public.asset_intune_sync_runs
  drop constraint if exists asset_intune_sync_runs_status_check,
  add constraint asset_intune_sync_runs_status_check
    check (status in ('running', 'succeeded', 'failed', 'cancelled', 'blocked')),
  drop constraint if exists asset_intune_sync_runs_trigger_kind_check,
  add constraint asset_intune_sync_runs_trigger_kind_check
    check (trigger_kind in ('legacy', 'manual_preflight', 'manual_preflight_retry')),
  drop constraint if exists asset_intune_sync_runs_execution_scope_check,
  add constraint asset_intune_sync_runs_execution_scope_check
    check (execution_scope in ('legacy_provider', 'local_preflight')),
  drop constraint if exists asset_intune_sync_runs_local_preflight_check,
  add constraint asset_intune_sync_runs_local_preflight_check
    check (
      execution_scope <> 'local_preflight'
      or (
        mode = 'dry_run'
        and provider_contacted = false
        and status in ('succeeded', 'blocked')
        and finished_at is not null
        and devices_seen = 0
        and assets_created = 0
        and assets_updated = 0
        and result_code is not null
        and configuration_generation is not null
        and configuration_generation >= 1
        and started_by is not null
        and root_run_id is not null
        and attempt_no is not null
        and attempt_no >= 1
        and client_request_id is not null
        and trigger_kind in ('manual_preflight', 'manual_preflight_retry')
      )
    ),
  drop constraint if exists asset_intune_sync_runs_retry_tenant_fk,
  add constraint asset_intune_sync_runs_retry_tenant_fk
    foreign key (retry_of_run_id, tenant_id)
    references public.asset_intune_sync_runs (id, tenant_id)
    on delete restrict,
  drop constraint if exists asset_intune_sync_runs_root_tenant_fk,
  add constraint asset_intune_sync_runs_root_tenant_fk
    foreign key (root_run_id, tenant_id)
    references public.asset_intune_sync_runs (id, tenant_id)
    on delete restrict;

create unique index if not exists asset_intune_sync_runs_local_preflight_request_unique
  on public.asset_intune_sync_runs (tenant_id, client_request_id)
  where execution_scope = 'local_preflight' and client_request_id is not null;
create unique index if not exists asset_intune_sync_runs_local_preflight_attempt_unique
  on public.asset_intune_sync_runs (tenant_id, root_run_id, attempt_no)
  where execution_scope = 'local_preflight';
create index if not exists asset_intune_sync_runs_local_preflight_history_idx
  on public.asset_intune_sync_runs (tenant_id, started_at desc, id desc)
  where execution_scope = 'local_preflight';

create or replace function public.validate_active_problem_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null and not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) then
    raise exception 'Problem owner must be an active tenant member'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_active_problem_owner()
  from public, anon, authenticated;
drop trigger if exists problems_validate_active_owner on public.problems;
create trigger problems_validate_active_owner
  before insert or update of tenant_id, owner_id on public.problems
  for each row execute function public.validate_active_problem_owner();

-- Browser clients use only the user-authenticated Edge Function. This prevents
-- direct reads of configuration identifiers, low-level errors and run rows.
revoke all on table public.asset_intune_connections, public.asset_intune_sync_runs
  from anon, authenticated;

create or replace function public.assert_asset_intune_preflight_feature_enabled(
  p_tenant_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.tenant_feature_flags feature
    where feature.tenant_id = p_tenant_id
      and feature.feature_key = 'assets.management'
      and feature.enabled
      and (
        feature.pilot_ends_at is null
        or feature.pilot_ends_at > timezone('utc', now())
      )
  ) then
    raise exception 'Asset management is disabled for this tenant'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.configure_asset_intune_preflight(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_enabled boolean
)
returns table (
  enabled boolean,
  sso_binding_available boolean,
  last_preflight_at timestamptz,
  last_preflight_result_code text,
  configuration_generation bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted_tenant_id uuid;
  v_configuration public.asset_intune_connections%rowtype;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'asset.integration.manage'
  );
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);

  insert into public.asset_intune_connections (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into v_configuration
  from public.asset_intune_connections
  where tenant_id = p_tenant_id
  for update;

  perform 1
  from public.tenant_sso_configurations
  where tenant_id = p_tenant_id
  for share;
  v_trusted_tenant_id := public.trusted_entra_tenant_id_for_tenant(p_tenant_id);

  if p_enabled and v_trusted_tenant_id is null then
    raise exception 'Asset Intune configuration requires an active tenant-specific Azure SSO binding'
      using errcode = 'P0001';
  end if;

  update public.asset_intune_connections
  set enabled = p_enabled,
      directory_tenant_id = case when p_enabled then v_trusted_tenant_id else null end,
      -- A local preflight never enables a provider operation or scheduler.
      sync_enabled = false,
      last_status = case when p_enabled then 'ready' else 'not_configured' end,
      last_error_code = null,
      last_preflight_at = null,
      last_preflight_result_code = null,
      updated_by = p_actor_id,
      configuration_generation = v_configuration.configuration_generation + 1
  where tenant_id = p_tenant_id
  returning
    asset_intune_connections.enabled,
    v_trusted_tenant_id is not null,
    asset_intune_connections.last_preflight_at,
    asset_intune_connections.last_preflight_result_code,
    asset_intune_connections.configuration_generation
  into
    enabled,
    sso_binding_available,
    last_preflight_at,
    last_preflight_result_code,
    configuration_generation;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'asset.intune_preflight.configuration_updated',
    'asset_intune_connection',
    p_tenant_id,
    'security',
    jsonb_build_object(
      'enabled', p_enabled,
      'sso_binding_available', v_trusted_tenant_id is not null,
      'provider_contacted', false
    )
  );

  return next;
end;
$$;

create or replace function public.get_asset_intune_preflight_configuration(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns table (
  enabled boolean,
  sso_binding_available boolean,
  sync_enabled boolean,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_status text,
  last_preflight_at timestamptz,
  last_preflight_result_code text,
  configuration_generation bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'asset.integration.manage'
  );
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);

  select * into v_configuration
  from public.asset_intune_connections
  where tenant_id = p_tenant_id;

  if not found then
    enabled := false;
    sso_binding_available := public.trusted_entra_tenant_id_for_tenant(p_tenant_id) is not null;
    sync_enabled := false;
    last_success_at := null;
    last_attempt_at := null;
    last_status := 'not_configured';
    last_preflight_at := null;
    last_preflight_result_code := null;
    configuration_generation := 1;
    updated_at := null;
  else
    enabled := v_configuration.enabled;
    sso_binding_available := public.trusted_entra_tenant_id_for_tenant(p_tenant_id) is not null;
    sync_enabled := false;
    last_success_at := v_configuration.last_success_at;
    last_attempt_at := v_configuration.last_attempt_at;
    last_status := v_configuration.last_status;
    last_preflight_at := v_configuration.last_preflight_at;
    last_preflight_result_code := v_configuration.last_preflight_result_code;
    configuration_generation := v_configuration.configuration_generation;
    updated_at := v_configuration.updated_at;
  end if;
  return next;
end;
$$;

create or replace function public.run_asset_intune_local_preflight(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_retry_of_run_id uuid default null
)
returns table (
  id uuid,
  trigger_kind text,
  status text,
  result_code text,
  started_at timestamptz,
  finished_at timestamptz,
  execution_scope text,
  retry_of_run_id uuid,
  root_run_id uuid,
  attempt_no integer,
  provider_contacted boolean,
  devices_seen integer,
  assets_created integer,
  assets_updated integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
  v_trusted_tenant_id uuid;
  v_retry public.asset_intune_sync_runs%rowtype;
  v_existing public.asset_intune_sync_runs%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_root_run_id uuid;
  v_attempt_no integer;
  v_trigger_kind text;
  v_status text;
  v_result_code text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_client_request_id is null then
    raise exception 'A client request identifier is required' using errcode = '22023';
  end if;

  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'asset.integration.manage'
  );
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);

  -- Serialize same-request retries without a global tenant lock.
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_client_request_id::text));
  select * into v_existing
  from public.asset_intune_sync_runs run
  where run.tenant_id = p_tenant_id
    and run.execution_scope = 'local_preflight'
    and run.client_request_id = p_client_request_id;
  if found then
    id := v_existing.id;
    trigger_kind := v_existing.trigger_kind;
    status := v_existing.status;
    result_code := v_existing.result_code;
    started_at := v_existing.started_at;
    finished_at := v_existing.finished_at;
    execution_scope := v_existing.execution_scope;
    retry_of_run_id := v_existing.retry_of_run_id;
    root_run_id := v_existing.root_run_id;
    attempt_no := v_existing.attempt_no;
    provider_contacted := v_existing.provider_contacted;
    devices_seen := v_existing.devices_seen;
    assets_created := v_existing.assets_created;
    assets_updated := v_existing.assets_updated;
    return next;
    return;
  end if;

  if p_retry_of_run_id is not null then
    select * into v_retry
    from public.asset_intune_sync_runs run
    where run.id = p_retry_of_run_id
      and run.tenant_id = p_tenant_id
      and run.execution_scope = 'local_preflight'
      and run.status in ('succeeded', 'blocked')
    for share;
    if not found then
      raise exception 'The preflight run cannot be retried' using errcode = 'P0002';
    end if;
    v_root_run_id := coalesce(v_retry.root_run_id, v_retry.id);
    -- Different request IDs for the same root run must still be serialized.
    perform pg_advisory_xact_lock(
      hashtext(p_tenant_id::text || ':preflight-retry:' || v_root_run_id::text)
    );
    select coalesce(max(run.attempt_no), 0) + 1 into v_attempt_no
    from public.asset_intune_sync_runs run
    where run.tenant_id = p_tenant_id
      and run.execution_scope = 'local_preflight'
      and run.root_run_id = v_root_run_id;
    v_trigger_kind := 'manual_preflight_retry';
  else
    v_root_run_id := v_run_id;
    v_attempt_no := 1;
    v_trigger_kind := 'manual_preflight';
  end if;

  insert into public.asset_intune_connections (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;
  select * into v_configuration
  from public.asset_intune_connections
  where tenant_id = p_tenant_id
  for update;

  perform 1
  from public.tenant_sso_configurations
  where tenant_id = p_tenant_id
  for share;
  v_trusted_tenant_id := public.trusted_entra_tenant_id_for_tenant(p_tenant_id);

  if not v_configuration.enabled then
    v_status := 'blocked';
    v_result_code := 'connection_disabled';
  elsif v_trusted_tenant_id is null then
    v_status := 'blocked';
    v_result_code := 'sso_binding_required';
  elsif v_configuration.directory_tenant_id is distinct from v_trusted_tenant_id then
    v_status := 'blocked';
    v_result_code := 'configuration_rebinding_required';
  else
    v_status := 'succeeded';
    v_result_code := 'preflight_ready';
  end if;

  insert into public.asset_intune_sync_runs (
    id, tenant_id, mode, status, started_at, finished_at,
    devices_seen, assets_created, assets_updated, started_by,
    trigger_kind, execution_scope, provider_contacted, result_code,
    configuration_generation, retry_of_run_id, root_run_id, attempt_no,
    client_request_id
  ) values (
    v_run_id, p_tenant_id, 'dry_run', v_status, v_now, v_now,
    0, 0, 0, p_actor_id,
    v_trigger_kind, 'local_preflight', false, v_result_code,
    v_configuration.configuration_generation, p_retry_of_run_id, v_root_run_id,
    v_attempt_no, p_client_request_id
  );

  update public.asset_intune_connections
  set last_preflight_at = v_now,
      last_preflight_result_code = v_result_code,
      last_attempt_at = v_now,
      last_status = case when v_status = 'succeeded' then 'ready' else 'not_configured' end,
      last_error_code = null
  where tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'asset.intune_preflight.' || v_status,
    'asset_intune_sync_run',
    v_run_id,
    (case when v_status = 'succeeded' then 'info' else 'warning' end)::public.audit_severity,
    jsonb_build_object(
      'trigger_kind', v_trigger_kind,
      'result_code', v_result_code,
      'provider_contacted', false,
      'attempt_no', v_attempt_no
    )
  );

  id := v_run_id;
  trigger_kind := v_trigger_kind;
  status := v_status;
  result_code := v_result_code;
  started_at := v_now;
  finished_at := v_now;
  execution_scope := 'local_preflight';
  retry_of_run_id := p_retry_of_run_id;
  root_run_id := v_root_run_id;
  attempt_no := v_attempt_no;
  provider_contacted := false;
  devices_seen := 0;
  assets_created := 0;
  assets_updated := 0;
  return next;
end;
$$;

-- Asset access is fail-closed at the database boundary as well as in the
-- Edge Functions. A hidden, disabled, expired or missing feature flag must
-- not be bypassable through direct PostgREST table access.
create or replace function public.is_asset_management_client_enabled(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_feature_flags feature
    where feature.tenant_id = p_tenant_id
      and feature.feature_key = 'assets.management'
      and feature.enabled
      and (
        feature.pilot_ends_at is null
        or feature.pilot_ends_at > timezone('utc', now())
      )
  );
$$;

revoke all on function public.is_asset_management_client_enabled(uuid)
  from public, anon;
grant execute on function public.is_asset_management_client_enabled(uuid)
  to authenticated;

drop policy if exists services_select_member on public.services;
create policy services_select_member on public.services
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists services_manage_authorized on public.services;
create policy services_manage_authorized on public.services
  for all to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  )
  with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );

drop policy if exists assets_select_member on public.assets;
create policy assets_select_member on public.assets
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists assets_manage_authorized on public.assets;
create policy assets_manage_authorized on public.assets
  for all to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  )
  with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );

drop policy if exists problems_select_member on public.problems;
create policy problems_select_member on public.problems
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists problems_insert_authorized on public.problems;
create policy problems_insert_authorized on public.problems
  for insert to authenticated with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
    and created_by = auth.uid()
  );
drop policy if exists problems_update_authorized on public.problems;
create policy problems_update_authorized on public.problems
  for update to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  )
  with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists problems_delete_authorized on public.problems;
create policy problems_delete_authorized on public.problems
  for delete to authenticated using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );

drop policy if exists asset_locations_select_member on public.asset_locations;
create policy asset_locations_select_member on public.asset_locations
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists asset_locations_manage_authorized on public.asset_locations;
create policy asset_locations_manage_authorized on public.asset_locations
  for all to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  )
  with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );

drop policy if exists asset_assignments_manage_authorized on public.asset_assignments;
create policy asset_assignments_manage_authorized on public.asset_assignments
  for all to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  )
  with check (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );
drop policy if exists asset_lifecycle_events_select_authorized on public.asset_lifecycle_events;
create policy asset_lifecycle_events_select_authorized on public.asset_lifecycle_events
  for select to authenticated using (
    public.has_tenant_permission(tenant_id, 'asset.manage')
    and public.is_asset_management_client_enabled(tenant_id)
  );

-- Explicit policies make the feature gate auditable and avoid dynamic SQL
-- during a production migration.
drop policy if exists ticket_services_select_member on public.ticket_services;
create policy ticket_services_select_member on public.ticket_services
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and public.can_read_ticket(ticket_id)
  );
drop policy if exists ticket_services_insert_authorized on public.ticket_services;
create policy ticket_services_insert_authorized on public.ticket_services
  for insert to authenticated with check (
    public.is_asset_management_client_enabled(tenant_id)
    and linked_by = auth.uid()
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_services.ticket_id
        and ticket.tenant_id = ticket_services.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_services_update_authorized on public.ticket_services;
create policy ticket_services_update_authorized on public.ticket_services
  for update to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_services.ticket_id
        and ticket.tenant_id = ticket_services.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  ) with check (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_services.ticket_id
        and ticket.tenant_id = ticket_services.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_services_delete_authorized on public.ticket_services;
create policy ticket_services_delete_authorized on public.ticket_services
  for delete to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_services.ticket_id
        and ticket.tenant_id = ticket_services.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );

drop policy if exists ticket_assets_select_member on public.ticket_assets;
create policy ticket_assets_select_member on public.ticket_assets
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and public.can_read_ticket(ticket_id)
  );
drop policy if exists ticket_assets_insert_authorized on public.ticket_assets;
create policy ticket_assets_insert_authorized on public.ticket_assets
  for insert to authenticated with check (
    public.is_asset_management_client_enabled(tenant_id)
    and linked_by = auth.uid()
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_assets.ticket_id
        and ticket.tenant_id = ticket_assets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_assets_update_authorized on public.ticket_assets;
create policy ticket_assets_update_authorized on public.ticket_assets
  for update to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_assets.ticket_id
        and ticket.tenant_id = ticket_assets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  ) with check (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_assets.ticket_id
        and ticket.tenant_id = ticket_assets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_assets_delete_authorized on public.ticket_assets;
create policy ticket_assets_delete_authorized on public.ticket_assets
  for delete to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_assets.ticket_id
        and ticket.tenant_id = ticket_assets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );

drop policy if exists problem_tickets_select_member on public.problem_tickets;
create policy problem_tickets_select_member on public.problem_tickets
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and public.can_read_ticket(ticket_id)
  );
drop policy if exists problem_tickets_insert_authorized on public.problem_tickets;
create policy problem_tickets_insert_authorized on public.problem_tickets
  for insert to authenticated with check (
    public.is_asset_management_client_enabled(tenant_id)
    and linked_by = auth.uid()
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = problem_tickets.ticket_id
        and ticket.tenant_id = problem_tickets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists problem_tickets_update_authorized on public.problem_tickets;
create policy problem_tickets_update_authorized on public.problem_tickets
  for update to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = problem_tickets.ticket_id
        and ticket.tenant_id = problem_tickets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  ) with check (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = problem_tickets.ticket_id
        and ticket.tenant_id = problem_tickets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists problem_tickets_delete_authorized on public.problem_tickets;
create policy problem_tickets_delete_authorized on public.problem_tickets
  for delete to authenticated using (
    public.is_asset_management_client_enabled(tenant_id)
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = problem_tickets.ticket_id
        and ticket.tenant_id = problem_tickets.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );

-- External device IDs are operational provider identifiers. Preserve their
-- legacy values in a service-only relation, remove old public lookup copies
-- and metadata copies, and remove the provider ID column from the
-- browser-readable assets table. An old source can contain the same device ID
-- in a different case on multiple assets. Keep every legacy link instead of
-- aborting the migration or choosing a device arbitrarily; the registry
-- returns an explicit ambiguous lookup result in that case.
create table if not exists public.asset_intune_asset_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  canonical_external_device_id text not null check (
    char_length(canonical_external_device_id) >= 1
    and canonical_external_device_id = lower(btrim(canonical_external_device_id))
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, asset_id),
  constraint asset_intune_asset_links_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists asset_intune_asset_links_tenant_external_device_idx
  on public.asset_intune_asset_links (tenant_id, canonical_external_device_id);

alter table public.asset_intune_asset_links enable row level security;
revoke all on table public.asset_intune_asset_links, public.asset_identifiers,
  public.asset_intune_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.asset_intune_asset_links,
  public.asset_identifiers, public.asset_intune_devices to service_role;

insert into public.asset_intune_asset_links (
  tenant_id, asset_id, canonical_external_device_id
)
select asset.tenant_id, asset.id, lower(btrim(asset.intune_device_id))
from public.assets asset
where asset.intune_device_id is not null
  and btrim(asset.intune_device_id) <> ''
on conflict (tenant_id, asset_id) do update
set canonical_external_device_id = excluded.canonical_external_device_id,
    updated_at = timezone('utc', now());

insert into public.asset_intune_asset_links (
  tenant_id, asset_id, canonical_external_device_id
)
select device.tenant_id, device.asset_id, lower(btrim(device.external_device_id))
from public.asset_intune_devices device
where device.asset_id is not null
  and btrim(device.external_device_id) <> ''
on conflict (tenant_id, asset_id) do nothing;

insert into public.asset_intune_asset_links (
  tenant_id, asset_id, canonical_external_device_id
)
select asset.tenant_id, asset.id, lower(btrim(asset.metadata->>'external_device_id'))
from public.assets asset
where jsonb_typeof(asset.metadata->'external_device_id') = 'string'
  and btrim(asset.metadata->>'external_device_id') <> ''
on conflict (tenant_id, asset_id) do nothing;

-- Provider identifiers must never live in the mutable, browser-readable
-- metadata JSON. Rebuild nested objects and arrays so a legacy or later
-- nested key cannot evade the privacy boundary. All unrelated values remain
-- semantically unchanged.
create or replace function public.strip_private_asset_provider_metadata(
  p_metadata jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_type text := jsonb_typeof(p_metadata);
begin
  if v_type = 'object' then
    return coalesce((
      select jsonb_object_agg(entry.key, public.strip_private_asset_provider_metadata(entry.value))
      from jsonb_each(p_metadata) as entry(key, value)
      where entry.key not in (
        'external_device_id',
        'intune_device_id',
        'managed_device_id',
        'graph_snapshot',
        'intune_snapshot',
        'user_display_name',
        'user_principal_name'
      )
    ), '{}'::jsonb);
  end if;
  if v_type = 'array' then
    return coalesce((
      select jsonb_agg(public.strip_private_asset_provider_metadata(element.value))
      from jsonb_array_elements(p_metadata) as element(value)
    ), '[]'::jsonb);
  end if;
  return p_metadata;
end;
$$;

revoke all on function public.strip_private_asset_provider_metadata(jsonb)
  from public, anon, authenticated;

update public.assets
set metadata = public.strip_private_asset_provider_metadata(metadata)
where metadata::text ~ '"(external_device_id|intune_device_id|managed_device_id|graph_snapshot|intune_snapshot|user_display_name|user_principal_name)"[[:space:]]*:';

create or replace function public.reject_private_asset_provider_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'assets' then
    raise exception 'Invalid asset provider metadata trigger target' using errcode = '22023';
  end if;
  if new.metadata is distinct from public.strip_private_asset_provider_metadata(new.metadata) then
    raise exception 'Private provider metadata cannot be stored with an asset'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_private_asset_provider_metadata()
  from public, anon, authenticated;
drop trigger if exists assets_reject_private_provider_metadata on public.assets;
create trigger assets_reject_private_provider_metadata
  before insert or update of metadata on public.assets
  for each row execute function public.reject_private_asset_provider_metadata();

delete from public.asset_identifiers
where identifier_type = 'intune_device_id';
drop policy if exists asset_identifiers_select_member on public.asset_identifiers;
drop policy if exists asset_identifiers_manage_authorized on public.asset_identifiers;
drop policy if exists asset_intune_devices_select_authorized on public.asset_intune_devices;

drop trigger if exists assets_sync_identifiers on public.assets;
drop index if exists public.assets_tenant_intune_device_id_unique;
alter table public.assets drop column if exists intune_device_id;

create or replace function public.sync_asset_identifiers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'assets' then
    raise exception 'Invalid asset identifier trigger target' using errcode = '22023';
  end if;
  delete from public.asset_identifiers
  where tenant_id = new.tenant_id
    and asset_id = new.id
    and identifier_type in ('asset_tag', 'inventory_number', 'serial_number');

  insert into public.asset_identifiers (tenant_id, asset_id, identifier_type, canonical_value)
  select new.tenant_id, new.id, identifier_type, lower(value)
  from (values
    ('asset_tag'::text, nullif(btrim(new.asset_tag), '')),
    ('inventory_number'::text, nullif(btrim(new.inventory_number), '')),
    ('serial_number'::text, nullif(btrim(new.serial_number), ''))
  ) as identifiers(identifier_type, value)
  where value is not null;
  return new;
end;
$$;

revoke all on function public.sync_asset_identifiers()
  from public, anon, authenticated;
create trigger assets_sync_identifiers
  after insert or update of asset_tag, inventory_number, serial_number
  on public.assets for each row execute function public.sync_asset_identifiers();

revoke all on function public.assert_asset_intune_preflight_feature_enabled(uuid)
  from public, anon, authenticated;
revoke all on function public.configure_asset_intune_preflight(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.get_asset_intune_preflight_configuration(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.run_asset_intune_local_preflight(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.configure_asset_intune_preflight(uuid, uuid, boolean)
  to service_role;
grant execute on function public.get_asset_intune_preflight_configuration(uuid, uuid)
  to service_role;
grant execute on function public.run_asset_intune_local_preflight(uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.run_asset_intune_local_preflight(uuid, uuid, uuid, uuid) is
  'Audited P1.5 control-plane preflight. It never requests a Graph token, contacts a provider, mutates assets/devices or enables scheduling.';

commit;
