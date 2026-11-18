begin;

set local search_path = pg_catalog, public;

-- «Ausbuchen»: taking stock out of the warehouse by hand (movement «issue»
-- without a reservation) needs its own permission. Receipts, transfers and
-- issues of reservations (shop hand-outs) stay with «inventory.move».
-- The Edge Function inventory enforces the split; the database function
-- post_inventory_movement keeps requiring «inventory.move» as well.
insert into public.permissions (code, description, is_sensitive)
values ('inventory.issue', 'Bestände von Hand ausbuchen (Entnahme aus dem Lager)', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

-- «inventory.move» no longer covers taking stock out by hand.
update public.permissions
set description = 'Wareneingänge, Umbuchungen und Reservierungen buchen (inkl. Ausgabe reservierter Artikel)'
where code = 'inventory.move';

-- The tenant administrator keeps every inventory capability.
insert into public.role_permissions (role_id, permission_code)
select role.id, 'inventory.issue'
from public.roles as role
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_inventory_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values
      (new.id, 'inventory.read'),
      (new.id, 'inventory.manage'),
      (new.id, 'inventory.move'),
      (new.id, 'inventory.issue'),
      (new.id, 'inventory.adjust'),
      (new.id, 'inventory.count.close')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_inventory_permissions() from public, anon, authenticated;

-- System role «Lagerverwaltung»: agents who may also book stock out.
-- It carries exactly read, receipt/transfer and issue; administrators assign
-- it to people under Rollen und Rechte.
create or replace function public.seed_inventory_issue_system_role(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role_id uuid;
begin
  insert into public.roles (tenant_id, name, scope, is_system, active)
  values (p_tenant_id, 'Lagerverwaltung', 'tenant', true, true)
  on conflict (tenant_id, name) do update
    set scope = 'tenant',
        is_system = true,
        active = true
  returning id into v_role_id;

  delete from public.role_permissions permission
  where permission.role_id = v_role_id
    and permission.permission_code not in ('inventory.read', 'inventory.move', 'inventory.issue');

  insert into public.role_permissions (role_id, permission_code)
  values
    (v_role_id, 'inventory.read'),
    (v_role_id, 'inventory.move'),
    (v_role_id, 'inventory.issue')
  on conflict (role_id, permission_code) do nothing;
end;
$$;
revoke all on function public.seed_inventory_issue_system_role(uuid) from public, anon, authenticated;

create or replace function public.seed_inventory_issue_system_role_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.seed_inventory_issue_system_role(new.id);
  return new;
end;
$$;
revoke all on function public.seed_inventory_issue_system_role_for_tenant() from public, anon, authenticated;

drop trigger if exists tenants_seed_inventory_issue_system_role on public.tenants;
create trigger tenants_seed_inventory_issue_system_role
  after insert on public.tenants
  for each row execute function public.seed_inventory_issue_system_role_for_tenant();

-- Never turn an existing custom role with that name into a privileged system
-- role: its members must not gain rights implicitly. Keep it under a clear name.
update public.roles role
set name = format('Lagerverwaltung (bestehend %s)', role.id::text)
where role.tenant_id is not null
  and role.name = 'Lagerverwaltung'
  and (role.scope <> 'tenant' or not role.is_system);

select public.seed_inventory_issue_system_role(tenant.id)
from public.tenants tenant;

commit;
