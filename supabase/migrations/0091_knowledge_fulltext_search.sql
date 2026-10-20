begin;

-- A revision keeps the title that was valid when that revision was created.
-- This prevents an external reader from seeing a later draft title on an
-- otherwise still published article.
alter table public.knowledge_article_revisions
  add column if not exists title_snapshot text;

update public.knowledge_article_revisions revision
set title_snapshot = article.title
from public.knowledge_articles article
where article.id = revision.article_id
  and revision.title_snapshot is null;

alter table public.knowledge_article_revisions
  alter column title_snapshot set not null;

alter table public.knowledge_article_revisions
  drop constraint if exists knowledge_article_revisions_title_snapshot_length_check;
alter table public.knowledge_article_revisions
  add constraint knowledge_article_revisions_title_snapshot_length_check
  check (char_length(title_snapshot) between 3 and 240);

create or replace function public.knowledge_article_revision_apply_title_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.title_snapshot is null then
    select article.title
      into new.title_snapshot
      from public.knowledge_articles article
     where article.id = new.article_id;
  end if;

  if new.title_snapshot is null
    or char_length(new.title_snapshot) not between 3 and 240 then
    raise exception 'Knowledge revision title is invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_article_revisions_apply_title_snapshot
  on public.knowledge_article_revisions;
create trigger knowledge_article_revisions_apply_title_snapshot
before insert on public.knowledge_article_revisions
for each row execute function public.knowledge_article_revision_apply_title_snapshot();

-- Index revision text rather than browser-side fragments. The current revision
-- is searched for internal members; customer readers search only the already
-- published revision.
alter table public.knowledge_article_revisions
  add column if not exists search_document tsvector generated always as (
    setweight(
      to_tsvector('german'::regconfig, coalesce(summary, '')),
      'B'
    )
    || setweight(
      to_tsvector('german'::regconfig, coalesce(body, '')),
      'C'
    )
  ) stored;

create index if not exists knowledge_article_revisions_search_document_idx
  on public.knowledge_article_revisions using gin (search_document);

create index if not exists knowledge_article_revisions_title_search_document_idx
  on public.knowledge_article_revisions using gin (
    to_tsvector('german'::regconfig, title_snapshot)
  );
drop index if exists public.knowledge_articles_title_search_document_idx;

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
begin
  if p_tenant_id is null or char_length(btrim(coalesce(p_query, ''))) not between 1 and 120 then
    raise exception 'Invalid knowledge search query' using errcode = '22023';
  end if;

  v_query := websearch_to_tsquery('german'::regconfig, btrim(p_query));
  if numnode(v_query) = 0 then
    return;
  end if;

  return query
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
      )
    ) as rank
  from public.knowledge_articles article
  join public.knowledge_article_revisions revision
    on revision.article_id = article.id
   and revision.revision = case
     when p_can_read_internal then article.current_revision
     else article.published_revision
   end
  where article.tenant_id = p_tenant_id
    and article.status <> 'archived'
    and (
      revision.search_document @@ v_query
      or to_tsvector('german'::regconfig, revision.title_snapshot) @@ v_query
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
          from public.customer_organizations organization
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

revoke all on function public.search_knowledge_article_ids(uuid, text, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.search_knowledge_article_ids(uuid, text, boolean, uuid[]) to service_role;

commit;
