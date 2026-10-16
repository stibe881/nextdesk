begin;

create table public.feature_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  name text not null check (char_length(name) between 3 and 120),
  description text not null check (char_length(description) between 3 and 500),
  category text not null check (category in ('ticketing', 'automation', 'knowledge', 'reporting', 'integrations', 'assets')),
  default_enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.feature_catalog (key, name, description, category, default_enabled)
values
  ('ticketing.detail', 'Ticketdetail', 'Ticketdetail mit Status, Priorität, Zuweisung und Kommentaren.', 'ticketing', true),
  ('ticketing.checklists', 'Checklisten', 'Checklisten innerhalb eines Tickets.', 'ticketing', true),
  ('ticketing.time-tracking', 'Zeiterfassung', 'Interne und verrechenbare Arbeitszeiterfassung.', 'ticketing', true),
  ('ticketing.templates', 'Ticketvorlagen', 'Wiederverwendbare Vorlagen und Checklisten.', 'ticketing', false),
  ('knowledge.base', 'Wissensdatenbank', 'Mandantenlokale Wissensartikel und Lösungen.', 'knowledge', false),
  ('automation.sla', 'SLA-Automatisierung', 'SLA-Ziele, Eskalationen und Benachrichtigungen.', 'automation', false),
  ('reporting.service', 'Service-Reporting', 'Mandantenbezogene Betriebs- und Qualitätsberichte.', 'reporting', false),
  ('integrations.email', 'E-Mail-to-Ticket', 'Eingehende E-Mails als Tickets verarbeiten.', 'integrations', false),
  ('assets.management', 'Asset-Management', 'Assets und Services mit Tickets verknüpfen.', 'assets', false)
on conflict (key) do update set name = excluded.name, description = excluded.description, category = excluded.category;

create table public.tenant_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.feature_catalog(key) on delete cascade,
  enabled boolean not null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, feature_key)
);

create table public.tenant_sso_configurations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'oidc' check (provider in ('oidc', 'saml', 'azure_ad')),
  enabled boolean not null default false,
  issuer_url text,
  discovery_url text,
  client_id text,
  client_secret_reference text,
  allowed_email_domains text[] not null default '{}',
  enforce_sso boolean not null default false,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  check ((enabled = false) or (issuer_url is not null or discovery_url is not null))
);

create or replace function public.initialize_tenant_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
  select new.id, catalog.key, catalog.default_enabled
  from public.feature_catalog catalog
  on conflict do nothing;
  insert into public.tenant_sso_configurations (tenant_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists tenant_feature_flags_defaults on public.tenants;
create trigger tenant_feature_flags_defaults
  after insert on public.tenants
  for each row execute function public.initialize_tenant_feature_flags();

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, catalog.key, catalog.default_enabled
from public.tenants tenant cross join public.feature_catalog catalog
on conflict do nothing;
insert into public.tenant_sso_configurations (tenant_id)
select id from public.tenants on conflict do nothing;

alter table public.feature_catalog enable row level security;
alter table public.tenant_feature_flags enable row level security;
alter table public.tenant_sso_configurations enable row level security;
revoke all on table public.feature_catalog, public.tenant_feature_flags, public.tenant_sso_configurations from anon, authenticated;

commit;
