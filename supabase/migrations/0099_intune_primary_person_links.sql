begin;

-- `managedDevice.userId` is an Entra object ID, not a display name or mailbox
-- identifier. It exists only in private staging until it can be resolved against
-- the active, tenant-scoped directory mirror. No Graph person field is persisted.
alter table public.asset_intune_manual_sync_stage
  add column if not exists primary_user_object_id uuid;

create table public.asset_intune_primary_person_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  entra_object_id uuid not null,
  resolved_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, asset_id),
  constraint asset_intune_primary_person_links_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id)
    on delete cascade,
  constraint asset_intune_primary_person_links_directory_tenant_fk
    foreign key (tenant_id, entra_object_id)
    references public.tenant_entra_directory_people (tenant_id, entra_object_id)
    on delete cascade
);

create index asset_intune_primary_person_links_person_idx
  on public.asset_intune_primary_person_links (tenant_id, entra_object_id, asset_id);

alter table public.asset_intune_primary_person_links enable row level security;
revoke all on table public.asset_intune_primary_person_links
  from public, anon, authenticated;
grant select, insert, update, delete on table public.asset_intune_primary_person_links
  to service_role;

create or replace function public.sync_asset_intune_primary_person_link(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_asset_id uuid,
  p_entra_object_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolved boolean := false;
begin
  if p_actor_id is null or p_tenant_id is null or p_asset_id is null then
    raise exception 'Invalid Intune primary-person link input' using errcode = '22023';
  end if;

  perform 1
  from public.assets asset
  where asset.tenant_id = p_tenant_id and asset.id = p_asset_id
  for share;
  if not found then
    raise exception 'The synchronized asset is no longer available' using errcode = 'P0002';
  end if;

  if p_entra_object_id is not null then
    perform 1
    from public.tenant_entra_directory_people person
    where person.tenant_id = p_tenant_id
      and person.entra_object_id = p_entra_object_id
      and person.account_enabled
      and person.inactive_at is null
    for share;
    v_resolved := found;
  end if;

  if v_resolved then
    insert into public.asset_intune_primary_person_links (
      tenant_id, asset_id, entra_object_id, resolved_at
    ) values (
      p_tenant_id, p_asset_id, p_entra_object_id, timezone('utc', now())
    ) on conflict (tenant_id, asset_id) do update
      set entra_object_id = excluded.entra_object_id,
          resolved_at = excluded.resolved_at;
    return true;
  end if;

  delete from public.asset_intune_primary_person_links link
  where link.tenant_id = p_tenant_id and link.asset_id = p_asset_id;
  return false;
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
      enrolled_at timestamptz,
      primary_user_object_id uuid
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
      or (primary_user_object_id is not null and primary_user_object_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  )
  select count(*)::integer into v_count from invalid;
  if v_count <> 0 then
    raise exception 'Invalid manual Intune device payload' using errcode = '22023';
  end if;

  insert into public.asset_intune_manual_sync_stage (
    run_id, tenant_id, canonical_external_device_id, device_name, serial_number,
    manufacturer, model, operating_system, os_version, compliance_state,
    is_encrypted, last_sync_at, enrolled_at, primary_user_object_id
  )
  select
    p_run_id, p_tenant_id, lower(btrim(external_device_id)),
    device_name, serial_number, manufacturer, model, operating_system, os_version,
    compliance_state, is_encrypted, last_sync_at, enrolled_at, primary_user_object_id
  from jsonb_to_recordset(p_devices) as device(
    external_device_id text, device_name text, serial_number text, manufacturer text,
    model text, operating_system text, os_version text, compliance_state text,
    is_encrypted boolean, last_sync_at timestamptz, enrolled_at timestamptz,
    primary_user_object_id uuid
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
  v_primary_people_resolved integer := 0;
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
        if public.sync_asset_intune_primary_person_link(
          p_actor_id,
          p_tenant_id,
          v_asset_id,
          v_stage.primary_user_object_id
        ) then
          v_primary_people_resolved := v_primary_people_resolved + 1;
        end if;
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
      if public.sync_asset_intune_primary_person_link(
        p_actor_id,
        p_tenant_id,
        v_asset_id,
        v_stage.primary_user_object_id
      ) then
        v_primary_people_resolved := v_primary_people_resolved + 1;
      end if;
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
      'assets_skipped', v_skipped, 'ambiguous_devices', v_ambiguous,
      'primary_people_resolved', v_primary_people_resolved
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


revoke all on function public.sync_asset_intune_primary_person_link(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.stage_asset_intune_manual_sync_devices(uuid, uuid, uuid, bigint, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_asset_intune_manual_sync_run(uuid, uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.sync_asset_intune_primary_person_link(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.stage_asset_intune_manual_sync_devices(uuid, uuid, uuid, bigint, bigint, jsonb)
  to service_role;
grant execute on function public.complete_asset_intune_manual_sync_run(uuid, uuid, uuid, bigint, bigint)
  to service_role;

comment on table public.asset_intune_primary_person_links is
  'Private tenant-scoped mapping from an Intune asset to an already active local Entra directory person. Never stores Graph display names, UPNs or e-mail addresses.';
comment on column public.asset_intune_manual_sync_stage.primary_user_object_id is
  'Temporary Microsoft Graph managedDevice.userId. Resolved only against an active local directory person and removed with the run staging rows.';

commit;
