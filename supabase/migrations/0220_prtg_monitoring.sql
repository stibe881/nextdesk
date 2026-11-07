begin;

set local search_path = pg_catalog, public;

-- Monitoring (PRTG Network Monitor): PRTG notifications call the
-- monitoring-webhook Edge Function («Execute HTTP Action»). A Down/Warning
-- opens one ticket per monitored object, further messages become internal
-- comments, Up resolves the alert (optionally the ticket) and restores the
-- service status. Everything is written by the service role after the
-- webhook token (stored only as SHA-256 hash) has been checked.

create table if not exists public.monitoring_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'prtg' check (provider in ('prtg')),
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_rotated_at timestamptz,
  enabled boolean not null default false,
  department_id uuid references public.departments(id) on delete set null,
  create_on text not null default 'down'
    check (create_on in ('down', 'down_and_warning')),
  auto_resolve boolean not null default false,
  set_service_status boolean not null default false,
  priority_key text check (priority_key is null or char_length(priority_key) between 1 and 64),
  last_received_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_integrations_tenant_unique unique (tenant_id)
);
create unique index if not exists monitoring_integrations_token_hash_idx
  on public.monitoring_integrations (token_hash)
  where token_hash is not null;

create table if not exists public.monitoring_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.monitoring_integrations(id) on delete cascade,
  external_key text not null check (char_length(external_key) between 1 and 300),
  device_name text check (device_name is null or char_length(device_name) <= 300),
  sensor_name text check (sensor_name is null or char_length(sensor_name) <= 300),
  asset_id uuid references public.assets(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  state text not null default 'open' check (state in ('open', 'resolved')),
  last_status text check (last_status is null or char_length(last_status) <= 80),
  last_message text check (last_message is null or char_length(last_message) <= 2000),
  service_status_applied text check (
    service_status_applied is null or service_status_applied in ('degraded', 'partial_outage')
  ),
  event_count integer not null default 1 check (event_count >= 1),
  last_event_at timestamptz not null default timezone('utc', now()),
  last_comment_at timestamptz,
  opened_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
-- At most one open alert per monitored object and tenant.
create unique index if not exists monitoring_alerts_open_key_idx
  on public.monitoring_alerts (tenant_id, external_key)
  where state = 'open';
create index if not exists monitoring_alerts_tenant_recent_idx
  on public.monitoring_alerts (tenant_id, opened_at desc);
create index if not exists monitoring_alerts_service_open_idx
  on public.monitoring_alerts (tenant_id, service_id)
  where state = 'open' and service_id is not null;

-- The single global system identity that authors monitoring tickets and
-- comments (it has a user profile and never a tenant membership).
create table if not exists public.monitoring_service_identity (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.asset_infrastructure
  add column if not exists prtg_object_id text
    check (prtg_object_id is null or prtg_object_id ~ '^[0-9]{1,12}$');
create index if not exists asset_infrastructure_prtg_object_idx
  on public.asset_infrastructure (tenant_id, prtg_object_id)
  where prtg_object_id is not null;

alter table public.monitoring_integrations enable row level security;
alter table public.monitoring_alerts enable row level security;
alter table public.monitoring_service_identity enable row level security;
revoke all on table public.monitoring_integrations, public.monitoring_alerts,
  public.monitoring_service_identity
  from public, anon, authenticated;
grant all on table public.monitoring_integrations,
  public.monitoring_alerts, public.monitoring_service_identity
  to service_role;

create or replace trigger monitoring_integrations_updated_at
  before update on public.monitoring_integrations
  for each row execute function public.set_updated_at();
create or replace trigger monitoring_alerts_updated_at
  before update on public.monitoring_alerts
  for each row execute function public.set_updated_at();

comment on table public.monitoring_integrations is
  'Per-tenant PRTG webhook configuration; the webhook token is stored only as SHA-256 hash. Service role only.';
comment on table public.monitoring_alerts is
  'Monitoring alerts from PRTG with their ticket; one open alert per tenant and monitored object. Service role only.';

commit;
