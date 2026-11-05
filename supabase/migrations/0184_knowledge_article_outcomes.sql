begin;

set local search_path = pg_catalog, public;

-- How often a knowledge article helped (Pakete 1 and 2):
--   deflected    – a requester saw the article while creating a ticket and
--                  chose "Hat mein Problem gelöst" (no ticket created)
--   resolved     – a ticket linked to the article was closed
--   not_helpful  – a requester or agent marked the article as not helpful
create table if not exists public.knowledge_article_outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  kind text not null check (kind in ('deflected', 'resolved', 'not_helpful')),
  actor_id uuid references public.user_profiles(id) on delete set null,
  query_text text check (query_text is null or char_length(query_text) <= 500),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists knowledge_article_outcomes_article_idx
  on public.knowledge_article_outcomes (tenant_id, article_id, kind, created_at desc);
create index if not exists knowledge_article_outcomes_tenant_idx
  on public.knowledge_article_outcomes (tenant_id, kind, created_at desc);
create unique index if not exists knowledge_article_outcomes_resolved_unique
  on public.knowledge_article_outcomes (article_id, ticket_id)
  where kind = 'resolved' and ticket_id is not null;

alter table public.knowledge_article_outcomes enable row level security;
revoke all on public.knowledge_article_outcomes from anon, authenticated;

commit;
