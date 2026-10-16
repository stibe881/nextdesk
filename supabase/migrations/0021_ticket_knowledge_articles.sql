begin;
set local search_path = pg_catalog, public;

create unique index if not exists tickets_id_tenant_unique
  on public.tickets (id, tenant_id);
create unique index if not exists knowledge_articles_id_tenant_unique
  on public.knowledge_articles (id, tenant_id);

create table if not exists public.ticket_knowledge_articles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  article_id uuid not null,
  visibility text not null default 'internal'
    constraint ticket_knowledge_articles_visibility_check
      check (visibility in ('internal', 'external')),
  attached_by uuid not null default auth.uid(),
  attached_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (ticket_id, article_id),
  constraint ticket_knowledge_articles_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_knowledge_articles_article_tenant_fk
    foreign key (article_id, tenant_id)
    references public.knowledge_articles (id, tenant_id) on delete cascade,
  constraint ticket_knowledge_articles_attacher_tenant_fk
    foreign key (tenant_id, attached_by)
    references public.tenant_memberships (tenant_id, user_id)
);
create index if not exists ticket_knowledge_articles_tenant_ticket_idx
  on public.ticket_knowledge_articles (tenant_id, ticket_id, attached_at desc);
create index if not exists ticket_knowledge_articles_article_tenant_idx
  on public.ticket_knowledge_articles (article_id, tenant_id);

-- The legacy knowledge article SELECT policy uses a NULL department, which
-- cannot satisfy department membership. This narrowly scoped helper uses the
-- existing tenant/department RBAC functions without broadening that policy.
-- Only published external articles are public; drafts/review remain staff-only.
create or replace function public.can_read_ticket_knowledge_article(
  p_tenant_id uuid, p_ticket_id uuid, p_article_id uuid
)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and public.can_read_ticket(p_ticket_id)
    and exists (
      select 1
      from public.tickets as ticket
      join public.knowledge_articles as article
        on article.tenant_id = ticket.tenant_id
      where ticket.id = p_ticket_id
        and ticket.tenant_id = p_tenant_id
        and article.id = p_article_id
        and article.status <> 'archived'
        and (
          (article.visibility = 'external' and article.status = 'published')
          or public.has_tenant_permission(p_tenant_id, 'knowledge.read')
          or public.has_ticket_permission(p_tenant_id, ticket.department_id, 'knowledge.read')
        )
    );
$$;

create or replace function public.validate_ticket_knowledge_article_change()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  article public.knowledge_articles%rowtype;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_knowledge_articles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.ticket_id is distinct from old.ticket_id
    or new.article_id is distinct from old.article_id
    or new.attached_by is distinct from old.attached_by
    or new.attached_at is distinct from old.attached_at
  ) then
    raise exception 'Link identity is immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is null or new.attached_by is distinct from auth.uid()
      or not public.is_active_tenant_member(new.tenant_id) then
      raise exception 'Invalid link attribution' using errcode = '42501';
    end if;
    if new.sent_at is not null then
      raise exception 'Links cannot be inserted as sent' using errcode = '23514';
    end if;
    new.attached_at := now();
  end if;

  if not exists (
    select 1 from public.tickets as ticket
    where ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id
  ) then
    raise exception 'Invalid ticket tenant' using errcode = '23503';
  end if;
  -- Serialize with changes to the referenced article, not merely an unlocked
  -- existence check. Composite FKs also guard service-role writes and reparenting.
  select * into article from public.knowledge_articles
    where id = new.article_id and tenant_id = new.tenant_id for share;
  if not found then
    raise exception 'Invalid article tenant' using errcode = '23503';
  end if;
  if new.visibility = 'external'
    and (article.visibility <> 'external' or article.status <> 'published') then
    raise exception 'External links require published external articles' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Visibility is an invariant over time, including edits through knowledge-base.
