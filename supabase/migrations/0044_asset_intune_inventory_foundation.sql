begin;

-- Asset integration is deliberately separated from the generic asset.manage
-- permission. It controls only connector configuration and runs; device data
-- remains server-side and cannot be read directly by browser clients.
insert into public.permissions (code, description, is_sensitive)
values ('asset.integration.manage', 'Configure tenant asset integrations and run read-only device synchronization', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_code)
select role.id, 'asset.integration.manage'
from public.roles role
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;

-- Future tenant administrators receive the same least-privilege connector
-- capability. No support-agent or requester role receives it implicitly.
create or replace function public.grant_default_asset_integration_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values (new.id, 'asset.integration.manage')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_asset_integration_permission() from public, anon, authenticated;
drop trigger if exists roles_grant_default_asset_integration_permission on public.roles;
create trigger roles_grant_default_asset_integration_permission
  after insert on public.roles
  for each row execute function public.grant_default_asset_integration_permission();

create table public.asset_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint asset_locations_id_tenant_unique unique (id, tenant_id),
  constraint asset_locations_tenant_name_unique unique (tenant_id, name)
);

alter table public.assets
  add column if not exists location_id uuid,
  add column if not exists inventory_number text,
  add column if not exists serial_number text,
  add column if not exists manufacturer text,
  add column if not exists model text,
  add column if not exists operating_system text,
  add column if not exists lifecycle_state text not null default 'active',
  add column if not exists lifecycle_changed_at timestamptz not null default timezone('utc', now()),
  add column if not exists intune_device_id text,
  add column if not exists intune_last_sync_at timestamptz,
  add column if not exists intune_compliance_state text,
  add column if not exists intune_encrypted boolean,
  add column if not exists intune_last_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assets_location_tenant_fk'
  ) then
    alter table public.assets add constraint assets_location_tenant_fk
      foreign key (location_id, tenant_id)
      references public.asset_locations (id, tenant_id)
      on delete set null (location_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'assets_lifecycle_state_valid'
  ) then
    alter table public.assets add constraint assets_lifecycle_state_valid
      check (lifecycle_state in ('ordered', 'stock', 'active', 'repair', 'retired', 'disposed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'assets_inventory_number_valid'
  ) then
    alter table public.assets add constraint assets_inventory_number_valid
      check (inventory_number is null or (
        char_length(btrim(inventory_number)) between 1 and 160
        and inventory_number = btrim(inventory_number)
        and inventory_number !~ '[[:cntrl:]]'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'assets_serial_number_valid'
  ) then
    alter table public.assets add constraint assets_serial_number_valid
      check (serial_number is null or (
        char_length(btrim(serial_number)) between 1 and 160
        and serial_number = btrim(serial_number)
        and serial_number !~ '[[:cntrl:]]'
      ));
  end if;
end;
$$;

create table public.asset_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  identifier_type text not null check (identifier_type in (
    'asset_tag', 'inventory_number', 'serial_number', 'intune_device_id', 'qr_code'
  )),
  canonical_value text not null check (
    char_length(canonical_value) between 1 and 200
    and canonical_value = lower(btrim(canonical_value))
    and canonical_value !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  constraint asset_identifiers_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint asset_identifiers_tenant_asset_type_unique
    unique (tenant_id, asset_id, identifier_type)
);

create table public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  requester_id uuid not null,
  assigned_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz,
  note text,
  assigned_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint asset_assignments_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint asset_assignments_requester_tenant_fk
    foreign key (requester_id, tenant_id)
    references public.ticket_requesters (id, tenant_id) on delete restrict,
  constraint asset_assignments_return_after_assignment
    check (returned_at is null or returned_at >= assigned_at),
  constraint asset_assignments_note_valid
    check (note is null or (
      char_length(btrim(note)) between 1 and 2000
      and note = btrim(note)
      and note !~ '[[:cntrl:]]'
    ))
);

create unique index asset_assignments_one_active_per_asset
  on public.asset_assignments (tenant_id, asset_id)
  where returned_at is null;
create index asset_assignments_requester_active_idx
  on public.asset_assignments (tenant_id, requester_id, assigned_at desc)
  where returned_at is null;

create table public.asset_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  previous_state text,
  next_state text not null check (next_state in ('ordered', 'stock', 'active', 'repair', 'retired', 'disposed')),
  reason text,
  actor_id uuid references public.user_profiles(id) on delete set null,
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint asset_lifecycle_events_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint asset_lifecycle_events_reason_valid
    check (reason is null or (
      char_length(btrim(reason)) between 1 and 2000
      and reason = btrim(reason)
      and reason !~ '[[:cntrl:]]'
    ))
);

