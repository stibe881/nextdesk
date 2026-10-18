begin;

-- Ein manuell bestätigter Lauf wird von Vorschau und späterem Scheduler getrennt
-- protokolliert. Dadurch bleibt jede irreversible Aktion nachvollziehbar.
alter table public.tenant_automation_runs
  drop constraint if exists tenant_automation_runs_mode_check;

alter table public.tenant_automation_runs
  add constraint tenant_automation_runs_mode_check
  check (mode in ('preview', 'manual', 'scheduled'));

commit;
