begin;

-- Requesters may publish an external answer only through the ticket-operations
-- ownership check. This capability deliberately does not grant department-level
-- ticket.comment.external access.
insert into public.permissions (code, description, is_sensitive)
values ('ticket.comment.external.own', 'External comment on own requester ticket', false)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_code)
select role.id, 'ticket.comment.external.own'
from public.roles as role
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Requester'
on conflict (role_id, permission_code) do nothing;

-- Apply the same least-privilege default to Requester roles created for future
-- tenants without changing the existing tenant provisioning function again.
create or replace function public.grant_default_requester_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Requester' then
    insert into public.role_permissions (role_id, permission_code)
    values (new.id, 'ticket.comment.external.own')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_requester_permissions() from public;

drop trigger if exists roles_grant_default_requester_permissions on public.roles;
create trigger roles_grant_default_requester_permissions
  after insert on public.roles
  for each row execute function public.grant_default_requester_permissions();

commit;
