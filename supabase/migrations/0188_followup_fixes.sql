begin;

set local search_path = pg_catalog, public;

-- Follow-up fixes.
--
-- 1. Requester comments of knowledge articles that were sent before migration
--    0186 still contain the internal image references `![…](kb-image:<uuid>)`,
--    which requesters cannot open. They are rewritten once with
--    knowledge_article_requester_comment (0186), like newer comments.
--
--    Only comments named by a 'ticket.knowledge.sent' event are touched, only
--    while they still contain 'kb-image:' and do not contain the portal note
--    that knowledge_article_requester_comment appends. A second run (or a run
--    after newer sends) therefore changes nothing. The title is the current
--    title of the article; comments whose article no longer exists, or whose
--    rewritten body would exceed the comment length limit, are left as they
--    are.
--
--    Triggers on ticket_comments: only ticket_comments_updated_at fires on
--    update (the author name sync, push notifications and the Exchange mail
--    queue are insert triggers), so no notification or mail is sent. The
--    updated_at trigger is disabled for this statement so the comments keep
--    their timestamps and do not look edited. Realtime subscribers receive an
--    update event (ticket_comments is in the supabase_realtime publication),
--    which only makes open ticket views reload the comment.

alter table public.ticket_comments disable trigger ticket_comments_updated_at;

with sent as (
  select distinct
    event.ticket_id,
    (event.payload ->> 'comment_id')::uuid as comment_id,
    (event.payload ->> 'article_id')::uuid as article_id
  from public.ticket_events event
  where event.event_type = 'ticket.knowledge.sent'
    and event.payload ->> 'comment_id'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and event.payload ->> 'article_id'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
rewritten as (
  select
    comment.id,
    public.knowledge_article_requester_comment(article.title, comment.body) as body
  from sent
  join public.ticket_comments comment
    on comment.id = sent.comment_id and comment.ticket_id = sent.ticket_id
  join public.tickets ticket on ticket.id = comment.ticket_id
  join public.knowledge_articles article
    on article.id = sent.article_id and article.tenant_id = ticket.tenant_id
  where comment.body like '%kb-image:%'
    and position(
      'mit allen Bildern finden Sie im Portal in diesem Ticket im Bereich «Wissen»'
      in comment.body
    ) = 0
)
update public.ticket_comments comment
set body = rewritten.body
from rewritten
where comment.id = rewritten.id
  and char_length(rewritten.body) between 1 and 50000;

alter table public.ticket_comments enable trigger ticket_comments_updated_at;

commit;
