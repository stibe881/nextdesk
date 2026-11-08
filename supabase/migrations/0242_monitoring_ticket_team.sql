begin;

set local search_path = pg_catalog, public;

-- Optional team that receives the tickets created from PRTG alerts. The team
-- must belong to the tenant; the webhook only assigns it while it is active
-- and in the same department as the ticket.
alter table public.monitoring_integrations
  add column if not exists team_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monitoring_integrations_team_fk'
      and conrelid = 'public.monitoring_integrations'::regclass
  ) then
    alter table public.monitoring_integrations
      add constraint monitoring_integrations_team_fk
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
end $$;

commit;
