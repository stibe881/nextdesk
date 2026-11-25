begin;

set local search_path = pg_catalog, public;

-- Zertifikate und Domains: neben der Abteilung auch das Team, dem die
-- Tickets zugewiesen werden. Es wird nur gesetzt, solange das Team aktiv ist
-- und zur Abteilung des Tickets gehört.
alter table public.monitoring_expiry_settings
  add column if not exists team_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monitoring_expiry_settings_team_fk'
      and conrelid = 'public.monitoring_expiry_settings'::regclass
  ) then
    alter table public.monitoring_expiry_settings
      add constraint monitoring_expiry_settings_team_fk
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
end $$;

commit;
