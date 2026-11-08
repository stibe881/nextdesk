begin;
set local search_path = pg_catalog, public;

-- Intune-Aktionen aus dem Ticket: remote actions on Intune managed devices
-- (sync, restart, lock, passcode reset, local admin password rotation,
-- Defender quick scan). The edge function intune-actions calls Microsoft
-- Graph; this migration provides the permission, the action log and the
-- service-role RPCs that authorize, log and write the ticket history.

insert into public.permissions (code, description, is_sensitive)
values ('asset.intune.actions', 'Intune-Geräteaktionen auslösen (Synchronisieren, Neustart, Sperren, Kennung zurücksetzen, Defender-Scan)', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

-- Default: every system role that has asset.manage also gets the Intune
-- actions. Custom roles are left to the tenant administrators.
insert into public.role_permissions (role_id, permission_code)
select distinct permission.role_id, 'asset.intune.actions'
from public.role_permissions permission
join public.roles role on role.id = permission.role_id
where permission.permission_code = 'asset.manage'
  and role.is_system
  and role.active
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_intune_action_permission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.permission_code = 'asset.manage' and exists (
    select 1 from public.roles role
    where role.id = new.role_id and role.is_system and role.active
  ) then
    insert into public.role_permissions (role_id, permission_code)
    values (new.role_id, 'asset.intune.actions')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_intune_action_permission()
  from public, anon, authenticated;

create trigger role_permissions_grant_default_intune_action
after insert on public.role_permissions
for each row
when (new.permission_code = 'asset.manage')
execute function public.grant_default_intune_action_permission();

create table public.intune_device_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  ticket_id uuid,
  action text not null check (action in (
    'syncDevice', 'rebootNow', 'remoteLock', 'resetPasscode',
    'rotateLocalAdminPassword', 'windowsDefenderScan'
  )),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  requested_by uuid references public.user_profiles(id) on delete set null,
  requested_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  graph_api_version text check (graph_api_version is null or graph_api_version in ('v1.0', 'beta')),
  graph_status integer check (graph_status is null or graph_status between 100 and 599),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint intune_device_actions_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint intune_device_actions_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete set null (ticket_id),
  constraint intune_device_actions_finished_check check (
    (status = 'pending' and finished_at is null)
    or (status <> 'pending' and finished_at is not null and finished_at >= requested_at)
  ),
  constraint intune_device_actions_error_check check (
    status <> 'succeeded' or error_code is null
  )
);

create index if not exists intune_device_actions_tenant_asset_idx
  on public.intune_device_actions (tenant_id, asset_id, requested_at desc);
create index if not exists intune_device_actions_ticket_idx
  on public.intune_device_actions (ticket_id, requested_at desc)
  where ticket_id is not null;

alter table public.intune_device_actions enable row level security;
revoke all on table public.intune_device_actions from public, anon, authenticated;
grant select on table public.intune_device_actions to authenticated;
grant select, insert, update on table public.intune_device_actions to service_role;

create policy intune_device_actions_select on public.intune_device_actions
  for select to authenticated
  using (
    public.has_tenant_permission(tenant_id, 'asset.intune.actions')
    or public.has_tenant_permission(tenant_id, 'asset.manage')
  );