create table public.asset_intune_connections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  directory_tenant_id uuid,
  sync_enabled boolean not null default false,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_status text not null default 'not_configured'
    check (last_status in ('not_configured', 'ready', 'running', 'succeeded', 'failed')),
  last_error_code text,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  check (not enabled or directory_tenant_id is not null),
  check (not sync_enabled or enabled)
);

create table public.asset_intune_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('dry_run', 'synchronize')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  devices_seen integer not null default 0 check (devices_seen >= 0),
  assets_created integer not null default 0 check (assets_created >= 0),
  assets_updated integer not null default 0 check (assets_updated >= 0),
  error_code text,
  started_by uuid references public.user_profiles(id) on delete set null,
  check (finished_at is null or finished_at >= started_at)
);

create table public.asset_intune_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid,
  external_device_id text not null check (char_length(btrim(external_device_id)) between 1 and 200),
  device_name text,
  managed_device_name text,
  serial_number text,
  manufacturer text,
  model text,
  operating_system text,
  os_version text,
  user_display_name text,
  user_principal_name text,
  compliance_state text,
  is_encrypted boolean,
  last_sync_at timestamptz,
  last_seen_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  synced_at timestamptz not null default timezone('utc', now()),
  constraint asset_intune_devices_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete set null (asset_id),
  constraint asset_intune_devices_tenant_external_unique
    unique (tenant_id, external_device_id)
);

create index asset_locations_tenant_active_name_idx
  on public.asset_locations (tenant_id, active, name);
create unique index assets_tenant_intune_device_id_unique
  on public.assets (tenant_id, intune_device_id)
  where intune_device_id is not null;
create index assets_tenant_lifecycle_idx
  on public.assets (tenant_id, lifecycle_state, active, updated_at desc);
create index assets_location_tenant_idx
  on public.assets (tenant_id, location_id) where location_id is not null;
create index asset_identifiers_lookup_idx
  on public.asset_identifiers (tenant_id, canonical_value, identifier_type);
create index asset_lifecycle_events_asset_idx
  on public.asset_lifecycle_events (tenant_id, asset_id, occurred_at desc);
create index asset_intune_sync_runs_tenant_started_idx
  on public.asset_intune_sync_runs (tenant_id, started_at desc);
create index asset_intune_devices_asset_idx
  on public.asset_intune_devices (tenant_id, asset_id) where asset_id is not null;
create index asset_intune_devices_serial_idx
  on public.asset_intune_devices (tenant_id, serial_number) where serial_number is not null;

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
    and identifier_type in ('asset_tag', 'inventory_number', 'serial_number', 'intune_device_id');

  insert into public.asset_identifiers (tenant_id, asset_id, identifier_type, canonical_value)
  select new.tenant_id, new.id, identifier_type, lower(value)
  from (values
    ('asset_tag'::text, nullif(btrim(new.asset_tag), '')),
    ('inventory_number'::text, nullif(btrim(new.inventory_number), '')),
    ('serial_number'::text, nullif(btrim(new.serial_number), '')),
    ('intune_device_id'::text, nullif(btrim(new.intune_device_id), ''))
  ) as identifiers(identifier_type, value)
  where value is not null;
  return new;
end;
$$;

create or replace function public.record_asset_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'assets' then
    raise exception 'Invalid asset lifecycle trigger target' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.lifecycle_state is distinct from old.lifecycle_state then
    insert into public.asset_lifecycle_events (
      tenant_id, asset_id, previous_state, next_state, actor_id, occurred_at
    ) values (
      new.tenant_id, new.id,
      case when tg_op = 'INSERT' then null else old.lifecycle_state end,
      new.lifecycle_state, auth.uid(), timezone('utc', now())
    );
  end if;
  return new;
end;
$$;

create or replace function public.audit_asset_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  before_row jsonb := to_jsonb(old);
  after_row jsonb := to_jsonb(new);
begin
  if exists (select 1 from public.tenants where id = (row_data ->> 'tenant_id')::uuid) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity,
      before_data, after_data, metadata
    ) values (
      (row_data ->> 'tenant_id')::uuid,
      auth.uid(), 'asset_inventory.' || tg_table_name || '.' || lower(tg_op),
      tg_table_name,
      coalesce(row_data ->> 'asset_id', row_data ->> 'id')::uuid,
      'info',
      case when tg_op = 'INSERT' then null else jsonb_build_object('id', coalesce(before_row ->> 'id', before_row ->> 'asset_id')) end,
      case when tg_op = 'DELETE' then null else jsonb_build_object('id', coalesce(after_row ->> 'id', after_row ->> 'asset_id')) end,
      jsonb_build_object('operation', tg_op)
    );
  end if;
  return null;
