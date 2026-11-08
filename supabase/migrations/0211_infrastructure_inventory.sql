begin;

set local search_path = pg_catalog, public;

-- Infrastruktur: network and server hardware (access points, switches,
-- servers, firewalls, …) as assets with technical and lifecycle details.
-- The device itself stays an asset (name, serial, manufacturer, model,
-- location, lifecycle state and history, QR scan, ticket links); this table
-- adds what infrastructure needs.

create table if not exists public.asset_infrastructure (
  asset_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null check (category in (
    'server', 'switch', 'access_point', 'firewall', 'router', 'storage',
    'ups', 'virtual_host', 'other'
  )),
  hostname text check (hostname is null or char_length(hostname) <= 253),
  ip_address text check (ip_address is null or char_length(ip_address) <= 64),
  mac_address text check (mac_address is null or char_length(mac_address) <= 32),
  firmware_version text check (firmware_version is null or char_length(firmware_version) <= 120),
  rack text check (rack is null or char_length(rack) <= 80),
  rack_unit text check (rack_unit is null or char_length(rack_unit) <= 20),
  uplink_asset_id uuid,
  uplink_port text check (uplink_port is null or char_length(uplink_port) <= 40),
  purchase_date date,
  purchase_price numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  supplier text check (supplier is null or char_length(supplier) <= 160),
  warranty_until date,
  support_until date,
  end_of_life date,
  planned_replacement date,
  criticality text not null default 'medium'
    check (criticality in ('low', 'medium', 'high', 'critical')),
  maintenance_interval_months integer
    check (maintenance_interval_months is null or maintenance_interval_months between 1 and 120),
  last_maintenance_on date,
  notes text check (notes is null or char_length(notes) <= 4000),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint asset_infrastructure_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint asset_infrastructure_uplink_fk foreign key (uplink_asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete set null (uplink_asset_id),
  constraint asset_infrastructure_not_own_uplink check (uplink_asset_id is distinct from asset_id)
);
create index if not exists asset_infrastructure_tenant_idx
  on public.asset_infrastructure (tenant_id, category);
create index if not exists asset_infrastructure_uplink_idx
  on public.asset_infrastructure (tenant_id, uplink_asset_id)
  where uplink_asset_id is not null;

create table if not exists public.asset_maintenance_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  performed_on date not null,
  kind text not null default 'maintenance'
    check (kind in ('maintenance', 'firmware', 'repair', 'inspection', 'other')),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint asset_maintenance_log_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists asset_maintenance_log_asset_idx
  on public.asset_maintenance_log (tenant_id, asset_id, performed_on desc);

alter table public.asset_infrastructure enable row level security;
alter table public.asset_maintenance_log enable row level security;
revoke all on table public.asset_infrastructure, public.asset_maintenance_log
  from public, anon, authenticated;
grant all on table public.asset_infrastructure, public.asset_maintenance_log to service_role;

-- Reminders for warranty, vendor support, end of life and maintenance that
-- are due within 30 days (once per date and asset).
create table if not exists public.infrastructure_due_notices (
  asset_id uuid not null,
  reason text not null check (reason in ('warranty', 'support', 'end_of_life', 'maintenance')),
  due_on date not null,
  sent_at timestamptz not null default timezone('utc', now()),
  primary key (asset_id, reason, due_on)
);
alter table public.infrastructure_due_notices enable row level security;
revoke all on table public.infrastructure_due_notices from public, anon, authenticated;

create or replace function public.infrastructure_send_due_notices()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_due record;
  v_recipient uuid;
  v_count integer := 0;
begin
  for v_due in
    with dates as (
      select infra.tenant_id, infra.asset_id, asset.name, 'warranty'::text as reason,
             infra.warranty_until as due_on
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id
      where asset.lifecycle_state in ('stock', 'active', 'repair')
      union all
      select infra.tenant_id, infra.asset_id, asset.name, 'support', infra.support_until
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id
      where asset.lifecycle_state in ('stock', 'active', 'repair')
      union all
      select infra.tenant_id, infra.asset_id, asset.name, 'end_of_life', infra.end_of_life
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id
      where asset.lifecycle_state in ('stock', 'active', 'repair')
      union all
      select infra.tenant_id, infra.asset_id, asset.name, 'maintenance',
             (coalesce(infra.last_maintenance_on, infra.purchase_date, current_date)
               + make_interval(months => infra.maintenance_interval_months))::date
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id
      where asset.lifecycle_state = 'active' and infra.maintenance_interval_months is not null
    )
    select dates.*
    from dates
    where dates.due_on is not null
      and dates.due_on <= current_date + 30
      and dates.due_on >= current_date - 365
      and not exists (
        select 1 from public.infrastructure_due_notices notice
        where notice.asset_id = dates.asset_id
          and notice.reason = dates.reason
          and notice.due_on = dates.due_on
      )
    limit 500
  loop
    insert into public.infrastructure_due_notices (asset_id, reason, due_on)
    values (v_due.asset_id, v_due.reason, v_due.due_on)
    on conflict do nothing;
    for v_recipient in
      select distinct assignment.user_id
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id and role.active
      join public.role_permissions permission
        on permission.role_id = role.id and permission.permission_code = 'asset.manage'
      join public.tenant_memberships membership
        on membership.tenant_id = assignment.tenant_id
       and membership.user_id = assignment.user_id
       and membership.status = 'active'
      where assignment.tenant_id = v_due.tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_due.tenant_id, v_recipient, null, 'infrastructure.due',
        jsonb_build_object(
          'assetId', v_due.asset_id,
          'assetName', v_due.name,
          'reason', v_due.reason,
          'dueOn', v_due.due_on
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.infrastructure_send_due_notices() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-infrastructure-due'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-infrastructure-due',
    '17 5 * * *',
    'select public.infrastructure_send_due_notices();'
  );
exception when others then
  null;
end;
$$;

commit;
