begin;

set local search_path = pg_catalog, public;

-- Skill levels of agents who are pre-assigned from Entra but have not signed
-- in yet (no user account). Moved to agent_skill_levels on the first
-- Microsoft sign-in (tenant-sso-access).
create table if not exists public.pending_agent_skill_levels (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entra_object_id uuid not null,
  skill_id uuid not null,
  level smallint not null check (level between 1 and 3),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.user_profiles(id) on delete set null,
  primary key (tenant_id, entra_object_id, skill_id),
  constraint pending_agent_skill_levels_skill_fk foreign key (skill_id, tenant_id)
    references public.team_skills (id, tenant_id) on delete cascade
);

alter table public.pending_agent_skill_levels enable row level security;
revoke all on table public.pending_agent_skill_levels from public, anon, authenticated;
grant select, insert, update, delete on table public.pending_agent_skill_levels to service_role;

commit;
