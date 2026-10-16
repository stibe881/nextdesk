begin;

-- Tenant administrators manage local knowledge and SLA configuration.
-- `on conflict` keeps the migration safe for already-configured tenants.
insert into public.role_permissions (role_id, permission_code)
select roles.id, required_permissions.permission_code
from public.roles
cross join (
  values
    ('knowledge.read'::text),
    ('knowledge.manage'::text),
    ('ticket.read.department'::text),
    ('ticket.sla.manage'::text)
) as required_permissions(permission_code)
where roles.scope = 'tenant'
  and roles.active = true
  and roles.name = 'Tenant administrator'
on conflict do nothing;

commit;
