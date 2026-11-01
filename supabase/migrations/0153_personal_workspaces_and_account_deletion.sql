begin;

set local search_path = pg_catalog, public;

-- Personal workspaces
-- -------------------
-- Everyone can register without an existing organisation. A registered person
-- without an active membership creates exactly one personal workspace and can
-- invite team members into it. Personal workspaces are deliberately not
-- connected to an identity provider: SSO, SSO domain routing and the Entra
-- directory sync stay organisation-only features.

alter table public.tenants
  add column if not exists workspace_kind text not null default 'organization',
  add column if not exists owner_user_id uuid references public.user_profiles(id) on delete set null;

alter table public.tenants
  drop constraint if exists tenants_workspace_kind_valid;
alter table public.tenants
  add constraint tenants_workspace_kind_valid
  check (workspace_kind in ('organization', 'personal'));

alter table public.tenants
  drop constraint if exists tenants_personal_workspace_owner_required;
alter table public.tenants
  add constraint tenants_personal_workspace_owner_required
  check (workspace_kind <> 'personal' or owner_user_id is not null or status = 'archived');

-- One personal workspace per person. Additional colleagues join by invitation.
create unique index if not exists tenants_one_personal_workspace_per_owner
  on public.tenants (owner_user_id)
  where workspace_kind = 'personal';

comment on column public.tenants.workspace_kind is
  'organization: provisioned by the platform operator (SSO capable). personal: self-registered workspace of one person and the team members they invite; no SSO.';
comment on column public.tenants.owner_user_id is
  'Owner of a personal workspace. Deleting the owner account deletes the personal workspace.';

-- SSO and directory integration are rejected for personal workspaces even when
-- a service-role code path tries to write them.
create or replace function public.reject_identity_integration_for_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_active boolean := true;
begin
  -- Every tenant receives disabled default rows for SSO and the directory sync.
  -- Only enabling them (or binding an e-mail domain) is rejected.
  if tg_table_name in ('tenant_sso_configurations', 'tenant_entra_directory_sync_configurations') then
    v_active := coalesce((to_jsonb(new) ->> 'enabled')::boolean, false);
  end if;
  if v_active and exists (
    select 1
    from public.tenants tenant
    where tenant.id = new.tenant_id
      and tenant.workspace_kind = 'personal'
  ) then
    raise exception 'Personal workspaces cannot use SSO or directory integration'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_identity_integration_for_personal_workspace()
  from public, anon, authenticated;

drop trigger if exists tenant_sso_configurations_personal_guard on public.tenant_sso_configurations;
create trigger tenant_sso_configurations_personal_guard
  before insert or update on public.tenant_sso_configurations
  for each row execute function public.reject_identity_integration_for_personal_workspace();

drop trigger if exists tenant_sso_allowed_domains_personal_guard on public.tenant_sso_allowed_domains;
create trigger tenant_sso_allowed_domains_personal_guard
  before insert or update on public.tenant_sso_allowed_domains
  for each row execute function public.reject_identity_integration_for_personal_workspace();

drop trigger if exists tenant_entra_directory_sync_personal_guard on public.tenant_entra_directory_sync_configurations;
create trigger tenant_entra_directory_sync_personal_guard
  before insert or update on public.tenant_entra_directory_sync_configurations
  for each row execute function public.reject_identity_integration_for_personal_workspace();

