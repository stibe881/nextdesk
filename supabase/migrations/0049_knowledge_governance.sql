begin;

-- A published revision is an immutable customer-facing snapshot. New working
-- revisions may be drafted or reviewed without changing the published text.
alter table public.knowledge_articles
  add column if not exists published_revision integer,
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_requested_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.user_profiles(id) on delete set null;

update public.knowledge_articles
set published_revision = current_revision
where status = 'published'
  and published_revision is null;

alter table public.knowledge_articles
  drop constraint if exists knowledge_articles_published_revision_check;
alter table public.knowledge_articles
  add constraint knowledge_articles_published_revision_check
  check (published_revision is null or (published_revision >= 1 and published_revision <= current_revision));

create unique index if not exists knowledge_articles_id_tenant_unique
  on public.knowledge_articles (id, tenant_id);

create table if not exists public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, slug),
  unique (id, tenant_id)
);

create table if not exists public.knowledge_article_collections (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_id uuid not null,
  collection_id uuid not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (article_id, collection_id),
  foreign key (article_id, tenant_id)
    references public.knowledge_articles(id, tenant_id) on delete cascade,
  foreign key (collection_id, tenant_id)
    references public.knowledge_collections(id, tenant_id) on delete cascade
);
create index if not exists knowledge_article_collections_tenant_collection_idx
  on public.knowledge_article_collections (tenant_id, collection_id, article_id);

create table if not exists public.knowledge_article_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_id uuid not null,
  revision integer not null check (revision >= 1),
  requested_by uuid not null references public.user_profiles(id) on delete restrict,
  requested_at timestamptz not null default timezone('utc', now()),
  decided_by uuid references public.user_profiles(id) on delete set null,
  decided_at timestamptz,
  decision text check (decision in ('approved', 'rejected')),
  note text check (note is null or char_length(note) <= 1000),
  unique (article_id, revision),
  foreign key (article_id, tenant_id)
    references public.knowledge_articles(id, tenant_id) on delete cascade,
  check (
    (decision is null and decided_by is null and decided_at is null)
    or (decision is not null and decided_by is not null and decided_at is not null)
  )
);
create index if not exists knowledge_article_reviews_open_idx
  on public.knowledge_article_reviews (tenant_id, requested_at desc)
  where decision is null;

-- Customer/requester access is deliberately narrower than member access. A
-- published external revision is visible only to its customer organisation (or
-- globally when no organisation is assigned).
create or replace function public.can_read_external_knowledge_article(p_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.knowledge_articles article
    where article.id = p_article_id
      and article.visibility = 'external'
      and article.status <> 'archived'
      and article.published_revision is not null
      and public.is_active_tenant_member(article.tenant_id)
      and (
        article.customer_organization_id is null
        or exists (
          select 1
          from public.customer_memberships membership
          join public.customer_organizations organization
            on organization.id = membership.customer_organization_id
          where membership.user_id = auth.uid()
            and membership.access = 'company'
            and organization.id = article.customer_organization_id
            and organization.tenant_id = article.tenant_id
            and organization.active
        )
      )
  );
$$;

revoke all on function public.can_read_external_knowledge_article(uuid) from public;
grant execute on function public.can_read_external_knowledge_article(uuid) to authenticated;

alter table public.knowledge_collections enable row level security;
alter table public.knowledge_collections force row level security;
alter table public.knowledge_article_collections enable row level security;
alter table public.knowledge_article_collections force row level security;
alter table public.knowledge_article_reviews enable row level security;
alter table public.knowledge_article_reviews force row level security;

-- All category and review writes stay in the authenticated Edge API. Do not
-- grant direct table writes to browser clients.
revoke all on table public.knowledge_collections from anon, authenticated;
revoke all on table public.knowledge_article_collections from anon, authenticated;
revoke all on table public.knowledge_article_reviews from anon, authenticated;

-- Tighten old broad read policies so unpublished revisions cannot be obtained
-- by direct REST requests from ordinary requesters.
drop policy if exists knowledge_articles_select_authorized on public.knowledge_articles;
create policy knowledge_articles_select_authorized
on public.knowledge_articles
for select to authenticated
using (
  public.is_active_tenant_member(tenant_id)
  and (
    public.has_ticket_permission(tenant_id, null, 'knowledge.read')
    or public.can_read_external_knowledge_article(id)
  )
);

drop policy if exists knowledge_revisions_select_authorized on public.knowledge_article_revisions;
create policy knowledge_revisions_select_authorized
on public.knowledge_article_revisions
for select to authenticated
using (
  exists (
    select 1
    from public.knowledge_articles article
    where article.id = knowledge_article_revisions.article_id
      and public.is_active_tenant_member(article.tenant_id)
      and (
        public.has_ticket_permission(article.tenant_id, null, 'knowledge.read')
        or (
          public.can_read_external_knowledge_article(article.id)
          and article.published_revision = knowledge_article_revisions.revision
        )
      )
  )
);

commit;
