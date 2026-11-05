begin;

set local search_path = pg_catalog, public;

-- Learning from solutions (Pakete 2 and 3):
--   1. Closing a ticket that has linked knowledge articles records one
--      "resolved" outcome per article (knowledge_article_outcomes, 0184).
--   2. Aggregated outcome counts per article for the knowledge base.
--   3. Similar tickets created within a time window for the incident hint
--      ("Möglicher Störfall") in the ticket detail. similar_tickets (0183)
--      keeps its signature.

-- 1. Resolved outcomes --------------------------------------------------------
-- A database trigger covers every way a ticket is closed (detail, bulk
-- actions, automations, e-mail, API) instead of only one edge function. A
-- failure never blocks closing the ticket: the outcome is statistics only.
create or replace function public.record_knowledge_article_resolutions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
begin
  -- Merged duplicates are closed as a side effect, not solved.
  if new.merged_into_ticket_id is not null then
    return new;
  end if;
  if not exists (
    select 1 from public.ticket_statuses status
    where status.id = new.status_id and status.is_closed
  ) then
    return new;
  end if;
  if old.status_id is not null and exists (
    select 1 from public.ticket_statuses status
    where status.id = old.status_id and status.is_closed
  ) then
    return new;
  end if;

  begin
    select profile.id into v_actor
    from public.user_profiles profile
    where profile.id = auth.uid();
    v_actor := coalesce(v_actor, new.assigned_agent_id);

    insert into public.knowledge_article_outcomes (
      tenant_id, article_id, ticket_id, kind, actor_id
    )
    select new.tenant_id, linked.article_id, new.id, 'resolved', v_actor
    from (
      select link.article_id
      from public.ticket_knowledge_articles link
      where link.ticket_id = new.id and link.tenant_id = new.tenant_id
      union
      select legacy.article_id
      from public.ticket_knowledge_links legacy
      where legacy.ticket_id = new.id
    ) linked
    join public.knowledge_articles article
      on article.id = linked.article_id and article.tenant_id = new.tenant_id
    on conflict (article_id, ticket_id)
      where kind = 'resolved' and ticket_id is not null
      do nothing;
  exception when others then
    raise warning 'Knowledge article outcomes could not be recorded for ticket %: %',
      new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.record_knowledge_article_resolutions()
  from public, anon, authenticated;

drop trigger if exists tickets_record_knowledge_resolutions on public.tickets;
create trigger tickets_record_knowledge_resolutions
  after update of status_id on public.tickets
  for each row
  when (old.status_id is distinct from new.status_id)
  execute function public.record_knowledge_article_resolutions();

-- 2. Outcome counts -------------------------------------------------------------
-- Read by the knowledge-base function with the service role after it has
-- applied the reader's article visibility; not callable by browsers.
create or replace function public.knowledge_article_outcome_counts(
  p_tenant_id uuid,
  p_article_ids uuid[],
  p_since timestamptz
)
returns table (
  article_id uuid,
  resolved_recent integer,
  deflected_recent integer,
  not_helpful_recent integer,
  resolved_total integer,
  deflected_total integer,
  not_helpful_total integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    outcome.article_id,
    (count(*) filter (where outcome.kind = 'resolved' and outcome.created_at >= p_since))::integer,
    (count(*) filter (where outcome.kind = 'deflected' and outcome.created_at >= p_since))::integer,
    (count(*) filter (where outcome.kind = 'not_helpful' and outcome.created_at >= p_since))::integer,
    (count(*) filter (where outcome.kind = 'resolved'))::integer,
    (count(*) filter (where outcome.kind = 'deflected'))::integer,
    (count(*) filter (where outcome.kind = 'not_helpful'))::integer
  from public.knowledge_article_outcomes outcome
  where outcome.tenant_id = p_tenant_id
    and outcome.article_id = any(coalesce(p_article_ids, array[]::uuid[]))
  group by outcome.article_id;
$$;

revoke all on function public.knowledge_article_outcome_counts(uuid, uuid[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.knowledge_article_outcome_counts(uuid, uuid[], timestamptz)
  to service_role;

-- 3. Recent similar tickets ------------------------------------------------------
-- Like similar_tickets, but only tickets created since p_since (at most seven
-- days back) and only tickets sharing enough significant words: at least two
-- (or all, when the text has fewer) and at least a quarter of them. That keeps
-- a single common word from turning unrelated tickets into a "Störfall".
create or replace function public.recent_similar_tickets(
  p_tenant_id uuid,
  p_text text,
  p_since timestamptz,
  p_exclude_ticket_id uuid default null,
  p_limit integer default 50
)
returns table (
  ticket_id uuid,
  ticket_number text,
  subject text,
  status_label text,
  is_closed boolean,
  department_id uuid,
  created_at timestamptz,
  rank real,
  matched_terms integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_words text[];
  v_query tsquery;
  v_since timestamptz;
  v_min_matches integer;
begin
  if p_tenant_id is null or auth.uid() is null
    or not public.is_active_tenant_member(p_tenant_id) then
    return;
  end if;
  select array_agg(word)
    into v_words
  from (
    select distinct lexeme as word
    from unnest(to_tsvector('german'::regconfig, left(coalesce(p_text, ''), 2000)))
    where char_length(lexeme) >= 3
    limit 24
  ) words;
  if v_words is null or cardinality(v_words) = 0 then
    return;
  end if;
  v_query := to_tsquery(
    'german'::regconfig,
    (select string_agg(quote_literal(word) || ':*', ' | ') from unnest(v_words) word)
  );
  v_since := greatest(
    coalesce(p_since, timezone('utc', now()) - interval '2 hours'),
    timezone('utc', now()) - interval '7 days'
  );
  v_min_matches := least(
    cardinality(v_words),
    greatest(2, ceil(cardinality(v_words) * 0.25)::integer)
  );

  return query
  select
    candidate.id,
    candidate.ticket_number,
    candidate.subject,
    candidate.status_label,
    candidate.is_closed,
    candidate.department_id,
    candidate.created_at,
    candidate.rank,
    candidate.matched_terms
  from (
    select
      ticket.id,
      ticket.ticket_number,
      ticket.subject,
      status.label as status_label,
      status.is_closed,
      ticket.department_id,
      ticket.created_at,
      ts_rank_cd(ticket.search_vector, v_query, 32)::real as rank,
      (
        select count(*)::integer
        from unnest(v_words) word
        where ticket.search_vector @@ to_tsquery('german'::regconfig, quote_literal(word) || ':*')
      ) as matched_terms
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.tenant_id = p_tenant_id
      and ticket.created_at >= v_since
      and ticket.merged_into_ticket_id is null
      and ticket.search_vector @@ v_query
      and (p_exclude_ticket_id is null or ticket.id <> p_exclude_ticket_id)
      and public.can_read_ticket(ticket.id)
  ) candidate
  where candidate.matched_terms >= v_min_matches
  order by candidate.rank desc, candidate.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

revoke all on function public.recent_similar_tickets(uuid, text, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.recent_similar_tickets(uuid, text, timestamptz, uuid, integer)
  to authenticated, service_role;

commit;
