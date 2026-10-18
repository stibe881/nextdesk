begin;

create table if not exists public.tenant_data_retention_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ticket_retention_days integer not null default 730 check (ticket_retention_days between 30 and 3650),
  attachment_retention_days integer not null default 730 check (attachment_retention_days between 30 and 3650),
  audit_retention_days integer not null default 1825 check (audit_retention_days between 365 and 3650),
  legal_hold boolean not null default false,
  deletion_mode text not null default 'manual_review' check (deletion_mode = 'manual_review'),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.tenant_data_retention_policies is
  'Tenant-specific retention targets. They never authorize automatic deletion; each deletion requires a later audited manual-review workflow.';

insert into public.tenant_data_retention_policies (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

create or replace function public.create_default_tenant_data_retention_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_data_retention_policies (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_create_default_data_retention_policy on public.tenants;
create trigger tenants_create_default_data_retention_policy
after insert on public.tenants
for each row execute function public.create_default_tenant_data_retention_policy();

alter table public.tenant_data_retention_policies enable row level security;
revoke all on table public.tenant_data_retention_policies from anon, authenticated;

commit;
