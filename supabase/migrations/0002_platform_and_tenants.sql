begin;

create table public.platform_settings (
  id boolean primary key default true check (id),
  product_name text not null default 'TicketHub',
  support_access_max_minutes integer not null default 60 check (support_access_max_minutes between 5 and 480),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  mfa_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text,
  target_type text,
  target_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now())
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  name text not null check (char_length(name) between 2 and 160),
  status public.tenant_status not null default 'active',
  timezone text not null default 'Europe/Zurich',
  default_locale text not null default 'de-CH',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname citext not null unique,
  is_primary boolean not null default false,
  status public.domain_status not null default 'pending',
  verification_token_hash text,
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint verified_domain_requires_timestamp check (status <> 'verified' or verified_at is not null)
);
create unique index tenant_domains_one_primary_per_tenant on public.tenant_domains (tenant_id) where is_primary;

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  portal_name text not null,
  support_email text,
  ticket_access_enabled boolean not null default true,
  allow_external_ticket_access boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  logo_path text,
  favicon_path text,
  primary_color text not null default '#2563EB',
  secondary_color text not null default '#0F172A',
  accent_color text not null default '#14B8A6',
  login_background_path text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.tenant_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, feature_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid,
  severity public.audit_severity not null default 'info',
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now())
);
create index audit_logs_tenant_time_idx on public.audit_logs (tenant_id, occurred_at desc);

create trigger platform_settings_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();
create trigger platform_administrators_updated_at before update on public.platform_administrators for each row execute function public.set_updated_at();
create trigger tenants_updated_at before update on public.tenants for each row execute function public.set_updated_at();
create trigger tenant_domains_updated_at before update on public.tenant_domains for each row execute function public.set_updated_at();
create trigger tenant_settings_updated_at before update on public.tenant_settings for each row execute function public.set_updated_at();
create trigger tenant_branding_updated_at before update on public.tenant_branding for each row execute function public.set_updated_at();

commit;
