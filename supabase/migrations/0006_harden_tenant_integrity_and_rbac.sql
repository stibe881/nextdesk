begin;

-- Every cross-tenant reference is constrained at the database boundary.
alter table public.departments add constraint departments_id_tenant_unique unique (id, tenant_id);
alter table public.teams add constraint teams_id_tenant_unique unique (id, tenant_id);
alter table public.roles add constraint roles_id_tenant_unique unique (id, tenant_id);
alter table public.ticket_statuses add constraint ticket_statuses_id_tenant_unique unique (id, tenant_id);
alter table public.ticket_priorities add constraint ticket_priorities_id_tenant_unique unique (id, tenant_id);
alter table public.ticket_categories add constraint ticket_categories_id_tenant_department_unique unique (id, tenant_id, department_id);

alter table public.roles
  add constraint roles_scope_tenant_consistency
  check (
    (scope = 'platform' and tenant_id is null)
    or (scope <> 'platform' and tenant_id is not null)
  );

alter table public.department_memberships add column tenant_id uuid;
update public.department_memberships membership
set tenant_id = department.tenant_id
from public.departments department
where department.id = membership.department_id;
alter table public.department_memberships alter column tenant_id set not null;
alter table public.department_memberships
  add constraint department_memberships_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete cascade;

alter table public.user_role_assignments
  add constraint user_role_assignments_role_tenant_fk
  foreign key (role_id, tenant_id)
  references public.roles (id, tenant_id)
  on delete cascade;
alter table public.user_role_assignments
  add constraint user_role_assignments_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete cascade;
alter table public.user_role_assignments
  add constraint user_role_assignments_team_tenant_fk
  foreign key (team_id, tenant_id)
  references public.teams (id, tenant_id)
  on delete cascade;

alter table public.tickets
  add constraint tickets_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete restrict;
alter table public.tickets
  add constraint tickets_status_tenant_fk
  foreign key (status_id, tenant_id)
  references public.ticket_statuses (id, tenant_id)
  on delete restrict;
alter table public.tickets
  add constraint tickets_priority_tenant_fk
  foreign key (priority_id, tenant_id)
  references public.ticket_priorities (id, tenant_id)
  on delete restrict;
alter table public.tickets
  add constraint tickets_category_department_tenant_fk
  foreign key (category_id, tenant_id, department_id)
  references public.ticket_categories (id, tenant_id, department_id)
  on delete restrict;
alter table public.tickets
  add constraint tickets_assigned_team_tenant_fk
  foreign key (assigned_team_id, tenant_id)
  references public.teams (id, tenant_id)
  on delete set null;

alter table public.teams
  add constraint teams_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete restrict;
alter table public.ticket_categories
  add constraint ticket_categories_parent_department_tenant_fk
  foreign key (parent_id, tenant_id, department_id)
  references public.ticket_categories (id, tenant_id, department_id)
  on delete restrict;
alter table public.ticket_number_sequences
  add constraint ticket_number_sequences_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete cascade;

create or replace function public.validate_role_assignment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_scope public.role_scope;
begin
  select scope into assigned_scope from public.roles where id = new.role_id and tenant_id = new.tenant_id;

  if assigned_scope is null or assigned_scope = 'platform' then
    raise exception 'Role must belong to the assignment tenant and must not be a platform role';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.user_id
      and membership.status = 'active'
  ) then
    raise exception 'A role can only be assigned to an active tenant member';
  end if;

  if assigned_scope = 'tenant' and (new.department_id is not null or new.team_id is not null) then
    raise exception 'Tenant role assignments may not contain a department or team scope';
  end if;

  if assigned_scope = 'department' and (new.department_id is null or new.team_id is not null) then
    raise exception 'Department role assignments require exactly a department scope';
  end if;

  if assigned_scope = 'team' and new.team_id is null then
    raise exception 'Team role assignments require a team scope';
  end if;

  return new;
end;
$$;

