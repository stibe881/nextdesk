begin;

-- Category changes and article collection replacement are committed together with
-- their audit record. Browser roles cannot call these helpers directly; the
-- JWT-protected Edge Function verifies membership and `knowledge.manage` first.
create or replace function public.replace_knowledge_article_collections(
  p_tenant_id uuid,
  p_article_id uuid,
  p_collection_ids uuid[],
  p_actor_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before_ids uuid[] := '{}';
  v_collection_count integer := 0;
  v_distinct_count integer := 0;
  v_normalized_ids uuid[] := coalesce(p_collection_ids, '{}');
begin
  if cardinality(v_normalized_ids) > 12 then
    raise exception 'A knowledge article may have at most 12 collection assignments'
      using errcode = '22023';
  end if;

  select count(*)
    into v_distinct_count
    from (
      select distinct collection_id
      from unnest(v_normalized_ids) as collection_id
    ) as distinct_ids;
  if v_distinct_count <> cardinality(v_normalized_ids) then
    raise exception 'Collection assignments must be unique' using errcode = '22023';
  end if;

  perform 1
    from public.knowledge_articles as article
   where article.tenant_id = p_tenant_id
     and article.id = p_article_id
     and article.status <> 'archived'
   for update;
  if not found then
    raise exception 'Knowledge article was not found or is archived' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(link.collection_id order by link.collection_id), '{}')
    into v_before_ids
    from public.knowledge_article_collections as link
   where link.tenant_id = p_tenant_id
     and link.article_id = p_article_id;

  if cardinality(v_normalized_ids) > 0 then
    select count(*)
      into v_collection_count
      from public.knowledge_collections as collection
     where collection.tenant_id = p_tenant_id
       and collection.active
       and collection.id = any(v_normalized_ids);
    if v_collection_count <> cardinality(v_normalized_ids) then
      raise exception 'Every collection assignment must be active and tenant-scoped'
        using errcode = '23503';
    end if;
  end if;

  delete from public.knowledge_article_collections as link
   where link.tenant_id = p_tenant_id
     and link.article_id = p_article_id;

  insert into public.knowledge_article_collections (
    tenant_id,
    article_id,
    collection_id,
    created_by
  )
  select p_tenant_id, p_article_id, collection_id, p_actor_id
  from unnest(v_normalized_ids) as collection_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    before_data,
    after_data,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'knowledge.article.collections_updated',
    'article',
    p_article_id,
    'info',
    jsonb_build_object('collectionIds', v_before_ids),
    jsonb_build_object('collectionIds', v_normalized_ids),
    jsonb_build_object('articleId', p_article_id)
  );

  return v_normalized_ids;
end;
$$;

create or replace function public.create_knowledge_collection(
  p_tenant_id uuid,
  p_name text,
  p_parent_id uuid,
  p_actor_id uuid
)
returns table (
  id uuid,
  name text,
  slug text,
  parent_id uuid,
  active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_normalized_name text := btrim(coalesce(p_name, ''));
  v_slug_base text;
  v_collection public.knowledge_collections%rowtype;
begin
  if char_length(v_normalized_name) not between 2 and 100 then
    raise exception 'Knowledge collection names require between 2 and 100 characters'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  if p_parent_id is not null then
    perform 1
      from public.knowledge_collections as parent
     where parent.tenant_id = p_tenant_id
       and parent.id = p_parent_id
       and parent.active
       and parent.parent_id is null
     for share;
    if not found then
      raise exception 'Knowledge collection parent must be an active root category in the tenant'
        using errcode = '23503';
    end if;
  end if;

  if exists (
    select 1
    from public.knowledge_collections as collection
    where collection.tenant_id = p_tenant_id
      and collection.active
      and collection.parent_id is not distinct from p_parent_id
      and lower(collection.name) = lower(v_normalized_name)
  ) then
    raise exception 'A category with this name already exists at this level'
      using errcode = '23505';
  end if;

  v_slug_base := coalesce(
    nullif(
      trim(both '-' from lower(regexp_replace(v_normalized_name, '[^a-z0-9]+', '-', 'g'))),
      ''
    ),
    'category'
  );

  insert into public.knowledge_collections (
    tenant_id,
    name,
    slug,
    parent_id,
    active,
    created_by,
    updated_at
  )
  values (
    p_tenant_id,
    v_normalized_name,
    v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    p_parent_id,
    true,
    p_actor_id,
    timezone('utc', now())
  )
  returning * into v_collection;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    before_data,
    after_data,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'knowledge.collection.created',
    'knowledge_collection',
    v_collection.id,
    'info',
    null,
    jsonb_build_object('name', v_collection.name, 'parentId', v_collection.parent_id),
    jsonb_build_object('parentId', v_collection.parent_id)
  );

  return query
  select
    v_collection.id,
    v_collection.name,
    v_collection.slug,
    v_collection.parent_id,
    v_collection.active;
end;
$$;

create or replace function public.rename_knowledge_collection(
  p_tenant_id uuid,
  p_collection_id uuid,
  p_name text,
  p_actor_id uuid
)
returns table (
  id uuid,
  name text,
  slug text,
  parent_id uuid,
  active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_normalized_name text := btrim(coalesce(p_name, ''));
  v_collection public.knowledge_collections%rowtype;
  v_before_name text;
begin
  if char_length(v_normalized_name) not between 2 and 100 then
    raise exception 'Knowledge collection names require between 2 and 100 characters'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  select *
    into v_collection
    from public.knowledge_collections as collection
   where collection.tenant_id = p_tenant_id
     and collection.id = p_collection_id
     and collection.active
   for update;
  if not found then
    raise exception 'Knowledge collection does not exist or is inactive' using errcode = 'P0002';
  end if;
  v_before_name := v_collection.name;

  if exists (
    select 1
    from public.knowledge_collections as collection
    where collection.tenant_id = p_tenant_id
      and collection.active
      and collection.id <> v_collection.id
      and collection.parent_id is not distinct from v_collection.parent_id
      and lower(collection.name) = lower(v_normalized_name)
  ) then
    raise exception 'A category with this name already exists at this level'
      using errcode = '23505';
  end if;

  update public.knowledge_collections as collection
     set name = v_normalized_name,
         updated_at = timezone('utc', now())
   where collection.tenant_id = p_tenant_id
     and collection.id = v_collection.id
     and collection.active
  returning * into v_collection;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    before_data,
    after_data,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'knowledge.collection.updated',
    'knowledge_collection',
    v_collection.id,
    'info',
    jsonb_build_object('name', v_before_name),
    jsonb_build_object('name', v_collection.name, 'parentId', v_collection.parent_id),
    jsonb_build_object('parentId', v_collection.parent_id)
  );

  return query
  select
    v_collection.id,
    v_collection.name,
    v_collection.slug,
    v_collection.parent_id,
    v_collection.active;
end;
$$;

revoke all on function public.replace_knowledge_article_collections(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.create_knowledge_collection(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rename_knowledge_collection(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.replace_knowledge_article_collections(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function public.create_knowledge_collection(uuid, text, uuid, uuid) to service_role;
grant execute on function public.rename_knowledge_collection(uuid, uuid, text, uuid) to service_role;

commit;
