begin;

-- A manually started Graph sync is deliberately separated from the legacy
-- `sync_enabled` switch. That switch stays false forever and cannot activate a
-- worker, scheduler or background provider operation.
alter table public.asset_intune_connections
  add column if not exists manual_sync_enabled boolean not null default false,
  add column if not exists manual_sync_generation bigint not null default 1,
  add column if not exists active_manual_sync_run_id uuid,
  add column if not exists manual_sync_lease_expires_at timestamptz,
  add column if not exists last_manual_sync_at timestamptz,
  add column if not exists last_manual_sync_status text not null default 'not_configured',
  add column if not exists last_manual_sync_result_code text;

update public.asset_intune_connections
set sync_enabled = false
where sync_enabled is distinct from false;

alter table public.asset_intune_connections
  drop constraint if exists asset_intune_connections_manual_sync_lease_pair_check,
  add constraint asset_intune_connections_manual_sync_lease_pair_check
    check (
      (active_manual_sync_run_id is null and manual_sync_lease_expires_at is null)
      or (active_manual_sync_run_id is not null and manual_sync_lease_expires_at is not null)
    ),
  drop constraint if exists asset_intune_connections_last_manual_sync_status_check,
  add constraint asset_intune_connections_last_manual_sync_status_check
    check (last_manual_sync_status in ('not_configured', 'ready', 'running', 'succeeded', 'failed', 'blocked')),
  drop constraint if exists asset_intune_connections_last_manual_sync_result_code_check,
  add constraint asset_intune_connections_last_manual_sync_result_code_check
    check (
      last_manual_sync_result_code is null
      or last_manual_sync_result_code in (
        'manual_sync_ready',
        'manual_sync_not_enabled',
        'connection_disabled',
        'sso_binding_required',
        'configuration_rebinding_required',
        'provider_not_configured',
        'provider_unavailable',
        'provider_rate_limited',
        'provider_payload_invalid',
        'run_invalidated',
        'run_expired',
        'provider_dry_run_succeeded',
        'provider_sync_succeeded'
      )
    );

create table if not exists public.asset_intune_manual_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('dry_run', 'synchronize')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'blocked')),
  result_code text not null check (
    result_code in (
      'running',
      'manual_sync_ready',
      'manual_sync_not_enabled',
      'connection_disabled',
      'sso_binding_required',
      'configuration_rebinding_required',
      'provider_not_configured',
      'provider_unavailable',
      'provider_rate_limited',
      'provider_payload_invalid',
      'run_invalidated',
      'run_expired',
      'provider_dry_run_succeeded',
      'provider_sync_succeeded'
    )
  ),
  trigger_kind text not null check (
    trigger_kind in ('manual_provider_dry_run', 'manual_provider_sync', 'manual_provider_retry')
  ),
  started_by uuid not null references public.user_profiles(id) on delete restrict,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  provider_contacted boolean not null default false,
  devices_seen integer not null default 0 check (devices_seen >= 0),
  assets_created integer not null default 0 check (assets_created >= 0),
  assets_updated integer not null default 0 check (assets_updated >= 0),
  assets_skipped integer not null default 0 check (assets_skipped >= 0),
  ambiguous_devices integer not null default 0 check (ambiguous_devices >= 0),
  configuration_generation bigint not null check (configuration_generation >= 1),
  manual_sync_generation bigint not null check (manual_sync_generation >= 1),
  client_request_id uuid not null,
  retry_of_run_id uuid,
  root_run_id uuid,
  attempt_no integer not null check (attempt_no between 1 and 3),
  constraint asset_intune_manual_sync_runs_id_tenant_unique unique (id, tenant_id),
  constraint asset_intune_manual_sync_runs_finished_after_started
    check (finished_at is null or finished_at >= started_at),
  constraint asset_intune_manual_sync_runs_root_tenant_fk
    foreign key (root_run_id, tenant_id)
    references public.asset_intune_manual_sync_runs (id, tenant_id)
    on delete restrict,
  constraint asset_intune_manual_sync_runs_retry_tenant_fk
    foreign key (retry_of_run_id, tenant_id)
    references public.asset_intune_manual_sync_runs (id, tenant_id)
    on delete restrict,
  constraint asset_intune_manual_sync_runs_terminal_check
    check (
      (status = 'running' and finished_at is null and result_code = 'running')
      or (status <> 'running' and finished_at is not null and result_code <> 'running')
    )
);

alter table public.asset_intune_connections
  drop constraint if exists asset_intune_connections_active_manual_sync_run_tenant_fk,
  add constraint asset_intune_connections_active_manual_sync_run_tenant_fk
    foreign key (active_manual_sync_run_id, tenant_id)
    references public.asset_intune_manual_sync_runs (id, tenant_id)
    on delete set null (active_manual_sync_run_id);

