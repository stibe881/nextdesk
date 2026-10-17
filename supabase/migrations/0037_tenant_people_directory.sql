begin;

-- Employee attributes are tenant-scoped. A person can therefore belong to more
-- than one nextDesk tenant without exposing a customer-specific function or
-- department to another tenant.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.departments'::regclass
      and conname = 'departments_id_tenant_key'
  ) then
    alter table public.departments
      add constraint departments_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

alter table public.tenant_user_invitations
  add column if not exists display_name text,
  add column if not exists job_title text,
  add column if not exists offer text,
  add column if not exists department_id uuid,
  add column if not exists wants_agent boolean not null default false;

alter table public.tenant_user_invitations
  drop constraint if exists tenant_user_invitations_department_tenant_fkey,
  add constraint tenant_user_invitations_department_tenant_fkey
    foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id)
    on delete restrict,
  drop constraint if exists tenant_user_invitations_wants_agent_department_check,
  add constraint tenant_user_invitations_wants_agent_department_check
    check (not wants_agent or department_id is not null),
  drop constraint if exists tenant_user_invitations_display_name_length_check,
  add constraint tenant_user_invitations_display_name_length_check
    check (display_name is null or char_length(btrim(display_name)) between 2 and 160),
  drop constraint if exists tenant_user_invitations_job_title_length_check,
  add constraint tenant_user_invitations_job_title_length_check
    check (job_title is null or char_length(btrim(job_title)) between 2 and 160),
  drop constraint if exists tenant_user_invitations_offer_length_check,
  add constraint tenant_user_invitations_offer_length_check
    check (offer is null or char_length(btrim(offer)) between 2 and 160);

create table if not exists public.tenant_member_directory (
  tenant_id uuid not null,
  user_id uuid not null,
  department_id uuid,
  job_title text,
  offer text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id),
  constraint tenant_member_directory_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint tenant_member_directory_department_tenant_fkey
    foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id)
    on delete restrict,
  constraint tenant_member_directory_job_title_length_check
    check (job_title is null or char_length(btrim(job_title)) between 2 and 160),
  constraint tenant_member_directory_offer_length_check
    check (offer is null or char_length(btrim(offer)) between 2 and 160)
);

create index if not exists tenant_member_directory_department_idx
  on public.tenant_member_directory (tenant_id, department_id)
  where department_id is not null;

create trigger tenant_member_directory_updated_at
  before update on public.tenant_member_directory
  for each row execute function public.set_updated_at();

alter table public.tenant_member_directory enable row level security;
revoke all on table public.tenant_member_directory from anon, authenticated;
grant select, insert, update, delete on table public.tenant_member_directory to service_role;

grant select, insert, update, delete on table public.tenant_user_invitations to service_role;

comment on table public.tenant_member_directory is
  'Private, tenant-scoped employee directory metadata. It is read and written only through audited tenant-administration Edge Functions.';
comment on column public.tenant_user_invitations.wants_agent is
  'Preselected support-agent access applied only after an invited employee has joined the tenant.';

commit;
