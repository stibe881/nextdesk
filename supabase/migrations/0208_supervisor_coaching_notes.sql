begin;

set local search_path = pg_catalog, public;

-- Private coaching notes of a supervisor about an agent. Only the author
-- reads them; they are read and written through the team-supervision
-- function, which checks that the agent belongs to a supervised department.
create table if not exists public.supervisor_coaching_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.user_profiles(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  kind text not null default 'note' check (kind in ('note', 'praise', 'goal', 'concern')),
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists supervisor_coaching_notes_lookup_idx
  on public.supervisor_coaching_notes (tenant_id, author_id, agent_id, created_at desc);
alter table public.supervisor_coaching_notes enable row level security;
revoke all on table public.supervisor_coaching_notes from public, anon, authenticated;
grant all on table public.supervisor_coaching_notes to service_role;

commit;
