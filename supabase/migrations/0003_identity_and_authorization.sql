begin;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'de-CH',
  timezone text not null default 'Europe/Zurich',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  status public.membership_status not null default 'invited',
  joined_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, user_id)
);
create index tenant_memberships_user_idx on public.tenant_memberships (user_id, tenant_id) where status = 'active';

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  name text not null,
  kind text not null default 'custom' check (kind in ('ict', 'infrastructure', 'custom')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, key)
);

create table public.department_memberships (
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (department_id, user_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, name)
);

create table public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (team_id, user_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  scope public.role_scope not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique nulls not distinct (tenant_id, name)
);

create table public.permissions (
  code text primary key,
  description text not null,
  is_sensitive boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete restrict,
  primary key (role_id, permission_code)
);

create table public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  starts_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  assigned_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check (expires_at is null or expires_at > starts_at)
);
create index user_role_assignments_authorize_idx on public.user_role_assignments (user_id, tenant_id, starts_at, expires_at);

create table public.customer_organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  ticket_access public.customer_ticket_access not null default 'disabled',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, name)
);

create table public.customer_memberships (
  customer_organization_id uuid not null references public.customer_organizations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  access public.customer_ticket_access not null default 'own' check (access in ('own', 'company')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (customer_organization_id, user_id)
);

create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger tenant_memberships_updated_at before update on public.tenant_memberships for each row execute function public.set_updated_at();
create trigger departments_updated_at before update on public.departments for each row execute function public.set_updated_at();
create trigger department_memberships_updated_at before update on public.department_memberships for each row execute function public.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger roles_updated_at before update on public.roles for each row execute function public.set_updated_at();
create trigger customer_organizations_updated_at before update on public.customer_organizations for each row execute function public.set_updated_at();

commit;