-- Downgrade rather than disclose an article that becomes internal/unpublished.
-- This conservative system transition keeps the historical sent_at timestamp.
create or replace function public.restrict_ticket_knowledge_article_links()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'knowledge_articles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;
  if new.visibility <> 'external' or new.status <> 'published' then
    update public.ticket_knowledge_articles
      set visibility = 'internal'
      where article_id = new.id and visibility = 'external';
  end if;
  return null;
end;
$$;

create or replace function public.audit_ticket_knowledge_article_changes()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  affected_row jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_knowledge_articles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;
  -- The link contains identifiers/state only. Never query or copy article
  -- title, body, summary, revision contents, or personal profile data here.
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  affected_row := coalesce(after_row, before_row);
  if exists (select 1 from public.tenants where id = (affected_row ->> 'tenant_id')::uuid) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity,
      before_data, after_data, metadata
    ) values (
      (affected_row ->> 'tenant_id')::uuid, auth.uid(),
      'ticket_knowledge_articles.' || lower(tg_op), 'ticket_knowledge_article',
      (affected_row ->> 'article_id')::uuid, 'info', before_row, after_row,
      jsonb_build_object('ticket_id', affected_row -> 'ticket_id',
                         'article_id', affected_row -> 'article_id', 'operation', tg_op)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists ticket_knowledge_articles_validate_change on public.ticket_knowledge_articles;
create trigger ticket_knowledge_articles_validate_change
  before insert or update on public.ticket_knowledge_articles
  for each row execute function public.validate_ticket_knowledge_article_change();
drop trigger if exists ticket_knowledge_articles_audit_changes on public.ticket_knowledge_articles;
create trigger ticket_knowledge_articles_audit_changes
  after insert or update or delete on public.ticket_knowledge_articles
  for each row execute function public.audit_ticket_knowledge_article_changes();
drop trigger if exists knowledge_articles_restrict_ticket_links on public.knowledge_articles;
create trigger knowledge_articles_restrict_ticket_links
  after update of visibility, status on public.knowledge_articles
  for each row execute function public.restrict_ticket_knowledge_article_links();

alter table public.ticket_knowledge_articles enable row level security;
revoke all on table public.ticket_knowledge_articles from public, anon, authenticated;
grant select, insert, delete on table public.ticket_knowledge_articles to authenticated;
-- sent_at is controlled by the atomic send RPC, not client-supplied timestamps.
grant update (visibility) on public.ticket_knowledge_articles to authenticated;
grant select, insert, update, delete on public.ticket_knowledge_articles to service_role;

drop policy if exists ticket_knowledge_articles_select_readable on public.ticket_knowledge_articles;
create policy ticket_knowledge_articles_select_readable
  on public.ticket_knowledge_articles for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and public.can_read_ticket(ticket_id)
    and public.can_read_ticket_knowledge_article(tenant_id, ticket_id, article_id)
    and (visibility = 'external' or public.can_read_internal_note(ticket_id))
  );
