begin;

set local search_path = pg_catalog, public;

-- Raumplanung and Eintritte become modules that can be switched per tenant
-- and per department (like the other modules). Existing tenants keep both on.

insert into public.feature_catalog (key, name, description, category, default_enabled)
values
  ('event.spaces', 'Raumplanung', 'Räume reservieren und Raumaufträge an die zuständigen Abteilungen geben.', 'experience', true),
  ('onboarding.entries', 'Eintritte', 'Eintritte neuer Mitarbeitender mit Aufgaben für die Abteilungen planen.', 'experience', true)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, feature.key, true
from public.tenants as tenant
cross join (values ('event.spaces'), ('onboarding.entries')) as feature(key)
on conflict (tenant_id, feature_key) do nothing;

commit;
