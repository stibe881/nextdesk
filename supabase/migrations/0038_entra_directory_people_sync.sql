begin;

-- The tenant-owned connection holds only the Entra directory identifier and
-- operational status. The Graph application secret remains an Edge Function
-- secret and never enters tenant-visible data.
create table public.tenant_entra_directory_sync_configurations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  entra_tenant_id uuid not null,
  enabled boolean not null default false,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tenant_entra_directory_sync_status_check
    check (last_sync_status is null or last_sync_status in ('success', 'failed', 'running')),
  constraint tenant_entra_directory_sync_error_length_check
    check (last_sync_error is null or char_length(last_sync_error) <= 500)
);

create trigger tenant_entra_directory_sync_configurations_updated_at
before update on public.tenant_entra_directory_sync_configurations
for each row execute function public.set_updated_at();

-- Records from Microsoft Graph may exist before a person has logged in to
-- nextDesk. Linking them to a local user happens only after verified Entra SSO.
create table public.tenant_entra_directory_people (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entra_object_id uuid not null,
  email text not null,
  display_name text not null,
  job_title text,
  source_department_name text,
  account_enabled boolean not null default true,
  local_user_id uuid references public.user_profiles(id) on delete set null,
  agent_requested boolean not null default false,
  agent_department_id uuid,
  last_synced_at timestamptz not null default timezone('utc', now()),
  inactive_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, entra_object_id),
  unique (tenant_id, email),
  constraint tenant_entra_directory_people_email_valid
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint tenant_entra_directory_people_display_name_length
    check (char_length(btrim(display_name)) between 2 and 160),
  constraint tenant_entra_directory_people_job_title_length
    check (job_title is null or char_length(btrim(job_title)) between 2 and 160),
  constraint tenant_entra_directory_people_department_name_length
    check (source_department_name is null or char_length(btrim(source_department_name)) between 2 and 160),
  constraint tenant_entra_directory_people_agent_department_fkey
    foreign key (agent_department_id, tenant_id)
    references public.departments (id, tenant_id)
    on delete restrict,
  constraint tenant_entra_directory_people_agent_department_check
    check (not agent_requested or agent_department_id is not null)
);

create index tenant_entra_directory_people_active_idx
  on public.tenant_entra_directory_people (tenant_id, account_enabled, inactive_at, display_name);
create index tenant_entra_directory_people_local_user_idx
  on public.tenant_entra_directory_people (tenant_id, local_user_id)
  where local_user_id is not null;

create trigger tenant_entra_directory_people_updated_at
before update on public.tenant_entra_directory_people
for each row execute function public.set_updated_at();

alter table public.tenant_entra_directory_sync_configurations enable row level security;
alter table public.tenant_entra_directory_people enable row level security;
revoke all on table public.tenant_entra_directory_sync_configurations from public, anon, authenticated;
revoke all on table public.tenant_entra_directory_people from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_entra_directory_sync_configurations to service_role;
grant select, insert, update, delete on table public.tenant_entra_directory_people to service_role;

comment on table public.tenant_entra_directory_sync_configurations is
  'Private, tenant-scoped Microsoft Graph directory synchronization configuration. Graph credentials are Edge Function secrets.';
comment on table public.tenant_entra_directory_people is
  'Private, tenant-scoped people mirrored from Microsoft Entra before first nextDesk sign-in. No record grants tickets or agent permissions by itself.';
comment on column public.tenant_entra_directory_people.agent_requested is
  'A tenant administrator may preselect support-agent access. It becomes an effective role only after the person has verified Entra SSO and joins the tenant.';

commit;
