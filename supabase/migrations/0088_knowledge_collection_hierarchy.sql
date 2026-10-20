begin;

-- Knowledge categories support one optional parent level. The composite key
-- keeps every parent/child relationship inside its own tenant.
alter table public.knowledge_collections
  add column if not exists parent_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'knowledge_collections_parent_tenant_fkey'
      and conrelid = 'public.knowledge_collections'::regclass
  ) then
    alter table public.knowledge_collections
      add constraint knowledge_collections_parent_tenant_fkey
      foreign key (parent_id, tenant_id)
      references public.knowledge_collections(id, tenant_id)
      on delete restrict;
  end if;
end;
$$;

alter table public.knowledge_collections
  drop constraint if exists knowledge_collections_parent_not_self_check;
alter table public.knowledge_collections
  add constraint knowledge_collections_parent_not_self_check
  check (parent_id is null or parent_id <> id);

create index if not exists knowledge_collections_tenant_parent_name_idx
  on public.knowledge_collections (tenant_id, parent_id, name)
  where active;

create or replace function public.validate_knowledge_collection_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent_parent_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A knowledge category cannot be its own parent' using errcode = '23514';
  end if;

  select parent.parent_id
    into v_parent_parent_id
    from public.knowledge_collections as parent
   where parent.id = new.parent_id
     and parent.tenant_id = new.tenant_id
   for share;

  if not found then
    raise exception 'Knowledge category parent must belong to the same tenant' using errcode = '23503';
  end if;

  if v_parent_parent_id is not null then
    raise exception 'Knowledge categories support only one subcategory level' using errcode = '23514';
  end if;

  -- A category which already has direct children must stay a root category.
  -- Otherwise reparenting it would silently create a third hierarchy level.
  if exists (
    select 1
    from public.knowledge_collections as child
    where child.tenant_id = new.tenant_id
      and child.parent_id = new.id
  ) then
    raise exception 'A category with subcategories cannot itself be a subcategory' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_knowledge_collection_parent() from public, anon, authenticated;

drop trigger if exists knowledge_collections_validate_parent on public.knowledge_collections;
create trigger knowledge_collections_validate_parent
  before insert or update of tenant_id, parent_id on public.knowledge_collections
  for each row execute function public.validate_knowledge_collection_parent();

-- The legacy import predates the hierarchy. Derive its sole tenant from the
-- imported folder signature, never from a mutable SSO configuration. The root
-- signature also permits a safe re-run after a completed migration.
create temporary table knowledge_collection_hierarchy_target (
  tenant_id uuid primary key
) on commit drop;

insert into knowledge_collection_hierarchy_target (tenant_id)
select candidate.tenant_id
from (
  select collection.tenant_id
  from public.knowledge_collections as collection
  where collection.parent_id is null
    and collection.slug like 'legacy-folder-%'
    and collection.name ~ '^(ICT intern|ICT öffentlich) / .+$'
  group by collection.tenant_id
  having count(*) = 27

  union

  select collection.tenant_id
  from public.knowledge_collections as collection
  where collection.slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
  group by collection.tenant_id
  having count(*) = 2
) as candidate;

do $$
begin
  if (select count(*) from knowledge_collection_hierarchy_target) <> 1 then
    raise exception 'Expected exactly one complete legacy knowledge import target' using errcode = '23514';
  end if;
end;
$$;

-- Refuse a partial or unexpected data shape. This ensures a production run
-- either restructures all 27 imported folders and 64 linked articles, or rolls
-- back without changing a single legacy category.
do $$
declare
  v_flat_subcategory_count integer;
  v_hierarchical_subcategory_count integer;
  v_linked_article_count integer;
  v_article_assignment_count integer;
begin
  select count(*) into v_flat_subcategory_count
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.parent_id is null
    and collection.slug like 'legacy-folder-%'
    and collection.name ~ '^(ICT intern|ICT öffentlich) / .+$';

  select count(*) into v_hierarchical_subcategory_count
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.slug like 'legacy-folder-%'
    and collection.parent_id in (
      select root.id
      from public.knowledge_collections as root
      where root.tenant_id = target.tenant_id
        and root.slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
    );

  select count(distinct assignment.article_id) into v_linked_article_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = assignment.tenant_id
  where collection.slug like 'legacy-folder-%';

  select count(*) into v_article_assignment_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = assignment.tenant_id
  where collection.slug like 'legacy-folder-%';

  if v_flat_subcategory_count not in (0, 27)
    or v_hierarchical_subcategory_count not in (0, 27)
    or (v_flat_subcategory_count = 0 and v_hierarchical_subcategory_count <> 27)
    or (v_flat_subcategory_count = 27 and v_hierarchical_subcategory_count <> 0)
    or v_linked_article_count <> 64
    or v_article_assignment_count <> 64 then
    raise exception 'Legacy knowledge import is incomplete or unexpected' using errcode = '23514';
  end if;
