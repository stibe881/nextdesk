begin;

-- A maintenance window, its complete service selection and its audit record form
-- one command. Any exception raised below aborts the RPC statement and therefore
-- rolls back every preceding write in this function.
create or replace function public.save_service_status_maintenance(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_maintenance_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_state text,
  p_public_enabled boolean,
  p_service_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_maintenance public.service_status_maintenances%rowtype;
  v_service record;
  v_service_count integer := 0;
  v_distinct_service_count integer := 0;
  v_requested_service_count integer := cardinality(p_service_ids);
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := case
    when p_description is null then null
    else btrim(p_description)
  end;
begin
  if p_actor_id is null or p_tenant_id is null then
    raise exception 'Actor and tenant are required' using errcode = '22023';
  end if;
  if char_length(v_title) not between 2 and 180 then
    raise exception 'Maintenance title must contain between 2 and 180 characters'
      using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Maintenance description may contain at most 2000 characters'
      using errcode = '22023';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Maintenance end must be later than its start' using errcode = '22023';
  end if;
  if p_state not in ('scheduled', 'active', 'completed', 'cancelled') then
    raise exception 'Invalid maintenance state' using errcode = '22023';
  end if;
  if p_public_enabled is null then
    raise exception 'Maintenance public setting is required' using errcode = '22023';
  end if;
  if v_requested_service_count is null
    or v_requested_service_count not between 1 and 100
    or array_position(p_service_ids, null) is not null then
    raise exception 'Maintenance must contain between one and 100 services' using errcode = '22023';
  end if;

  select count(*)
    into v_distinct_service_count
    from (
      select distinct service_id
      from unnest(p_service_ids) as service_id
    ) as requested_services;
  if v_distinct_service_count <> v_requested_service_count then
    raise exception 'Maintenance service IDs must be unique' using errcode = '22023';
  end if;

  -- The tenant existence check is explicit and the row lock keeps its FK target
  -- stable for the complete command.
  perform 1
    from public.tenants as tenant
   where tenant.id = p_tenant_id
   for key share;
  if not found then
    raise exception 'Tenant does not exist' using errcode = 'P0002';
  end if;

  if p_maintenance_id is null then
    -- Creating a public window is a publication action.
    if p_public_enabled
      and not public.user_has_tenant_permission(
        p_actor_id,
        p_tenant_id,
        'tenant.settings.manage'
      ) then
      raise exception 'Tenant publication permission is required' using errcode = '42501';
    end if;

    insert into public.service_status_maintenances (
      tenant_id,
      title,
      description,
      starts_at,
      ends_at,
      state,
      public_enabled,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_title,
      v_description,
      p_starts_at,
      p_ends_at,
      p_state,
      p_public_enabled,
      p_actor_id,
      p_actor_id
    )
    returning * into v_maintenance;
  else
    -- Lock before inspecting the existing visibility. This serializes concurrent
    -- edits and prevents an asset manager from changing or unpublishing a window
    -- that was already public without the publication permission.
    select *
      into v_maintenance
      from public.service_status_maintenances as maintenance
     where maintenance.tenant_id = p_tenant_id
       and maintenance.id = p_maintenance_id
     for update;
    if not found then
      raise exception 'Maintenance window does not exist for this tenant' using errcode = 'P0002';
    end if;

    if (p_public_enabled or v_maintenance.public_enabled)
      and not public.user_has_tenant_permission(
        p_actor_id,
        p_tenant_id,
        'tenant.settings.manage'
      ) then
      raise exception 'Tenant publication permission is required' using errcode = '42501';
    end if;

    update public.service_status_maintenances as maintenance
       set title = v_title,
           description = v_description,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           state = p_state,
           public_enabled = p_public_enabled,
           updated_by = p_actor_id
     where maintenance.tenant_id = p_tenant_id
       and maintenance.id = v_maintenance.id
    returning * into v_maintenance;
  end if;

  -- Lock every tenant-local selected service while validating it. FOR SHARE
  -- prevents an active/public status change from racing this replacement until
  -- the maintenance command has committed or rolled back.
  for v_service in
    select service.id, service.active, service.status_public
      from public.services as service
     where service.tenant_id = p_tenant_id
       and service.id = any(p_service_ids)
     for share
  loop
    v_service_count := v_service_count + 1;
    if not v_service.active then
      raise exception 'Maintenance services must be active' using errcode = '23503';
    end if;
    if p_public_enabled and not v_service.status_public then
      raise exception 'Public maintenance services must be public' using errcode = '23503';
    end if;
  end loop;
  if v_service_count <> v_requested_service_count then
    raise exception 'Every maintenance service must belong to the tenant' using errcode = '23503';
  end if;

  -- Replacing rather than merging links guarantees that an update cannot retain
  -- a stale affected service. Both predicates preserve the composite tenant
  -- boundary independently of the foreign keys.
  delete from public.service_status_maintenance_services as link
   where link.tenant_id = p_tenant_id
     and link.maintenance_id = v_maintenance.id;

  insert into public.service_status_maintenance_services (
    tenant_id,
    maintenance_id,
    service_id
  )
  select p_tenant_id, v_maintenance.id, requested_service_id
    from unnest(p_service_ids) as requested_service_id;

  -- Deliberately data-minimal audit metadata: no title, description, service ID
  -- list, or before/after snapshot is persisted here.
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
    case
      when p_maintenance_id is null then 'service_status_maintenance.created'
      else 'service_status_maintenance.updated'
    end,
    'service_status_maintenance',
    v_maintenance.id,
    'info',
    jsonb_build_object(
      'source', 'service_status',
      'state', p_state,
      'publicEnabled', p_public_enabled,
      'serviceCount', v_requested_service_count
    )
  );

  return v_maintenance.id;
end;
$$;

-- The Edge Function keeps the service-role secret. Browser roles cannot invoke
-- this SECURITY DEFINER command or write maintenance rows around it.
revoke all on function public.save_service_status_maintenance(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean, uuid[]
) from public, anon, authenticated;
grant execute on function public.save_service_status_maintenance(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean, uuid[]
) to service_role;

revoke insert, update, delete on table public.service_status_maintenances,
  public.service_status_maintenance_services from service_role;
grant select on table public.service_status_maintenances,
  public.service_status_maintenance_services to service_role;

commit;
