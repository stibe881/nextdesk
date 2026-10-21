begin;

insert into public.permissions (code, description, is_sensitive)
values ('contracts.manage', 'Verträge anzeigen, erfassen, bearbeiten und archivieren', true)
on conflict (code) do update
  set description = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- The feature is intentionally opt-in. Existing tenant-feature initialization
-- dynamically provisions this catalog entry for future tenants.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'contracts.management',
  'Verträge',
  'Mandantenlokale Vertragsverwaltung mit Fristen und klaren Verantwortlichkeiten.',
  'ticketing',
  false
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'contracts.management', false
from public.tenants tenant
on conflict (tenant_id, feature_key) do nothing;

create or replace function public.has_contracts_management_permission(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.user_role_assignments assignment
      on assignment.tenant_id = membership.tenant_id
      and assignment.user_id = membership.user_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = membership.tenant_id
      and role.scope = 'tenant'
      and role.active
      and role.is_system
      and role.name in ('Tenant administrator', 'Verträge')
    join public.role_permissions permission
      on permission.role_id = role.id
      and permission.permission_code = 'contracts.manage'
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  );
$$;

create or replace function public.is_contracts_management_client_enabled(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_contracts_management_permission(p_tenant_id, auth.uid())
    and exists (
      select 1
      from public.tenant_feature_flags flag
      where flag.tenant_id = p_tenant_id
        and flag.feature_key = 'contracts.management'
        and flag.enabled
        and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
    );
$$;

revoke all on function public.has_contracts_management_permission(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.is_contracts_management_client_enabled(uuid)
  from public, anon;
grant execute on function public.has_contracts_management_permission(uuid, uuid)
  to service_role;
grant execute on function public.is_contracts_management_client_enabled(uuid)
  to authenticated, service_role;

-- Tenant administrators retain their existing global responsibility. A second
-- system role is present for a deliberately narrow contract-management duty.
insert into public.role_permissions (role_id, permission_code)
select role.id, 'contracts.manage'
from public.roles role
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_contracts_permission()
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
    values (new.id, 'contracts.manage')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_contracts_permission()
  from public, anon, authenticated;
drop trigger if exists roles_grant_default_contracts_permission on public.roles;
create trigger roles_grant_default_contracts_permission
  after insert on public.roles
  for each row execute function public.grant_default_contracts_permission();

create or replace function public.seed_contracts_system_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id uuid;
begin
  insert into public.roles (tenant_id, name, scope, is_system, active)
  values (new.id, 'Verträge', 'tenant', true, true)
  on conflict (tenant_id, name) do update
    set scope = 'tenant',
        is_system = true,
        active = true
  returning id into v_role_id;

  delete from public.role_permissions permission
  where permission.role_id = v_role_id
    and permission.permission_code <> 'contracts.manage';

  insert into public.role_permissions (role_id, permission_code)
  values (v_role_id, 'contracts.manage')
  on conflict (role_id, permission_code) do nothing;
  return new;
end;
$$;
revoke all on function public.seed_contracts_system_role()
  from public, anon, authenticated;
drop trigger if exists tenants_seed_contracts_system_role on public.tenants;
create trigger tenants_seed_contracts_system_role
  after insert on public.tenants
  for each row execute function public.seed_contracts_system_role();

-- Do not convert a pre-existing custom role into a privileged system role:
-- people assigned to that role must never receive contract access implicitly.
-- Retain the custom role and its assignments under an unambiguous legacy name,
-- then create the protected system role below.
update public.roles role
set name = format('Verträge (bestehend %s)', role.id::text)
where role.tenant_id is not null
  and role.name = 'Verträge'
  and (role.scope <> 'tenant' or not role.is_system);

insert into public.roles (tenant_id, name, scope, is_system, active)
select tenant.id, 'Verträge', 'tenant', true, true
from public.tenants tenant
on conflict (tenant_id, name) do update
  set scope = 'tenant',
      is_system = true,
      active = true;

delete from public.role_permissions permission
using public.roles role
where role.id = permission.role_id
  and role.tenant_id is not null
  and role.name = 'Verträge'
  and role.scope = 'tenant'
  and role.is_system
  and permission.permission_code <> 'contracts.manage';

insert into public.role_permissions (role_id, permission_code)
select role.id, 'contracts.manage'
from public.roles role
where role.tenant_id is not null
  and role.name = 'Verträge'
  and role.scope = 'tenant'
  and role.is_system
on conflict (role_id, permission_code) do nothing;

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (
    char_length(btrim(title)) between 3 and 240
    and title = btrim(title)
    and title !~ '[[:cntrl:]]'
  ),
  counterparty_name text not null check (
    char_length(btrim(counterparty_name)) between 2 and 160
    and counterparty_name = btrim(counterparty_name)
    and counterparty_name !~ '[[:cntrl:]]'
  ),
  reference_number text check (
    reference_number is null or (
      char_length(btrim(reference_number)) between 1 and 120
      and reference_number = btrim(reference_number)
      and reference_number !~ '[[:cntrl:]]'
    )
  ),
  contract_type text not null default 'service'
    check (contract_type in ('service', 'license', 'maintenance', 'lease', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'terminated', 'archived')),
  starts_on date,
  ends_on date,
  notice_period_days integer check (notice_period_days between 0 and 3650),
  responsible_user_id uuid references public.user_profiles(id) on delete set null,
  notes text check (
    notes is null or (
      char_length(btrim(notes)) <= 2000
      and notes = btrim(notes)
      and notes !~ '[[:cntrl:]]'
    )
  ),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  archived_by uuid references public.user_profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contracts_id_tenant_unique unique (id, tenant_id),
  constraint contracts_end_after_start check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint contracts_archive_metadata check (
    (status = 'archived' and archived_at is not null and archived_by is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null)
  )
);

create unique index contracts_tenant_reference_unique
  on public.contracts (tenant_id, reference_number)
  where reference_number is not null;
create index contracts_tenant_status_end_idx
  on public.contracts (tenant_id, status, ends_on);
create index contracts_tenant_responsible_idx
  on public.contracts (tenant_id, responsible_user_id)
  where responsible_user_id is not null;

create or replace function public.validate_contract_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'contracts' then
    raise exception 'Invalid contract trigger target' using errcode = '22023';
  end if;
  if new.responsible_user_id is not null and not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.responsible_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Contract responsible user must be an active tenant member' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is null or new.updated_by is null or new.created_by <> new.updated_by then
      raise exception 'Contract actor is required' using errcode = '22023';
    end if;
    if new.status not in ('draft', 'active') then
      raise exception 'Contract must start as draft or active' using errcode = '22023';
    end if;
  else
    if new.id <> old.id
      or new.tenant_id <> old.tenant_id
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'Immutable contract identity changed' using errcode = '22023';
    end if;
    if old.status = 'archived' then
      raise exception 'Archived contracts are terminal' using errcode = '22023';
    end if;
    if not (
      new.status = old.status
      or (old.status = 'draft' and new.status in ('active', 'archived'))
      or (old.status = 'active' and new.status in ('terminated', 'archived'))
      or (old.status = 'terminated' and new.status = 'archived')
    ) then
      raise exception 'Invalid contract status transition' using errcode = '22023';
    end if;
  end if;

  if new.status = 'archived' then
    if new.archived_by is null then
      new.archived_by := new.updated_by;
    end if;
    if new.archived_by <> new.updated_by then
      raise exception 'Archive actor must match update actor' using errcode = '22023';
    end if;
    if new.archived_at is null then
      new.archived_at := timezone('utc', now());
    end if;
  else
    new.archived_by := null;
    new.archived_at := null;
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.audit_contract_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.contracts%rowtype;
  v_previous_status text;
begin
  v_row := coalesce(new, old);
  v_previous_status := case when tg_op = 'INSERT' then null else old.status end;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    v_row.tenant_id,
    coalesce(new.updated_by, old.updated_by),
    'contract.' || lower(tg_op),
    'contract',
    v_row.id,
    'info',
    jsonb_build_object(
      'operation', tg_op,
      'previous_status', v_previous_status,
      'next_status', v_row.status,
      'archived', v_row.status = 'archived'
    )
  );
  return null;
end;
$$;
revoke all on function public.validate_contract_change() from public, anon, authenticated;
revoke all on function public.audit_contract_change() from public, anon, authenticated;

drop trigger if exists contracts_validate_change on public.contracts;
create trigger contracts_validate_change
  before insert or update on public.contracts
  for each row execute function public.validate_contract_change();
drop trigger if exists contracts_audit_changes on public.contracts;
create trigger contracts_audit_changes
  after insert or update on public.contracts
  for each row execute function public.audit_contract_change();

alter table public.contracts enable row level security;
revoke all on table public.contracts from public, anon, authenticated, service_role;
grant select, insert, update on table public.contracts to service_role;

comment on table public.contracts is
  'Tenant-isolated contract metadata. Browser roles use the contracts Edge Function; no contract files, payment data or automatic lifecycle changes are stored here.';

commit;
