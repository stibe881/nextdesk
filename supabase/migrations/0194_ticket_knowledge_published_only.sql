begin;

set local search_path = pg_catalog, public;

-- The knowledge panel of a ticket only shows published articles: drafts and
-- articles in review stay in the knowledge base until they are published.
create or replace function public.ticket_knowledge_read(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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
      where article.tenant_id = p_tenant_id and article.status = 'published'
        and public.can_read_ticket_knowledge_article(p_tenant_id, p_ticket_id, article.id)
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
    and article.status = 'published'
    and public.can_read_ticket_knowledge_article(p_tenant_id, p_ticket_id, article.id)
    and (link.visibility = 'external' or public.can_read_internal_note(p_ticket_id));
  return jsonb_build_object('links', result);
end;
$function$;

commit;
