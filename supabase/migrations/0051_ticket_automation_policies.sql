begin;

create table if not exists public.tenant_automation_policies (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_key text not null check (policy_key in (
    'follow_up', 'auto_close', 'duplicate_warning', 'data_hygiene',
    'quality_check', 'compliance_warning', 'operations_report'
  )),
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, policy_key)
);

create table if not exists public.tenant_automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_key text not null check (policy_key in (
    'follow_up', 'auto_close', 'duplicate_warning', 'data_hygiene',
    'quality_check', 'compliance_warning', 'operations_report'
  )),
  initiated_by uuid references public.user_profiles(id) on delete set null,
  mode text not null check (mode in ('preview', 'scheduled')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists tenant_automation_runs_tenant_created_idx
  on public.tenant_automation_runs (tenant_id, created_at desc);

alter table public.tenant_automation_policies enable row level security;
alter table public.tenant_automation_runs enable row level security;

-- Automation policies are deliberately mediated through the audited Edge API.
-- No direct browser policy permits are added here.
revoke all on table public.tenant_automation_policies from anon, authenticated;
revoke all on table public.tenant_automation_runs from anon, authenticated;

do $$
declare
  policy_entry record;
begin
  for policy_entry in
    select * from (values
      ('follow_up', '{"afterDays":3}'::jsonb),
      ('auto_close', '{"afterDays":14,"requirePreview":true}'::jsonb),
      ('duplicate_warning', '{"afterDays":30}'::jsonb),
      ('data_hygiene', '{"afterDays":7}'::jsonb),
      ('quality_check', '{"afterDays":7}'::jsonb),
      ('compliance_warning', '{"afterDays":1}'::jsonb),
      ('operations_report', '{"afterDays":30}'::jsonb)
    ) as defaults(policy_key, configuration)
  loop
    insert into public.tenant_automation_policies (tenant_id, policy_key, configuration)
    select tenant.id, policy_entry.policy_key, policy_entry.configuration
    from public.tenants tenant
    on conflict (tenant_id, policy_key) do nothing;
  end loop;
end $$;

create or replace function public.create_default_automation_policies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_automation_policies (tenant_id, policy_key, configuration)
  values
    (new.id, 'follow_up', '{"afterDays":3}'::jsonb),
    (new.id, 'auto_close', '{"afterDays":14,"requirePreview":true}'::jsonb),
    (new.id, 'duplicate_warning', '{"afterDays":30}'::jsonb),
    (new.id, 'data_hygiene', '{"afterDays":7}'::jsonb),
    (new.id, 'quality_check', '{"afterDays":7}'::jsonb),
    (new.id, 'compliance_warning', '{"afterDays":1}'::jsonb),
    (new.id, 'operations_report', '{"afterDays":30}'::jsonb)
  on conflict (tenant_id, policy_key) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_create_default_automation_policies on public.tenants;
create trigger tenants_create_default_automation_policies
after insert on public.tenants
for each row execute function public.create_default_automation_policies();

commit;
