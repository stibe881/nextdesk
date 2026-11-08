begin;

set local search_path = pg_catalog, public;

-- Teams an admin selects while pre-assigning an Entra person as agent;
-- applied (team memberships) on the person's first Microsoft sign-in.
alter table public.tenant_entra_directory_people
  add column if not exists agent_team_ids uuid[] not null default '{}'::uuid[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_entra_directory_people_agent_team_ids_check'
      and conrelid = 'public.tenant_entra_directory_people'::regclass
  ) then
    alter table public.tenant_entra_directory_people
      add constraint tenant_entra_directory_people_agent_team_ids_check
      check (cardinality(agent_team_ids) <= 20);
  end if;
end;
$$;

commit;
