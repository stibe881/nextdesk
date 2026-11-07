begin;

set local search_path = pg_catalog, public;

-- Automatic knowledge article suggestions ("Artikelvorschläge"):
-- when several similar tickets were solved the same way, nextDesk suggests a
-- knowledge article and the AI can write a draft that a person reviews.
--
-- The clustering itself (word similarity) runs in the edge function
-- knowledge-suggestions with the service role. It recomputes the clusters of
-- a tenant when a list is requested and the last computation is older than
-- 24 hours (no cron job: the edge function needs no secret in SQL that way).
-- A suggestion is identified by a stable fingerprint per tenant, so dismissed
-- suggestions are kept and do not come back after a recomputation.

create table if not exists public.knowledge_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  fingerprint text not null check (char_length(fingerprint) between 3 and 300),
  title_hint text not null check (char_length(title_hint) between 1 and 240),
  ticket_ids uuid[] not null default array[]::uuid[],
  ticket_count integer not null default 0 check (ticket_count >= 0),
  status text not null default 'open'
    check (status in ('open', 'drafted', 'dismissed', 'published')),
  article_id uuid references public.knowledge_articles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  dismissed_by uuid references public.user_profiles(id) on delete set null,
  dismissed_at timestamptz,
  unique (tenant_id, fingerprint)
);
create index if not exists knowledge_suggestions_tenant_status_idx
  on public.knowledge_suggestions (tenant_id, status, ticket_count desc);
create index if not exists knowledge_suggestions_article_idx
  on public.knowledge_suggestions (article_id) where article_id is not null;

-- When the clusters of a tenant were last computed.
create table if not exists public.knowledge_suggestion_refreshes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  refreshed_at timestamptz not null default timezone('utc', now()),
  refreshed_by uuid references public.user_profiles(id) on delete set null
);

alter table public.knowledge_suggestions enable row level security;
alter table public.knowledge_suggestion_refreshes enable row level security;
revoke all on table public.knowledge_suggestions, public.knowledge_suggestion_refreshes
  from public, anon, authenticated;
grant all on table public.knowledge_suggestions, public.knowledge_suggestion_refreshes
  to service_role;

-- Source tickets for the clustering: tickets of the tenant solved since
-- p_since (resolved or closed, not merged into another ticket) that have at
-- least one reply or note (the solution text) and that were not solved with
-- a published knowledge article already linked to them.
create or replace function public.knowledge_suggestion_source_tickets(
  p_tenant_id uuid,
  p_since timestamptz,
  p_limit integer default 2000
)
returns table (
  ticket_id uuid,
  subject text,
  category_name text,
  department_id uuid,
  solved_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    ticket.id,
    ticket.subject,
    category.name,
    ticket.department_id,
    coalesce(ticket.resolved_at, ticket.closed_at)
  from public.tickets ticket
  left join public.ticket_categories category
    on category.id = ticket.category_id
  where ticket.tenant_id = p_tenant_id
    and ticket.merged_into_ticket_id is null
    and coalesce(ticket.resolved_at, ticket.closed_at) >= p_since
    and exists (
      select 1 from public.ticket_comments comment
      where comment.ticket_id = ticket.id
    )
    and not exists (
      select 1
      from public.ticket_knowledge_articles link
      join public.knowledge_articles article
        on article.id = link.article_id and article.tenant_id = link.tenant_id
      where link.ticket_id = ticket.id
        and link.tenant_id = p_tenant_id
        and article.status = 'published'
    )
    and not exists (
      select 1
      from public.ticket_knowledge_links legacy
      join public.knowledge_articles article on article.id = legacy.article_id
      where legacy.ticket_id = ticket.id
        and article.tenant_id = p_tenant_id
        and article.status = 'published'
    )
  order by coalesce(ticket.resolved_at, ticket.closed_at) desc
  limit least(greatest(coalesce(p_limit, 2000), 1), 5000);
$$;

revoke all on function public.knowledge_suggestion_source_tickets(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.knowledge_suggestion_source_tickets(uuid, timestamptz, integer)
  to service_role;

commit;
