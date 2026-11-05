begin;

set local search_path = pg_catalog, public;

-- Knowledge follow-ups:
--   1. delete_knowledge_collection: a category goes with its subcategories in
--      one transaction (previously the edge function deleted the children and
--      the parent in separate requests). Articles stay; only their
--      assignments to the deleted categories disappear (cascade).
--   2. Sending a knowledge article to the requester (ticket_knowledge_mutate,
--      action sendToRequester) no longer copies kb-image references the
--      requester cannot load. Images become readable placeholders and the
--      comment points to the article in the ticket's knowledge area.

-- 1. Atomic category deletion -------------------------------------------------
create or replace function public.delete_knowledge_collection(
  p_tenant_id uuid,
  p_collection_id uuid,
  p_actor_id uuid default null
)
returns table (
  collection_id uuid,
  deleted_collection_ids uuid[],
  deleted_subcategories integer,
  removed_assignments integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_collection public.knowledge_collections%rowtype;
  v_child_ids uuid[];
  v_all_ids uuid[];
  v_assignments integer;
begin
  if p_tenant_id is null or p_collection_id is null then
    raise exception 'Tenant and collection are required' using errcode = '22023';
  end if;

  -- Same lock as create/rename: no subcategory can be added to the category
  -- while it is being deleted.
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  select *
    into v_collection
    from public.knowledge_collections as collection
   where collection.tenant_id = p_tenant_id
     and collection.id = p_collection_id
   for update;
  if not found then
    raise exception 'Knowledge collection does not exist' using errcode = 'P0002';
  end if;

  -- Categories have at most one subcategory level (migration 0088).
  select coalesce(array_agg(child.id order by child.id), '{}'::uuid[])
    into v_child_ids
    from public.knowledge_collections as child
   where child.tenant_id = p_tenant_id
     and child.parent_id = v_collection.id;
  perform 1
    from public.knowledge_collections as child
   where child.tenant_id = p_tenant_id
     and child.id = any(v_child_ids)
   for update;

  v_all_ids := v_child_ids || v_collection.id;

  select count(*)::integer
    into v_assignments
    from public.knowledge_article_collections as assignment
   where assignment.tenant_id = p_tenant_id
     and assignment.collection_id = any(v_all_ids);

  -- The parent key is ON DELETE RESTRICT: children first, all in this
  -- transaction.
  if cardinality(v_child_ids) > 0 then
    delete from public.knowledge_collections as child
     where child.tenant_id = p_tenant_id
       and child.id = any(v_child_ids);
  end if;
  delete from public.knowledge_collections as collection
   where collection.tenant_id = p_tenant_id
     and collection.id = v_collection.id;

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
    'knowledge.collection.deleted',
    'knowledge_collection',
    v_collection.id,
    'info',
    jsonb_build_object('name', v_collection.name, 'parentId', v_collection.parent_id),
    null,
    jsonb_build_object(
      'collectionId', v_collection.id,
      'deletedSubcategoryIds', to_jsonb(v_child_ids),
      'removedAssignments', v_assignments
    )
  );

  return query
  select
    v_collection.id,
    v_all_ids,
    cardinality(v_child_ids),
    v_assignments;
end;
$$;

revoke all on function public.delete_knowledge_collection(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_knowledge_collection(uuid, uuid, uuid)
  to service_role;

-- 2. Requester-ready article comments -----------------------------------------
-- Article images are private (kb-image:<id>). A requester cannot load them
-- from a ticket comment, so every image becomes a readable placeholder and a
-- closing line points to the article in the ticket's knowledge area, where
-- external articles are shown with their images.
create or replace function public.knowledge_article_requester_comment(
  p_title text,
  p_body text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  -- regexp_replace interprets backslashes in the replacement text.
  v_title_replacement text := replace(btrim(coalesce(p_title, '')), '\', '\\');
  v_reference constant text :=
    'kb-image:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_body text := coalesce(p_body, '');
begin
  -- ![](kb-image:…) and ![ ](kb-image:… "title")
  v_body := regexp_replace(
    v_body,
    '!\[[[:space:]]*\]\([[:space:]]*<?' || v_reference || '>?([[:space:]]+"[^"]*")?[[:space:]]*\)',
    '[Bild – im Wissensartikel «' || v_title_replacement || '» ansehen]',
    'gi'
  );
  -- ![alt](kb-image:…)
  v_body := regexp_replace(
    v_body,
    '!\[[[:space:]]*([^]]*[^][:space:]])[[:space:]]*\]\([[:space:]]*<?' || v_reference || '>?([[:space:]]+"[^"]*")?[[:space:]]*\)',
    '[Bild: \1 – im Wissensartikel «' || v_title_replacement || '» ansehen]',
    'gi'
  );
  -- [text](kb-image:…)
  v_body := regexp_replace(
    v_body,
    '\[([^]]*)\]\([[:space:]]*<?' || v_reference || '>?([[:space:]]+"[^"]*")?[[:space:]]*\)',
    '\1 (Bild im Wissensartikel «' || v_title_replacement || '»)',
    'gi'
  );
  -- Any other remaining reference (e.g. reference definitions).
  v_body := regexp_replace(
    v_body,
    v_reference,
    'Bild im Wissensartikel «' || v_title_replacement || '»',
    'gi'
  );
  return rtrim(v_body, E' \t\r\n')
    || E'\n\n---\n'
    || 'Den vollständigen Artikel «' || v_title || '» mit allen Bildern finden '
    || 'Sie im Portal in diesem Ticket im Bereich «Wissen» (unter «Abschluss & '
    || 'Nachbereitung»).';
end;
$$;

revoke all on function public.knowledge_article_requester_comment(text, text)
  from public, anon, authenticated;

-- Unchanged from migration 0055 except for the comment body of
-- sendToRequester (knowledge_article_requester_comment).
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
  comment_body text;
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
  -- Private image references become placeholders; the closing line points to
  -- the article (with its images) in the ticket's knowledge area.
  comment_body := public.knowledge_article_requester_comment(article.title, revision.body);
  if char_length(comment_body) > 50000 then
    raise exception 'Current revision cannot be sent as a comment' using errcode = '23514';
  end if;
  sent_time := now();
  -- No greeting, signature, requester/agent name, email or profile lookup. Only
  -- the already-public current article body is copied; author_id stays in DB.
  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
    values (p_ticket_id, auth.uid(), 'external', comment_body) returning id into comment_id;
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

revoke all on function public.ticket_knowledge_mutate(text, uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ticket_knowledge_mutate(text, uuid, uuid, uuid, text, text, text)
  to authenticated;

commit;