end;
$$;

-- Preserve every existing legacy-folder and article-link identity while adding
-- two visible roots and turning the 27 imported folders into direct children.
-- The RETURNING rows are intentionally combined with existing rows: a single
-- statement snapshot cannot otherwise read freshly inserted parent records.
with root_input(name, slug) as (
  values
    ('ICT intern'::text, 'legacy-root-ict-intern'::text),
    ('ICT öffentlich'::text, 'legacy-root-ict-oeffentlich'::text)
), ensured_roots as (
  insert into public.knowledge_collections (
    tenant_id, name, slug, parent_id, active, created_by, updated_at
  )
  select target.tenant_id, root_input.name, root_input.slug, null, true, null, timezone('utc', now())
  from knowledge_collection_hierarchy_target as target
  cross join root_input
  on conflict (tenant_id, slug) do update
    set name = excluded.name,
        parent_id = null,
        active = true,
        updated_at = excluded.updated_at
    where public.knowledge_collections.name is distinct from excluded.name
       or public.knowledge_collections.parent_id is not null
       or public.knowledge_collections.active is distinct from true
  returning id, tenant_id, name
), roots as (
  select id, tenant_id, name
  from ensured_roots

  union

  select collection.id, collection.tenant_id, collection.name
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
), legacy_subcategories as (
  select
    collection.id,
    collection.tenant_id,
    split_part(collection.name, ' / ', 1) as root_name,
    substring(collection.name from char_length(split_part(collection.name, ' / ', 1)) + 4) as subcategory_name
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.parent_id is null
    and collection.slug like 'legacy-folder-%'
    and collection.name ~ '^(ICT intern|ICT öffentlich) / .+$'
), reparented as (
  update public.knowledge_collections as collection
     set parent_id = root.id,
         name = legacy.subcategory_name,
         updated_at = timezone('utc', now())
    from legacy_subcategories as legacy
    join roots as root
      on root.tenant_id = legacy.tenant_id
     and root.name = legacy.root_name
   where collection.id = legacy.id
  returning collection.id
), audit as (
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  )
  select
    target.tenant_id,
    null,
    'knowledge.legacy_import.category_hierarchy',
    'knowledge_import',
    null,
    'info',
    jsonb_build_object(
      'source_file', 'Solutions.xml',
      'root_category_count', 2,
      'reparented_subcategory_count', (select count(*) from reparented),
      'article_links_preserved', true
    )
  from knowledge_collection_hierarchy_target as target
  where exists (select 1 from reparented)
  returning id
)
select
  (select count(*) from ensured_roots) as changed_root_count,
  (select count(*) from reparented) as reparented_subcategory_count,
  (select count(*) from audit) as audit_count;

do $$
declare
  v_root_count integer;
  v_subcategory_count integer;
  v_linked_article_count integer;
  v_article_assignment_count integer;
begin
  select count(*) into v_root_count
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
    and collection.parent_id is null
    and collection.active;

  select count(*) into v_subcategory_count
  from public.knowledge_collections as collection
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = collection.tenant_id
  where collection.slug like 'legacy-folder-%'
    and collection.parent_id in (
      select root.id
      from public.knowledge_collections as root
      where root.tenant_id = target.tenant_id
        and root.slug in ('legacy-root-ict-intern', 'legacy-root-ict-oeffentlich')
    );

  select count(distinct assignment.article_id) into v_linked_article_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = assignment.tenant_id
  where collection.slug like 'legacy-folder-%';

  select count(*) into v_article_assignment_count
  from public.knowledge_article_collections as assignment
  join public.knowledge_collections as collection
    on collection.id = assignment.collection_id
   and collection.tenant_id = assignment.tenant_id
  join knowledge_collection_hierarchy_target as target
    on target.tenant_id = assignment.tenant_id
  where collection.slug like 'legacy-folder-%';

  if v_root_count <> 2
    or v_subcategory_count <> 27
    or v_linked_article_count <> 64
    or v_article_assignment_count <> 64 then
    raise exception 'Legacy knowledge hierarchy validation failed' using errcode = '23514';
  end if;
end;
$$;

commit;
