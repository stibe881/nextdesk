begin;

set local search_path = pg_catalog, public;

-- Possible incidents for the hint above the agent ticket list in one call.
-- Until now ticket-operations looked up up to twelve seeds one by one with
-- recent_similar_tickets (migration 0185). This function does the same
-- clustering in the database:
--   * seeds are the latest 30 tickets created since p_since (at most seven
--     days back) that the signed-in person can read (can_read_ticket),
--   * at most twelve seeds are looked up, a ticket already in a cluster is no
--     seed again,
--   * a seed's members are the seed and its recent_similar_tickets matches
--     (same word-overlap rule, readable tickets only),
--   * a cluster needs p_min_size members, and p_min_size of them must not be
--     part of an earlier cluster (no duplicate clusters),
--   * at most p_limit clusters, the largest first.
create or replace function public.recent_incident_clusters(
  p_tenant_id uuid,
  p_since timestamptz,
  p_min_size integer default 5,
  p_limit integer default 3
)
returns table (
  ticket_id uuid,
  subject text,
  ticket_count integer,
  ticket_ids uuid[],
  tickets jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
#variable_conflict use_column
declare
  v_since timestamptz;
  v_min_size integer;
  v_limit integer;
  v_seed record;
  v_seeds jsonb;
  v_lookups integer := 0;
  v_clustered uuid[] := array[]::uuid[];
  v_member_ids uuid[];
  v_members jsonb;
  v_fresh integer;
  v_clusters jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null or auth.uid() is null
    or not public.is_active_tenant_member(p_tenant_id) then
    return;
  end if;
  v_since := greatest(
    coalesce(p_since, timezone('utc', now()) - interval '2 hours'),
    timezone('utc', now()) - interval '7 days'
  );
  v_min_size := greatest(2, least(coalesce(p_min_size, 5), 50));
  v_limit := greatest(1, least(coalesce(p_limit, 3), 10));

  select coalesce(jsonb_agg(to_jsonb(seed) order by seed.created_at desc, seed.id), '[]'::jsonb)
    into v_seeds
  from (
    select ticket.id, ticket.ticket_number, ticket.subject,
      left(coalesce(ticket.description, ''), 1500) as description, ticket.created_at
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.created_at >= v_since
      and ticket.merged_into_ticket_id is null
      and public.can_read_ticket(ticket.id)
    order by ticket.created_at desc, ticket.id
    limit 30
  ) seed;
  -- Fewer readable tickets in the window than a cluster needs: no lookups.
  if jsonb_array_length(v_seeds) < v_min_size then
    return;
  end if;

  for v_seed in
    select
      (item ->> 'id')::uuid as id,
      item ->> 'ticket_number' as ticket_number,
      item ->> 'subject' as subject,
      item ->> 'description' as description,
      (item ->> 'created_at')::timestamptz as created_at
    from jsonb_array_elements(v_seeds) with ordinality as seeds(item, pos)
    order by seeds.pos
  loop
    exit when v_lookups >= 12 or jsonb_array_length(v_clusters) >= v_limit;
    continue when v_seed.id = any(v_clustered);
    v_lookups := v_lookups + 1;

    select
      array_agg(member.id order by member.pos),
      jsonb_agg(
        jsonb_build_object(
          'id', member.id,
          'ticket_number', coalesce(member.ticket_number, ''),
          'subject', coalesce(member.subject, ''),
          'created_at', member.created_at
        )
        order by member.pos
      ),
      (count(*) filter (where not member.id = any(v_clustered)))::integer
      into v_member_ids, v_members, v_fresh
    from (
      select 0 as pos, v_seed.id, v_seed.ticket_number, v_seed.subject, v_seed.created_at
      union all
      select
        found.pos::integer,
        found.ticket_id,
        found.ticket_number,
        found.subject,
        found.created_at
      from public.recent_similar_tickets(
        p_tenant_id,
        coalesce(v_seed.subject, '') || E'\n' || left(coalesce(v_seed.description, ''), 1500),
        v_since,
        v_seed.id,
        50
      ) with ordinality as found(
        ticket_id, ticket_number, subject, status_label, is_closed,
        department_id, created_at, rank, matched_terms, pos
      )
      where found.ticket_id <> v_seed.id
    ) member;

    -- A cluster that mostly repeats an earlier one is not reported twice.
    continue when cardinality(v_member_ids) < v_min_size or v_fresh < v_min_size;
    v_clustered := v_clustered || v_member_ids;
    v_clusters := v_clusters || jsonb_build_array(jsonb_build_object(
      'ordinal', jsonb_array_length(v_clusters),
      'ticket_id', v_seed.id,
      'subject', coalesce(v_seed.subject, ''),
      'ticket_count', cardinality(v_member_ids),
      'ticket_ids', to_jsonb(v_member_ids),
      'tickets', v_members
    ));
  end loop;

  return query
  select
    (item ->> 'ticket_id')::uuid,
    item ->> 'subject',
    (item ->> 'ticket_count')::integer,
    array(select jsonb_array_elements_text(item -> 'ticket_ids')::uuid),
    item -> 'tickets'
  from jsonb_array_elements(v_clusters) as clusters(item)
  order by (item ->> 'ticket_count')::integer desc, (item ->> 'ordinal')::integer;
end;
$$;

revoke all on function public.recent_incident_clusters(uuid, timestamptz, integer, integer)
  from public, anon;
grant execute on function public.recent_incident_clusters(uuid, timestamptz, integer, integer)
  to authenticated, service_role;

commit;
