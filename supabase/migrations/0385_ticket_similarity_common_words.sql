begin;

-- Ähnliche Tickets (Störfall-Hinweis, Fälle): Mails derselben Organisation
-- teilen Signatur und Grussformeln (Firmenname, Adresse, «Angebot» …). Diese
-- Wörter machten fremde Tickets «ähnlich». Neu zählen Wörter nicht mehr, die
-- in vielen Tickets des Mandanten vorkommen, und ein Treffer muss auch im
-- Betreff mindestens ein Wort mit dem Ausgangsticket teilen.
create or replace function public.recent_similar_tickets(
  p_tenant_id uuid,
  p_text text,
  p_since timestamptz,
  p_exclude_ticket_id uuid default null,
  p_limit integer default 50
)
returns table(
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
  v_subject_words text[];
  v_query tsquery;
  v_subject_query tsquery;
  v_since timestamptz;
  v_min_matches integer;
  v_base integer;
  v_common_limit integer;
begin
  if p_tenant_id is null or auth.uid() is null
    or not public.is_active_tenant_member(p_tenant_id) then
    return;
  end if;

  -- Grundgesamtheit für «häufige Wörter»: Tickets der letzten 60 Tage.
  select count(*)::integer into v_base
    from public.tickets ticket
   where ticket.tenant_id = p_tenant_id
     and ticket.deleted_at is null
     and ticket.created_at >= timezone('utc', now()) - interval '60 days';
  v_common_limit := greatest(4, ceil(v_base * 0.12)::integer);

  select array_agg(word)
    into v_words
  from (
    select distinct lexeme as word
      from unnest(to_tsvector('german'::regconfig, left(coalesce(p_text, ''), 2000)))
     where char_length(lexeme) >= 3
  ) words
  where v_base < 20
     or (
       select count(*)
         from public.tickets ticket
        where ticket.tenant_id = p_tenant_id
          and ticket.deleted_at is null
          and ticket.created_at >= timezone('utc', now()) - interval '60 days'
          and ticket.search_vector @@ to_tsquery('german'::regconfig, quote_literal(words.word))
     ) <= v_common_limit;
  if v_words is null or cardinality(v_words) = 0 then
    return;
  end if;
  v_words := v_words[1:24];

  -- Wörter aus dem Betreff (erste Zeile), ohne die häufigen.
  select array_agg(lexeme)
    into v_subject_words
  from unnest(to_tsvector('german'::regconfig, split_part(coalesce(p_text, ''), E'\n', 1)))
  where char_length(lexeme) >= 3
    and lexeme = any(v_words);

  v_query := to_tsquery(
    'german'::regconfig,
    (select string_agg(quote_literal(word) || ':*', ' | ') from unnest(v_words) word)
  );
  v_subject_query := case
    when coalesce(cardinality(v_subject_words), 0) = 0 then null
    else to_tsquery(
      'german'::regconfig,
      (select string_agg(quote_literal(word) || ':*', ' | ') from unnest(v_subject_words) word)
    )
  end;
  v_since := greatest(
    coalesce(p_since, timezone('utc', now()) - interval '2 hours'),
    timezone('utc', now()) - interval '7 days'
  );
  v_min_matches := least(
    cardinality(v_words),
    greatest(2, ceil(cardinality(v_words) * 0.3)::integer)
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
      and (
        v_subject_query is null
        or to_tsvector('german'::regconfig, coalesce(ticket.subject, '')) @@ v_subject_query
      )
      and public.can_read_ticket(ticket.id)
  ) candidate
  where candidate.matched_terms >= v_min_matches
  order by candidate.rank desc, candidate.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

commit;
