begin;

set local search_path = pg_catalog, public;

-- Agent pre-assignment of an Entra person who has not signed in yet: the
-- admin can already set the display name and the manager like for an
-- existing agent. Both are applied on the first Microsoft sign-in.
alter table public.tenant_entra_directory_people
  add column if not exists agent_display_name text
    check (agent_display_name is null or char_length(btrim(agent_display_name)) between 1 and 160),
  add column if not exists agent_manager_user_id uuid
    references public.user_profiles(id) on delete set null;

commit;