end;
$$;

revoke all on function public.sync_asset_identifiers() from public, anon, authenticated;
revoke all on function public.record_asset_lifecycle_change() from public, anon, authenticated;
revoke all on function public.audit_asset_inventory_change() from public, anon, authenticated;

drop trigger if exists assets_sync_identifiers on public.assets;
create trigger assets_sync_identifiers
  after insert or update of asset_tag, inventory_number, serial_number, intune_device_id
  on public.assets for each row execute function public.sync_asset_identifiers();
drop trigger if exists assets_record_lifecycle on public.assets;
create trigger assets_record_lifecycle
  after insert or update of lifecycle_state
  on public.assets for each row execute function public.record_asset_lifecycle_change();

create trigger asset_locations_updated_at
  before update on public.asset_locations for each row execute function public.set_updated_at();
create trigger asset_intune_connections_updated_at
  before update on public.asset_intune_connections for each row execute function public.set_updated_at();

create trigger asset_locations_audit_changes
  after insert or update or delete on public.asset_locations
  for each row execute function public.audit_asset_inventory_change();
create trigger asset_assignments_audit_changes
  after insert or update or delete on public.asset_assignments
  for each row execute function public.audit_asset_inventory_change();
create trigger asset_intune_connections_audit_changes
  after insert or update or delete on public.asset_intune_connections
  for each row execute function public.audit_asset_inventory_change();

-- The initial lifecycle/identifier history covers existing active assets while
-- preserving their original fields and audit history.
update public.assets
set lifecycle_state = case when active then 'active' else 'retired' end,
    lifecycle_changed_at = timezone('utc', now())
where not active and lifecycle_state = 'active';

insert into public.asset_identifiers (tenant_id, asset_id, identifier_type, canonical_value)
select asset.tenant_id, asset.id, identifiers.identifier_type, lower(identifiers.value)
from public.assets asset
cross join lateral (values
  ('asset_tag'::text, nullif(btrim(asset.asset_tag), '')),
  ('inventory_number'::text, nullif(btrim(asset.inventory_number), '')),
  ('serial_number'::text, nullif(btrim(asset.serial_number), '')),
  ('intune_device_id'::text, nullif(btrim(asset.intune_device_id), ''))
) as identifiers(identifier_type, value)
where identifiers.value is not null
on conflict (tenant_id, asset_id, identifier_type) do update
set canonical_value = excluded.canonical_value;

insert into public.asset_intune_connections (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

alter table public.asset_locations enable row level security;
alter table public.asset_identifiers enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_lifecycle_events enable row level security;
alter table public.asset_intune_connections enable row level security;
alter table public.asset_intune_sync_runs enable row level security;
alter table public.asset_intune_devices enable row level security;

revoke all on table public.asset_locations, public.asset_identifiers,
  public.asset_assignments, public.asset_lifecycle_events,
  public.asset_intune_connections, public.asset_intune_sync_runs,
  public.asset_intune_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.asset_locations,
  public.asset_identifiers, public.asset_assignments, public.asset_lifecycle_events,
  public.asset_intune_connections, public.asset_intune_sync_runs,
  public.asset_intune_devices to authenticated, service_role;

create policy asset_locations_select_member on public.asset_locations
  for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy asset_locations_manage_authorized on public.asset_locations
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));

create policy asset_identifiers_select_member on public.asset_identifiers
  for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy asset_identifiers_manage_authorized on public.asset_identifiers
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));

create policy asset_assignments_manage_authorized on public.asset_assignments
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));
create policy asset_lifecycle_events_select_authorized on public.asset_lifecycle_events
  for select to authenticated using (public.has_tenant_permission(tenant_id, 'asset.manage'));
create policy asset_intune_connections_manage_authorized on public.asset_intune_connections
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.integration.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.integration.manage'));
create policy asset_intune_sync_runs_select_authorized on public.asset_intune_sync_runs
  for select to authenticated using (public.has_tenant_permission(tenant_id, 'asset.integration.manage'));
create policy asset_intune_devices_select_authorized on public.asset_intune_devices
  for select to authenticated using (public.has_tenant_permission(tenant_id, 'asset.manage'));

comment on table public.asset_intune_devices is
  'Server-maintained Intune device snapshot. Direct browser/mobile reads are restricted to asset managers; raw Graph tokens never enter this table.';
comment on table public.asset_intune_connections is
  'Tenant-specific Intune activation metadata. Client credentials are stored only as Edge Function secrets.';

commit;
