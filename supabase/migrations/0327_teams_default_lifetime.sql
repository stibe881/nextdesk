begin;

set local search_path = pg_catalog, public;

-- Microsoft Teams im Shop: Standard für die längste Laufzeit ist 1 Jahr
-- (pro Mandant weiterhin einstellbar). Bestehende Einstellungen bleiben.
alter table public.tenant_teams_settings
  alter column max_lifetime_months set default 12;

commit;