create table if not exists public.asset_intune_manual_sync_stage (
  run_id uuid not null,
  tenant_id uuid not null,
  canonical_external_device_id text not null check (
    char_length(canonical_external_device_id) between 1 and 200
    and canonical_external_device_id = lower(btrim(canonical_external_device_id))
    and canonical_external_device_id !~ '[[:cntrl:]]'
  ),
  device_name text,
  serial_number text,
  manufacturer text,
  model text,
  operating_system text,
  os_version text,
  compliance_state text,
  is_encrypted boolean,
  last_sync_at timestamptz,
  enrolled_at timestamptz,
  staged_at timestamptz not null default timezone('utc', now()),
  primary key (run_id, tenant_id, canonical_external_device_id),
  constraint asset_intune_manual_sync_stage_run_tenant_fk
    foreign key (run_id, tenant_id)
    references public.asset_intune_manual_sync_runs (id, tenant_id)
    on delete cascade,
  constraint asset_intune_manual_sync_stage_device_name_valid
    check (device_name is null or (char_length(btrim(device_name)) between 1 and 240 and device_name = btrim(device_name) and device_name !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_serial_valid
    check (serial_number is null or (char_length(btrim(serial_number)) between 1 and 160 and serial_number = btrim(serial_number) and serial_number !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_manufacturer_valid
    check (manufacturer is null or (char_length(btrim(manufacturer)) between 1 and 160 and manufacturer = btrim(manufacturer) and manufacturer !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_model_valid
    check (model is null or (char_length(btrim(model)) between 1 and 160 and model = btrim(model) and model !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_operating_system_valid
    check (operating_system is null or (char_length(btrim(operating_system)) between 1 and 120 and operating_system = btrim(operating_system) and operating_system !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_os_version_valid
    check (os_version is null or (char_length(btrim(os_version)) between 1 and 120 and os_version = btrim(os_version) and os_version !~ '[[:cntrl:]]')),
  constraint asset_intune_manual_sync_stage_compliance_valid
    check (compliance_state is null or compliance_state in ('unknown', 'compliant', 'noncompliant', 'conflict', 'error', 'inGracePeriod', 'configManager'))
);

create unique index if not exists asset_intune_manual_sync_runs_request_unique
  on public.asset_intune_manual_sync_runs (tenant_id, client_request_id);
create unique index if not exists asset_intune_manual_sync_runs_attempt_unique
  on public.asset_intune_manual_sync_runs (tenant_id, root_run_id, attempt_no);
create index if not exists asset_intune_manual_sync_runs_history_idx
  on public.asset_intune_manual_sync_runs (tenant_id, started_at desc, id desc);
create index if not exists asset_intune_manual_sync_stage_run_idx
  on public.asset_intune_manual_sync_stage (tenant_id, run_id);

alter table public.asset_intune_manual_sync_runs enable row level security;
alter table public.asset_intune_manual_sync_stage enable row level security;
revoke all on table public.asset_intune_manual_sync_runs, public.asset_intune_manual_sync_stage
  from public, anon, authenticated;
grant select, insert, update, delete on table public.asset_intune_manual_sync_runs, public.asset_intune_manual_sync_stage
  to service_role;

-- Legacy device rows must not retain persons or opaque Graph snapshots. New
-- manual runs never select or write any of those columns.
update public.asset_intune_devices
set user_display_name = null,
    user_principal_name = null,
    snapshot = '{}'::jsonb
where user_display_name is not null
   or user_principal_name is not null
   or snapshot <> '{}'::jsonb;

create or replace function public.configure_asset_intune_manual_sync(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_enabled boolean
)
returns table (
  manual_sync_enabled boolean,
  sso_binding_available boolean,
  configuration_generation bigint,
  manual_sync_generation bigint,
  last_manual_sync_at timestamptz,
  last_manual_sync_status text,
  last_manual_sync_result_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
  v_trusted_tenant_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id, p_tenant_id, 'asset.integration.manage'
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

  if p_enabled and (
    not v_configuration.enabled
    or v_trusted_tenant_id is null
    or v_configuration.directory_tenant_id is distinct from v_trusted_tenant_id
  ) then
    raise exception 'Manual Intune sync requires a saved tenant-specific Azure SSO binding'
      using errcode = 'P0001';
  end if;

  if v_configuration.active_manual_sync_run_id is not null
     and v_configuration.manual_sync_lease_expires_at > v_now then
    raise exception 'An Intune sync is already in progress' using errcode = 'P0001';
  end if;

  update public.asset_intune_connections
  set manual_sync_enabled = p_enabled,
      manual_sync_generation = v_configuration.manual_sync_generation + 1,
      active_manual_sync_run_id = null,
      manual_sync_lease_expires_at = null,
      last_manual_sync_status = case when p_enabled then 'ready' else 'not_configured' end,
      last_manual_sync_result_code = case when p_enabled then 'manual_sync_ready' else null end,
      sync_enabled = false,
      updated_by = p_actor_id
  where tenant_id = p_tenant_id
  returning
    asset_intune_connections.manual_sync_enabled,
    v_trusted_tenant_id is not null,
    asset_intune_connections.configuration_generation,
    asset_intune_connections.manual_sync_generation,
    asset_intune_connections.last_manual_sync_at,
    asset_intune_connections.last_manual_sync_status,
    asset_intune_connections.last_manual_sync_result_code
  into
    manual_sync_enabled,
    sso_binding_available,
    configuration_generation,
    manual_sync_generation,
    last_manual_sync_at,
    last_manual_sync_status,
    last_manual_sync_result_code;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'asset.intune_manual_sync.configuration_updated',
    'asset_intune_connection', p_tenant_id, 'security',
    jsonb_build_object('enabled', p_enabled, 'provider_contacted', false)
  );
  return next;
end;
$$;

create or replace function public.get_asset_intune_manual_sync_configuration(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns table (
  enabled boolean,
  sso_binding_available boolean,
  manual_sync_enabled boolean,
  configuration_generation bigint,
  manual_sync_generation bigint,
  last_manual_sync_at timestamptz,
  last_manual_sync_status text,
  last_manual_sync_result_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id, p_tenant_id, 'asset.integration.manage'
  );
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);
  select * into v_configuration
  from public.asset_intune_connections
  where tenant_id = p_tenant_id;

  enabled := coalesce(v_configuration.enabled, false);
  sso_binding_available := public.trusted_entra_tenant_id_for_tenant(p_tenant_id) is not null;
  manual_sync_enabled := coalesce(v_configuration.manual_sync_enabled, false);
  configuration_generation := coalesce(v_configuration.configuration_generation, 1);
  manual_sync_generation := coalesce(v_configuration.manual_sync_generation, 1);
  last_manual_sync_at := v_configuration.last_manual_sync_at;
  last_manual_sync_status := coalesce(v_configuration.last_manual_sync_status, 'not_configured');
  last_manual_sync_result_code := v_configuration.last_manual_sync_result_code;
  return next;
end;
$$;

create or replace function public.claim_asset_intune_manual_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_mode text,
  p_retry_of_run_id uuid default null
)
returns table (
  outcome text,
  id uuid,
  entra_tenant_id uuid,
  configuration_generation bigint,
  manual_sync_generation bigint,
  status text,
  result_code text,
  attempt_no integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
  v_existing public.asset_intune_manual_sync_runs%rowtype;
  v_retry public.asset_intune_manual_sync_runs%rowtype;
  v_expired public.asset_intune_manual_sync_runs%rowtype;
  v_trusted_tenant_id uuid;
  v_run_id uuid := gen_random_uuid();
  v_root_run_id uuid;
  v_attempt_no integer;
  v_trigger_kind text;
  v_now timestamptz := timezone('utc', now());
  v_result_code text;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null
     or p_mode not in ('dry_run', 'synchronize') then
    raise exception 'Invalid manual Intune sync request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(
    p_actor_id, p_tenant_id, 'asset.integration.manage'
  );
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':manual-intune:' || p_client_request_id::text));

  insert into public.asset_intune_connections (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;
  select * into v_configuration
  from public.asset_intune_connections
  where tenant_id = p_tenant_id
  for update;
  perform 1 from public.tenant_sso_configurations where tenant_id = p_tenant_id for share;
  v_trusted_tenant_id := public.trusted_entra_tenant_id_for_tenant(p_tenant_id);

  if v_configuration.active_manual_sync_run_id is not null
     and v_configuration.manual_sync_lease_expires_at <= v_now then
    select * into v_expired
    from public.asset_intune_manual_sync_runs as run
    where run.id = v_configuration.active_manual_sync_run_id
      and run.tenant_id = p_tenant_id
    for update;
    if found and v_expired.status = 'running' then
      update public.asset_intune_manual_sync_runs as run
      set status = 'blocked',
          result_code = 'run_expired',
          finished_at = v_now
      where run.id = v_expired.id and run.tenant_id = p_tenant_id;
      delete from public.asset_intune_manual_sync_stage
      where run_id = v_expired.id and tenant_id = p_tenant_id;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
      values (
        p_tenant_id,
        v_expired.started_by,
        'asset.intune_manual_sync.blocked',
        'asset_intune_manual_sync_run',
        v_expired.id,
        'security',
        jsonb_build_object('result_code', 'run_expired', 'provider_contacted', v_expired.provider_contacted)
      );
    end if;
    update public.asset_intune_connections
    set active_manual_sync_run_id = null,
        manual_sync_lease_expires_at = null,
        last_manual_sync_at = v_now,
        last_manual_sync_status = 'blocked',
        last_manual_sync_result_code = 'run_expired',
        last_status = 'not_configured',
        sync_enabled = false
    where tenant_id = p_tenant_id;
  end if;

  select * into v_existing
  from public.asset_intune_manual_sync_runs
  where tenant_id = p_tenant_id and client_request_id = p_client_request_id;
  if found then
    outcome := case when v_existing.status = 'running' then 'in_progress' else 'existing' end;
    id := v_existing.id;
    entra_tenant_id := null;
    configuration_generation := v_existing.configuration_generation;
    manual_sync_generation := v_existing.manual_sync_generation;
    status := v_existing.status;
    result_code := v_existing.result_code;
    attempt_no := v_existing.attempt_no;
    return next;
    return;
  end if;

  if p_retry_of_run_id is not null then
    select * into v_retry
    from public.asset_intune_manual_sync_runs as run
    where run.id = p_retry_of_run_id
      and run.tenant_id = p_tenant_id
      and run.status = 'failed'
      and run.result_code in ('provider_unavailable', 'provider_rate_limited')
    for share;
    if not found then
      raise exception 'The requested provider run cannot be retried' using errcode = 'P0002';
    end if;
    if v_retry.mode <> p_mode then
      raise exception 'The retry mode must match the original run' using errcode = '22023';
    end if;
    v_root_run_id := coalesce(v_retry.root_run_id, v_retry.id);
    perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':manual-intune-root:' || v_root_run_id::text));
    select coalesce(max(attempt_no), 0) + 1 into v_attempt_no
    from public.asset_intune_manual_sync_runs
    where tenant_id = p_tenant_id and root_run_id = v_root_run_id;
    if v_attempt_no > 3 then
      raise exception 'The manual provider retry limit was reached' using errcode = 'P0001';
    end if;
    v_trigger_kind := 'manual_provider_retry';
  else
    v_root_run_id := v_run_id;
    v_attempt_no := 1;
    v_trigger_kind := case when p_mode = 'dry_run'
      then 'manual_provider_dry_run' else 'manual_provider_sync' end;
  end if;

  if v_configuration.active_manual_sync_run_id is not null
     and v_configuration.manual_sync_lease_expires_at > v_now then
    outcome := 'in_progress';
    id := v_configuration.active_manual_sync_run_id;
    entra_tenant_id := null;
    configuration_generation := v_configuration.configuration_generation;
    manual_sync_generation := v_configuration.manual_sync_generation;
    status := 'running';
    result_code := 'running';
    attempt_no := null;
    return next;
    return;
  end if;

  if not v_configuration.enabled then
    v_result_code := 'connection_disabled';
  elsif not v_configuration.manual_sync_enabled then
    v_result_code := 'manual_sync_not_enabled';
  elsif v_trusted_tenant_id is null then
    v_result_code := 'sso_binding_required';
  elsif v_configuration.directory_tenant_id is distinct from v_trusted_tenant_id then
    v_result_code := 'configuration_rebinding_required';
  else
    v_result_code := null;
  end if;

  if v_result_code is not null then
    insert into public.asset_intune_manual_sync_runs (
      id, tenant_id, mode, status, result_code, trigger_kind, started_by,
      started_at, finished_at, provider_contacted, configuration_generation,
      manual_sync_generation, client_request_id, retry_of_run_id, root_run_id, attempt_no
    ) values (
      v_run_id, p_tenant_id, p_mode, 'blocked', v_result_code, v_trigger_kind, p_actor_id,
      v_now, v_now, false, v_configuration.configuration_generation,
      v_configuration.manual_sync_generation, p_client_request_id, p_retry_of_run_id,
      v_root_run_id, v_attempt_no
    );
    update public.asset_intune_connections
    set last_manual_sync_at = v_now,
        last_manual_sync_status = 'blocked',
        last_manual_sync_result_code = v_result_code,
        last_attempt_at = v_now,
        last_status = 'not_configured',
        sync_enabled = false
    where tenant_id = p_tenant_id;
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
    values (p_tenant_id, p_actor_id, 'asset.intune_manual_sync.blocked', 'asset_intune_manual_sync_run', v_run_id, 'warning',
      jsonb_build_object('result_code', v_result_code, 'provider_contacted', false, 'attempt_no', v_attempt_no));
    outcome := 'blocked';
    id := v_run_id;
    entra_tenant_id := null;
    configuration_generation := v_configuration.configuration_generation;
    manual_sync_generation := v_configuration.manual_sync_generation;
    status := 'blocked';
    result_code := v_result_code;
    attempt_no := v_attempt_no;
    return next;
    return;
  end if;

  insert into public.asset_intune_manual_sync_runs (
    id, tenant_id, mode, status, result_code, trigger_kind, started_by,
    configuration_generation, manual_sync_generation, client_request_id,
    retry_of_run_id, root_run_id, attempt_no
  ) values (
    v_run_id, p_tenant_id, p_mode, 'running', 'running', v_trigger_kind, p_actor_id,
    v_configuration.configuration_generation, v_configuration.manual_sync_generation,
    p_client_request_id, p_retry_of_run_id, v_root_run_id, v_attempt_no
  );
  update public.asset_intune_connections
  set active_manual_sync_run_id = v_run_id,
      manual_sync_lease_expires_at = v_now + interval '20 minutes',
      last_manual_sync_status = 'running',
      last_manual_sync_result_code = null,
      last_attempt_at = v_now,
      last_status = 'running',
      sync_enabled = false
  where tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'asset.intune_manual_sync.started', 'asset_intune_manual_sync_run', v_run_id, 'security',
    jsonb_build_object('mode', p_mode, 'attempt_no', v_attempt_no, 'provider_contacted', false));

  outcome := 'claimed';
  id := v_run_id;
  entra_tenant_id := v_trusted_tenant_id;
  configuration_generation := v_configuration.configuration_generation;
  manual_sync_generation := v_configuration.manual_sync_generation;
  status := 'running';
  result_code := 'running';
  attempt_no := v_attempt_no;
  return next;
end;
$$;

create or replace function public.assert_asset_intune_manual_sync_fence(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_configuration_generation bigint,
  p_manual_sync_generation bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_configuration public.asset_intune_connections%rowtype;
  v_run public.asset_intune_manual_sync_runs%rowtype;
begin
  -- These locks remain held for the complete RPC transaction. A membership,
  -- role, permission, feature or SSO change therefore wins before an asset
  -- mutation can start, never midway through the protected commit.
  select * into v_configuration from public.asset_intune_connections
  where tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'Manual Intune sync run is no longer valid' using errcode = 'P0002';
  end if;
  perform 1
  from public.tenant_sso_configurations configuration
  where configuration.tenant_id = p_tenant_id
  for share;
  if not found then
    raise exception 'Manual Intune sync run is no longer valid' using errcode = 'P0002';
  end if;
  perform 1
  from public.tenant_memberships membership
  join public.user_role_assignments assignment
    on assignment.user_id = membership.user_id
   and assignment.tenant_id = membership.tenant_id
   and assignment.starts_at <= timezone('utc', now())
   and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
  join public.roles role
    on role.id = assignment.role_id
   and role.tenant_id = assignment.tenant_id
   and role.active
   and role.scope = 'tenant'
  join public.role_permissions role_permission
    on role_permission.role_id = role.id
   and role_permission.permission_code = 'asset.integration.manage'
  where membership.user_id = p_actor_id
    and membership.tenant_id = p_tenant_id
    and membership.status = 'active'
  for share of membership, assignment, role, role_permission;
  if not found then
    raise exception 'Missing tenant permission asset.integration.manage' using errcode = '42501';
  end if;
  perform 1
  from public.tenant_feature_flags feature
  where feature.tenant_id = p_tenant_id
    and feature.feature_key = 'assets.management'
    and feature.enabled
    and (
      feature.pilot_ends_at is null
      or feature.pilot_ends_at > timezone('utc', now())
    )
  for share;
  if not found then
    raise exception 'Asset management is disabled for this tenant' using errcode = '42501';
  end if;
  select * into v_run from public.asset_intune_manual_sync_runs
  where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found
     or v_run.status <> 'running'
     or v_configuration.active_manual_sync_run_id is distinct from p_run_id
     or v_configuration.manual_sync_lease_expires_at <= timezone('utc', now())
     or v_configuration.configuration_generation is distinct from p_configuration_generation
     or v_configuration.manual_sync_generation is distinct from p_manual_sync_generation
     or not v_configuration.enabled
     or not v_configuration.manual_sync_enabled
     or v_configuration.directory_tenant_id is distinct from public.trusted_entra_tenant_id_for_tenant(p_tenant_id) then
    raise exception 'Manual Intune sync run is no longer valid' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.renew_asset_intune_manual_sync_fence(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_configuration_generation bigint,
  p_manual_sync_generation bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_asset_intune_manual_sync_fence(
    p_actor_id, p_tenant_id, p_run_id, p_configuration_generation, p_manual_sync_generation
  );
  update public.asset_intune_connections
  set manual_sync_lease_expires_at = timezone('utc', now()) + interval '20 minutes'
  where tenant_id = p_tenant_id and active_manual_sync_run_id = p_run_id;
end;
$$;

create or replace function public.mark_asset_intune_manual_sync_provider_contact(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_configuration_generation bigint,
  p_manual_sync_generation bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.renew_asset_intune_manual_sync_fence(
    p_actor_id, p_tenant_id, p_run_id, p_configuration_generation, p_manual_sync_generation
  );
  update public.asset_intune_manual_sync_runs
  set provider_contacted = true
  where id = p_run_id and tenant_id = p_tenant_id and status = 'running';
end;
$$;

create or replace function public.stage_asset_intune_manual_sync_devices(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_configuration_generation bigint,
  p_manual_sync_generation bigint,
  p_devices jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_devices) <> 'array' or jsonb_array_length(p_devices) > 100 then
    raise exception 'Invalid manual Intune staging batch' using errcode = '22023';
  end if;
  perform public.assert_asset_intune_manual_sync_fence(
    p_actor_id, p_tenant_id, p_run_id, p_configuration_generation, p_manual_sync_generation
  );
  if not exists (
    select 1
    from public.asset_intune_manual_sync_runs run
    where run.id = p_run_id
      and run.tenant_id = p_tenant_id
      and run.provider_contacted
  ) then
    raise exception 'Manual Intune sync did not confirm a Graph request' using errcode = 'P0002';
  end if;

  with input as (
    select *
    from jsonb_to_recordset(p_devices) as device(
      external_device_id text,
      device_name text,
      serial_number text,
      manufacturer text,
      model text,
      operating_system text,
      os_version text,
      compliance_state text,
      is_encrypted boolean,
      last_sync_at timestamptz,
      enrolled_at timestamptz
    )
  ), invalid as (
    select 1
    from input
    where external_device_id is null
      or char_length(btrim(external_device_id)) not between 1 and 200
      or btrim(external_device_id) ~ '[[:cntrl:]]'
      or (device_name is not null and (char_length(btrim(device_name)) not between 1 and 240 or device_name <> btrim(device_name) or device_name ~ '[[:cntrl:]]'))
      or (serial_number is not null and (char_length(btrim(serial_number)) not between 1 and 160 or serial_number <> btrim(serial_number) or serial_number ~ '[[:cntrl:]]'))
      or (manufacturer is not null and (char_length(btrim(manufacturer)) not between 1 and 160 or manufacturer <> btrim(manufacturer) or manufacturer ~ '[[:cntrl:]]'))
      or (model is not null and (char_length(btrim(model)) not between 1 and 160 or model <> btrim(model) or model ~ '[[:cntrl:]]'))
      or (operating_system is not null and (char_length(btrim(operating_system)) not between 1 and 120 or operating_system <> btrim(operating_system) or operating_system ~ '[[:cntrl:]]'))
      or (os_version is not null and (char_length(btrim(os_version)) not between 1 and 120 or os_version <> btrim(os_version) or os_version ~ '[[:cntrl:]]'))
      or (compliance_state is not null and compliance_state not in ('unknown', 'compliant', 'noncompliant', 'conflict', 'error', 'inGracePeriod', 'configManager'))
  )
  select count(*)::integer into v_count from invalid;
  if v_count <> 0 then
    raise exception 'Invalid manual Intune device payload' using errcode = '22023';
  end if;

  insert into public.asset_intune_manual_sync_stage (
    run_id, tenant_id, canonical_external_device_id, device_name, serial_number,
    manufacturer, model, operating_system, os_version, compliance_state,
    is_encrypted, last_sync_at, enrolled_at
  )
  select
    p_run_id, p_tenant_id, lower(btrim(external_device_id)),
    device_name, serial_number, manufacturer, model, operating_system, os_version,
    compliance_state, is_encrypted, last_sync_at, enrolled_at
  from jsonb_to_recordset(p_devices) as device(
    external_device_id text, device_name text, serial_number text, manufacturer text,
    model text, operating_system text, os_version text, compliance_state text,
    is_encrypted boolean, last_sync_at timestamptz, enrolled_at timestamptz
  );
  get diagnostics v_count = row_count;
  update public.asset_intune_connections
  set manual_sync_lease_expires_at = timezone('utc', now()) + interval '20 minutes'
  where tenant_id = p_tenant_id and active_manual_sync_run_id = p_run_id;
  return v_count;
end;
$$;

create or replace function public.complete_asset_intune_manual_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_configuration_generation bigint,
  p_manual_sync_generation bigint
)
returns table (
  id uuid,
  mode text,
  status text,
  result_code text,
  started_at timestamptz,
  finished_at timestamptz,
  provider_contacted boolean,
  devices_seen integer,
  assets_created integer,
  assets_updated integer,
  assets_skipped integer,
  ambiguous_devices integer,
  retry_of_run_id uuid,
  root_run_id uuid,
  attempt_no integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.asset_intune_manual_sync_runs%rowtype;
  v_stage public.asset_intune_manual_sync_stage%rowtype;
  v_link_count integer;
  v_asset_id uuid;
  v_serial_collision boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_ambiguous integer := 0;
  v_seen integer := 0;
  v_now timestamptz := timezone('utc', now());
  v_result_code text;
begin
  perform public.assert_asset_intune_manual_sync_fence(
    p_actor_id, p_tenant_id, p_run_id, p_configuration_generation, p_manual_sync_generation
  );
  select * into v_run
  from public.asset_intune_manual_sync_runs as run
  where run.id = p_run_id and run.tenant_id = p_tenant_id
  for update;
  if not v_run.provider_contacted then
    raise exception 'Manual Intune sync did not confirm a Graph request' using errcode = 'P0002';
  end if;

  for v_stage in
    select * from public.asset_intune_manual_sync_stage
    where run_id = p_run_id and tenant_id = p_tenant_id
    order by canonical_external_device_id
  loop
    v_seen := v_seen + 1;
    select count(*) into v_link_count
    from public.asset_intune_asset_links
    where tenant_id = p_tenant_id
      and canonical_external_device_id = v_stage.canonical_external_device_id;

    if v_link_count > 1 then
      v_ambiguous := v_ambiguous + 1;
      v_skipped := v_skipped + 1;
      if v_run.mode = 'synchronize' then
        insert into public.asset_intune_devices (
          tenant_id, asset_id, external_device_id, device_name, serial_number,
          manufacturer, model, operating_system, os_version, compliance_state,
          is_encrypted, last_sync_at, last_seen_at, snapshot, user_display_name, user_principal_name
        ) values (
          p_tenant_id, null, v_stage.canonical_external_device_id, v_stage.device_name,
          v_stage.serial_number, v_stage.manufacturer, v_stage.model,
          v_stage.operating_system, v_stage.os_version, v_stage.compliance_state,
          v_stage.is_encrypted, v_stage.last_sync_at, v_now, '{}'::jsonb, null, null
        ) on conflict (tenant_id, external_device_id) do update
          set asset_id = null,
              device_name = excluded.device_name,
              serial_number = excluded.serial_number,
              manufacturer = excluded.manufacturer,
              model = excluded.model,
              operating_system = excluded.operating_system,
              os_version = excluded.os_version,
              compliance_state = excluded.compliance_state,
              is_encrypted = excluded.is_encrypted,
              last_sync_at = excluded.last_sync_at,
              last_seen_at = excluded.last_seen_at,
              snapshot = '{}'::jsonb,
              user_display_name = null,
              user_principal_name = null,
              synced_at = v_now;
      end if;
      continue;
    end if;

    if v_link_count = 1 then
      select link.asset_id into v_asset_id
      from public.asset_intune_asset_links as link
      where link.tenant_id = p_tenant_id
        and link.canonical_external_device_id = v_stage.canonical_external_device_id;
      if v_run.mode = 'synchronize' then
        update public.assets as asset
        set intune_compliance_state = v_stage.compliance_state,
            intune_encrypted = v_stage.is_encrypted,
            intune_last_sync_at = v_stage.last_sync_at,
            intune_last_seen_at = v_now
        where asset.tenant_id = p_tenant_id and asset.id = v_asset_id;
        v_updated := v_updated + 1;
        insert into public.asset_intune_devices (
          tenant_id, asset_id, external_device_id, device_name, serial_number,
          manufacturer, model, operating_system, os_version, compliance_state,
          is_encrypted, last_sync_at, last_seen_at, snapshot, user_display_name, user_principal_name
        ) values (
          p_tenant_id, v_asset_id, v_stage.canonical_external_device_id, v_stage.device_name,
          v_stage.serial_number, v_stage.manufacturer, v_stage.model,
          v_stage.operating_system, v_stage.os_version, v_stage.compliance_state,
          v_stage.is_encrypted, v_stage.last_sync_at, v_now, '{}'::jsonb, null, null
        ) on conflict (tenant_id, external_device_id) do update
          set asset_id = excluded.asset_id,
              device_name = excluded.device_name,
              serial_number = excluded.serial_number,
              manufacturer = excluded.manufacturer,
              model = excluded.model,
              operating_system = excluded.operating_system,
              os_version = excluded.os_version,
              compliance_state = excluded.compliance_state,
              is_encrypted = excluded.is_encrypted,
              last_sync_at = excluded.last_sync_at,
              last_seen_at = excluded.last_seen_at,
              snapshot = '{}'::jsonb,
              user_display_name = null,
              user_principal_name = null,
              synced_at = v_now;
      else
        v_updated := v_updated + 1;
      end if;
      continue;
    end if;

    select exists (
      select 1 from public.assets asset
      where asset.tenant_id = p_tenant_id
        and v_stage.serial_number is not null
        and asset.serial_number is not null
        and lower(btrim(asset.serial_number)) = lower(btrim(v_stage.serial_number))
    ) into v_serial_collision;
    if v_serial_collision then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_run.mode = 'synchronize' then
      insert into public.assets as asset (
        tenant_id, name, serial_number, manufacturer, model, operating_system,
        kind, status, lifecycle_state, metadata, intune_compliance_state,
        intune_encrypted, intune_last_sync_at, intune_last_seen_at
      ) values (
        p_tenant_id,
        coalesce(v_stage.device_name, 'Intune-Gerät'),
        v_stage.serial_number, v_stage.manufacturer, v_stage.model, v_stage.operating_system,
        'device', 'active', 'active', '{}'::jsonb, v_stage.compliance_state,
        v_stage.is_encrypted, v_stage.last_sync_at, v_now
      ) returning asset.id into v_asset_id;
      insert into public.asset_intune_asset_links (
        tenant_id, asset_id, canonical_external_device_id
      ) values (p_tenant_id, v_asset_id, v_stage.canonical_external_device_id);
      insert into public.asset_intune_devices (
        tenant_id, asset_id, external_device_id, device_name, serial_number,
        manufacturer, model, operating_system, os_version, compliance_state,
        is_encrypted, last_sync_at, last_seen_at, snapshot, user_display_name, user_principal_name
      ) values (
        p_tenant_id, v_asset_id, v_stage.canonical_external_device_id, v_stage.device_name,
        v_stage.serial_number, v_stage.manufacturer, v_stage.model,
        v_stage.operating_system, v_stage.os_version, v_stage.compliance_state,
        v_stage.is_encrypted, v_stage.last_sync_at, v_now, '{}'::jsonb, null, null
      ) on conflict (tenant_id, external_device_id) do update
        set asset_id = excluded.asset_id,
            device_name = excluded.device_name,
            serial_number = excluded.serial_number,
            manufacturer = excluded.manufacturer,
            model = excluded.model,
            operating_system = excluded.operating_system,
            os_version = excluded.os_version,
            compliance_state = excluded.compliance_state,
            is_encrypted = excluded.is_encrypted,
            last_sync_at = excluded.last_sync_at,
            last_seen_at = excluded.last_seen_at,
            snapshot = '{}'::jsonb,
            user_display_name = null,
            user_principal_name = null,
            synced_at = v_now;
    end if;
    v_created := v_created + 1;
  end loop;

  v_result_code := case when v_run.mode = 'dry_run'
    then 'provider_dry_run_succeeded' else 'provider_sync_succeeded' end;
  update public.asset_intune_manual_sync_runs as run
  set status = 'succeeded',
      result_code = v_result_code,
      finished_at = v_now,
      devices_seen = v_seen,
      assets_created = v_created,
      assets_updated = v_updated,
      assets_skipped = v_skipped,
      ambiguous_devices = v_ambiguous
  where run.id = p_run_id and run.tenant_id = p_tenant_id;
  update public.asset_intune_connections
  set active_manual_sync_run_id = null,
      manual_sync_lease_expires_at = null,
      last_manual_sync_at = v_now,
      last_manual_sync_status = 'succeeded',
      last_manual_sync_result_code = v_result_code,
      last_success_at = case when v_run.mode = 'synchronize' then v_now else last_success_at end,
      last_status = 'succeeded',
      sync_enabled = false
  where tenant_id = p_tenant_id and active_manual_sync_run_id = p_run_id;
  delete from public.asset_intune_manual_sync_stage
  where run_id = p_run_id and tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'asset.intune_manual_sync.succeeded', 'asset_intune_manual_sync_run', p_run_id, 'info',
    jsonb_build_object(
      'mode', v_run.mode, 'provider_contacted', v_run.provider_contacted,
      'devices_seen', v_seen, 'assets_created', v_created, 'assets_updated', v_updated,
      'assets_skipped', v_skipped, 'ambiguous_devices', v_ambiguous
    ));

  id := p_run_id;
  mode := v_run.mode;
  status := 'succeeded';
  result_code := v_result_code;
  started_at := v_run.started_at;
  finished_at := v_now;
  provider_contacted := v_run.provider_contacted;
  devices_seen := v_seen;
  assets_created := v_created;
  assets_updated := v_updated;
  assets_skipped := v_skipped;
  ambiguous_devices := v_ambiguous;
  retry_of_run_id := v_run.retry_of_run_id;
  root_run_id := v_run.root_run_id;
  attempt_no := v_run.attempt_no;
  return next;
end;
$$;

create or replace function public.fail_asset_intune_manual_sync_run(
  p_tenant_id uuid,
  p_run_id uuid,
  p_result_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.asset_intune_manual_sync_runs%rowtype;
  v_status text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_result_code not in (
    'provider_not_configured', 'provider_unavailable', 'provider_rate_limited',
    'provider_payload_invalid', 'run_invalidated', 'run_expired'
  ) then
    raise exception 'Invalid manual Intune failure code' using errcode = '22023';
  end if;
  select * into v_run from public.asset_intune_manual_sync_runs
  where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found or v_run.status <> 'running' then return; end if;
  v_status := case when p_result_code in ('provider_not_configured', 'run_invalidated', 'run_expired')
    then 'blocked' else 'failed' end;
  update public.asset_intune_manual_sync_runs
  set status = v_status,
      result_code = p_result_code,
      finished_at = v_now
  where id = p_run_id and tenant_id = p_tenant_id;
  update public.asset_intune_connections
  set active_manual_sync_run_id = null,
      manual_sync_lease_expires_at = null,
      last_manual_sync_at = v_now,
      last_manual_sync_status = v_status,
      last_manual_sync_result_code = p_result_code,
      last_status = case when v_status = 'failed' then 'failed' else 'not_configured' end,
      last_error_code = null,
      sync_enabled = false
  where tenant_id = p_tenant_id and active_manual_sync_run_id = p_run_id;
  delete from public.asset_intune_manual_sync_stage where run_id = p_run_id and tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, v_run.started_by, 'asset.intune_manual_sync.' || v_status, 'asset_intune_manual_sync_run', p_run_id,
    (case when v_status = 'failed' then 'warning' else 'security' end)::public.audit_severity,
    jsonb_build_object('result_code', p_result_code, 'provider_contacted', v_run.provider_contacted));
end;
$$;

revoke all on function public.configure_asset_intune_manual_sync(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_asset_intune_manual_sync_configuration(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_asset_intune_manual_sync_run(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.assert_asset_intune_manual_sync_fence(uuid, uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.renew_asset_intune_manual_sync_fence(uuid, uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mark_asset_intune_manual_sync_provider_contact(uuid, uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.stage_asset_intune_manual_sync_devices(uuid, uuid, uuid, bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.complete_asset_intune_manual_sync_run(uuid, uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.fail_asset_intune_manual_sync_run(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.configure_asset_intune_manual_sync(uuid, uuid, boolean) to service_role;
grant execute on function public.get_asset_intune_manual_sync_configuration(uuid, uuid) to service_role;
grant execute on function public.claim_asset_intune_manual_sync_run(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.assert_asset_intune_manual_sync_fence(uuid, uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.renew_asset_intune_manual_sync_fence(uuid, uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.mark_asset_intune_manual_sync_provider_contact(uuid, uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.stage_asset_intune_manual_sync_devices(uuid, uuid, uuid, bigint, bigint, jsonb) to service_role;
grant execute on function public.complete_asset_intune_manual_sync_run(uuid, uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.fail_asset_intune_manual_sync_run(uuid, uuid, text) to service_role;

commit;
