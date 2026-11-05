begin;

set local search_path = pg_catalog, public;

-- Similar tickets for suggestions while creating a ticket and for the
-- "already solved" hints (Pakete 1–3). A German full-text vector over subject
-- and description, kept by the database, makes the lookup fast.

alter table public.tickets
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(subject, '')), 'A')
    || setweight(to_tsvector('german'::regconfig, left(coalesce(description, ''), 20000)), 'B')
  ) stored;

create index if not exists tickets_search_vector_idx
  on public.tickets using gin (search_vector);

-- Tickets similar to a free text, readable by the signed-in person
-- (can_read_ticket). Words are combined with OR, ranked by relevance;
-- p_only_closed limits the result to solved tickets, p_only_own to tickets
-- the person requested (duplicate hint for requesters).
create or replace function public.similar_tickets(
  p_tenant_id uuid,
  p_text text,
  p_exclude_ticket_id uuid default null,
  p_only_closed boolean default false,
  p_only_own boolean default false,
  p_limit integer default 5
)
returns table (
  ticket_id uuid,
  ticket_number text,
  subject text,
  status_label text,
  is_closed boolean,
  category_id uuid,
  department_id uuid,
  priority_id uuid,
  requester_id uuid,
  closed_at timestamptz,
  updated_at timestamptz,
  rank real
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_query tsquery;
  v_words text;
begin
  if p_tenant_id is null or auth.uid() is null
    or not public.is_active_tenant_member(p_tenant_id) then
    return;
  end if;
  -- Significant words only, combined with OR so that a short subject still
  -- finds tickets that share some of its words.
  select string_agg(quote_literal(word) || ':*', ' | ')
    into v_words
  from (
    select distinct lexeme as word
    from unnest(to_tsvector('german'::regconfig, left(coalesce(p_text, ''), 2000)))
    where char_length(lexeme) >= 3
    limit 24
  ) words;
  if v_words is null then
    return;
  end if;
  v_query := to_tsquery('german'::regconfig, v_words);

  return query
  select
    ticket.id,
    ticket.ticket_number,
    ticket.subject,
    status.label,
    status.is_closed,
    ticket.category_id,
    ticket.department_id,
    ticket.priority_id,
    ticket.requester_id,
    ticket.closed_at,
    ticket.updated_at,
    ts_rank_cd(ticket.search_vector, v_query, 32)::real
  from public.tickets ticket
  join public.ticket_statuses status on status.id = ticket.status_id
  where ticket.tenant_id = p_tenant_id
    and ticket.search_vector @@ v_query
    and (p_exclude_ticket_id is null or ticket.id <> p_exclude_ticket_id)
    and (not p_only_closed or status.is_closed)
    and (not p_only_own or ticket.requester_id = auth.uid())
    and public.can_read_ticket(ticket.id)
  order by ts_rank_cd(ticket.search_vector, v_query, 32) desc, ticket.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 5), 25));
end;
$$;

revoke all on function public.similar_tickets(uuid, text, uuid, boolean, boolean, integer)
  from public, anon;
grant execute on function public.similar_tickets(uuid, text, uuid, boolean, boolean, integer)
  to authenticated, service_role;

commit;
