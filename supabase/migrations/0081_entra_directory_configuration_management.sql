begin;

alter table public.tenant_entra_directory_sync_configurations
  add column if not exists last_connection_tested_at timestamptz,
  add column if not exists last_connection_test_status text,
  add column if not exists active_sync_run_id uuid,
  add column if not exists sync_lease_expires_at timestamptz,
  add column if not exists sync_generation bigint not null default 1;

alter table public.tenant_entra_directory_sync_configurations
  drop constraint if exists tenant_entra_directory_connection_test_status_check,
  add constraint tenant_entra_directory_connection_test_status_check
    check (
      last_connection_test_status is null
      or last_connection_test_status in ('success', 'failed')
    ),
  drop constraint if exists tenant_entra_directory_sync_lease_pair_check,
  add constraint tenant_entra_directory_sync_lease_pair_check
    check (
      (active_sync_run_id is null and sync_lease_expires_at is null)
      or (active_sync_run_id is not null and sync_lease_expires_at is not null)
    );

create or replace function public.trusted_entra_tenant_id_for_tenant(
  p_tenant_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_url text;
  v_match text[];
begin
  for v_url in
    select candidate.url
    from public.tenant_sso_configurations configuration
    cross join lateral unnest(array[
      configuration.issuer_url,
      configuration.discovery_url
    ]) as candidate(url)
    where configuration.tenant_id = p_tenant_id
      and configuration.provider = 'azure_ad'
      and configuration.enabled
      and candidate.url is not null
  loop
    v_match := regexp_match(
      v_url,
      '^https://login\.microsoftonline\.com/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:/|$)',
      'i'
    );
    if v_match is not null then
      return v_match[1]::uuid;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.configure_entra_directory_sync(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_enabled boolean
)
returns table (
  entra_tenant_id uuid,
  enabled boolean,
  last_connection_tested_at timestamptz,
  last_connection_test_status text,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_status text,
  sync_generation bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted_tenant_id uuid;
  v_configuration public.tenant_entra_directory_sync_configurations%rowtype;
  v_has_configuration boolean := false;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  select *
  into v_configuration
  from public.tenant_entra_directory_sync_configurations
  where tenant_id = p_tenant_id
  for update;
  v_has_configuration := found;

  perform 1
  from public.tenant_sso_configurations
  where tenant_id = p_tenant_id
  for share;

  v_trusted_tenant_id := public.trusted_entra_tenant_id_for_tenant(p_tenant_id);
  if v_trusted_tenant_id is null then
    raise exception 'An active Azure SSO configuration with a tenant-specific issuer is required'
      using errcode = 'P0001';
  end if;

  if v_has_configuration
     and v_configuration.active_sync_run_id is not null
     and v_configuration.sync_lease_expires_at > timezone('utc', now()) then
    raise exception 'Entra directory sync is in progress' using errcode = 'P0001';
  end if;

  insert into public.tenant_entra_directory_sync_configurations as configuration (
    tenant_id,
    entra_tenant_id,
    enabled,
    last_connection_tested_at,
    last_connection_test_status,
    last_sync_started_at,
    last_sync_completed_at,
    last_sync_status,
    last_sync_error,
    active_sync_run_id,
    sync_lease_expires_at,
    sync_generation
  ) values (
    p_tenant_id,
    v_trusted_tenant_id,
    p_enabled,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    1
  )
  on conflict (tenant_id) do update
    set entra_tenant_id = excluded.entra_tenant_id,
        enabled = excluded.enabled,
        last_connection_tested_at = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_connection_tested_at
        end,
        last_connection_test_status = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_connection_test_status
        end,
        last_sync_started_at = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_sync_started_at
        end,
        last_sync_completed_at = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_sync_completed_at
        end,
        last_sync_status = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_sync_status
        end,
        last_sync_error = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.last_sync_error
        end,
        active_sync_run_id = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.active_sync_run_id
        end,
        sync_lease_expires_at = case
          when configuration.entra_tenant_id is distinct from excluded.entra_tenant_id
            then null
          else configuration.sync_lease_expires_at
        end,
        sync_generation = configuration.sync_generation + 1
  returning
    configuration.entra_tenant_id,
    configuration.enabled,
    configuration.last_connection_tested_at,
    configuration.last_connection_test_status,
    configuration.last_sync_started_at,
    configuration.last_sync_completed_at,
    configuration.last_sync_status,
    configuration.sync_generation
  into
    entra_tenant_id,
    enabled,
    last_connection_tested_at,
    last_connection_test_status,
    last_sync_started_at,
    last_sync_completed_at,
    last_sync_status,
    sync_generation;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant.entra_directory.configuration_updated',
    'tenant_entra_directory_sync_configuration',
    p_tenant_id,
    'security',
    jsonb_build_object('enabled', p_enabled)
  );

  return next;
end;
$$;

create or replace function public.record_entra_directory_connection_test(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_entra_tenant_id uuid,
  p_sync_generation bigint,
  p_success boolean
)
returns table (
  last_connection_tested_at timestamptz,
  last_connection_test_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.tenant_entra_directory_sync_configurations%rowtype;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  if p_entra_tenant_id is null or p_sync_generation < 1 then
    raise exception 'Invalid Entra directory connection test fence' using errcode = '22023';
  end if;

  select *
  into v_configuration
  from public.tenant_entra_directory_sync_configurations
  where tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Entra directory configuration not found' using errcode = 'P0002';
  end if;

  -- Keep an SSO binding change from racing the test audit that unlocks sync.
  perform 1
  from public.tenant_sso_configurations
  where tenant_id = p_tenant_id
  for share;

  if v_configuration.entra_tenant_id is distinct from p_entra_tenant_id
     or v_configuration.sync_generation is distinct from p_sync_generation
     or public.trusted_entra_tenant_id_for_tenant(p_tenant_id) is distinct from p_entra_tenant_id then
    raise exception 'Entra directory configuration is no longer valid' using errcode = 'P0002';
  end if;

  update public.tenant_entra_directory_sync_configurations
  set last_connection_tested_at = timezone('utc', now()),
      last_connection_test_status = case when p_success then 'success' else 'failed' end
  where tenant_id = p_tenant_id
    and sync_generation = p_sync_generation
  returning
    tenant_entra_directory_sync_configurations.last_connection_tested_at,
    tenant_entra_directory_sync_configurations.last_connection_test_status
  into last_connection_tested_at, last_connection_test_status;

  if not found then
    raise exception 'Entra directory configuration not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    case
      when p_success then 'tenant.entra_directory.connection_test_succeeded'
      else 'tenant.entra_directory.connection_test_failed'
    end,
    'tenant_entra_directory_sync_configuration',
    p_tenant_id,
    'security',
    jsonb_build_object('outcome', case when p_success then 'success' else 'failed' end)
  );

  return next;
end;
$$;

create or replace function public.assert_fenced_entra_directory_sync_run(
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint,
  p_entra_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.tenant_entra_directory_sync_configurations%rowtype;
begin
  if p_tenant_id is null
     or p_run_id is null
     or p_sync_generation < 1
     or p_entra_tenant_id is null then
    raise exception 'Invalid Entra directory sync fence' using errcode = '22023';
  end if;

  select *
  into v_configuration
  from public.tenant_entra_directory_sync_configurations
  where tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Entra directory sync run is no longer valid' using errcode = 'P0002';
  end if;

  -- The share lock prevents a concurrent SSO issuer change for the duration of
  -- the protected mutation. A subsequent batch re-evaluates the binding.
  perform 1
  from public.tenant_sso_configurations
  where tenant_id = p_tenant_id
  for share;

  if v_configuration.active_sync_run_id is distinct from p_run_id
     or v_configuration.sync_generation is distinct from p_sync_generation
     or v_configuration.sync_lease_expires_at <= timezone('utc', now())
     or v_configuration.entra_tenant_id is distinct from p_entra_tenant_id
     or public.trusted_entra_tenant_id_for_tenant(p_tenant_id) is distinct from p_entra_tenant_id then
    raise exception 'Entra directory sync run is no longer valid' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.claim_entra_directory_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid
)
returns table (
  outcome text,
  entra_tenant_id uuid,
  started_at timestamptz,
  sync_generation bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.tenant_entra_directory_sync_configurations%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  if p_run_id is null then
    raise exception 'A sync run identifier is required' using errcode = '22023';
  end if;

  select *
  into v_configuration
  from public.tenant_entra_directory_sync_configurations
  where tenant_id = p_tenant_id
  for update;

  if not found
     or not v_configuration.enabled
     or v_configuration.last_connection_test_status is distinct from 'success'
     or v_configuration.entra_tenant_id is distinct from public.trusted_entra_tenant_id_for_tenant(p_tenant_id) then
    outcome := 'not_ready';
    return next;
    return;
  end if;

  if v_configuration.active_sync_run_id is not null
     and v_configuration.sync_lease_expires_at > v_now then
    outcome := 'in_progress';
    return next;
    return;
  end if;

  update public.tenant_entra_directory_sync_configurations
  set active_sync_run_id = p_run_id,
      sync_lease_expires_at = v_now + interval '20 minutes',
      last_sync_started_at = v_now,
      last_sync_status = 'running',
      last_sync_error = null
  where tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant.entra_directory.sync_started',
    'tenant_entra_directory_sync_configuration',
    p_tenant_id,
    'security',
    '{}'::jsonb
  );

  outcome := 'claimed';
  entra_tenant_id := v_configuration.entra_tenant_id;
  started_at := v_now;
  sync_generation := v_configuration.sync_generation;
  return next;
end;
$$;

create or replace function public.renew_entra_directory_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint,
  p_entra_tenant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  perform public.assert_fenced_entra_directory_sync_run(
    p_tenant_id,
    p_run_id,
    p_sync_generation,
    p_entra_tenant_id
  );

  update public.tenant_entra_directory_sync_configurations
  set sync_lease_expires_at = timezone('utc', now()) + interval '20 minutes'
  where tenant_id = p_tenant_id
    and active_sync_run_id = p_run_id
    and sync_generation = p_sync_generation;

  return found;
end;
$$;

create or replace function public.upsert_fenced_entra_directory_people_batch(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint,
  p_entra_tenant_id uuid,
  p_started_at timestamptz,
  p_people jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imported integer := 0;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  if p_started_at is null
     or jsonb_typeof(p_people) <> 'array'
     or jsonb_array_length(p_people) > 250 then
    raise exception 'Invalid Entra directory sync batch' using errcode = '22023';
  end if;

  perform public.assert_fenced_entra_directory_sync_run(
    p_tenant_id,
    p_run_id,
    p_sync_generation,
    p_entra_tenant_id
  );

  with input as (
    select *
    from jsonb_to_recordset(p_people) as person(
      entra_object_id uuid,
      email text,
      display_name text,
      job_title text,
      source_department_name text,
      account_enabled boolean
    )
  ), written as (
    insert into public.tenant_entra_directory_people as directory (
      tenant_id,
      entra_object_id,
      email,
      display_name,
      job_title,
      source_department_name,
      account_enabled,
      inactive_at,
      last_synced_at
    )
    select
      p_tenant_id,
      input.entra_object_id,
      input.email,
      input.display_name,
      input.job_title,
      input.source_department_name,
      input.account_enabled,
      case when input.account_enabled then null else p_started_at end,
      p_started_at
    from input
    on conflict (tenant_id, entra_object_id) do update
      set email = excluded.email,
          display_name = excluded.display_name,
          job_title = excluded.job_title,
          source_department_name = excluded.source_department_name,
          account_enabled = excluded.account_enabled,
          inactive_at = excluded.inactive_at,
          last_synced_at = excluded.last_synced_at
    returning 1
  )
  select count(*)::integer into v_imported from written;

  update public.tenant_entra_directory_sync_configurations
  set sync_lease_expires_at = timezone('utc', now()) + interval '20 minutes'
  where tenant_id = p_tenant_id
    and active_sync_run_id = p_run_id
    and sync_generation = p_sync_generation;

  if not found then
    raise exception 'Entra directory sync run is no longer valid' using errcode = 'P0002';
  end if;

  return v_imported;
end;
$$;

create or replace function public.finalize_fenced_entra_directory_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint,
  p_entra_tenant_id uuid,
  p_started_at timestamptz,
  p_imported_count integer
)
returns table (
  requester_contacts_created integer,
  requester_profiles_initialized integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contacts_created integer := 0;
  v_profiles_initialized integer := 0;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  if p_started_at is null or p_imported_count < 0 or p_imported_count > 1000000 then
    raise exception 'Invalid Entra directory sync completion values' using errcode = '22023';
  end if;

  perform public.assert_fenced_entra_directory_sync_run(
    p_tenant_id,
    p_run_id,
    p_sync_generation,
    p_entra_tenant_id
  );
  perform public.deactivate_stale_entra_directory_people(
    p_tenant_id,
    p_started_at,
    p_actor_id
  );
  select requesters.requester_contacts_created, requesters.requester_profiles_initialized
  into v_contacts_created, v_profiles_initialized
  from public.sync_entra_directory_requesters(p_tenant_id) as requesters;

  update public.tenant_entra_directory_sync_configurations
  set active_sync_run_id = null,
      sync_lease_expires_at = null,
      last_sync_completed_at = timezone('utc', now()),
      last_sync_status = 'success',
      last_sync_error = null
  where tenant_id = p_tenant_id
    and active_sync_run_id = p_run_id
    and sync_generation = p_sync_generation;

  if not found then
    raise exception 'Entra directory sync run is no longer valid' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant.entra_directory.sync_completed',
    'tenant_entra_directory_sync_configuration',
    p_tenant_id,
    'security',
    jsonb_build_object('outcome', 'success', 'imported_count', p_imported_count)
  );

  return query select v_contacts_created, v_profiles_initialized;
end;
$$;

create or replace function public.fail_entra_directory_sync_run(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failed boolean := false;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  update public.tenant_entra_directory_sync_configurations
  set active_sync_run_id = null,
      sync_lease_expires_at = null,
      last_sync_completed_at = timezone('utc', now()),
      last_sync_status = 'failed',
      last_sync_error = 'directory_sync_failed'
  where tenant_id = p_tenant_id
    and active_sync_run_id = p_run_id
    and sync_generation = p_sync_generation
  returning true into v_failed;

  if not found or not coalesce(v_failed, false) then
    return false;
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant.entra_directory.sync_failed',
    'tenant_entra_directory_sync_configuration',
    p_tenant_id,
    'security',
    jsonb_build_object('outcome', 'failed', 'imported_count', 0)
  );

  return true;
end;
$$;

revoke all on function public.trusted_entra_tenant_id_for_tenant(uuid) from public, anon, authenticated;
revoke all on function public.configure_entra_directory_sync(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_entra_directory_connection_test(uuid, uuid, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.assert_fenced_entra_directory_sync_run(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.claim_entra_directory_sync_run(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.renew_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.upsert_fenced_entra_directory_people_batch(uuid, uuid, uuid, bigint, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_fenced_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.fail_entra_directory_sync_run(uuid, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.trusted_entra_tenant_id_for_tenant(uuid) to service_role;
grant execute on function public.configure_entra_directory_sync(uuid, uuid, boolean) to service_role;
grant execute on function public.record_entra_directory_connection_test(uuid, uuid, uuid, bigint, boolean) to service_role;
grant execute on function public.claim_entra_directory_sync_run(uuid, uuid, uuid) to service_role;
grant execute on function public.renew_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.upsert_fenced_entra_directory_people_batch(uuid, uuid, uuid, bigint, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.finalize_fenced_entra_directory_sync_run(uuid, uuid, uuid, bigint, uuid, timestamptz, integer) to service_role;
grant execute on function public.fail_entra_directory_sync_run(uuid, uuid, uuid, bigint) to service_role;

commit;