create trigger user_role_assignments_validate_scope
before insert or update on public.user_role_assignments
for each row execute function public.validate_role_assignment_scope();

-- Permission catalogue must be present before role bindings are possible.
insert into public.permissions (code, description, is_sensitive) values
  ('ticket.create', 'Create a ticket in an authorized tenant.', false),
  ('ticket.read.own', 'Read own or affected tickets.', false),
  ('ticket.read.assigned', 'Read tickets assigned to the current agent.', false),
  ('ticket.read.department', 'Read tickets in an authorized department.', false),
  ('ticket.update', 'Update an authorized ticket.', false),
  ('ticket.assign', 'Assign an authorized ticket.', false),
  ('ticket.close', 'Close an authorized ticket.', false),
  ('ticket.delete', 'Delete an authorized ticket.', true),
  ('ticket.merge', 'Merge or split an authorized ticket.', true),
  ('ticket.export', 'Export authorized ticket data.', true),
  ('ticket.internal_notes.read', 'Read internal ticket notes.', false),
  ('ticket.internal_notes.write', 'Write internal ticket notes.', false),
  ('department.manage', 'Manage departments.', true),
  ('team.manage', 'Manage teams.', true),
  ('user.manage', 'Manage tenant users.', true),
  ('role.manage', 'Manage tenant roles.', true),
  ('report.read', 'Read reports.', false),
  ('automation.manage', 'Manage automations.', true),
  ('knowledge.manage', 'Manage knowledge articles.', true),
  ('asset.manage', 'Manage assets.', true),
  ('tenant.settings.manage', 'Manage tenant settings.', true),
  ('platform.tenants.manage', 'Manage platform tenants.', true),
  ('platform.support_access.request', 'Request audited platform support access.', true)
on conflict (code) do update
  set description = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- RLS is enabled on every non-public core table. Tables without a policy are intentionally API-inaccessible.
alter table public.platform_settings enable row level security;
alter table public.platform_administrators enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.tenant_features enable row level security;
alter table public.audit_logs enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_role_assignments enable row level security;
alter table public.customer_organizations enable row level security;
alter table public.customer_memberships enable row level security;
alter table public.ticket_statuses enable row level security;
alter table public.ticket_priorities enable row level security;
alter table public.ticket_categories enable row level security;
alter table public.ticket_number_sequences enable row level security;

revoke all on table public.platform_settings, public.platform_administrators, public.platform_audit_logs from anon, authenticated;
revoke all on table public.audit_logs, public.roles, public.permissions, public.role_permissions, public.user_role_assignments from anon, authenticated;
revoke all on table public.ticket_number_sequences from anon, authenticated;
revoke execute on function public.reserve_ticket_number(uuid, uuid, text, integer) from public, anon, authenticated;

create or replace function public.has_tenant_permission(
  p_tenant_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope = 'tenant'
      join public.role_permissions role_permission on role_permission.role_id = role.id
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and role_permission.permission_code = p_permission_code
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    );
$$;

create or replace function public.has_ticket_permission(
  p_tenant_id uuid,
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.department_memberships department_membership
      where department_membership.user_id = auth.uid()
        and department_membership.tenant_id = p_tenant_id
        and department_membership.department_id = p_department_id
        and department_membership.status = 'active'
    )
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
      join public.role_permissions role_permission on role_permission.role_id = role.id
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and role_permission.permission_code = p_permission_code
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and (role.scope = 'tenant' or assignment.department_id = p_department_id)
    );
$$;

create or replace function public.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and public.is_active_tenant_member(ticket.tenant_id)
      and (
        (
          (ticket.requester_id = auth.uid() or ticket.affected_user_id = auth.uid())
          and public.has_tenant_permission(ticket.tenant_id, 'ticket.read.own')
        )
        or (
          ticket.assigned_agent_id = auth.uid()
          and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned')
        )
        or public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
      )
  );
$$;

revoke all on function public.has_tenant_permission(uuid, text) from public;
grant execute on function public.has_tenant_permission(uuid, text) to authenticated;

commit;
