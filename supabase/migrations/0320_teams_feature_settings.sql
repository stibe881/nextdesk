begin;

set local search_path = pg_catalog, public;

-- Microsoft Teams im Shop: Funktion pro Mandant (Einstellungen → Funktionen),
-- standardmässig aus. Die Mandanten-Administration schaltet sie ein, prüft die
-- Verbindung und legt Laufzeit-Grenzen fest.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'teams.provisioning',
  'Microsoft Teams im Shop',
  'Mitarbeitende bestellen im Shop neue Microsoft-Teams-Teams mit Laufzeit; nextDesk legt sie an, erinnert die Owner und archiviert abgelaufene Teams. Menü «Teams» zur Verwaltung.',
  'integrations',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'teams.provisioning', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;

create table public.tenant_teams_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_lifetime_months integer not null default 36
    check (max_lifetime_months between 1 and 60),
  allow_guests boolean not null default true,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tenant_teams_settings enable row level security;
alter table public.tenant_teams_settings force row level security;
revoke all on table public.tenant_teams_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_teams_settings to service_role;
create policy tenant_teams_settings_service_role_only on public.tenant_teams_settings
  for all to service_role using (true) with check (true);

comment on table public.tenant_teams_settings is
  'Einstellungen der Funktion «Microsoft Teams im Shop» pro Mandant (höchste Laufzeit, Gäste zulässig). Nur Service-Rolle (Edge Function teams-settings).';

commit;
