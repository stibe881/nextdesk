begin;

set local search_path = pg_catalog, public;

-- Personal order of the tickets assigned to an agent. The AI (or, without AI,
-- a rule-based score) proposes an order with a short reason; the agent can
-- move tickets, which is stored as a manual rank and wins over the proposal.
create table if not exists public.ticket_personal_ranks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  ai_rank integer,
  ai_score numeric(8, 2),
  ai_reason text check (ai_reason is null or char_length(ai_reason) <= 300),
  ai_source text check (ai_source is null or ai_source in ('ai', 'rules')),
  ai_ranked_at timestamptz,
  manual_rank integer,
  manual_ranked_at timestamptz,
  primary key (user_id, ticket_id)
);
create index if not exists ticket_personal_ranks_user_idx
  on public.ticket_personal_ranks (tenant_id, user_id);

alter table public.ticket_personal_ranks enable row level security;
revoke all on table public.ticket_personal_ranks from public, anon, authenticated;
grant all on table public.ticket_personal_ranks to service_role;

commit;
