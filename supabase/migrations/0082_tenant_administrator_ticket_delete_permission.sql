begin;

set local search_path = pg_catalog, public;

-- A tenant administrator is the tenant-wide emergency and administration role.
-- Permanent ticket deletion remains guarded by explicit confirmation, active
-- membership, per-ticket authorization and legal hold in bulk_delete_tickets.
-- This migration only makes the already-defined sensitive permission available
-- to the standard system role; it does not grant it to agents or requesters.
insert into public.role_permissions (role_id, permission_code)
select role.id, 'ticket.delete'
from public.roles role
where role.name = 'Tenant administrator'
  and role.scope = 'tenant'
  and role.is_system
  and role.active
on conflict do nothing;

create or replace function public.grant_ticket_delete_to_tenant_administrator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.name = 'Tenant administrator'
    and new.scope = 'tenant'
    and new.is_system
    and new.active then
    insert into public.role_permissions (role_id, permission_code)
    values (new.id, 'ticket.delete')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists roles_grant_ticket_delete_to_tenant_administrator on public.roles;
create trigger roles_grant_ticket_delete_to_tenant_administrator
after insert or update of name, scope, is_system, active on public.roles
for each row execute function public.grant_ticket_delete_to_tenant_administrator();

revoke all on function public.grant_ticket_delete_to_tenant_administrator()
  from public, anon, authenticated;

grant execute on function public.grant_ticket_delete_to_tenant_administrator()
  to service_role;

comment on function public.grant_ticket_delete_to_tenant_administrator() is
  'Keeps the standard active tenant-administrator system role eligible for ticket.delete. The sensitive deletion transaction remains enforced by bulk_delete_tickets.';

commit;