-- Readiness of the tenant's Intune connection for remote actions: enabled
-- and bound to the Entra tenant of the tenant's trusted SSO configuration.
create or replace function public.intune_device_action_entra_tenant(
  p_tenant_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_connection public.asset_intune_connections%rowtype;
  v_trusted uuid;
begin
  select * into v_connection
  from public.asset_intune_connections
  where tenant_id = p_tenant_id;
  if not found or not v_connection.enabled or v_connection.directory_tenant_id is null then
    return null;
  end if;
  v_trusted := public.trusted_entra_tenant_id_for_tenant(p_tenant_id);
  if v_trusted is null or v_trusted is distinct from v_connection.directory_tenant_id then
    return null;
  end if;
  return v_trusted;
end;
$$;

-- Intune managed assets among the given ones, with their platform. The
-- provider device ID stays in the database.
create or replace function public.intune_device_action_targets(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_asset_ids uuid[]
)
returns table (
  asset_id uuid,
  operating_system text,
  connection_ready boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_ready boolean;
begin
  if p_actor_id is null or p_tenant_id is null or p_asset_ids is null
     or cardinality(p_asset_ids) > 200 then
    raise exception 'Invalid Intune action target request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'asset.intune.actions');
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);
  v_ready := public.intune_device_action_entra_tenant(p_tenant_id) is not null;
  return query
  select link.asset_id,
         coalesce(nullif(btrim(device.operating_system), ''), nullif(btrim(asset.operating_system), '')),
         v_ready
  from public.asset_intune_asset_links link
  join public.assets asset
    on asset.id = link.asset_id and asset.tenant_id = link.tenant_id and asset.active
  left join public.asset_intune_devices device
    on device.tenant_id = link.tenant_id
   and lower(device.external_device_id) = link.canonical_external_device_id
  where link.tenant_id = p_tenant_id
    and link.asset_id = any(p_asset_ids);
end;
$$;

create or replace function public.begin_intune_device_action(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_asset_id uuid,
  p_ticket_id uuid,
  p_action text
)
returns table (
  action_id uuid,
  entra_tenant_id uuid,
  managed_device_id text,
  operating_system text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_entra uuid;
  v_device_id text;
  v_os text;
  v_id uuid;
begin
  if p_actor_id is null or p_tenant_id is null or p_asset_id is null
     or p_action is null or p_action not in (
       'syncDevice', 'rebootNow', 'remoteLock', 'resetPasscode',
       'rotateLocalAdminPassword', 'windowsDefenderScan'
     ) then
    raise exception 'Invalid Intune action request' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'asset.intune.actions');
  perform public.assert_asset_intune_preflight_feature_enabled(p_tenant_id);
  if p_ticket_id is not null and not exists (
    select 1 from public.tickets ticket
    where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id
  ) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  select link.canonical_external_device_id,
         coalesce(nullif(btrim(device.operating_system), ''), nullif(btrim(asset.operating_system), ''))
    into v_device_id, v_os
  from public.asset_intune_asset_links link
  join public.assets asset
    on asset.id = link.asset_id and asset.tenant_id = link.tenant_id and asset.active
  left join public.asset_intune_devices device
    on device.tenant_id = link.tenant_id
   and lower(device.external_device_id) = link.canonical_external_device_id
  where link.tenant_id = p_tenant_id and link.asset_id = p_asset_id;
  if v_device_id is null then
    raise exception 'Asset is not managed by Intune' using errcode = 'P0002';
  end if;

  v_entra := public.intune_device_action_entra_tenant(p_tenant_id);
  if v_entra is null then
    raise exception 'Intune connection is not ready' using errcode = 'P0001';
  end if;

  insert into public.intune_device_actions (tenant_id, asset_id, ticket_id, action, requested_by)
  values (p_tenant_id, p_asset_id, p_ticket_id, p_action, p_actor_id)
  returning id into v_id;

  action_id := v_id;
  entra_tenant_id := v_entra;
  managed_device_id := v_device_id;
  operating_system := v_os;
  return next;
end;
$$;

create or replace function public.finish_intune_device_action(
  p_tenant_id uuid,
  p_action_id uuid,
  p_succeeded boolean,
  p_graph_api_version text,
  p_graph_status integer,
  p_error_code text
)
returns table (
  id uuid,
  action text,
  status text,
  graph_status integer,
  error_code text,
  requested_at timestamptz,
  finished_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row public.intune_device_actions%rowtype;
  v_asset_name text;
begin
  if p_tenant_id is null or p_action_id is null or p_succeeded is null
     or (p_succeeded and p_error_code is not null)
     or (not p_succeeded and p_error_code is null) then
    raise exception 'Invalid Intune action result' using errcode = '22023';
  end if;
  update public.intune_device_actions as log
  set status = case when p_succeeded then 'succeeded' else 'failed' end,
      finished_at = greatest(timezone('utc', now()), log.requested_at),
      graph_api_version = p_graph_api_version,
      graph_status = p_graph_status,
      error_code = p_error_code
  where log.id = p_action_id
    and log.tenant_id = p_tenant_id
    and log.status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'Intune action not pending' using errcode = 'P0002';
  end if;

  select asset.name into v_asset_name
  from public.assets asset
  where asset.id = v_row.asset_id and asset.tenant_id = v_row.tenant_id;

  if v_row.ticket_id is not null then
    -- Internal ticket history entry (not in the requester portal allowlist).
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      v_row.ticket_id,
      v_row.requested_by,
      'asset.intune_action',
      jsonb_build_object(
        'actionId', v_row.id,
        'action', v_row.action,
        'assetId', v_row.asset_id,
        'assetName', v_asset_name,
        'status', v_row.status,
        'errorCode', v_row.error_code
      )
    );
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    v_row.tenant_id,
    v_row.requested_by,
    'asset.intune_action.' || v_row.status,
    'asset',
    v_row.asset_id,
    'security',
    jsonb_build_object(
      'intune_action_id', v_row.id,
      'action', v_row.action,
      'ticket_id', v_row.ticket_id,
      'graph_status', v_row.graph_status,
      'error_code', v_row.error_code
    )
  );

  id := v_row.id;
  action := v_row.action;
  status := v_row.status;
  graph_status := v_row.graph_status;
  error_code := v_row.error_code;
  requested_at := v_row.requested_at;
  finished_at := v_row.finished_at;
  return next;
end;
$$;

revoke all on function public.intune_device_action_entra_tenant(uuid)
  from public, anon, authenticated;
revoke all on function public.intune_device_action_targets(uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.begin_intune_device_action(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finish_intune_device_action(uuid, uuid, boolean, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.intune_device_action_entra_tenant(uuid) to service_role;
grant execute on function public.intune_device_action_targets(uuid, uuid, uuid[]) to service_role;
grant execute on function public.begin_intune_device_action(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.finish_intune_device_action(uuid, uuid, boolean, text, integer, text) to service_role;

commit;
