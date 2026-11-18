begin;

set local search_path = pg_catalog, public;

create or replace function public.search_knowledge_article_ids(
  p_tenant_id uuid,
  p_query text,
  p_can_read_internal boolean,
  p_customer_organization_ids uuid[] default array[]::uuid[]
)
returns table(article_id uuid, rank real)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_query tsquery;
  v_prefix text;
begin
  if p_tenant_id is null or char_length(btrim(coalesce(p_query, ''))) not between 1 and 120 then
    raise exception 'Invalid knowledge search query' using errcode = '22023';
  end if;

  -- Every word also matches as a beginning ("wla" finds "WLAN"), so the live
  -- search finds articles while typing.
  select string_agg(words.token || ':*', ' & ')
    into v_prefix
  from (
    select regexp_replace(word, '[^[:alnum:]äöüÄÖÜß_-]', '', 'g') as token
    from regexp_split_to_table(btrim(p_query), '\s+') as word
  ) as words
  where char_length(words.token) >= 1;
  if v_prefix is not null then
    begin
      v_query := to_tsquery('german'::regconfig, v_prefix);
    exception when others then
      v_query := websearch_to_tsquery('german'::regconfig, btrim(p_query));
    end;
  else
    v_query := websearch_to_tsquery('german'::regconfig, btrim(p_query));
  end if;
  if numnode(v_query) = 0 then
    return;
  end if;

  return query
  with matching_collection_matches as (
    -- A direct root-category assignment or an active child assignment can
    -- match its own name. Child categories require an active root parent.
    select
      collection.id,
      ts_rank_cd(
        setweight(
          to_tsvector('german'::regconfig, collection.name),
          'B'
        ),
        v_query,
        32
      ) as taxonomy_rank
    from public.knowledge_collections as collection
    left join public.knowledge_collections as parent
      on parent.id = collection.parent_id
     and parent.tenant_id = collection.tenant_id
    where p_can_read_internal
      and collection.tenant_id = p_tenant_id
      and collection.active
      and (
        collection.parent_id is null
        or (parent.active and parent.parent_id is null)
      )
      and to_tsvector('german'::regconfig, collection.name) @@ v_query

    union all

    -- A root category also matches articles that are assigned only to one of
    -- its active direct children. This keeps category and subcategory search
    -- behaviour consistent with the article-list filter.
    select
      child.id,
      ts_rank_cd(
        setweight(
          to_tsvector('german'::regconfig, parent.name),
          'B'
        ),
        v_query,
        32
      ) as taxonomy_rank
    from public.knowledge_collections as parent
    join public.knowledge_collections as child
      on child.parent_id = parent.id
     and child.tenant_id = parent.tenant_id
    where p_can_read_internal
      and parent.tenant_id = p_tenant_id
      and parent.active
      and parent.parent_id is null
      and child.active
      and to_tsvector('german'::regconfig, parent.name) @@ v_query
  ), matching_collection_ranks as (
    select id, max(taxonomy_rank) as taxonomy_rank
    from matching_collection_matches
    group by id
  )
  select
    article.id,
    greatest(
      ts_rank_cd(revision.search_document, v_query, 32),
      ts_rank_cd(
        setweight(
          to_tsvector('german'::regconfig, revision.title_snapshot),
          'A'
        ),
        v_query,
        32
      ),
      coalesce(taxonomy.taxonomy_rank, 0::real)
    ) as rank
  from public.knowledge_articles as article
  join public.knowledge_article_revisions as revision
    on revision.article_id = article.id
   and revision.revision = case
     when p_can_read_internal then article.current_revision
     else article.published_revision
   end
  left join lateral (
    select max(match.taxonomy_rank) as taxonomy_rank
    from public.knowledge_article_collections as assignment
    join matching_collection_ranks as match
      on match.id = assignment.collection_id
    where assignment.tenant_id = article.tenant_id
      and assignment.article_id = article.id
  ) as taxonomy on true
  where article.tenant_id = p_tenant_id
    and article.status <> 'archived'
    and (
      revision.search_document @@ v_query
      or to_tsvector('german'::regconfig, revision.title_snapshot) @@ v_query
      or taxonomy.taxonomy_rank is not null
    )
    and (
      p_can_read_internal
      or (
        article.visibility = 'external'
        and article.published_revision is not null
        and (
          article.customer_organization_id is null
          or exists (
            select 1
            from public.customer_organizations as organization
            where organization.id = article.customer_organization_id
              and organization.tenant_id = article.tenant_id
              and organization.active
              and organization.id = any(coalesce(p_customer_organization_ids, array[]::uuid[]))
          )
        )
      )
    )
  order by rank desc, article.updated_at desc, article.id
  limit 200;
end;
$$;

commit;
