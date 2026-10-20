begin;

insert into public.permissions (code, description, is_sensitive) values
  ('onboarding.request', 'Eintritte anfragen', false),
  ('onboarding.manage', 'Eintritte und Onboarding-Aufgaben verwalten', false)
on conflict (code) do update
  set description = excluded.description,
      is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_code)
select distinct role.id, 'onboarding.request'
from public.roles role
join public.role_permissions permission
  on permission.role_id = role.id and permission.permission_code = 'ticket.create'
where role.active
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select distinct role.id, grants.permission_code
from public.roles role
join public.role_permissions permission
  on permission.role_id = role.id
cross join lateral (values ('onboarding.request'::text), ('onboarding.manage'::text)) grants(permission_code)
where role.active and permission.permission_code = 'tenant.settings.manage'
on conflict do nothing;

create or replace function public.grant_default_onboarding_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.permission_code = 'ticket.create' then
    insert into public.role_permissions (role_id, permission_code)
    values (new.role_id, 'onboarding.request') on conflict do nothing;
  elsif new.permission_code = 'tenant.settings.manage' then
    insert into public.role_permissions (role_id, permission_code) values
      (new.role_id, 'onboarding.request'), (new.role_id, 'onboarding.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_default_onboarding_permission() from public, anon, authenticated;
drop trigger if exists role_permissions_grant_default_onboarding_permission on public.role_permissions;
create trigger role_permissions_grant_default_onboarding_permission
after insert on public.role_permissions for each row execute function public.grant_default_onboarding_permission();

create or replace function public.has_onboarding_permission(p_tenant_id uuid, p_permission_code text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select p_permission_code in ('onboarding.request', 'onboarding.manage')
    and public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id and role.active
      join public.role_permissions permission on permission.role_id = role.id
        and permission.permission_code = p_permission_code
      where assignment.tenant_id = p_tenant_id
        and assignment.user_id = auth.uid()
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and (role.scope = 'tenant' or exists (
          select 1 from public.department_memberships membership
          where membership.tenant_id = assignment.tenant_id
            and membership.department_id = assignment.department_id
            and membership.user_id = auth.uid() and membership.status = 'active'
        ))
    );
$$;
revoke all on function public.has_onboarding_permission(uuid, text) from public, anon;
grant execute on function public.has_onboarding_permission(uuid, text) to authenticated, service_role;

create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_key text not null check (template_key in ('standard', 'ict', 'schule', 'verwaltung')),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, tenant_id), unique (tenant_id, template_key)
);
create table if not exists public.onboarding_template_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,
  task_key text not null check (char_length(task_key) between 2 and 80),
  title text not null check (char_length(btrim(title)) between 2 and 240),
  position integer not null check (position between 1 and 100),
  due_offset_days integer not null check (due_offset_days between -60 and 90),
  responsibility text not null check (responsibility in ('ict', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (template_id, position), unique (template_id, task_key), unique (id, tenant_id),
  foreign key (template_id, tenant_id) references public.onboarding_templates(id, tenant_id) on delete cascade
);
create table if not exists public.onboarding_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_name text not null check (char_length(btrim(employee_name)) between 2 and 160),
  starts_on date not null check (starts_on between date '2000-01-01' and date '2100-12-31'),
  organisation_unit text not null check (char_length(btrim(organisation_unit)) between 2 and 160),
  location text not null check (char_length(btrim(location)) between 2 and 160),
  manager_user_id uuid not null,
  ict_responsible_user_id uuid not null,
  template_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, tenant_id),
  foreign key (tenant_id, manager_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, ict_responsible_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (template_id, tenant_id) references public.onboarding_templates(id, tenant_id) on delete restrict
);
create table if not exists public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_id uuid not null,
  template_task_id uuid,
  title text not null check (char_length(btrim(title)) between 2 and 240),
  due_on date not null,
  responsible_user_id uuid not null,
  position integer not null check (position between 1 and 100),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entry_id, position), unique (id, tenant_id), unique (id, entry_id, tenant_id),
  foreign key (entry_id, tenant_id) references public.onboarding_entries(id, tenant_id) on delete cascade,
  foreign key (template_task_id, tenant_id) references public.onboarding_template_tasks(id, tenant_id) on delete set null (template_task_id),
  foreign key (tenant_id, responsible_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  check ((status = 'completed' and completed_at is not null) or (status <> 'completed' and completed_at is null))
);
create table if not exists public.onboarding_exception_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_id uuid not null,
  task_id uuid,
  ticket_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id),
  foreign key (entry_id, tenant_id) references public.onboarding_entries(id, tenant_id) on delete cascade,
  foreign key (task_id, entry_id, tenant_id) references public.onboarding_tasks(id, entry_id, tenant_id) on delete set null (task_id),
  foreign key (ticket_id, tenant_id) references public.tickets(id, tenant_id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create index if not exists onboarding_entries_tenant_start_idx on public.onboarding_entries(tenant_id, starts_on, created_at desc);
create index if not exists onboarding_entries_manager_idx on public.onboarding_entries(tenant_id, manager_user_id, starts_on);
create index if not exists onboarding_entries_ict_idx on public.onboarding_entries(tenant_id, ict_responsible_user_id, starts_on);
create index if not exists onboarding_tasks_responsible_idx on public.onboarding_tasks(tenant_id, responsible_user_id, due_on);
create index if not exists onboarding_tasks_entry_idx on public.onboarding_tasks(entry_id, position);
create index if not exists onboarding_exception_tickets_entry_idx on public.onboarding_exception_tickets(tenant_id, entry_id);

create or replace function public.seed_onboarding_templates()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.onboarding_templates (tenant_id, template_key, name) values
    (new.id, 'standard', 'Standard'), (new.id, 'ict', 'ICT'),
    (new.id, 'schule', 'Schule'), (new.id, 'verwaltung', 'Verwaltung')
  on conflict (tenant_id, template_key) do nothing;
  insert into public.onboarding_template_tasks (tenant_id, template_id, task_key, title, position, due_offset_days, responsibility)
  select template.tenant_id, template.id, task.task_key, task.title, task.position, task.offset_days, task.responsibility
  from public.onboarding_templates template
  cross join (values
    ('device', 'Gerät bereitstellen', 10, -7, 'ict'),
    ('account_access', 'Konto und Zugriffe einrichten', 20, -5, 'ict'),
    ('groups_permissions', 'Gruppen und Berechtigungen zuweisen', 30, -4, 'ict'),
    ('workplace', 'Arbeitsplatz vorbereiten', 40, -3, 'manager'),
    ('communications_software', 'Telefonie, E-Mail, Drucker und Software einrichten', 50, -2, 'ict'),
    ('handover', 'Einführung und Übergabe bestätigen', 60, 0, 'manager')
  ) task(task_key, title, position, offset_days, responsibility)
  where template.tenant_id = new.id
  on conflict (template_id, task_key) do nothing;
  insert into public.onboarding_template_tasks (tenant_id, template_id, task_key, title, position, due_offset_days, responsibility)
  select template.tenant_id, template.id, specific.task_key, specific.title, 70, -1, 'ict'
  from public.onboarding_templates template
  join (values
    ('ict'::text, 'intune_admin', 'Intune und ICT-Adminzugriffe vorbereiten'),
    ('schule'::text, 'school_apps', 'Schulische Fachanwendungen vorbereiten'),
    ('verwaltung'::text, 'admin_apps', 'Verwaltungsfachanwendungen vorbereiten')
  ) specific(template_key, task_key, title) on specific.template_key = template.template_key
  where template.tenant_id = new.id
  on conflict (template_id, task_key) do nothing;
  return new;
end;
$$;
revoke all on function public.seed_onboarding_templates() from public, anon, authenticated;
drop trigger if exists onboarding_templates_seed on public.tenants;
create trigger onboarding_templates_seed after insert on public.tenants for each row execute function public.seed_onboarding_templates();
insert into public.onboarding_templates (tenant_id, template_key, name)
select tenant.id, defaults.key, defaults.name from public.tenants tenant
cross join (values ('standard'::text, 'Standard'::text), ('ict','ICT'), ('schule','Schule'), ('verwaltung','Verwaltung')) defaults(key, name)
on conflict (tenant_id, template_key) do nothing;
insert into public.onboarding_template_tasks (tenant_id, template_id, task_key, title, position, due_offset_days, responsibility)
select template.tenant_id, template.id, task.task_key, task.title, task.position, task.offset_days, task.responsibility
from public.onboarding_templates template
cross join (values
  ('device', 'Gerät bereitstellen', 10, -7, 'ict'), ('account_access', 'Konto und Zugriffe einrichten', 20, -5, 'ict'),
  ('groups_permissions', 'Gruppen und Berechtigungen zuweisen', 30, -4, 'ict'), ('workplace', 'Arbeitsplatz vorbereiten', 40, -3, 'manager'),
  ('communications_software', 'Telefonie, E-Mail, Drucker und Software einrichten', 50, -2, 'ict'), ('handover', 'Einführung und Übergabe bestätigen', 60, 0, 'manager')
) task(task_key, title, position, offset_days, responsibility)
on conflict (template_id, task_key) do nothing;
insert into public.onboarding_template_tasks (tenant_id, template_id, task_key, title, position, due_offset_days, responsibility)
select template.tenant_id, template.id, specific.task_key, specific.title, 70, -1, 'ict'
from public.onboarding_templates template
join (values
  ('ict'::text, 'intune_admin', 'Intune und ICT-Adminzugriffe vorbereiten'),
  ('schule'::text, 'school_apps', 'Schulische Fachanwendungen vorbereiten'),
  ('verwaltung'::text, 'admin_apps', 'Verwaltungsfachanwendungen vorbereiten')
) specific(template_key, task_key, title) on specific.template_key = template.template_key
on conflict (template_id, task_key) do nothing;

create or replace function public.create_onboarding_entry(
  p_tenant_id uuid, p_employee_name text, p_starts_on date, p_organisation_unit text,
  p_location text, p_manager_user_id uuid, p_ict_responsible_user_id uuid,
  p_template_id uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry_id uuid; v_task_count integer;
begin
  if not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant_id and user_id = p_actor_id and status = 'active') then
    raise exception 'Onboarding actor is not an active member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.onboarding_templates where id = p_template_id and tenant_id = p_tenant_id and active) then
    raise exception 'Onboarding template unavailable' using errcode = '23503';
  end if;
  if not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant_id and user_id = p_manager_user_id and status = 'active')
    or not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = 'active') then
    raise exception 'Onboarding responsible user unavailable' using errcode = '23503';
  end if;
  select count(*) into v_task_count from public.onboarding_template_tasks where tenant_id = p_tenant_id and template_id = p_template_id and active;
  if v_task_count < 1 then raise exception 'Onboarding template has no tasks' using errcode = 'P0001'; end if;
  insert into public.onboarding_entries(tenant_id, employee_name, starts_on, organisation_unit, location, manager_user_id, ict_responsible_user_id, template_id, created_by)
  values (p_tenant_id, btrim(p_employee_name), p_starts_on, btrim(p_organisation_unit), btrim(p_location), p_manager_user_id, p_ict_responsible_user_id, p_template_id, p_actor_id)
  returning id into v_entry_id;
  insert into public.onboarding_tasks(tenant_id, entry_id, template_task_id, title, due_on, responsible_user_id, position)
  select p_tenant_id, v_entry_id, task.id, task.title, p_starts_on + task.due_offset_days,
    case when task.responsibility = 'manager' then p_manager_user_id else p_ict_responsible_user_id end, task.position
  from public.onboarding_template_tasks task
  where task.tenant_id = p_tenant_id and task.template_id = p_template_id and task.active
  order by task.position;
  insert into public.audit_logs(tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (p_tenant_id, p_actor_id, 'onboarding.entry.created', 'onboarding_entry', v_entry_id, 'info', jsonb_build_object('taskCount', v_task_count));
  return v_entry_id;
end;
$$;
revoke all on function public.create_onboarding_entry(uuid, text, date, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_onboarding_entry(uuid, text, date, text, text, uuid, uuid, uuid, uuid) to service_role;

alter table public.onboarding_templates enable row level security;
alter table public.onboarding_template_tasks enable row level security;
alter table public.onboarding_entries enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.onboarding_exception_tickets enable row level security;
revoke all on table public.onboarding_templates, public.onboarding_template_tasks, public.onboarding_entries, public.onboarding_tasks, public.onboarding_exception_tickets from public, anon, authenticated;
grant all on public.onboarding_templates, public.onboarding_template_tasks, public.onboarding_entries, public.onboarding_tasks, public.onboarding_exception_tickets to service_role;

commit;
