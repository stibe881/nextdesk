begin;

set local search_path = pg_catalog, public;

-- Backup-Überwachung: neben der Abteilung auch das Team, dem die Tickets
-- zugewiesen werden (wie bei Zertifikaten und Domains, 0379).
alter table public.monitoring_backup_settings
  add column if not exists team_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monitoring_backup_settings_team_fk'
      and conrelid = 'public.monitoring_backup_settings'::regclass
  ) then
    alter table public.monitoring_backup_settings
      add constraint monitoring_backup_settings_team_fk
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
end $$;

commit;