drop policy if exists ticket_knowledge_articles_insert_authorized on public.ticket_knowledge_articles;
create policy ticket_knowledge_articles_insert_authorized
  on public.ticket_knowledge_articles for insert to authenticated
  with check (
    attached_by = auth.uid() and sent_at is null
    and public.is_active_tenant_member(tenant_id)
    and public.can_read_ticket(ticket_id)
    and public.can_read_ticket_knowledge_article(tenant_id, ticket_id, article_id)
    and exists (
      select 1 from public.tickets as ticket
      where ticket.id = ticket_knowledge_articles.ticket_id
        and ticket.tenant_id = ticket_knowledge_articles.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_knowledge_articles_update_authorized on public.ticket_knowledge_articles;
create policy ticket_knowledge_articles_update_authorized
  on public.ticket_knowledge_articles for update to authenticated
  using (
    public.is_active_tenant_member(tenant_id) and public.can_read_ticket(ticket_id)
    and exists (
      select 1 from public.tickets as ticket
      where ticket.id = ticket_knowledge_articles.ticket_id
        and ticket.tenant_id = ticket_knowledge_articles.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  )
  with check (
    public.is_active_tenant_member(tenant_id) and public.can_read_ticket(ticket_id)
    and public.can_read_ticket_knowledge_article(tenant_id, ticket_id, article_id)
    and exists (
      select 1 from public.tickets as ticket
      where ticket.id = ticket_knowledge_articles.ticket_id
        and ticket.tenant_id = ticket_knowledge_articles.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );
drop policy if exists ticket_knowledge_articles_delete_authorized on public.ticket_knowledge_articles;
create policy ticket_knowledge_articles_delete_authorized
  on public.ticket_knowledge_articles for delete to authenticated
  using (
    public.is_active_tenant_member(tenant_id) and public.can_read_ticket(ticket_id)
    and exists (
      select 1 from public.tickets as ticket
      where ticket.id = ticket_knowledge_articles.ticket_id
        and ticket.tenant_id = ticket_knowledge_articles.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.update')
    )
  );

-- RPCs are intentionally caller-authenticated security definers: the original
-- knowledge RLS cannot read internal articles and direct ticket/comment writes
-- are denied. Authorization is rechecked inside every RPC; no actor argument or
-- service-role credential is accepted. All bodies come from current_revision.
create or replace function public.ticket_knowledge_read(
  p_tenant_id uuid, p_ticket_id uuid, p_query text default null
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_active_tenant_member(p_tenant_id)
    or not public.can_read_ticket(p_ticket_id)
    or not exists (select 1 from public.tickets where id = p_ticket_id and tenant_id = p_tenant_id) then
    raise exception 'Ticket not found or access denied' using errcode = 'P0002';
  end if;
  if p_query is not null then
    if char_length(btrim(p_query)) not between 2 and 120 then
      raise exception 'Invalid search query' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb) into result
    from (
      select article.id, article.title, article.visibility, revision.body, revision.summary
      from public.knowledge_articles as article
      join public.knowledge_article_revisions as revision
        on revision.article_id = article.id and revision.revision = article.current_revision
      where article.tenant_id = p_tenant_id and article.status <> 'archived'
        and public.can_read_ticket_knowledge_article(p_tenant_id, p_ticket_id, article.id)
        -- Literal substring matching: percent/underscore/commas are not SQL or
        -- PostgREST filter syntax, and there is no dynamic query construction.
        and strpos(lower(article.title || E'\n' || coalesce(revision.summary, '') || E'\n' || revision.body),
                   lower(btrim(p_query))) > 0
      order by article.updated_at desc, article.id
      limit 30
    ) as candidate;
    return jsonb_build_object('articles', result);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'articleId', link.article_id, 'visibility', link.visibility,
    'attachedAt', link.attached_at, 'sentAt', link.sent_at,
    'article', jsonb_build_object('id', article.id, 'title', article.title,
      'visibility', article.visibility, 'body', revision.body, 'summary', revision.summary)
  ) order by link.attached_at desc, link.article_id), '[]'::jsonb) into result
  from public.ticket_knowledge_articles as link
  join public.knowledge_articles as article
    on article.id = link.article_id and article.tenant_id = link.tenant_id
  join public.knowledge_article_revisions as revision
    on revision.article_id = article.id and revision.revision = article.current_revision
  where link.tenant_id = p_tenant_id and link.ticket_id = p_ticket_id
    and public.can_read_ticket_knowledge_article(p_tenant_id, p_ticket_id, article.id)
    and (link.visibility = 'external' or public.can_read_internal_note(p_ticket_id));
  return jsonb_build_object('links', result);
end;
$$;

create or replace function public.ticket_knowledge_mutate(
  p_action text, p_tenant_id uuid, p_ticket_id uuid,
  p_article_id uuid default null, p_visibility text default null,
  p_title text default null, p_body_markdown text default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ticket public.tickets%rowtype;
  article public.knowledge_articles%rowtype;
  link public.ticket_knowledge_articles%rowtype;
  revision public.knowledge_article_revisions%rowtype;
  comment_id uuid;
  sent_time timestamptz;
begin
  if p_action is null or p_action not in ('attach', 'detach', 'sendToRequester', 'createAndAttach') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.is_active_tenant_member(p_tenant_id)
    or not public.can_read_ticket(p_ticket_id) then
    raise exception 'Ticket not found or access denied' using errcode = 'P0002';
  end if;
  -- One lock order for all actions serializes sends, attach/detach and first
  -- response bookkeeping. Failures roll back article/link/comment/event/audit.
  select * into ticket from public.tickets
    where id = p_ticket_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'Ticket not found or access denied' using errcode = 'P0002';
  end if;
  if not public.has_ticket_permission(p_tenant_id, ticket.department_id, 'ticket.update') then
    raise exception 'Ticket update denied' using errcode = '42501';
  end if;
  if p_action in ('attach', 'createAndAttach') then
    if p_visibility is null or p_visibility not in ('internal', 'external') then
      raise exception 'Invalid visibility' using errcode = '22023';
    end if;
  elsif p_visibility is not null then
    raise exception 'Unexpected visibility' using errcode = '22023';
  end if;

  if p_action = 'createAndAttach' then
    if p_article_id is not null or p_title is null
      or char_length(btrim(p_title)) not between 3 and 240
      or p_body_markdown is null or char_length(btrim(p_body_markdown)) < 1
      or char_length(p_body_markdown) > 100000 then
      raise exception 'Invalid article content' using errcode = '22023';
    end if;
    if not public.has_tenant_permission(p_tenant_id, 'knowledge.manage') then
      raise exception 'Knowledge management denied' using errcode = '42501';
    end if;
    -- External content must follow the article publication model; a public
    -- link never silently makes a draft visible. No knowledge.publish bypass
    -- is exposed as a standalone action: this is the authorized create flow.
    insert into public.knowledge_articles (
      tenant_id, title, slug, visibility, status, current_revision, created_by, published_at
    ) values (
      p_tenant_id, btrim(p_title), 'ticket-article-' || gen_random_uuid()::text,
      p_visibility::public.comment_visibility,
      case when p_visibility = 'external' then 'published' else 'draft' end,
      1, auth.uid(), case when p_visibility = 'external' then now() else null end
    ) returning * into article;
    insert into public.knowledge_article_revisions (article_id, revision, body, author_id)
      values (article.id, 1, p_body_markdown, auth.uid());
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, after_data, metadata)
      values (p_tenant_id, auth.uid(), 'knowledge.article.created', 'article', article.id,
        jsonb_build_object('visibility', article.visibility, 'status', article.status, 'current_revision', 1),
        jsonb_build_object('source', 'ticket_knowledge', 'ticket_id', p_ticket_id));
  else
    if p_article_id is null or p_title is not null or p_body_markdown is not null then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    if p_action = 'detach' then
      -- Removal is allowed even after an article was archived or made unreadable;
      -- it returns no article content and does not disclose whether a link existed.
      delete from public.ticket_knowledge_articles
        where tenant_id = p_tenant_id and ticket_id = p_ticket_id and article_id = p_article_id;
      return jsonb_build_object('detached', true, 'articleId', p_article_id);
    end if;
    select * into article from public.knowledge_articles
      where id = p_article_id and tenant_id = p_tenant_id for update;
    if not found or not public.can_read_ticket_knowledge_article(p_tenant_id, p_ticket_id, p_article_id) then
      raise exception 'Article not found or access denied' using errcode = 'P0002';
    end if;
  end if;

  if p_action in ('attach', 'createAndAttach') then
    if p_visibility = 'external' and (article.visibility <> 'external' or article.status <> 'published') then
      raise exception 'External article required' using errcode = '23514';
    end if;
    if not exists (select 1 from public.knowledge_article_revisions as current_revision
      where current_revision.article_id = article.id and current_revision.revision = article.current_revision) then
      raise exception 'Current revision unavailable' using errcode = '23514';
    end if;
    insert into public.ticket_knowledge_articles (tenant_id, ticket_id, article_id, visibility, attached_by)
      values (p_tenant_id, p_ticket_id, article.id, p_visibility, auth.uid())
      on conflict (ticket_id, article_id) do nothing;
    select * into link from public.ticket_knowledge_articles
      where tenant_id = p_tenant_id and ticket_id = p_ticket_id and article_id = article.id;
    if link.visibility <> p_visibility then
      raise exception 'Link already has another visibility' using errcode = '23505';
    end if;
    return jsonb_build_object('link', jsonb_build_object(
      'articleId', link.article_id, 'visibility', link.visibility,
      'attachedAt', link.attached_at, 'sentAt', link.sent_at));
  end if;

  select * into link from public.ticket_knowledge_articles
    where tenant_id = p_tenant_id and ticket_id = p_ticket_id and article_id = article.id for update;
  if not found then
    raise exception 'Link not found or access denied' using errcode = 'P0002';
  end if;
  if link.visibility <> 'external' or article.visibility <> 'external' or article.status <> 'published' then
    raise exception 'External article and link required' using errcode = '23514';
  end if;
  -- Retries are idempotent: a link can be sent once, not double-posted by two
  -- simultaneous requests. Deliberate re-sending needs a fresh attachment.
  if link.sent_at is not null then
    return jsonb_build_object('articleId', article.id, 'sentAt', link.sent_at, 'alreadySent', true);
  end if;
  select * into revision from public.knowledge_article_revisions as current_revision
    where current_revision.article_id = article.id and current_revision.revision = article.current_revision for share;
  if not found or char_length(btrim(revision.body)) < 1 or char_length(revision.body) > 50000 then
    raise exception 'Current revision cannot be sent as a comment' using errcode = '23514';
  end if;
  sent_time := now();
  -- No greeting, signature, requester/agent name, email or profile lookup. Only
  -- the already-public current article body is copied; author_id stays in DB.
  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
    values (p_ticket_id, auth.uid(), 'external', revision.body) returning id into comment_id;
  update public.ticket_knowledge_articles set sent_at = sent_time
    where tenant_id = p_tenant_id and ticket_id = p_ticket_id and article_id = article.id;
  update public.tickets set first_responded_at = coalesce(first_responded_at, sent_time)
    where id = p_ticket_id and tenant_id = p_tenant_id;
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (p_ticket_id, auth.uid(), 'ticket.knowledge.sent',
      jsonb_build_object('article_id', article.id, 'revision', revision.revision,
                         'comment_id', comment_id, 'visibility', 'external'));
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_tenant_id, auth.uid(), 'ticket.knowledge.sent', 'ticket', p_ticket_id,
      jsonb_build_object('article_id', article.id, 'revision', revision.revision,
                         'comment_id', comment_id, 'sent_at', sent_time));
  return jsonb_build_object('articleId', article.id, 'commentId', comment_id,
                           'sentAt', sent_time, 'alreadySent', false);
end;
$$;

revoke all on function public.validate_ticket_knowledge_article_change() from public, anon, authenticated;
revoke all on function public.restrict_ticket_knowledge_article_links() from public, anon, authenticated;
revoke all on function public.audit_ticket_knowledge_article_changes() from public, anon, authenticated;
revoke all on function public.can_read_ticket_knowledge_article(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ticket_knowledge_read(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ticket_knowledge_mutate(text, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.can_read_ticket_knowledge_article(uuid, uuid, uuid) to authenticated;
grant execute on function public.ticket_knowledge_read(uuid, uuid, text) to authenticated;
grant execute on function public.ticket_knowledge_mutate(text, uuid, uuid, uuid, text, text, text) to authenticated;

commit;
