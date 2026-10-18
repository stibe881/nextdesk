begin;

set local search_path = pg_catalog, public;

-- External ticket knowledge is a publication and requires the same explicit
-- knowledge.publish permission as the governed knowledge workflow.
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
    -- An externally visible ticket article is a publication. Creating it from
    -- a ticket must therefore not bypass the normal knowledge.publish gate.
    if p_visibility = 'external'
      and not public.has_tenant_permission(p_tenant_id, 'knowledge.publish') then
      raise exception 'Knowledge publication denied' using errcode = '42501';
    end if;
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

-- Keep at least one active tenant administrator even when a separate role
-- manager attempts to revoke another administrator's assignment. This guard is
-- data-level and therefore also protects future callers of the same table.
create or replace function public.prevent_last_tenant_administrator_revocation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_active_administrators integer;
begin
  if tg_op = 'UPDATE'
    and new.expires_at is not null
    and (old.expires_at is null or new.expires_at < old.expires_at)
    and new.expires_at <= timezone('utc', now())
    and exists (
      select 1
      from public.roles role
      where role.id = old.role_id
        and role.tenant_id = old.tenant_id
        and role.name = 'Tenant administrator'
        and role.scope = 'tenant'
        and role.active
    )
  then
    select count(*)
      into v_active_administrators
    from public.user_role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = assignment.tenant_id
      and role.name = 'Tenant administrator'
      and role.scope = 'tenant'
      and role.active
    join public.tenant_memberships membership
      on membership.tenant_id = assignment.tenant_id
      and membership.user_id = assignment.user_id
      and membership.status = 'active'
    where assignment.tenant_id = old.tenant_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()));

    if v_active_administrators <= 1 then
      raise exception 'At least one active tenant administrator is required'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_role_assignments_protect_last_tenant_administrator
  on public.user_role_assignments;
create trigger user_role_assignments_protect_last_tenant_administrator
before update of expires_at on public.user_role_assignments
for each row execute function public.prevent_last_tenant_administrator_revocation();

revoke all on function public.prevent_last_tenant_administrator_revocation()
  from public, anon, authenticated;

comment on function public.prevent_last_tenant_administrator_revocation() is
  'Prevents revoking the final active Tenant administrator assignment within a tenant.';

commit;