create or replace function public.provision_personal_workspace(
  p_user_id uuid,
  p_email text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_domain text := lower(split_part(coalesce(p_email, ''), '@', 2));
  v_slug text;
  v_department_id uuid;
  v_tenant_admin_role_id uuid;
  v_agent_role_id uuid;
  v_requester_role_id uuid;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown account' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Invalid workspace name' using errcode = '22023';
  end if;

  -- A person who belongs to an organisation that enforces SSO for their e-mail
  -- domain must use that organisation instead of a private workspace.
  if v_domain <> '' and exists (
    select 1
    from public.tenant_sso_allowed_domains domain_binding
    join public.tenant_sso_configurations sso
      on sso.tenant_id = domain_binding.tenant_id
    where domain_binding.domain = v_domain
      and sso.enabled
      and sso.enforce_sso
  ) then
    raise exception 'This e-mail domain belongs to an organisation with SSO'
      using errcode = '42501';
  end if;

  -- Serialise concurrent requests of the same person.
  perform pg_advisory_xact_lock(hashtextextended('personal-workspace:' || p_user_id::text, 0));

  if exists (
    select 1 from public.tenants
    where owner_user_id = p_user_id and workspace_kind = 'personal'
  ) then
    raise exception 'A personal workspace already exists' using errcode = '23505';
  end if;

  v_slug := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  insert into public.user_profiles (id) values (p_user_id)
  on conflict (id) do nothing;

  insert into public.tenants (slug, name, workspace_kind, owner_user_id)
  values (v_slug, v_name, 'personal', p_user_id)
  returning id into v_tenant_id;
  insert into public.tenant_settings (tenant_id, portal_name)
  values (v_tenant_id, left(v_name || ' Support', 160));
  insert into public.tenant_branding (tenant_id) values (v_tenant_id);
  insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
  values (v_tenant_id, p_user_id, 'active', timezone('utc', now()));

  -- The same standard roles as an operator-provisioned organisation. Later
  -- permission triggers on public.roles keep them complete.
  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Tenant administrator', 'tenant', true)
  returning id into v_tenant_admin_role_id;
  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Support agent', 'department', true)
  returning id into v_agent_role_id;
  insert into public.roles (tenant_id, name, scope, is_system)
  values (v_tenant_id, 'Requester', 'tenant', true)
  returning id into v_requester_role_id;

  insert into public.role_permissions (role_id, permission_code)
  select v_tenant_admin_role_id, permission_code
  from unnest(array[
    'ticket.create', 'ticket.read.own', 'ticket.read.department', 'ticket.update', 'ticket.assign',
    'ticket.close', 'ticket.export', 'ticket.internal_notes.read', 'ticket.internal_notes.write',
    'ticket.comment.external', 'department.manage', 'team.manage', 'user.manage', 'role.manage',
    'report.read', 'automation.manage', 'knowledge.manage', 'asset.manage', 'tenant.settings.manage'
  ]::text[]) as permission_code
  on conflict do nothing;
  insert into public.role_permissions (role_id, permission_code)
  select v_agent_role_id, permission_code
  from unnest(array[
    'ticket.read.assigned', 'ticket.read.department', 'ticket.update', 'ticket.assign',
    'ticket.close', 'ticket.internal_notes.read', 'ticket.internal_notes.write', 'ticket.comment.external'
  ]::text[]) as permission_code
  on conflict do nothing;
  insert into public.role_permissions (role_id, permission_code)
  values (v_requester_role_id, 'ticket.create'), (v_requester_role_id, 'ticket.read.own')
  on conflict do nothing;

  insert into public.departments (tenant_id, key, name, kind)
  values (v_tenant_id, 'support', 'Support', 'ict')
  returning id into v_department_id;
  insert into public.department_memberships (department_id, tenant_id, user_id, status)
  values (v_department_id, v_tenant_id, p_user_id, 'active');

  insert into public.user_role_assignments (tenant_id, user_id, role_id, assigned_by)
  values (v_tenant_id, p_user_id, v_tenant_admin_role_id, p_user_id);
  insert into public.user_role_assignments (tenant_id, user_id, role_id, department_id, assigned_by)
  values (v_tenant_id, p_user_id, v_agent_role_id, v_department_id, p_user_id);

  insert into public.platform_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_user_id, 'tenant.personal_workspace_created', 'tenant', v_tenant_id,
    jsonb_build_object('slug', v_slug));

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_personal_workspace(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_personal_workspace(uuid, text, text)
  to service_role;

-- Account deletion
-- ----------------
-- The append-only inventory ledger may only disappear together with the whole
-- personal workspace it belongs to.
create or replace function public.prevent_inventory_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
    and old.tenant_id::text = current_setting('nextdesk.purge_tenant_id', true) then
    return old;
  end if;
  raise exception 'Inventory event ledger is append-only' using errcode = '55000';
end;
$$;

revoke all on function public.prevent_inventory_event_mutation() from public, anon, authenticated;

-- Removes every row of a personal workspace. Tenant tables reference each other
-- with RESTRICT keys, so the function deletes table by table and repeats the
-- tables blocked by a not-yet-deleted dependant until everything is gone.
create or replace function public.purge_personal_workspace(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_table record;
  v_blocked integer;
  v_progress boolean;
  v_pass integer := 0;
  v_count bigint;
  v_last_error text;
begin
  if not exists (
    select 1 from public.tenants
    where id = p_tenant_id and workspace_kind = 'personal'
  ) then
    raise exception 'Only personal workspaces can be purged' using errcode = '42501';
  end if;

  perform set_config('nextdesk.purge_tenant_id', p_tenant_id::text, true);

  loop
    v_pass := v_pass + 1;
    v_blocked := 0;
    v_progress := false;
    for v_table in
      select namespace.nspname, class.relname
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = class.oid
       and attribute.attname = 'tenant_id'
       and not attribute.attisdropped
      where namespace.nspname not like 'pg\_%'
        and namespace.nspname not in (
          'information_schema', 'auth', 'storage', 'realtime', 'extensions',
          'graphql', 'graphql_public', 'vault', 'net', 'cron', 'pgsodium',
          'supabase_functions', 'supabase_migrations'
        )
        and class.relkind in ('r', 'p')
        and not (namespace.nspname = 'public' and class.relname = 'tenants')
      order by namespace.nspname, class.relname
    loop
      begin
        execute format('delete from %I.%I where tenant_id = $1', v_table.nspname, v_table.relname)
          using p_tenant_id;
        get diagnostics v_count = row_count;
        if v_count > 0 then
          v_progress := true;
        end if;
      exception
        when foreign_key_violation or restrict_violation then
          v_blocked := v_blocked + 1;
          v_last_error := v_table.nspname || '.' || v_table.relname || ': ' || sqlerrm;
      end;
    end loop;

    exit when v_blocked = 0;
    if not v_progress or v_pass >= 40 then
      raise exception 'Personal workspace purge is blocked (%)', v_last_error
        using errcode = '55000';
    end if;
  end loop;

  delete from public.tenants where id = p_tenant_id;
  perform set_config('nextdesk.purge_tenant_id', '', true);
end;
$$;

revoke all on function public.purge_personal_workspace(uuid) from public, anon, authenticated;
grant execute on function public.purge_personal_workspace(uuid) to service_role;

-- Deletes the personal data of an account. Returns the personal workspace ids
-- that were removed (so the caller can delete their stored files) and whether
-- the profile itself could be removed. When records in another organisation
-- still reference the person (e.g. tickets they wrote there), the profile is
-- anonymised and all access is removed instead; the caller then anonymises
-- the authentication record.
create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_workspace record;
  v_purged uuid[] := '{}';
  v_profile_deleted boolean := false;
begin
  if p_user_id is null then
    raise exception 'Account required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('personal-workspace:' || p_user_id::text, 0));

  for v_workspace in
    select id from public.tenants
    where owner_user_id = p_user_id and workspace_kind = 'personal'
  loop
    perform public.purge_personal_workspace(v_workspace.id);
    v_purged := v_purged || v_workspace.id;
  end loop;

  begin
    delete from public.user_profiles where id = p_user_id;
    v_profile_deleted := found;
  exception
    when foreign_key_violation or restrict_violation then
      v_profile_deleted := false;
  end;

  if not v_profile_deleted then
    update public.tenant_memberships
       set status = 'removed', updated_at = timezone('utc', now())
     where user_id = p_user_id;
    delete from public.user_role_assignments where user_id = p_user_id;
    delete from public.department_memberships where user_id = p_user_id;
    delete from public.push_devices where user_id = p_user_id;
    delete from public.push_preferences where user_id = p_user_id;
    delete from public.tenant_member_directory where user_id = p_user_id;
    update public.user_profiles
       set display_name = 'Gelöschtes Konto', updated_at = timezone('utc', now())
     where id = p_user_id;
  end if;

  insert into public.platform_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    null,
    'account.deleted',
    'user',
    p_user_id,
    jsonb_build_object(
      'personalWorkspacesDeleted', coalesce(array_length(v_purged, 1), 0),
      'profileDeleted', v_profile_deleted
    )
  );

  return jsonb_build_object(
    'purgedWorkspaceIds', to_jsonb(v_purged),
    'profileDeleted', v_profile_deleted
  );
end;
$$;

revoke all on function public.delete_user_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_account(uuid) to service_role;

commit;
